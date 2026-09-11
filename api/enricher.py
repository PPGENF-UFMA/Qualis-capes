import asyncio
import json
import math
import os
import re
import threading
import logging
from collections import defaultdict
from datetime import datetime

logger = logging.getLogger(__name__)

import httpx
from bs4 import BeautifulSoup

from . import cache
from . import engine

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOURNALS_PATH = os.path.join(PROJECT_ROOT, "data", "journals.json")
ALIASES_PATH = os.path.join(PROJECT_ROOT, "data", "aliases.json")
USER_ALIASES_PATH = os.path.join(PROJECT_ROOT, "data", "user_aliases.json")
CROSSREF_CACHE_PATH = os.path.join(PROJECT_ROOT, "data", "crossref_cache.json")
ELSEVIER_BASE = "https://api.elsevier.com/content/serial/title/issn"

def get_api_key() -> str:
    return os.environ.get("ELSEVIER_API_KEY", "")

_journals_db: dict[str, dict] | None = None
_issn_index: dict[str, str] = {}
_database_meta: dict = {}
_title_index: dict[str, list[str]] = {}
_idf_weights: dict[str, float] = {}
_db_summary_cache: list[dict] | None = None
_server_aliases: dict[str, str] = {}
_user_aliases: dict[str, str] = {}
_match_stats: dict[str, int] = defaultdict(int)  # fase 3a/3e
_crossref_cache: dict[str, dict] = {}
_alias_lock = threading.Lock()
_crossref_lock = threading.Lock()

import unicodedata

# Stopwords "generalistas" — peso IDF baixo no Jaccard. Espelha js/lattesParser.js.
_MATCH_GENERIC_TERMS = {
    "REVISTA", "JOURNAL", "JOURNALS", "REV", "R",
    "CIENCIA", "CIENCIAS", "CIENCE", "SCIENCES", "SCIENCE",
    "SAUDE", "HEALTH", "SAUDAVEL",
    "EDUCACAO", "EDUCATION", "EDUCATIONAL",
    "HUMANAS", "HUMANITIES", "SOCIAIS", "SOCIAL",
    "BRASILEIRA", "BRASILEIRAS", "BRASIL", "BRAZIL", "BR",
    "INTERNACIONAL", "INTERNATIONAL", "INTER", "NACIONAL", "NATIONAL",
    "E", "Y", "ET", "UND",
    "DA", "DE", "DO", "DAS", "DOS",
    "OF", "THE", "IN", "ON", "FOR", "AND",
    "ARTIGO", "ARTICLES", "PAPER",
    "ONLINE", "IMPRESSO", "PRINT", "DIGITAL", "ELETRONICA", "ELETRONICO",
    "COLETIVA", "COLETIVAS", "PUBLICA", "PUBLICAS",
    "PUBLIC", "PUBLICACAO",
}

_STOPWORDS_RE = re.compile(
    r"\b(?:DE|DA|DOS|DAS|DO|EM|OF|THE|IN|ON|PARA|SOB|A|O|AS|OS|UM|UNS|UMA|UMAS)\b"
)

