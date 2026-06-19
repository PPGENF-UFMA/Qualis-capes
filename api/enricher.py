import asyncio
import json
import os
import re
from datetime import datetime

import httpx

from . import cache
from . import engine

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOURNALS_PATH = os.path.join(PROJECT_ROOT, "data", "journals.json")
ELSEVIER_BASE = "https://api.elsevier.com/content/serial/title/issn"

def get_api_key() -> str:
    return os.environ.get("ELSEVIER_API_KEY", "")

_journals_db: dict[str, dict] | None = None


def normalize_issn(issn: str) -> str:
    if not isinstance(issn, str):
        return ""
    cleaned = re.sub(r"[^0-9Xx]", "", issn).upper()
    if len(cleaned) == 8:
        return f"{cleaned[:4]}-{cleaned[4:]}"
    return ""


def load_database() -> dict[str, dict]:
    global _journals_db
    if _journals_db is not None:
        return _journals_db

    if not os.path.exists(JOURNALS_PATH):
        print(f"[AVISO] Arquivo {JOURNALS_PATH} nao encontrado.")
        _journals_db = {}
        return _journals_db

    try:
        with open(JOURNALS_PATH, "r", encoding="utf-8") as f:
            raw = json.load(f)

        _journals_db = {}
        for raw_issn, record in raw.items():
            norm = normalize_issn(raw_issn)
            if norm:
                _journals_db[norm] = record

        discoveries = cache.get_discoveries()
        for issn, record in discoveries.items():
            if issn not in _journals_db:
                _journals_db[issn] = record

        return _journals_db
    except Exception as e:
        print(f"[ERRO] Falha ao carregar {JOURNALS_PATH}: {e}")
        _journals_db = {}
        return _journals_db


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
        return result
    except httpx.HTTPStatusError as e:
        return {"scielo": False, "revenf": False, "title": None, "updated_at": None, "error": f"SciELO API error: {e.response.status_code}"}
    except (httpx.RequestError, httpx.TimeoutException):
        return {"scielo": False, "revenf": False, "title": None, "updated_at": None, "error": "Timeout"}


async def fetch_lilacs(issn: str, http_client: httpx.AsyncClient) -> dict:
    cached = cache.check_cache_validity(cache.get_lilacs_cache(), issn)
    if cached and "bdenf" in cached:
        return cached

    url = f"https://lilacs.bvsalud.org/wp-json/test/v1/bvs/journals/search?q={issn}"
    headers = {"Accept": "application/json", "User-Agent": "Mozilla/5.5"}

    try:
        response = await http_client.get(url, headers=headers, timeout=10)
        raw_data = response.json()

        response_data = (
            raw_data.get("data", {}).get("diaServerResponse", [{}])[0].get("response", {})
        )
        num_found = response_data.get("numFound", 0)
        docs = response_data.get("docs", [])

        lilacs = num_found >= 1
        bdenf = False
        title = None
        issn_real = None
        if lilacs and len(docs) > 0:
            title = docs[0].get("title")
            indexed_dbs = docs[0].get("indexed_database", [])
            bdenf = any("BDENF" in db.upper() for db in indexed_dbs)
            issn_list = docs[0].get("issn", [])
            if len(issn_list) > 0:
                issn_real = issn_list[0]

        today_str = datetime.now().strftime("%Y-%m-%d")
        result = {
            "lilacs": lilacs,
            "bdenf": bdenf,
            "title": title,
            "issn": issn_real,
            "updated_at": today_str,
            "status": "ok",
        }
        cache.save_lilacs_cache({issn: result})
        return result
    except httpx.HTTPStatusError as e:
        return {"lilacs": False, "bdenf": False, "title": None, "issn": None, "updated_at": None, "error": f"LILACS API error: {e.response.status_code}"}
    except (httpx.RequestError, httpx.TimeoutException):
        return {"lilacs": False, "bdenf": False, "title": None, "issn": None, "updated_at": None, "error": "Timeout"}


