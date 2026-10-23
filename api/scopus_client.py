import asyncio
import logging
import os
import re
import unicodedata
import httpx

from . import enricher

logger = logging.getLogger(__name__)

ELSEVIER_AUTHOR_BASE = os.environ.get(
    "ELSEVIER_AUTHOR_BASE", "https://api.elsevier.com/content/author"
)

AGNONES = {"junior", "filho", "filha", "neto", "neta", "sobrinho", "sobrinha"}
PARTICLES = {"de", "da", "do", "das", "dos", "e"}


def _strip_accents(text: str) -> str:
    """Remove acentuação para comparação fonética e de grafia robusta."""
    if not text:
        return ""
    return "".join(
        c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn"
    )


def _clean_orcid(val: str | None) -> str:
    """Extrai apenas dígitos e 'X' maiúsculo de um ORCID."""
    if not val:
        return ""
    return re.sub(r"[^0-9Xx]", "", str(val)).upper()


def _is_orcid_conflict_raw(orcid_a: str | None, orcid_b: str | None) -> bool:
    """Verifica se dois ORCIDs válidos são diferentes entre si."""
    clean_a = _clean_orcid(orcid_a)
    clean_b = _clean_orcid(orcid_b)
    return bool(clean_a and clean_b and clean_a != clean_b)


def _extract_entry_orcid(entry: dict) -> str | None:
    """Extrai o ORCID do perfil de autor retornado pela Elsevier."""
    core = entry.get("coredata") or {}
    if core.get("orcid"):
        return str(core["orcid"]).strip()
    prof = entry.get("author-profile") or {}
    if prof.get("orcid"):
        return str(prof["orcid"]).strip()
    personal = prof.get("personal-details") or {}
    if personal.get("orcid"):
        return str(personal["orcid"]).strip()
    return None


def _is_orcid_conflict(entry: dict, target_orcid: str | None) -> bool:
    """Verifica se o perfil retornado possui um ORCID conflitante com o pesquisador alvo."""
    if not target_orcid or not entry:
        return False
    entry_orcid = _extract_entry_orcid(entry)
    return _is_orcid_conflict_raw(entry_orcid, target_orcid)


def parse_brazilian_name(researcher_name: str) -> dict:
    """Decompõe nomes brasileiros tratando agnomes (Júnior, Filho), partículas e prenomes."""
    clean_name = _strip_accents(researcher_name)
    tokens = [p.strip().lower() for p in re.split(r"[\s\.\-]+", clean_name) if p.strip()]
    if not tokens:
        return {
            "first": "", "middles": [], "last": "", "agnome": None,
            "search_first": "", "search_last": "", "last_tokens": set()
        }

    first = tokens[0]
    agnome = tokens[-1] if len(tokens) > 1 and tokens[-1] in AGNONES else None

    # Sobrenome significativo (ignorando agnome e partículas finais como 'de')
    idx = len(tokens) - 2 if agnome else len(tokens) - 1
    while idx > 0 and tokens[idx] in PARTICLES:
        idx -= 1

    search_last = tokens[idx] if idx >= 0 else tokens[-1]
    last_tokens = {search_last}
    if agnome:
        last_tokens.add(agnome)

    middles = [t for t in tokens[1:idx] if t not in PARTICLES]

    return {
        "first": first,
        "middles": middles,
        "last": " ".join(tokens[idx:]),
        "agnome": agnome,
        "search_first": first,
        "search_last": search_last,
        "last_tokens": last_tokens,
    }


def _check_author_match(
    author: dict,
    first_name: str,
    last_name: str,
    target_orcid: str | None = None,
) -> bool:
    """Verifica correspondência entre coautor do Scopus e o pesquisador alvo."""
    if target_orcid:
        author_orcid = author.get("@orcid") or author.get("orcid")
        if author_orcid and _is_orcid_conflict_raw(author_orcid, target_orcid):
            return False

    surn_raw = _strip_accents((author.get("ce:surname") or "").lower().strip())
    surn_tokens = set(re.findall(r"[a-z]+", surn_raw)) - PARTICLES
    last_tokens = set(re.findall(r"[a-z]+", _strip_accents(last_name.lower()))) - PARTICLES - AGNONES

    if last_tokens and not (last_tokens & surn_tokens):
        return False

    if not first_name:
        return True

    given_raw = _strip_accents((author.get("ce:given-name") or "").lower().strip())
    given_tokens = re.findall(r"[a-z]+", given_raw)
    target_first = _strip_accents(re.sub(r"[^a-z]", "", first_name.lower()))

    if not given_tokens or not target_first:
        initials_raw = _strip_accents((author.get("ce:initials") or "").lower())
        init_letters = re.findall(r"[a-z]", initials_raw)
        return bool(init_letters and target_first.startswith(init_letters[0]))

    first_given = given_tokens[0]

    # Ambos completos: primeiro nome deve coincidir exatamente
    if len(first_given) >= 2 and len(target_first) >= 2:
        return first_given == target_first

    # Um dos lados é abreviação/inicial: confere primeira letra
    return target_first.startswith(first_given[0])