def _normalize_text(text: str) -> str:
    """Normalização alinhada com js/lattesParser.js::normalizeString.

    Caixa alta + strip acentos + & -> E + pontuações viram espaço +
    remoção de stopwords simples (DE, DA, DO, EM, OF, THE, IN, ON, ...).
    """
    if not text: return ""
    text = text.upper()
    text = unicodedata.normalize("NFD", text)
    text = re.sub(r"[\u0300-\u036f]", "", text)  # remove acentos
    text = text.replace("&", " E ")
    text = re.sub(r"[\u2018\u2019\u201C\u201D]", "'", text)  # aspas curvas
    text = re.sub(r"[\.\,\-\;\:\?\!\"\'\(\)\[\]\/]", " ", text)
    text = _STOPWORDS_RE.sub(" ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _jaro_winkler(s1: str, s2: str) -> float:
    """Jaro-Winkler — similaridade 0.0–1.0.

    Bônus de prefixo Winkler limitado a 2 caracteres (em vez de 4) para
    evitar viés de "REVI"/"JOUR" inflar scores entre periódicos que
    compartilham prefixos genéricos.
    """
    if s1 == s2:
        return 1.0
    len1, len2 = len(s1), len(s2)
    if len1 == 0 or len2 == 0:
        return 0.0
    max_dist = max(len1, len2) // 2 - 1
    hash_s1 = [0] * len1
    hash_s2 = [0] * len2
    m = 0
    for i in range(len1):
        start = max(0, i - max_dist)
        end = min(len2, i + max_dist + 1)
        for j in range(start, end):
            if s1[i] == s2[j] and hash_s2[j] == 0:
                hash_s1[i] = 1
                hash_s2[j] = 1
                m += 1
                break
    if m == 0:
        return 0.0
    t = 0
    point = 0
    for i in range(len1):
        if hash_s1[i]:
            while point < len2 and hash_s2[point] == 0:
                point += 1
            if point < len2 and s1[i] != s2[point]:
                t += 1
            point += 1
    t = t / 2
    jaro = (m / len1 + m / len2 + (m - t) / m) / 3.0
    p = 0.1
    l = 0
    for i in range(min(2, min(len1, len2))):  # bônus limitado a 2 chars
        if s1[i] == s2[i]:
            l += 1
        else:
            break
    return jaro + l * p * (1 - jaro)


def _fuzzy_match_name(query: str, db_items: list[dict], threshold: float = 0.90) -> list[dict]:
    """Busca fuzzy (Jaro-Winkler) entre um nome e os títulos da base local.

    Retorna resultados ordenados por score de similaridade, acima do threshold.
    """
    if not query or not db_items:
        return []
    norm_query = _normalize_text(query)
    if not norm_query:
        return []
    query_terms = [t for t in norm_query.split() if len(t) >= 3]
    candidates = []
    for item in db_items:
        title = item.get("title") or ""
        norm_title = _normalize_text(title)
        if not norm_title:
            continue
        if query_terms:
            if not any(t in norm_title for t in query_terms):
                continue
        score = _jaro_winkler(norm_query, norm_title)
        if score >= threshold:
            candidates.append((item.get("issn"), item.get("title"), score))
    candidates.sort(key=lambda x: x[2], reverse=True)
    return [
        {"issn": issn, "title": title, "area": "Outras Áreas", "source": "local-fuzzy"}
        for issn, title, _ in candidates[:20]
    ]

def _build_title_index():
    """Reconstrói o índice invertido token→[issn] e os pesos IDF por token.

    Indexa também variantes de título (_variants_raw) coletadas de APIs externas.
    Chamar dentro de load_database (sob lock) — uma única passada no DB.
    """
    global _title_index, _idf_weights
    _title_index.clear()
    _idf_weights.clear()
    if not _journals_db: return
    df: dict[str, int] = defaultdict(int)
    for issn, record in _journals_db.items():
        titles = [record.get("title", "")]
        titles.extend(record.get("_variants_raw") or [])
        seen = set()
        for title in titles:
            for token in _normalize_text(title).split():
                if len(token) < 2: continue
                if token in seen: continue
                seen.add(token)
                df[token] += 1
    n = len(_journals_db)
    for token, df_count in df.items():
        _idf_weights[token] = math.log((n + 1) / (df_count + 1)) + 1
    for issn, record in _journals_db.items():
        titles = [record.get("title", "")]
        titles.extend(record.get("_variants_raw") or [])
        for title in titles:
            for token in _normalize_text(title).split():
                if len(token) >= 3:
                    _title_index.setdefault(token, []).append(issn)


def _load_server_aliases():
    """Carrega data/aliases.json + data/user_aliases.json em memória.

    User aliases têm precedência sobre aliases estáticos (foram validados
    por um usuário real com feedback explícito).
    """
    global _server_aliases, _user_aliases
    _server_aliases.clear()
    _user_aliases.clear()

    # Aliases estáticos (curados manualmente)
    if os.path.exists(ALIASES_PATH):
        try:
            with open(ALIASES_PATH, "r", encoding="utf-8") as f:
                raw = json.load(f)
            for key, issn in raw.items():
                norm_key = _normalize_text(key)
                if norm_key:
                    _server_aliases[norm_key] = issn
        except (json.JSONDecodeError, OSError) as e:
            logger.warning(f"Falha ao carregar {ALIASES_PATH}: {e}")

    # User aliases (aprendidos via feedback explícito — mais confiáveis)
    if os.path.exists(USER_ALIASES_PATH):
        try:
            with open(USER_ALIASES_PATH, "r", encoding="utf-8") as f:
                raw = json.load(f)
            for key, issn in raw.items():
                norm_key = _normalize_text(key)
                if norm_key:
                    _user_aliases[norm_key] = issn
                    _server_aliases[norm_key] = issn  # user alias sobrepõe estáticos
        except (json.JSONDecodeError, OSError) as e:
            logger.warning(f"Falha ao carregar {USER_ALIASES_PATH}: {e}")


def save_user_alias(journal_name: str, issn: str):
    """Persiste um alias aprendido no disco para todos os clientes."""
    global _server_aliases, _user_aliases
    norm_key = _normalize_text(journal_name)
    if not norm_key or not issn:
        return
    try:
        with _alias_lock:
            _server_aliases[norm_key] = issn
            _user_aliases[norm_key] = issn
            existing = {}
            if os.path.exists(USER_ALIASES_PATH):
                with open(USER_ALIASES_PATH, "r", encoding="utf-8") as f:
                    existing = json.load(f)
            existing[journal_name] = issn
            cache.save_json_cache(USER_ALIASES_PATH, existing)
    except Exception as e:
        logger.warning(f"Falha ao salvar user alias: {e}")


def normalize_issn(issn: str) -> str:
    if not isinstance(issn, str):
        return ""
    cleaned = re.sub(r"[^0-9Xx]", "", issn).upper()
    if len(cleaned) != 8:
        return ""
        
    weights = [8, 7, 6, 5, 4, 3, 2]
    total = sum(int(cleaned[i]) * weights[i] for i in range(7))
    rem = total % 11
    check_digit = 11 - rem
    
    if check_digit == 10:
        expected = "X"
    elif check_digit == 11:
        expected = "0"
    else:
        expected = str(check_digit)
        
    if cleaned[7] != expected:
        return ""
        
    return f"{cleaned[:4]}-{cleaned[4:]}"


_db_lock = threading.Lock()

def _merge_records(r1: dict, r2: dict) -> dict:
    if not r1: return r2
    if not r2: return r1
    
    jcr = r1.get("jcr")
    jcr2 = r2.get("jcr")
    if jcr2 is not None and (jcr is None or jcr2 > jcr):
        jcr = jcr2

    cs = r1.get("citeScore")
    cs2 = r2.get("citeScore")
    if cs2 is not None and (cs is None or cs2 > cs):
        cs = cs2

    idx = set(r1.get("indexers", []))
    idx.update(r2.get("indexers", []))

    t1 = r1.get("title") or ""
    t2 = r2.get("title") or ""
    title = t1 if len(t1) >= len(t2) else t2

    area = r1.get("area", "Outras Áreas")
    if r2.get("area") == "Enfermagem":
        area = "Enfermagem"

    merged = {
        "title": title,
        "area": area,
        "jcr": jcr,
        "citeScore": cs,
        "indexers": list(idx),
        "metrics": {
            "cuiden": r1.get("metrics", {}).get("cuiden") or r2.get("metrics", {}).get("cuiden")
        }
    }

    variants = set(r1.get("_variants_raw") or [])
    variants.update(r2.get("_variants_raw") or [])
    if t1 and t1 != title:
        variants.add(t1)
    if t2 and t2 != title:
        variants.add(t2)
    if variants:
        merged["_variants_raw"] = sorted(variants)
    
    for k in ["scieloUpdatedAt", "lilacsUpdatedAt", "latindexUpdatedAt"]:
        if k in r1 or k in r2:
            merged[k] = r1.get(k) or r2.get(k)
            
    return merged

def load_database() -> dict[str, dict]:
    global _journals_db, _issn_index, _database_meta, _db_summary_cache
    
    # Fast path if already loaded
    if _journals_db is not None:
        return _journals_db

    with _db_lock:
        # Double-check locking pattern
        if _journals_db is not None:
            return _journals_db

        if not os.path.exists(JOURNALS_PATH):
            logger.warning(f"Arquivo {JOURNALS_PATH} nao encontrado.")
            _journals_db = {}
            return _journals_db

        try:
            with open(JOURNALS_PATH, "r", encoding="utf-8") as f:
                raw = json.load(f)

            _database_meta = raw.pop("_meta", {})
            eissn_idx = _database_meta.get("eissn_index", {})

            temp_records = {}
            key_order = {}
            for position, (raw_issn, record) in enumerate(raw.items()):
                norm = normalize_issn(raw_issn)
                if norm:
                    key_order.setdefault(norm, position)
                    if norm in temp_records:
                        temp_records[norm] = _merge_records(temp_records[norm], record)
                    else:
                        temp_records[norm] = record

            # Consolida ISSN impresso/e-ISSN sem duplicar o periódico no dicionário
            # principal. Todos os identificadores ficam no índice de aliases e
            # apontam para uma única chave canônica.
            parent: dict[str, str] = {}

            def find(value: str) -> str:
                parent.setdefault(value, value)
                if parent[value] != value:
                    parent[value] = find(parent[value])
                return parent[value]

            def union(left: str, right: str):
                root_left = find(left)
                root_right = find(right)
                if root_left != root_right:
                    parent[root_right] = root_left

            for issn in temp_records:
                find(issn)
            for raw_issn, raw_alt in eissn_idx.items():
                issn = normalize_issn(raw_issn)
                alt_issn = normalize_issn(raw_alt)
                if issn and alt_issn:
                    union(issn, alt_issn)

            groups: dict[str, set[str]] = defaultdict(set)
            for issn in list(parent):
                groups[find(issn)].add(issn)

            temp_db: dict[str, dict] = {}
            _issn_index = {}
            for members in groups.values():
                present = [issn for issn in members if issn in temp_records]
                if not present:
                    continue
                canonical = min(present, key=lambda value: key_order.get(value, len(key_order)))
                merged_record = {}
                for member in sorted(present, key=lambda value: key_order.get(value, len(key_order))):
                    merged_record = _merge_records(merged_record, temp_records[member])
                temp_db[canonical] = merged_record
                for member in members:
                    _issn_index[member] = canonical

            # Registros sem relação ISSN/e-ISSN permanecem canônicos.
            for issn, record in temp_records.items():
                if issn not in _issn_index:
                    temp_db[issn] = record
                    _issn_index[issn] = issn

            # Discoveries processing with TTL and Safe Merge
            discoveries = cache.get_discoveries()
            now = datetime.now()
            for raw_issn, record in discoveries.items():
                issn = normalize_issn(raw_issn)
                if not issn:
                    continue
                disc_date = record.get("discovered_at")
                if disc_date:
                    try:
                        dt = datetime.strptime(disc_date, "%Y-%m-%d")
                        if (now - dt).days > 90:
                            continue # discard old discovery
                    except ValueError:
                        pass
                
                canonical = _issn_index.get(issn, issn)
                if canonical not in temp_db:
                    temp_db[canonical] = record
                    _issn_index[issn] = canonical
                else:
                    db_rec = temp_db[canonical]
                    new_idx = set(db_rec.get("indexers", []))
                    new_idx.update(record.get("indexers", []))
                    db_rec["indexers"] = list(new_idx)
                    for k in ["scieloUpdatedAt", "lilacsUpdatedAt", "latindexUpdatedAt"]:
                        if k in record:
                            db_rec[k] = record[k]

            # Injeta indexadores RevEnf e BDENF das listas locais existentes
            revenf_file = os.path.join(PROJECT_ROOT, "data", "revenf_issns.json")
            if os.path.exists(revenf_file):
                try:
                    with open(revenf_file, "r", encoding="utf-8") as f:
                        for raw_issn in json.load(f):
                            norm = normalize_issn(raw_issn)
                            if not norm:
                                continue
                            can = _issn_index.get(norm, norm)
                            if can in temp_db:
                                rec = temp_db[can]
                                rec.setdefault("indexers", [])
                                if "RevEnf" not in rec["indexers"]:
                                    rec["indexers"].append("RevEnf")
                                rec["area"] = "Enfermagem"
                except Exception as e:
                    logger.warning(f"Erro ao aplicar revenf_issns: {e}")

            bdenf_file = os.path.join(PROJECT_ROOT, "data", "bdenf_issns.json")
            if os.path.exists(bdenf_file):
                try:
                    with open(bdenf_file, "r", encoding="utf-8") as f:
                        for raw_issn in json.load(f):
                            norm = normalize_issn(raw_issn)
                            if not norm:
                                continue
                            can = _issn_index.get(norm, norm)
                            if can in temp_db:
                                rec = temp_db[can]
                                rec.setdefault("indexers", [])
                                if "BDENF" not in rec["indexers"]:
                                    rec["indexers"].append("BDENF")
                                rec["area"] = "Enfermagem"
                except Exception as e:
                    logger.warning(f"Erro ao aplicar bdenf_issns: {e}")

            _journals_db = temp_db
            _build_title_index()
            _load_server_aliases()
            _load_crossref_cache()
            _db_summary_cache = build_summary_cache(temp_db)
            return _journals_db
        except Exception as e:
            logger.error(f"Falha ao carregar {JOURNALS_PATH}: {e}")
            _journals_db = {}
            return _journals_db


def get_database_meta() -> dict | None:
    """Retorna metadados de compilação do journals.json (compiled_at, sources, etc.)."""
    load_database()  # Garante que a base está carregada
    return _database_meta


def resolve_issn(issn: str) -> str:
    """Retorna a chave canônica de um ISSN impresso ou eletrônico."""
    normalized = normalize_issn(issn)
    if not normalized:
        return ""
    load_database()
    return _issn_index.get(normalized, normalized)


def get_identifier_count() -> int:
    """Quantidade de ISSNs aceitos, incluindo identificadores alternativos."""
    load_database()
    return len(_issn_index)


def find_journal(issn: str) -> dict | None:
    """Busca um periódico por ISSN/e-ISSN sem duplicar registros no banco."""
    canonical = resolve_issn(issn)
    return load_database().get(canonical) if canonical else None


def build_summary_cache(db: dict[str, dict]) -> list[dict]:
    """Pré-constrói a lista de resumo para evitar O(N) a cada request."""
    items = []
    for issn, record in db.items():
        items.append({
            "issn": issn,
            "title": record.get("title", ""),
            "area": record.get("area", "Outras Áreas"),
        })
    return items


def get_db_summary() -> list[dict]:
    if _db_summary_cache is not None:
        return _db_summary_cache
    return build_summary_cache(load_database())


# ISSNs de periódicos estabelecidos de Enfermagem que devem estar no Latindex.
# Se TODOS falharem, o scraping do Latindex provavelmente quebrou.
_LATINDEX_CANARY_ISSNS = ["0034-7167", "1518-8345"]


async def run_latindex_canary(http_client: httpx.AsyncClient):
    """Verifica se o scraping do Latindex está funcionando.
    
    Consulta ISSNs canários conhecidos. Se todos falharem, loga WARNING.
    Deve ser chamado no startup do servidor.
    """
    failures = 0
    for issn in _LATINDEX_CANARY_ISSNS:
        cached = cache.check_cache_validity(cache.get_latindex_cache(), issn)
        if cached:
            continue
        result = await fetch_latindex(issn, http_client)
        if not result.get("latindex"):
            failures += 1
    if failures == len(_LATINDEX_CANARY_ISSNS):
        logger.warning(
            "Latindex canary: TODOS os ISSNs canarios falharam. "
            "O scraping do Latindex pode estar quebrado. "
            "Classificacoes A8 podem estar incorretas."
        )


async def _resolve_alt_issn(issn: str, http_client: httpx.AsyncClient) -> str | None:
    """Busca o ISSN alternativo (p-ISSN ou ISSN-L) para resolver e-ISSNs da SciELO.

    1. Consulta o índice local de aliases em memória (0ms).
    2. Fallback: consulta a API pública OpenAlex (filtro por ISSN, < 500ms).
    """
    # 1. Índice local
    if issn in _issn_index and _issn_index[issn] != issn:
        return _issn_index[issn]

    # 2. OpenAlex API
    if http_client:
        try:
            url = f"https://api.openalex.org/sources?filter=issn:{issn}"
            resp = await http_client.get(url, timeout=3.5)
            if resp.status_code == 200:
                results = resp.json().get("results", [])
                if results:
                    source = results[0]
                    issn_l = normalize_issn(source.get("issn_l"))
                    all_issns = [normalize_issn(x) for x in source.get("issn", [])]
                    for candidate in [issn_l] + all_issns:
                        if candidate and candidate != issn:
                            with _db_lock:
                                _issn_index[issn] = candidate
                            return candidate
        except Exception as e:
            logger.debug("Falha ao resolver alt_issn via OpenAlex para %s: %s", issn, e)

    return None


async def fetch_scielo(issn: str, http_client: httpx.AsyncClient) -> dict:
    norm_issn = normalize_issn(issn) or issn

    # 1. Consulta cache em disco
    cached = cache.check_cache_validity(cache.get_scielo_cache(), norm_issn)
    if cached:
        return cached

    cb = cache.circuit_scielo
    if not cb.allow_request():
        return {
            "scielo": False, "revenf": False, "title": None,
            "updated_at": None, "status": "error",
            "error": "SciELO temporariamente indisponível", "circuit": "open"
        }

    headers = {"Accept": "application/json", "User-Agent": "Mozilla/5.5"}

    async def _query_scielo_endpoint(query_issn: str) -> tuple[bool, bool, str | None]:
        url = f"https://articlemeta.scielo.org/api/v1/journal/?issn={query_issn}"
        resp = await http_client.get(url, headers=headers, timeout=8.0)
        resp.raise_for_status()
        data = resp.json()
        scielo_found = len(data) > 0 if isinstance(data, list) else False
        revenf_found = any(
            item.get("collection") == "rve"
            for item in (data if isinstance(data, list) else [])
        )
        t = None
        if scielo_found and isinstance(data, list):
            v100 = data[0].get("v100")
            if v100 and isinstance(v100, list) and len(v100) > 0:
                t = v100[0].get("_")
        return scielo_found, revenf_found, t

    try:
        scielo, revenf, title = await _query_scielo_endpoint(norm_issn)

        # Se não encontrou pelo ISSN consultado, pode ser um e-ISSN. Tenta resolver pelo p-ISSN / ISSN-L
        alt_issn = None
        if not scielo:
            alt_issn = await _resolve_alt_issn(norm_issn, http_client)
            if alt_issn:
                try:
                    scielo, revenf, title = await _query_scielo_endpoint(alt_issn)
                except Exception:
                    pass

        today_str = datetime.now().strftime("%Y-%m-%d")
        result = {
            "scielo": scielo,
            "revenf": revenf,
            "title": title,
            "updated_at": today_str,
            "status": "ok",
        }

        # Salva em cache para o ISSN consultado
        cache.save_scielo_cache({norm_issn: result})
        # Se houve resolução por ISSN alternativo, salva para ele também
        if alt_issn and scielo:
            cache.save_scielo_cache({alt_issn: result})

        cb.record_success()
        return result
    except Exception as exc:
        cb.record_failure()
        logger.warning("Falha ao consultar SciELO para %s: %s", norm_issn, exc)
        return {
            "scielo": False, "revenf": False, "title": None,
            "updated_at": None, "status": "error",
            "error": "SciELO temporariamente indisponível",
        }


LILACS_PRIMARY_URL = "https://fi-admin-api.bvsalud.org/api/title/search/"
LILACS_FALLBACK_URL = "https://lilacs.bvsalud.org/wp-json/test/v1/bvs/journals/search"


def _parse_lilacs_response(raw_data: dict) -> dict | None:
    response_data = raw_data.get("diaServerResponse", [{}])[0].get("response", {})
    if not response_data:
        response_data = raw_data.get("data", {}).get("diaServerResponse", [{}])[0].get("response", {})
    if response_data:
        return response_data
    return None


async def _try_fetch_lilacs(url: str, issn: str, http_client: httpx.AsyncClient) -> dict | None:
    headers = {"Accept": "application/json", "User-Agent": "Mozilla/5.5"}
    try:
        response = await http_client.get(url, params={"q": issn}, headers=headers, timeout=10)
        raw_data = response.json()
        response_data = _parse_lilacs_response(raw_data)
        if response_data is None:
            return None

        num_found = response_data.get("numFound", 0)
        docs = response_data.get("docs", [])

        if num_found < 1 or not docs:
            return {"lilacs": False, "bdenf": False, "title": None, "issn": None}

        indexed_dbs = docs[0].get("indexed_database", [])
        issn_list = docs[0].get("issn", [])
        return {
            "lilacs": True,
            "bdenf": any("BDENF" in db.upper() for db in indexed_dbs),
            "title": docs[0].get("title"),
            "issn": issn_list[0] if issn_list else None,
        }
    except Exception:
        return None


async def fetch_lilacs(issn: str, http_client: httpx.AsyncClient) -> dict:
    cached = cache.check_cache_validity(cache.get_lilacs_cache(), issn)
    if cached:
        return cached

    cb = cache.circuit_lilacs
    if not cb.allow_request():
        return {"lilacs": False, "bdenf": False, "title": None, "issn": None, "updated_at": None, "status": "error", "error": "LILACS temporariamente indisponível", "circuit": "open"}

    result = await _try_fetch_lilacs(LILACS_PRIMARY_URL, issn, http_client)

    if result is None:
        result = await _try_fetch_lilacs(LILACS_FALLBACK_URL, issn, http_client)

    today_str = datetime.now().strftime("%Y-%m-%d")
    if result:
        result["updated_at"] = today_str
        result["status"] = "ok"
        cache.save_lilacs_cache({issn: result})
        cb.record_success()
        return result

    cb.record_failure()
    return {
        "lilacs": False, "bdenf": False, "title": None, "issn": None,
        "updated_at": None, "status": "error",
        "error": "LILACS temporariamente indisponível",
    }


async def fetch_latindex(issn: str, http_client: httpx.AsyncClient) -> dict:
    cached = cache.check_cache_validity(cache.get_latindex_cache(), issn)
    if cached:
        return cached

    cb = cache.circuit_latindex
    if not cb.allow_request():
        return {"latindex": False, "title": None, "updated_at": None, "status": "error", "error": "Latindex temporariamente indisponível", "circuit": "open"}

    url = f"https://www.latindex.org/latindex/bAvanzada/resultado?idMod=0&send=Buscar&issn={issn}"
    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml",
        "User-Agent": "Mozilla/5.5",
    }

    try:
        response = await http_client.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")

        result_text = soup.find(string=re.compile(r"Resultado:\s*.*\s*Revistas?"))
        has_results = result_text is not None and "0" not in result_text

        latindex = False
        title = None
        if has_results:
            ficha_link = soup.find("a", href=re.compile(r"/latindex/ficha/\d+"))
            if ficha_link:
                title = ficha_link.get_text(strip=True)
                latindex = True

        today_str = datetime.now().strftime("%Y-%m-%d")
        result = {
            "latindex": latindex,
            "title": title,
            "updated_at": today_str,
            "status": "ok",
        }
        cache.save_latindex_cache({issn: result})
        cb.record_success()
        return result
    except Exception as exc:
        cb.record_failure()
        logger.warning("Falha ao consultar Latindex para %s: %s", issn, exc)
        return {
            "latindex": False, "title": None, "updated_at": None,
            "status": "error", "error": "Latindex temporariamente indisponível",
        }


