import asyncio
import json
import os
import re
import threading
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

import httpx
from bs4 import BeautifulSoup

from . import cache
from . import engine

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOURNALS_PATH = os.path.join(PROJECT_ROOT, "data", "journals.json")
ELSEVIER_BASE = "https://api.elsevier.com/content/serial/title/issn"

def get_api_key() -> str:
    return os.environ.get("ELSEVIER_API_KEY", "")

_journals_db: dict[str, dict] | None = None
_title_index: dict[str, list[str]] = {}

import unicodedata

def _normalize_text(text: str) -> str:
    if not text: return ""
    text = text.lower()
    text = unicodedata.normalize("NFD", text)
    text = re.sub(r"[\u0300-\u036f]", "", text)
    return text

def _build_title_index():
    global _title_index
    _title_index.clear()
    if not _journals_db: return
    for issn, record in _journals_db.items():
        title = _normalize_text(record.get("title", ""))
        for token in title.split():
            if len(token) >= 3:
                _title_index.setdefault(token, []).append(issn)


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
    
    for k in ["scieloUpdatedAt", "lilacsUpdatedAt", "latindexUpdatedAt"]:
        if k in r1 or k in r2:
            merged[k] = r1.get(k) or r2.get(k)
            
    return merged

def load_database() -> dict[str, dict]:
    global _journals_db, _database_meta
    
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

            temp_db = {}
            for raw_issn, record in raw.items():
                norm = normalize_issn(raw_issn)
                if norm:
                    if norm in temp_db:
                        temp_db[norm] = _merge_records(temp_db[norm], record)
                    else:
                        temp_db[norm] = record

            # Aliases Consolidation to prevent split records
            for issn, alt_issn in eissn_idx.items():
                if issn in temp_db and alt_issn in temp_db and temp_db[issn] is not temp_db[alt_issn]:
                    merged = _merge_records(temp_db[issn], temp_db[alt_issn])
                    temp_db[issn] = merged
                    temp_db[alt_issn] = merged
                elif issn in temp_db and alt_issn not in temp_db:
                    temp_db[alt_issn] = temp_db[issn]
                elif alt_issn in temp_db and issn not in temp_db:
                    temp_db[issn] = temp_db[alt_issn]

            # Discoveries processing with TTL and Safe Merge
            discoveries = cache.get_discoveries()
            now = datetime.now()
            for issn, record in discoveries.items():
                disc_date = record.get("discovered_at")
                if disc_date:
                    try:
                        dt = datetime.strptime(disc_date, "%Y-%m-%d")
                        if (now - dt).days > 90:
                            continue # discard old discovery
                    except ValueError:
                        pass
                
                if issn not in temp_db:
                    temp_db[issn] = record
                else:
                    db_rec = temp_db[issn]
                    new_idx = set(db_rec.get("indexers", []))
                    new_idx.update(record.get("indexers", []))
                    db_rec["indexers"] = list(new_idx)
                    for k in ["scieloUpdatedAt", "lilacsUpdatedAt", "latindexUpdatedAt"]:
                        if k in record:
                            db_rec[k] = record[k]

            _journals_db = temp_db
            _build_title_index()
            return _journals_db
        except Exception as e:
            logger.error(f"Falha ao carregar {JOURNALS_PATH}: {e}")
            _journals_db = {}
            return _journals_db


def get_database_meta() -> dict | None:
    """Retorna metadados de compilação do journals.json (compiled_at, sources, etc.)."""
    load_database()  # Garante que a base está carregada
    return _database_meta


def get_db_summary() -> list[dict]:
    db = load_database()
    items = []
    for issn, record in db.items():
        items.append({
            "issn": issn,
            "title": record.get("title", ""),
            "area": record.get("area", "Outras Áreas"),
        })
    return items


async def fetch_scielo(issn: str, http_client: httpx.AsyncClient) -> dict:
    cached = cache.check_cache_validity(cache.get_scielo_cache(), issn)
    if cached:
        return cached

    cb = cache.circuit_scielo
    if not cb.allow_request():
        return {"scielo": False, "revenf": False, "title": None, "updated_at": None, "error": "Circuit open", "circuit": "open"}

    url = f"https://articlemeta.scielo.org/api/v1/journal/?issn={issn}"
    headers = {"Accept": "application/json", "User-Agent": "Mozilla/5.5"}

    try:
        response = await http_client.get(url, headers=headers, timeout=10)
        data = response.json()

        scielo = len(data) > 0
        revenf = any(
            item.get("collection") == "rve"
            for item in (data if isinstance(data, list) else [])
        )
        title = None
        if scielo and isinstance(data, list):
            v100 = data[0].get("v100")
            if v100 and isinstance(v100, list) and len(v100) > 0:
                title = v100[0].get("_")

        today_str = datetime.now().strftime("%Y-%m-%d")
        result = {
            "scielo": scielo,
            "revenf": revenf,
            "title": title,
            "updated_at": today_str,
            "status": "ok",
        }
        cache.save_scielo_cache({issn: result})
        cb.record_success()
        return result
    except httpx.HTTPStatusError as e:
        cb.record_failure()
        return {"scielo": False, "revenf": False, "title": None, "updated_at": None, "error": f"SciELO API error: {e.response.status_code}"}
    except (httpx.RequestError, httpx.TimeoutException):
        cb.record_failure()
        return {"scielo": False, "revenf": False, "title": None, "updated_at": None, "error": "Timeout"}


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
        return {"lilacs": False, "bdenf": False, "title": None, "issn": None, "updated_at": None, "error": "Circuit open", "circuit": "open"}

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
    return {"lilacs": False, "bdenf": False, "title": None, "issn": None, "updated_at": None, "error": "LILACS API error (primary + fallback)"}