def _score_scopus_author_candidate(
    entry: dict,
    parsed_name: dict,
    target_orcid: str | None = None,
) -> float:
    """Calcula pontuação de confiabilidade de um candidato retornado pela busca por nome."""
    entry_orcid = entry.get("orcid")
    if target_orcid and entry_orcid:
        if _is_orcid_conflict_raw(entry_orcid, target_orcid):
            return -1.0
        if _clean_orcid(entry_orcid) == _clean_orcid(target_orcid):
            return 100.0

    pref = entry.get("preferred-name") or {}
    given = _strip_accents((pref.get("given-name") or "").lower().strip())
    surname = _strip_accents((pref.get("surname") or "").lower().strip())

    given_tokens = re.findall(r"[a-z]+", given)
    surn_tokens = set(re.findall(r"[a-z]+", surname)) - PARTICLES
    if not given_tokens or not surn_tokens:
        return -1.0

    target_first = parsed_name["first"]
    first_given = given_tokens[0]

    # Primeiro nome deve casar
    if len(first_given) >= 2 and len(target_first) >= 2:
        if first_given != target_first:
            return -1.0
    elif not target_first.startswith(first_given[0]):
        return -1.0

    # Sobrenome principal deve estar presente
    if not (surn_tokens & parsed_name["last_tokens"]):
        return -1.0

    score = 10.0

    # Bônus para nomes intermediários coincidentes
    for mid in parsed_name["middles"]:
        if mid in given_tokens or mid in surn_tokens:
            score += 5.0
        elif any(g.startswith(mid[0]) for g in given_tokens):
            score += 2.0

    # Bônus por agnome
    if parsed_name["agnome"] and (parsed_name["agnome"] in surn_tokens or parsed_name["agnome"] in given_tokens):
        score += 5.0

    # Bônus por afiliação Brasil
    affil = entry.get("affiliation-current") or {}
    country = (affil.get("affiliation-country") or "").lower()
    if country in {"brazil", "brasil"}:
        score += 3.0

    # Bônus por áreas da saúde/biológicas
    subjs = str(entry.get("subject-area") or "").upper()
    if any(s in subjs for s in ["MEDI", "NURS", "HEAL", "BIOC", "PHAR"]):
        score += 2.0

    return score


def _elsevier_headers(api_key: str) -> dict:
    headers = {"X-ELS-APIKey": api_key, "Accept": "application/json"}
    inst_token = os.environ.get("ELSEVIER_INST_TOKEN")
    if inst_token:
        headers["X-ELS-Insttoken"] = inst_token
    return headers


async def _fetch_scopus_author_entry(
    params: dict,
    http_client: httpx.AsyncClient,
    api_key: str,
) -> tuple[dict | None, bool]:
    """Consulta entrada de autor diretamente na API da Elsevier. Retorna (entry, is_authorized)."""
    try:
        response = await http_client.get(
            ELSEVIER_AUTHOR_BASE,
            params={**params, "view": "ENHANCED"},
            headers=_elsevier_headers(api_key),
            timeout=8,
        )
        if response.status_code in {401, 403}:
            logger.warning(
                f"Scopus Author API retornou {response.status_code} "
                f"(chave sem assinatura institucional ou ELSEVIER_INST_TOKEN ausente)."
            )
            return None, False
        if response.status_code != 200:
            return None, True
        entries = response.json().get("author-retrieval-response") or []
        if not entries or entries[0].get("@status") != "found":
            return None, True
        return entries[0], True
    except Exception as exc:
        logger.debug(f"Falha ao consultar Scopus Author ({params}): {exc}")
        return None, True