async def fetch_citescore_result(issn: str, http_client: httpx.AsyncClient) -> dict:
    citescore_cache = cache.get_citescore_cache()
    cached = cache.check_cache_validity(citescore_cache, issn, ttl_days=7)
    if cached:
        return cached

    api_key = get_api_key()
    if not api_key:
        return {
            "citeScore": None, "status": "unavailable",
            "error": "CiteScore não avaliado: chave Elsevier ausente",
        }

    cb = cache.circuit_elsevier
    if not cb.allow_request():
        return {
            "citeScore": None, "status": "error",
            "error": "Elsevier temporariamente indisponível",
        }

    url = f"{ELSEVIER_BASE}/{issn}?view=CITESCORE"
    headers = {
        "X-ELS-APIKey": api_key,
        "Accept": "application/json",
    }

    try:
        response = await http_client.get(url, headers=headers, timeout=10)
        if response.status_code == 404:
            today_str = datetime.now().strftime("%Y-%m-%d")
            result = {"citeScore": None, "source": "api", "status": "not_found", "updated_at": today_str}
            cache.save_citescore_cache({issn: result})
            cb.record_success()
            return result
        response.raise_for_status()
        data = response.json()

        entries = data.get("serial-metadata-response", {}).get("entry", [])
        cite_score = None
        if entries:
            cs_info = entries[0].get("citeScoreYearInfoList", {})
            cs_value = cs_info.get("citeScoreCurrentMetric")
            if cs_value is not None:
                try:
                    cite_score = round(float(cs_value), 1)
                except (ValueError, TypeError):
                    pass

        today_str = datetime.now().strftime("%Y-%m-%d")
        status = "ok" if cite_score is not None else "not_found"
        result = {"citeScore": cite_score, "source": "api", "status": status, "updated_at": today_str}
        
        cache.save_citescore_cache({issn: result})
        cb.record_success()
        return result
    except Exception as exc:
        cb.record_failure()
        logger.warning("Falha ao consultar Elsevier para %s: %s", issn, exc)
        return {
            "citeScore": None, "status": "error",
            "error": "Elsevier temporariamente indisponível",
        }