async def fetch_latindex(issn: str, http_client: httpx.AsyncClient) -> dict:
    cached = cache.check_cache_validity(cache.get_latindex_cache(), issn)
    if cached:
        return cached

    url = f"https://www.latindex.org/latindex/bAvanzada/resultado?idMod=0&send=Buscar&issn={issn}"
    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml",
        "User-Agent": "Mozilla/5.5",
    }

    try:
        response = await http_client.get(url, headers=headers, timeout=10)
        html = response.text

        has_zero_results = "Resultado:&nbsp;0&nbsp;Revistas" in html
        has_results = "Resultado:&nbsp;" in html and not has_zero_results

        latindex = has_results
        title = None
        if latindex:
            match = re.search(
                r'href="https://www\.latindex\.org/latindex/ficha/\d+"[^>]*>\s*([^<]+?)\s*</a>',
                html,
            )
            if match:
                title = match.group(1).strip()

        today_str = datetime.now().strftime("%Y-%m-%d")
        result = {
            "latindex": latindex,
            "title": title,
            "updated_at": today_str,
            "status": "ok",
        }
        cache.save_latindex_cache({issn: result})
        return result
    except httpx.HTTPStatusError as e:
        return {"latindex": False, "title": None, "updated_at": None, "error": f"Latindex error: {e.response.status_code}"}
    except (httpx.RequestError, httpx.TimeoutException):
        return {"latindex": False, "title": None, "updated_at": None, "error": "Timeout"}


async def fetch_citescore(issn: str, http_client: httpx.AsyncClient) -> float | None:
    session_cache = cache.get_session_cache()
    if issn in session_cache:
        return session_cache[issn].get("citeScore")

    api_key = get_api_key()
    if not api_key:
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

        result = {"citeScore": cite_score, "source": "api", "status": "ok" if cite_score is not None else "not_found"}
        cache.get_session_cache()[issn] = result
        return cite_score
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            result = {"citeScore": None, "source": "api", "status": "not_found"}
            cache.get_session_cache()[issn] = result
            return None
        return None
    except (httpx.RequestError, httpx.TimeoutException):
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
            for res in results:
                _merge_indexer_result(db_record, normalized, res)

    cite_score = db_record.get("citeScore")
    if cite_score is None:
        api_cs = await fetch_citescore(normalized, http_client)
        if api_cs is not None:
            db_record["citeScore"] = api_cs

    # Garante que 'SCOPUS' conste na lista de indexadores caso possua CiteScore
    indexers = list(db_record.get("indexers") or [])
    if db_record.get("citeScore") is not None:
        if "SCOPUS" not in [idx.upper() for idx in indexers]:
            indexers.append("SCOPUS")

    classification = engine.classify_journal(db_record)

    return {
        "issn": normalized,
        "title": db_record.get("title", "Sem Título"),
        "area": db_record.get("area", "Outras Áreas"),
        "jcr": db_record.get("jcr"),
        "citeScore": db_record.get("citeScore"),
        "indexers": indexers,
        "metrics": db_record.get("metrics") or {"cuiden": None},
        "classification": classification,
        "scieloUpdatedAt": db_record.get("scieloUpdatedAt"),
        "lilacsUpdatedAt": db_record.get("lilacsUpdatedAt"),
        "latindexUpdatedAt": db_record.get("latindexUpdatedAt"),
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

    import unicodedata

    def normalize_text(text: str) -> str:
        text = text.lower()
        text = unicodedata.normalize("NFD", text)
        text = re.sub(r"[\u0300-\u036f]", "", text)
        return text

    query_norm = normalize_text(query_lower)
    results = []
    for issn, record in db.items():
        title = record.get("title") or ""
        title_norm = normalize_text(title)
        if query_norm in title_norm:
            results.append({
                "issn": issn,
                "title": title,
                "area": record.get("area", "Outras Áreas"),
                "source": "local",
            })

    return results[:50]