async def _resolve_single_doi_author(
    doi: str,
    first_name: str,
    last_name: str,
    researcher_name: str,
    http_client: httpx.AsyncClient,
    api_key: str,
    target_orcid: str | None = None,
) -> str | None:
    """Busca um AUID em um único DOI na API Scopus."""
    try:
        r = await http_client.get(
            "https://api.elsevier.com/content/search/scopus",
            params={"query": f"DOI({doi})"},
            headers=_elsevier_headers(api_key),
            timeout=8,
        )
        if r.status_code != 200:
            return None
        entries = r.json().get("search-results", {}).get("entry") or []
        if not entries or "error" in entries[0]:
            return None
        scopus_id = entries[0].get("dc:identifier", "").replace("SCOPUS_ID:", "").strip()
        if not scopus_id:
            return None

        r_abs = await http_client.get(
            f"https://api.elsevier.com/content/abstract/scopus_id/{scopus_id}",
            params={"field": "author"},
            headers=_elsevier_headers(api_key),
            timeout=8,
        )
        if r_abs.status_code != 200:
            return None
        authors = r_abs.json().get("abstracts-retrieval-response", {}).get("authors", {}).get("author", [])
        if isinstance(authors, dict):
            authors = [authors]

        for a in authors:
            if _check_author_match(a, first_name, last_name, target_orcid=target_orcid):
                auid = a.get("@auid")
                if auid:
                    logger.info(f"Scopus AUID {auid} descoberto via DOI {doi} para '{researcher_name}'")
                    return str(auid).strip()
    except Exception as exc:
        logger.debug(f"Erro ao checar DOI {doi} no Scopus: {exc}")
    return None


async def _discover_scopus_auid_from_dois(
    dois: list[str],
    researcher_name: str,
    http_client: httpx.AsyncClient,
    api_key: str,
    target_orcid: str | None = None,
) -> str | None:
    """Descobre o Scopus Author ID (AUID) através dos DOIs em concorrência controlada."""
    if not dois or not researcher_name:
        return None

    parsed = parse_brazilian_name(researcher_name)
    first_name = parsed["first"]
    last_name = parsed["search_last"]
    if not first_name or not last_name:
        return None

    clean_dois = []
    for d in dois:
        cleaned = d.strip().replace("doi:", "")
        cleaned = re.sub(r"^https?://(dx\.)?doi\.org/", "", cleaned, flags=re.I).strip()
        if cleaned and cleaned not in clean_dois:
            clean_dois.append(cleaned)
        if len(clean_dois) >= 6:
            break

    if not clean_dois:
        return None

    tasks = [
        asyncio.create_task(
            _resolve_single_doi_author(
                doi, first_name, last_name, researcher_name, http_client, api_key, target_orcid=target_orcid
            )
        )
        for doi in clean_dois
    ]

    discovered_auid = None
    try:
        for fut in asyncio.as_completed(tasks):
            res = await fut
            if res:
                discovered_auid = res
                break
    finally:
        for t in tasks:
            if not t.done():
                t.cancel()

    return discovered_auid


async def _discover_scopus_auid_from_name(
    researcher_name: str,
    http_client: httpx.AsyncClient,
    api_key: str,
    target_orcid: str | None = None,
) -> str | None:
    """Busca alternativa no Scopus Author Search pelo nome do pesquisador com scoring e desambiguação."""
    if not researcher_name:
        return None
    parsed = parse_brazilian_name(researcher_name)
    last = parsed["search_last"]
    first = parsed["search_first"]
    if not last or not first:
        return None

    try:
        r = await http_client.get(
            "https://api.elsevier.com/content/search/author",
            params={"query": f"authlast({last}) and authfirst({first})"},
            headers=_elsevier_headers(api_key),
            timeout=8,
        )
        if r.status_code != 200:
            return None
        entries = r.json().get("search-results", {}).get("entry") or []
        if not entries:
            return None

        best_auid = None
        best_score = 0.0

        for e in entries:
            score = _score_scopus_author_candidate(e, parsed, target_orcid)
            if score > best_score:
                auid = e.get("dc:identifier", "").replace("AUTHOR_ID:", "").strip()
                if auid:
                    best_score = score
                    best_auid = auid

        if best_score >= 10.0 and best_auid:
            logger.info(
                f"Scopus AUID {best_auid} selecionado para '{researcher_name}' "
                f"com score {best_score:.1f}"
            )
            return best_auid
    except Exception as exc:
        logger.debug(f"Falha na busca por nome no Scopus: {exc}")
    return None