async def fetch_citescore(issn: str, http_client: httpx.AsyncClient) -> float | None:
    """Compatibilidade: retorna apenas o valor numérico do CiteScore."""
    result = await fetch_citescore_result(issn, http_client)
    return result.get("citeScore")


def _service_warning(source: str, result: dict) -> dict | None:
    if result.get("status") not in {"error", "unavailable"} and not result.get("error"):
        return None
    return {
        "source": source,
        "code": result.get("status", "error"),
        "message": result.get("error") or f"{source} temporariamente indisponível",
    }


async def enrich_and_classify(issn: str, http_client: httpx.AsyncClient) -> dict:
    db = load_database()
    normalized = normalize_issn(issn)
    if not normalized:
        return {
            "issn": issn,
            "title": "ISSN inválido",
            "area": "Outras Áreas",
            "jcr": None,
            "citeScore": None,
            "indexers": [],
            "metrics": {"cuiden": None},
            "classification": {"estrato": "NC", "justification": "ISSN em formato inválido."},
            "data_status": "invalid",
            "warnings": [],
            "scieloUpdatedAt": None,
            "lilacsUpdatedAt": None,
            "latindexUpdatedAt": None,
        }

    canonical = resolve_issn(normalized)
    db_record = db.get(canonical)
    warnings: list[dict] = []
    checked_sources: set[str] = set()
    citescore_result: dict | None = None

    if not db_record:
        scielo_data, lilacs_data, latindex_data, citescore_result = await _gather(
            fetch_scielo(normalized, http_client),
            fetch_lilacs(normalized, http_client),
            fetch_latindex(normalized, http_client),
            fetch_citescore_result(normalized, http_client),
        )
        checked_sources.update({"scielo", "lilacs", "latindex", "elsevier"})
        for source, result in (
            ("SciELO", scielo_data), ("LILACS", lilacs_data),
            ("Latindex", latindex_data), ("Elsevier", citescore_result),
        ):
            warning = _service_warning(source, result)
            if warning:
                warnings.append(warning)

        if (
            scielo_data.get("scielo") or lilacs_data.get("lilacs")
            or lilacs_data.get("bdenf") or latindex_data.get("latindex")
            or citescore_result.get("citeScore") is not None
        ):
            db_record = {
                "title": scielo_data.get("title") or lilacs_data.get("title") or latindex_data.get("title") or "Periódico identificado pela Elsevier",
                "area": "Enfermagem" if (scielo_data.get("revenf") or lilacs_data.get("bdenf")) else "Outras Áreas",
                "jcr": None,
                "citeScore": citescore_result.get("citeScore"),
                "indexers": [],
                "metrics": {"cuiden": None},
            }

            if scielo_data.get("scielo"):
                db_record["indexers"].append("SCIELO")
                db_record["scieloUpdatedAt"] = scielo_data.get("updated_at")
                if scielo_data.get("revenf"):
                    db_record["indexers"].append("RevEnf")
            if lilacs_data.get("lilacs"):
                db_record["indexers"].append("LILACS")
                db_record["lilacsUpdatedAt"] = lilacs_data.get("updated_at")
            if lilacs_data.get("bdenf"):
                db_record["indexers"].append("BDENF")
                db_record["lilacsUpdatedAt"] = lilacs_data.get("updated_at")
            if latindex_data.get("latindex"):
                db_record["indexers"].append("LATINDEX")
                db_record["latindexUpdatedAt"] = latindex_data.get("updated_at")
            if citescore_result.get("citeScore") is not None:
                db_record["indexers"].append("SCOPUS")

            with _db_lock:
                db[canonical] = db_record
                _issn_index[normalized] = canonical
            cache.save_discovery(canonical, db_record)

    if not db_record:
        unavailable_count = len(warnings)
        data_status = "error" if unavailable_count == 4 else "partial" if unavailable_count else "complete"
        if data_status == "error":
            justification = "Não foi possível concluir a consulta porque as fontes externas estão indisponíveis. Tente novamente mais tarde."
        elif data_status == "partial":
            justification = "ISSN não localizado nas fontes disponíveis; uma ou mais bases não puderam ser consultadas."
        else:
            justification = "ISSN não encontrado na base local nem nas fontes externas consultadas."
        return {
            "issn": normalized,
            "title": "Consulta não concluída" if data_status == "error" else "Periódico Não Identificado na Base",
            "area": "Outras Áreas",
            "jcr": None,
            "citeScore": None,
            "indexers": [],
            "metrics": {"cuiden": None},
            "classification": {
                "estrato": "NC",
                "justification": justification,
            },
            "data_status": data_status,
            "warnings": warnings,
            "scieloUpdatedAt": None,
            "lilacsUpdatedAt": None,
            "latindexUpdatedAt": None,
        }

    local_indexers = [idx.upper() for idx in (db_record.get("indexers") or [])]
    need_scielo = "scielo" not in checked_sources and "SCIELO" not in local_indexers and "REVENF" not in local_indexers
    need_lilacs = "lilacs" not in checked_sources and "LILACS" not in local_indexers and "BDENF" not in local_indexers
    need_latindex = "latindex" not in checked_sources and "LATINDEX" not in local_indexers

    if need_scielo or need_lilacs or need_latindex:
        tasks = []
        if need_scielo:
            tasks.append(_fetch_scielo_wrapper(normalized, http_client))
        if need_lilacs:
            tasks.append(_fetch_lilacs_wrapper(normalized, http_client))
        if need_latindex:
            tasks.append(_fetch_latindex_wrapper(normalized, http_client))

        if tasks:
            results = await _gather(*tasks)
            with _db_lock:
                for res in results:
                    data = res.get("data", {})
                    warning = _service_warning(res.get("type", "Fonte externa").title(), data)
                    if warning:
                        warnings.append(warning)
                    _merge_indexer_result(db_record, canonical, res)

    # Buscar CiteScore fora do lock (I/O), aplicar mutação dentro do lock
    need_citescore = db_record.get("citeScore") is None
    if need_citescore and citescore_result is None:
        citescore_result = await fetch_citescore_result(normalized, http_client)
        warning = _service_warning("Elsevier", citescore_result)
        if warning:
            warnings.append(warning)
    api_cs = citescore_result.get("citeScore") if citescore_result else None

    with _db_lock:
        if need_citescore and api_cs is not None:
            db_record["citeScore"] = api_cs

        # Garante que 'SCOPUS' conste na lista de indexadores caso possua CiteScore
        indexers = list(db_record.get("indexers") or [])
        if db_record.get("citeScore") is not None:
            if "SCOPUS" not in [idx.upper() for idx in indexers]:
                indexers.append("SCOPUS")
                db_record["indexers"] = indexers

        # Persistir CiteScore no cache de discoveries para sobreviver a restarts
        discoveries = cache.get_discoveries()
        if canonical in discoveries:
            discoveries[canonical]["citeScore"] = db_record.get("citeScore")
            discoveries[canonical]["jcr"] = db_record.get("jcr")
            discoveries[canonical]["indexers"] = list(db_record.get("indexers") or [])
            cache.save_json_cache(
                os.path.join(PROJECT_ROOT, "data", "runtime_discoveries.json"),
                discoveries
            )

    classification = engine.classify_journal(db_record)

    # Determinar fonte dos dados
    jcr_val = db_record.get("jcr")
    cs_val = db_record.get("citeScore")

    return {
        "issn": normalized,
        "title": db_record.get("title", "Sem Título"),
        "area": db_record.get("area", "Outras Áreas"),
        "jcr": jcr_val,
        "citeScore": cs_val,
        "indexers": indexers,
        "metrics": db_record.get("metrics") or {"cuiden": None},
        "classification": classification,
        "data_status": "partial" if warnings else "complete",
        "warnings": warnings,
        "scieloUpdatedAt": db_record.get("scieloUpdatedAt"),
        "lilacsUpdatedAt": db_record.get("lilacsUpdatedAt"),
        "latindexUpdatedAt": db_record.get("latindexUpdatedAt"),
        "jcr_source": "JCR (base local)" if jcr_val is not None else None,
        "citescore_source": "Elsevier API" if cs_val is not None else None,
    }