async def fetch_latindex(issn: str, http_client: httpx.AsyncClient) -> dict:
    cached = cache.check_cache_validity(cache.get_latindex_cache(), issn)
    if cached:
        return cached

    cb = cache.circuit_latindex
    if not cb.allow_request():
        return {"latindex": False, "title": None, "updated_at": None, "error": "Circuit open", "circuit": "open"}

    url = f"https://www.latindex.org/latindex/bAvanzada/resultado?idMod=0&send=Buscar&issn={issn}"
    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml",
        "User-Agent": "Mozilla/5.5",
    }

    try:
        response = await http_client.get(url, headers=headers, timeout=10)
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
    except httpx.HTTPStatusError as e:
        cb.record_failure()
        return {"latindex": False, "title": None, "updated_at": None, "error": f"Latindex error: {e.response.status_code}"}
    except (httpx.RequestError, httpx.TimeoutException):
        cb.record_failure()
        return {"latindex": False, "title": None, "updated_at": None, "error": "Timeout"}


async def fetch_citescore(issn: str, http_client: httpx.AsyncClient) -> float | None:
    citescore_cache = cache.get_citescore_cache()
    cached = cache.check_cache_validity(citescore_cache, issn)
    if cached:
        return cached.get("citeScore")

    api_key = get_api_key()
    if not api_key:
        return None

    cb = cache.circuit_elsevier
    if not cb.allow_request():
        return None

    url = f"{ELSEVIER_BASE}/{issn}?view=CITESCORE"
    headers = {
        "X-ELS-APIKey": api_key,
        "Accept": "application/json",
    }

    try:
        response = await http_client.get(url, headers=headers, timeout=10)
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
        return cite_score
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            today_str = datetime.now().strftime("%Y-%m-%d")
            result = {"citeScore": None, "source": "api", "status": "not_found", "updated_at": today_str}
            cache.save_citescore_cache({issn: result})
            cb.record_success()
            return None
        cb.record_failure()
        return None
    except (httpx.RequestError, httpx.TimeoutException):
        cb.record_failure()
        return None


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
            "scieloUpdatedAt": None,
            "lilacsUpdatedAt": None,
            "latindexUpdatedAt": None,
        }

    db_record = db.get(normalized)

    if not db_record:
        scielo_data, lilacs_data, latindex_data = await _fetch_all_indexers(
            normalized, http_client
        )

        if scielo_data.get("scielo") or lilacs_data.get("lilacs") or lilacs_data.get("bdenf") or latindex_data.get("latindex"):
            db_record = {
                "title": scielo_data.get("title") or lilacs_data.get("title") or latindex_data.get("title") or "Periódico da Rede BVS/SciELO/Latindex",
                "area": "Enfermagem" if (scielo_data.get("revenf") or lilacs_data.get("bdenf")) else "Outras Áreas",
                "jcr": None,
                "citeScore": None,
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

            with _db_lock:
                db[normalized] = db_record
            cache.save_discovery(normalized, db_record)

    if not db_record:
        return {
            "issn": normalized,
            "title": "Periódico Não Identificado na Base",
            "area": "Outras Áreas",
            "jcr": None,
            "citeScore": None,
            "indexers": [],
            "metrics": {"cuiden": None},
            "classification": {
                "estrato": "NC",
                "justification": "ISSN não encontrado na base de dados de referência local nem no SciELO/LILACS/Latindex.",
            },
            "scieloUpdatedAt": None,
            "lilacsUpdatedAt": None,
            "latindexUpdatedAt": None,
        }

    local_indexers = [idx.upper() for idx in (db_record.get("indexers") or [])]
    need_scielo = "SCIELO" not in local_indexers and "REVENF" not in local_indexers
    need_lilacs = "LILACS" not in local_indexers and "BDENF" not in local_indexers
    need_latindex = "LATINDEX" not in local_indexers

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
                    _merge_indexer_result(db_record, normalized, res)

    # Buscar CiteScore fora do lock (I/O), aplicar mutação dentro do lock
    api_cs = None
    need_citescore = db_record.get("citeScore") is None
    if need_citescore:
        api_cs = await fetch_citescore(normalized, http_client)

    with _db_lock:
        if need_citescore and api_cs is not None:
            db_record["citeScore"] = api_cs

        # Garante que 'SCOPUS' conste na lista de indexadores caso possua CiteScore
        indexers = list(db_record.get("indexers") or [])
        if db_record.get("citeScore") is not None:
            if "SCOPUS" not in [idx.upper() for idx in indexers]:
                indexers.append("SCOPUS")
                db_record["indexers"] = indexers

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
        return []
        
    results = []
    for issn in matched_issns:
        record = db.get(issn, {})
        results.append({
            "issn": issn,
            "title": record.get("title", ""),
            "area": record.get("area", "Outras Áreas"),
            "source": "local",
        })
        
    return results[:50]