def _parse_scopus_metrics(entry: dict) -> dict:
    """Extrai campos numéricos e links da entrada bruta do Scopus."""
    core = entry.get("coredata") or {}

    h_idx = None
    if entry.get("h-index") is not None:
        try:
            h_idx = int(entry["h-index"])
        except (ValueError, TypeError):
            h_idx = None

    citations = None
    citations_raw = core.get("citation-count") or core.get("cited-by-count")
    if citations_raw is not None:
        try:
            citations = int(citations_raw)
        except (ValueError, TypeError):
            citations = None

    documents = None
    if core.get("document-count") is not None:
        try:
            documents = int(core["document-count"])
        except (ValueError, TypeError):
            documents = None

    links = core.get("link") or []
    profile_url = next((l.get("@href") for l in links if l.get("@rel") == "scopus-author"), None)
    author_id = core.get("dc:identifier", "").replace("AUTHOR_ID:", "").strip()
    if not profile_url and author_id:
        profile_url = f"https://www.scopus.com/authid/detail.uri?authorId={author_id}"

    return {
        "h_index": h_idx,
        "citations": citations,
        "documents": documents,
        "author_id": author_id or None,
        "profile_url": profile_url,
        "source": "Scopus (Elsevier)",
        "available": True,
    }


async def fetch_scopus_author_metrics(
    orcid: str,
    http_client: httpx.AsyncClient,
    researcher_name: str | None = None,
    dois: list[str] | None = None,
    scopus_auid: str | None = None,
) -> dict | None:
    """Busca métricas de autor no Scopus com fallback em cascata e validação anti-homônimos.

    Prioridade:
    0. AUID direto do ORCID external-identifiers (mais confiável)
    1. Busca por ORCID na API Elsevier
    2. Descoberta por DOIs
    3. Fallback por nome com validação estrita e scoring
    """
    api_key = enricher.get_api_key()
    if not api_key:
        return None

    entry = None
    is_authorized = True

    # 0. AUID direto extraído do perfil ORCID (fonte mais confiável)
    if scopus_auid:
        logger.info(f"Usando Scopus Author ID {scopus_auid} do perfil ORCID (via external-identifiers)")
        entry, is_authorized = await _fetch_scopus_author_entry(
            {"author_id": scopus_auid}, http_client, api_key
        )
        if not is_authorized:
            logger.info("Scopus Author API nao autorizada (401/403). Interrompendo cascata.")
            return None
        if entry and not _is_orcid_conflict(entry, orcid):
            return _parse_scopus_metrics(entry)
        entry = None

    # 1. Tentativa direta por ORCID
    entry, is_authorized = await _fetch_scopus_author_entry({"orcid": orcid}, http_client, api_key)
    if not is_authorized:
        logger.info("Scopus Author API nao autorizada (401/403). Interrompendo cascata para evitar latencia.")
        return None
    if entry and not _is_orcid_conflict(entry, orcid):
        return _parse_scopus_metrics(entry)
    entry = None

    # 2. Descoberta concorrente por DOIs
    if dois and researcher_name:
        auid = await _discover_scopus_auid_from_dois(
            dois, researcher_name, http_client, api_key, target_orcid=orcid
        )
        if auid:
            entry, _ = await _fetch_scopus_author_entry({"author_id": auid}, http_client, api_key)
            if entry:
                if _is_orcid_conflict(entry, orcid):
                    logger.warning(
                        f"Scopus AUID {auid} descartado: possui ORCID vinculado diferente de {orcid}"
                    )
                    entry = None
                else:
                    return _parse_scopus_metrics(entry)

    # 3. Fallback por nome com desambiguação
    if researcher_name:
        auid = await _discover_scopus_auid_from_name(
            researcher_name, http_client, api_key, target_orcid=orcid
        )
        if auid:
            entry, _ = await _fetch_scopus_author_entry({"author_id": auid}, http_client, api_key)
            if entry:
                if _is_orcid_conflict(entry, orcid):
                    logger.warning(
                        f"Scopus AUID {auid} (via nome) descartado: possui ORCID vinculado diferente de {orcid}"
                    )
                    entry = None
                else:
                    return _parse_scopus_metrics(entry)

    return None