async def _fetch_all_indexers(issn: str, http_client: httpx.AsyncClient) -> tuple:
    return await _gather(
        fetch_scielo(issn, http_client),
        fetch_lilacs(issn, http_client),
        fetch_latindex(issn, http_client),
    )


async def _gather(*coros) -> list:
    return list(await asyncio.gather(*coros))


async def _fetch_scielo_wrapper(issn: str, http_client: httpx.AsyncClient) -> dict:
    data = await fetch_scielo(issn, http_client)
    return {"type": "scielo", "data": data}


async def _fetch_lilacs_wrapper(issn: str, http_client: httpx.AsyncClient) -> dict:
    data = await fetch_lilacs(issn, http_client)
    return {"type": "lilacs", "data": data}


async def _fetch_latindex_wrapper(issn: str, http_client: httpx.AsyncClient) -> dict:
    data = await fetch_latindex(issn, http_client)
    return {"type": "latindex", "data": data}


def _merge_indexer_result(db_record: dict, issn: str, result: dict):
    res_type = result.get("type")
    data = result.get("data", {})

    # Coletar títulos alternativos (variants) — Fase 2c
    alt_title = data.get("title")
    if alt_title and alt_title != db_record.get("title"):
        variants = set(db_record.get("variants") or [])
        variants.add(alt_title)
        # Adiciona também versão normalizada como alias automático
        if len(variants) > 0:
            db_record["_variants_raw"] = list(variants)
            # Re-indexa as variantes no índice invertido incrementalmente
            norm_title = _normalize_text(alt_title)
            for token in norm_title.split():
                if len(token) >= 3:
                    if token not in _title_index:
                        _title_index[token] = []
                    if issn not in _title_index[token]:
                        _title_index[token].append(issn)

    if res_type == "scielo" and data.get("scielo"):
        if "indexers" not in db_record or db_record["indexers"] is None:
            db_record["indexers"] = []
        if "SCIELO" not in db_record["indexers"]:
            db_record["indexers"].append("SCIELO")
        db_record["scieloUpdatedAt"] = data.get("updated_at")
        if data.get("revenf") and "RevEnf" not in db_record["indexers"]:
            db_record["indexers"].append("RevEnf")
            db_record["area"] = "Enfermagem"

    elif res_type == "lilacs" and (data.get("lilacs") or data.get("bdenf")):
        if "indexers" not in db_record or db_record["indexers"] is None:
            db_record["indexers"] = []
        if data.get("lilacs") and "LILACS" not in db_record["indexers"]:
            db_record["indexers"].append("LILACS")
        if data.get("bdenf") and "BDENF" not in db_record["indexers"]:
            db_record["indexers"].append("BDENF")
            db_record["area"] = "Enfermagem"
        db_record["lilacsUpdatedAt"] = data.get("updated_at")

    elif res_type == "latindex" and data.get("latindex"):
        if "indexers" not in db_record or db_record["indexers"] is None:
            db_record["indexers"] = []
        if "LATINDEX" not in db_record["indexers"]:
            db_record["indexers"].append("LATINDEX")
        db_record["latindexUpdatedAt"] = data.get("updated_at")


