import asyncio
import logging
import os
import re
import httpx

from . import enricher

logger = logging.getLogger(__name__)

ELSEVIER_AUTHOR_BASE = os.environ.get(
    "ELSEVIER_AUTHOR_BASE", "https://api.elsevier.com/content/author"
)


def _check_author_match(author: dict, first_name: str, last_name: str) -> bool:
    """Verifica correspondência entre dados de coautoria do Scopus e o pesquisador."""
    surn = (author.get("ce:surname") or "").lower().strip()
    given = (author.get("ce:given-name") or "").lower().strip()

    if last_name not in surn:
        return False
    if not first_name:
        return True
    if first_name in given or given in first_name:
        return True

    given_letters = re.sub(r"[^a-z]", "", given)
    first_letters = re.sub(r"[^a-z]", "", first_name)
    if not given_letters or not first_letters:
        return False

    # Coautor ou pesquisador indexado apenas por inicial (ex: "C." ou "C")
    if len(first_letters) == 1 and given_letters.startswith(first_letters):
        return True
    if len(given_letters) == 1 and first_letters.startswith(given_letters):
        return True
    return False


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
) -> str | None:
    """Busca um AUID em um único DOI na API Scopus."""
    try:
        r = await http_client.get(
            "https://api.elsevier.com/content/search/scopus",
            params={"query": f"DOI({doi})"},
            headers={"X-ELS-APIKey": api_key, "Accept": "application/json"},
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
            headers={"X-ELS-APIKey": api_key, "Accept": "application/json"},
            timeout=8,
        )
        if r_abs.status_code != 200:
            return None
        authors = r_abs.json().get("abstracts-retrieval-response", {}).get("authors", {}).get("author", [])
        if isinstance(authors, dict):
            authors = [authors]

        for a in authors:
            if _check_author_match(a, first_name, last_name):
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
) -> str | None:
    """Descobre o Scopus Author ID (AUID) através dos DOIs em concorrência controlada."""
    if not dois or not researcher_name:
        return None

    name_parts = [p.lower() for p in re.split(r"[\s\.\-]+", researcher_name) if len(p) >= 3]
    if not name_parts:
        return None
    last_name = name_parts[-1]
    first_name = name_parts[0]

    clean_dois = []
    for d in dois:
        cleaned = d.strip().replace("doi:", "")
        cleaned = re.sub(r"^https?://(dx\.)?doi\.org/", "", cleaned, flags=re.I).strip()
        if cleaned and cleaned not in clean_dois:
            clean_dois.append(cleaned)
        if len(clean_dois) >= 4:
            break

    if not clean_dois:
        return None

    tasks = [
        asyncio.create_task(
            _resolve_single_doi_author(
                doi, first_name, last_name, researcher_name, http_client, api_key
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
) -> str | None:
    """Busca alternativa no Scopus Author Search pelo nome do pesquisador."""
    if not researcher_name:
        return None
    name_parts = [p.strip() for p in researcher_name.split() if len(p.strip()) >= 2]
    if len(name_parts) < 2:
        return None
    last = name_parts[-1]
    first = name_parts[0]

    try:
        r = await http_client.get(
            "https://api.elsevier.com/content/search/author",
            params={"query": f"authlast({last}) and authfirst({first})"},
            headers={"X-ELS-APIKey": api_key, "Accept": "application/json"},
            timeout=8,
        )
        if r.status_code != 200:
            return None
        entries = r.json().get("search-results", {}).get("entry") or []
        if not entries:
            return None

        for e in entries:
            pref = e.get("preferred-name") or {}
            full_pref = f"{pref.get('given-name', '')} {pref.get('surname', '')}".lower()
            if last.lower() in full_pref and first.lower() in full_pref:
                auid = e.get("dc:identifier", "").replace("AUTHOR_ID:", "").strip()
                if auid:
                    return auid
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
) -> dict | None:
    """Busca métricas de autor no Scopus com fallback em cascata."""
    api_key = enricher.get_api_key()
    if not api_key:
        return None

    # 1. Tentativa direta por ORCID
    entry, is_authorized = await _fetch_scopus_author_entry({"orcid": orcid}, http_client, api_key)
    if not is_authorized:
        logger.info("Scopus Author API nao autorizada (401/403). Interrompendo cascata para evitar latencia.")
        return None

    # 2. Descoberta concorrente por DOIs
    if not entry and dois and researcher_name:
        auid = await _discover_scopus_auid_from_dois(dois, researcher_name, http_client, api_key)
        if auid:
            entry, _ = await _fetch_scopus_author_entry({"author_id": auid}, http_client, api_key)

    # 3. Fallback por nome
    if not entry and researcher_name:
        auid = await _discover_scopus_auid_from_name(researcher_name, http_client, api_key)
        if auid:
            entry, _ = await _fetch_scopus_author_entry({"author_id": auid}, http_client, api_key)

    if not entry:
        return None

    return _parse_scopus_metrics(entry)