def search_by_name(query: str) -> list[dict]:
    db = load_database()
    query_lower = query.lower().strip()
    if not query_lower:
        return []

    query_norm = _normalize_text(query_lower)
    tokens = [t for t in query_norm.split() if len(t) >= 3]
    
    if not tokens:
        results = []
        for issn, record in db.items():
            title = record.get("title") or ""
            title_norm = _normalize_text(title)
            if query_norm in title_norm:
                results.append({
                    "issn": issn,
                    "title": title,
                    "area": record.get("area", "Outras Áreas"),
                    "source": "local",
                })
        results.sort(key=lambda item: (_normalize_text(item["title"]), item["issn"]))
        return results[:50]

    matched_issns = None
    for token in tokens:
        # Lookup direto O(1) — token como chave exata do índice
        token_matches = set(_title_index.get(token, []))

        # Fallback: busca por prefixo apenas se lookup direto não encontrou
        if not token_matches:
            for idx_token, issns in _title_index.items():
                if idx_token.startswith(token):
                    token_matches.update(issns)

        if matched_issns is None:
            matched_issns = token_matches
        else:
            matched_issns = matched_issns.intersection(token_matches)

        if not matched_issns:
            break
            
    if not matched_issns:
        return _fuzzy_match_name(query_norm, get_db_summary())
        
    results = []
    for issn in matched_issns:
        record = db.get(issn, {})
        results.append({
            "issn": issn,
            "title": record.get("title", ""),
            "area": record.get("area", "Outras Áreas"),
            "source": "local",
        })

    results.sort(key=lambda item: (
        0 if _normalize_text(item["title"]) == query_norm else 1,
        abs(len(_normalize_text(item["title"])) - len(query_norm)),
        _normalize_text(item["title"]),
        item["issn"],
    ))
    limited = results[:50]
    if len(limited) < 3:
        fuzzy = _fuzzy_match_name(query_norm, get_db_summary())
        seen = set(r["issn"] for r in limited)
        for fr in fuzzy:
            if fr["issn"] not in seen:
                limited.append(fr)
                seen.add(fr["issn"])
    return limited
# ─── Parser Lattes + Matching engine (Fase 1) ───────────────────────
# Portado de js/lattesParser.js para Python. Pipeline idêntico:
#   1. Alias server-side (data/aliases.json)
#   2. Match exato de string normalizada
#   3. ISSN extraído diretamente do texto do artigo
#   4. Containment (todos tokens presentes, menor título vence)
#   5. Jaccard-IDF ponderado + Jaro-Winkler desempate

_CONGRESS_KEYWORDS = (
    'anais', 'congresso', 'simposio', 'simpósio', 'encontro',
    'conference', 'proceedings', 'workshop', 'seminário', 'jornada'
)

def _fix_encoding(text: str) -> str:
    """Corrige dupla-codificação UTF-8 → Latin-1 (mojibake)."""
    replacements = {
        'Ã©': 'é', 'Ã£': 'ã', 'Ã¡': 'á', 'Ã­': 'í',
        'Ãµ': 'õ', 'Ã³': 'ó', 'Ãº': 'ú', 'Ã§': 'ç',
        'Ã¢': 'â', 'Ãª': 'ê', 'Ã´': 'ô', 'Ã ': 'à',
        'Ã¼': 'ü', 'Ã±': 'ñ',
        'Ã‰': 'É', 'Ã‡': 'Ç', 'Ã"': 'Ó', 'Ãš': 'Ú',
    }
    result = text
    for bad, good in replacements.items():
        result = result.replace(bad, good)
    result = re.sub(r'[\u0000-\u001F\uFFFD\u25A1]', '', result)
    return result


def segment_lattes_text(text: str) -> list[str]:
    """Segmenta texto bruto colado do Lattes em artigos individuais.

    Portado de js/lattesParser.js::segmentLattesText.
    """
    if not text:
        return []
    clean = _fix_encoding(text)
    clean = re.sub(r"M\?BATNA", "M'BATNA", clean, flags=re.IGNORECASE)
    # Remover injeções de extensões de navegador (ex: Qualis Lattes) antes de linearizar
    clean = re.sub(r".*Qualis\s*\(ISSN:.*\n?", "", clean, flags=re.IGNORECASE)
    clean = re.sub(r".*fonte Qualis\/CAPES.*\n?", "", clean, flags=re.IGNORECASE)
    clean = re.sub(r".*Não classificado,\s*ISSN.*\n?", "", clean, flags=re.IGNORECASE)
    # Linearizar quebras de linha
    clean = clean.replace("\r\n", " ").replace("\n", " ")
    clean = re.sub(r"\s+", " ", clean)

    # Regex primária: artigos terminando com ano + ponto (aceita AAAA-MM, AAAA.)
    article_regex = re.compile(
        r"(.*?,\s*(?:\d{4}-\d{2}\s*,\s*)?\d{4}\.(?:\s*Citações:\d+)?)",
        re.IGNORECASE,
    )
    matches = article_regex.findall(clean)

    # Regex secundária: "no prelo" / "in press" (sem ano)
    in_press_regex = re.compile(
        r"(.*?,\s*(?:no prelo|in press|aceito para publica[çc][aã]o)\s*\.?(?:\s*Citações:\d+)?)",
        re.IGNORECASE,
    )
    matches.extend(in_press_regex.findall(clean))

    if not matches:
        numbered = re.split(r"\s+\b\d+\.\s+", clean)
        return [s.strip() for s in numbered if len(s.strip()) > 20]

    return [s.strip() for s in matches if len(s.strip()) > 20]


def _is_congress(text: str) -> bool:
    if not text:
        return False
    lower = text.lower()
    return any(kw in lower for kw in _CONGRESS_KEYWORDS)


def _extract_issn_from_text(text: str) -> str | None:
    """Regex ISSN literal (XXXX-XXXX com dígito-verificador validado)."""
    if not text:
        return None
    for m in re.finditer(r"\b(\d{4}-\d{3}[\dXx])\b", text):
        issn = normalize_issn(m.group(1))
        if issn:
            return issn
    return None


def _split_journal_title_sub_title(journal: str) -> str:
    """Quebra "Título-Subtítulo" e mantém só a cabeça quando aplicável.

    Conservador: head ≥3 palavras e tail ≥1.5× palavras head.
    Não corta "REBEN - X", "INTERFACES CIENTÍFICAS - HUMANAS".
    """
    if not journal:
        return journal
    m = re.match(r"^(.{3,}?)\s*[-–]\s*(.{3,})$", journal)
    if not m:
        return journal
    head = m.group(1).strip()
    tail = m.group(2).strip()
    head_words = len(head.split())
    tail_words = len(tail.split())
    if head_words >= 3 and tail_words >= 3 and tail_words >= head_words * 1.5:
        return head
    return journal


def parse_single_article(article_text: str) -> dict:
    """Parser de um artigo Lattes isolado. Espelha js/lattesParser.js.

    Retorna: {authors, title, journal, journalRaw, year, volume, pages,
              type, extractedIssn}
    """
    clean = re.sub(r"\s*Citações.*$", "", article_text, flags=re.IGNORECASE).strip()
    clean = re.sub(r"^\s*\d+\.\s*", "", clean)

    # Regex robusta: , [v. N,] [p. P,] [AAAA-MM,] AAAA. [Citações:K]
    pub_regex = re.compile(
        r",\s*(?:v\.\s*([^,]+?)\s*,\s*)?"  # volume (lazy)
        r"(?:p\.\s*([^,]+?)\s*,\s*)?"       # páginas (lazy)
        r"(?:\d{4}-\d{2}\s*,\s*)?"         # mes-ano opcional
        r"(\d{4})\s*\.?(?:\s*Cita[çc].*?\d+)?$",
        re.IGNORECASE,
    )
    match = pub_regex.search(clean)

    authors = "Autores Não Identificados"
    title = "Título Não Identificado"
    journal = "Periódico Não Identificado"
    journal_raw = ""
    year = None
    volume = ""
    pages = ""
    extracted_issn = None

    if match:
        volume = (match.group(1) or "").strip()
        pages = (match.group(2) or "").strip()
        year = int(match.group(3))
        main_block = clean[:match.start()].strip()
        extracted_issn = _extract_issn_from_text(main_block)

        # Procurar último ponto final fora de parênteses — separa Periódico
        nesting = 0
        last_dot = -1
        for i, ch in enumerate(main_block):
            if ch == "(":
                nesting += 1
            elif ch == ")":
                nesting -= 1
            elif ch == "." and nesting == 0:
                after = main_block[i + 1:].strip()
                if not after.startswith("("):
                    last_dot = i

        remaining_block = main_block
        if last_dot != -1:
            journal = main_block[last_dot + 1:].strip()
            remaining_block = main_block[:last_dot].strip()
        else:
            journal = main_block
        journal_raw = journal
        journal = _split_journal_title_sub_title(journal)

        # Separar autores e título no ponto após o último ";"
        last_semicolon = remaining_block.rfind(";")
        if last_semicolon != -1:
            first_dot_after = remaining_block.find(".", last_semicolon)
            if first_dot_after != -1:
                authors = remaining_block[:first_dot_after].strip()
                title = remaining_block[first_dot_after + 1:].strip()
            else:
                authors = remaining_block[:last_semicolon].strip()
                title = remaining_block[last_semicolon + 1:].strip()
        else:
            first_dot = remaining_block.find(".")
            if first_dot != -1 and first_dot < len(remaining_block) - 15:
                authors = remaining_block[:first_dot].strip()
                title = remaining_block[first_dot + 1:].strip()
            else:
                title = remaining_block
    else:
        parts = clean.split(".")
        if len(parts) >= 3:
            authors = parts[0].strip()
            title = parts[1].strip()
            journal = parts[2].strip()
            journal_raw = journal
            journal = _split_journal_title_sub_title(journal)
        else:
            title = clean
        extracted_issn = _extract_issn_from_text(clean)

    title = re.sub(r"\.$", "", title).strip()

    article_type = "congresso" if (_is_congress(journal) or _is_congress(title)) else "article"

    return {
        "authors": authors,
        "title": title,
        "journal": journal,
        "journalRaw": journal_raw,
        "year": year,
        "volume": volume,
        "pages": pages,
        "type": article_type,
        "extractedIssn": extracted_issn,
    }


def _idf_weight(token: str, n: int) -> float:
    """Peso IDF de um termo. Stopwords generalistas → 0.1."""
    if token in _MATCH_GENERIC_TERMS:
        return 0.1
    return _idf_weights.get(token, math.log((n + 1) / 1) + 1)


def _weighted_jaccard(q_tokens: set[str], db_tokens: set[str], n: int) -> float:
    inter_w = sum(_idf_weight(t, n) for t in q_tokens if t in db_tokens)
    union_w = sum(_idf_weight(t, n) for t in q_tokens | db_tokens)
    if union_w == 0:
        return 0.0
    return inter_w / union_w


def _load_crossref_cache():
    global _crossref_cache
    _crossref_cache.clear()
    if os.path.exists(CROSSREF_CACHE_PATH):
        try:
            with open(CROSSREF_CACHE_PATH, "r", encoding="utf-8") as f:
                raw = json.load(f)
            now = datetime.now()
            for key, entry in raw.items():
                ts = entry.get("_ts", "")
                try:
                    dt = datetime.strptime(ts, "%Y-%m-%d")
                    if (now - dt).days <= 30:
                        _crossref_cache[key] = entry
                except ValueError:
                    pass
        except Exception:
            pass


def _save_crossref_cache():
    try:
        with _crossref_lock:
            for entry in _crossref_cache.values():
                if "_ts" not in entry:
                    entry["_ts"] = datetime.now().strftime("%Y-%m-%d")
            cache.save_json_cache(CROSSREF_CACHE_PATH, _crossref_cache)
    except Exception:
        pass


def _crossref_lookup(article_title: str) -> dict | None:
    if not article_title or len(article_title.strip()) < 10:
        return None
    cache_key = _normalize_text(article_title)[:120]
    if cache_key in _crossref_cache:
        entry = _crossref_cache[cache_key]
        if entry.get("issn"):
            return {"issn": entry["issn"], "title": entry.get("title", "")}
        return None
    url = "https://api.crossref.org/works"
    params = {"query.bibliographic": article_title.strip(), "rows": 3, "select": "DOI,container-title,ISSN"}
    try:
        resp = httpx.get(url, params=params, timeout=10.0, follow_redirects=True)
        if resp.status_code != 200:
            _crossref_cache[cache_key] = {"issn": None, "_ts": datetime.now().strftime("%Y-%m-%d")}
            return None
        data = resp.json()
        items = (data.get("message") or {}).get("items") or []
        if items:
            for item in items:
                issn_list = item.get("ISSN") or []
                journal_title = (item.get("container-title") or [None])[0]
                if issn_list and journal_title:
                    issn = normalize_issn(issn_list[0])
                    if issn:
                        _crossref_cache[cache_key] = {"issn": issn, "title": journal_title, "_ts": datetime.now().strftime("%Y-%m-%d")}
                        _save_crossref_cache()
                        return {"issn": issn, "title": journal_title}
        _crossref_cache[cache_key] = {"issn": None, "_ts": datetime.now().strftime("%Y-%m-%d")}
        _save_crossref_cache()
    except Exception:
        pass
    return None


def _match_title_against_variants(query_norm: str, db: dict) -> tuple:
    for issn, record in db.items():
        title = record.get("title") or ""
        if _normalize_text(title) == query_norm:
            return issn, title
    for issn, record in db.items():
        for vtitle in (record.get("_variants_raw") or []):
            if _normalize_text(vtitle) == query_norm:
                return issn, vtitle
    return None, None


def _crossref_or_none(result: dict, query_norm: str, article_title: str | None) -> dict:
    if article_title:
        cr = _crossref_lookup(article_title)
        if cr and cr.get("issn"):
            result["issn"] = cr["issn"]
            result["confidence"] = "high"
            result["score"] = 0.85
            result["stage"] = "crossref"
            result["candidates"] = [{"issn": cr["issn"], "title": cr.get("title", "") or article_title, "score": 0.85}]
            global _match_stats
            _match_stats["stage_crossref"] += 1
            _match_stats["conf_high"] += 1
            return result
    _match_stats["conf_none"] += 1
    return result


def match_journal(
    query: str,
    article_title: str | None = None,
    top_k: int = 3,
) -> dict:
    global _match_stats
    db = load_database()
    if not query or not db:
        _match_stats["none_empty"] += 1
        return {"issn": None, "confidence": "none", "score": 0.0, "stage": "none", "candidates": []}
    query_norm = _normalize_text(query)
    if not query_norm:
        _match_stats["none_empty"] += 1
        return {"issn": None, "confidence": "none", "score": 0.0, "stage": "none", "candidates": []}

    # 1. Alias
    if query_norm in _server_aliases:
        _match_stats["stage_alias"] += 1
        _match_stats["conf_high"] += 1
        issn = _server_aliases[query_norm]
        return {"issn": issn, "confidence": "high", "score": 1.0, "stage": "alias",
                "candidates": [{"issn": issn, "title": query, "score": 1.0}]}

    # 2. Match exato (title + variants)
    variant_issn, variant_title = _match_title_against_variants(query_norm, db)
    if variant_issn:
        _match_stats["stage_exact"] += 1
        _match_stats["conf_high"] += 1
        return {"issn": variant_issn, "confidence": "high", "score": 1.0, "stage": "exact",
                "candidates": [{"issn": variant_issn, "title": variant_title or query, "score": 1.0}]}

    # 3. Containment (verify variants too)
    q_tokens = {t for t in query_norm.split() if len(t) >= 2}
    containment_hits: list[tuple[str, str, int]] = []
    if q_tokens:
        for issn, record in db.items():
            titles = [record.get("title") or ""]
            titles.extend(record.get("_variants_raw") or [])
            for title in titles:
                if not title: continue
                db_tokens = set(_normalize_text(title).split())
                if q_tokens.issubset(db_tokens):
                    containment_hits.append((issn, title, len(db_tokens)))
                    break
    if containment_hits:
        containment_hits.sort(key=lambda x: x[2])
        best = containment_hits[0]
        _match_stats["stage_containment"] += 1
        _match_stats["conf_high"] += 1
        return {"issn": best[0], "confidence": "high", "score": 0.95, "stage": "containment",
                "candidates": [{"issn": i, "title": t, "score": 0.95} for i, t, _ in containment_hits[:top_k]]}

    # 4. Jaccard-IDF
    n = len(db)
    q_tokens_for_fuzzy = {t for t in query_norm.split() if len(t) >= 2}
    if not q_tokens_for_fuzzy:
        none_result = {"issn": None, "confidence": "none", "score": 0.0, "stage": "none", "candidates": []}
        return _crossref_or_none(none_result, query_norm, article_title)

    candidate_issns: set[str] = set()
    for token in q_tokens_for_fuzzy:
        for issn in _title_index.get(token, []):
            candidate_issns.add(issn)
    if not candidate_issns:
        for token in q_tokens_for_fuzzy:
            for idx_token, issns in _title_index.items():
                if idx_token.startswith(token):
                    candidate_issns.update(issns)
    if not candidate_issns:
        none_result = {"issn": None, "confidence": "none", "score": 0.0, "stage": "none", "candidates": []}
        return _crossref_or_none(none_result, query_norm, article_title)

    fuzzy_results: list[tuple[str, str, float]] = []
    for issn in candidate_issns:
        record = db.get(issn, {})
        title = record.get("title") or ""
        if not title: continue
        norm_title = _normalize_text(title)
        db_tokens = set(norm_title.split())
        jaccard = _weighted_jaccard(q_tokens_for_fuzzy, db_tokens, n)
        jw = _jaro_winkler(query_norm, norm_title)
        score = 0.7 * jaccard + 0.3 * jw
        fuzzy_results.append((issn, title, score))
    fuzzy_results.sort(key=lambda x: x[2], reverse=True)
    if not fuzzy_results:
        none_result = {"issn": None, "confidence": "none", "score": 0.0, "stage": "none", "candidates": []}
        return _crossref_or_none(none_result, query_norm, article_title)

    best = fuzzy_results[0]
    best_score = best[2]
    top = fuzzy_results[:top_k]
    confidence = "none"
    if best_score >= 0.78: confidence = "high"
    elif best_score >= 0.62: confidence = "review"
    _match_stats[f"conf_{confidence}"] += 1
    _match_stats["stage_jaccard"] += 1

    result = {"issn": best[0] if confidence != "none" else None,
              "confidence": confidence, "score": best_score, "stage": "jaccard",
              "candidates": [{"issn": i, "title": t, "score": s} for i, t, s in top]}

    # 5. Crossref fallback
    if best_score < 0.80 and article_title:
        return _crossref_or_none(result, query_norm, article_title)
    return result


def parse_lattes_text(text: str) -> list[dict]:
    """Pipeline completo: segmenta → parseia → match (com ISSN extraído优先).

    Retorna lista de artigos com campos de parseSingleArticle + campos:
      matchedIssn, confidence, matchScore, matchStage, matchCandidates
    """
    segments = segment_lattes_text(text)
    results = []
    for seg in segments:
        parsed = parse_single_article(seg)
        if parsed["extractedIssn"]:
            match_result = {
                "issn": parsed["extractedIssn"], "confidence": "high",
                "score": 1.0, "stage": "issn-extracted", "candidates": [],
            }
        else:
            match_result = match_journal(
                parsed["journalRaw"] or parsed["journal"],
                article_title=parsed.get("title"),
            )
        results.append({
            **parsed,
            "matchedIssn": match_result["issn"],
            "confidence": match_result["confidence"],
            "matchScore": match_result["score"],
            "matchStage": match_result["stage"],
            "matchCandidates": match_result["candidates"],
        })
    return results


def get_match_stats() -> dict:
    """Retorna estatísticas de matching para observabilidade (Fase 3e)."""
    global _match_stats
    return dict(_match_stats) if _match_stats else {}
