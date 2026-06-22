import os
import sys

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import RedirectResponse

from . import cache
from . import enricher
from .models import BatchClassifyRequest, ClassifyResponse

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(PROJECT_ROOT, ".env"))

app = FastAPI(
    title="Qualis CAPES Classifier API",
    description="Classificação de periódicos conforme os critérios da CAPES.",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)

_http_client: httpx.AsyncClient | None = None


@app.on_event("startup")
async def startup():
    global _http_client
    _http_client = httpx.AsyncClient(timeout=30.0)
    enricher.load_database()
    api_key_set = "SIM" if os.environ.get("ELSEVIER_API_KEY") else "NAO"
    db_size = len(enricher.load_database())
    print(f"[API] Base carregada: {db_size} periodicos")
    print(f"[API] ELSEVIER_API_KEY configurada: {api_key_set}")
    print(f"[API] Servidor iniciado. Docs em /docs")


@app.on_event("shutdown")
async def shutdown():
    global _http_client
    if _http_client:
        await _http_client.aclose()


def get_http_client() -> httpx.AsyncClient:
    if _http_client is None:
        raise RuntimeError("HTTP client not initialized")
    return _http_client


@app.get("/", include_in_schema=False)
async def root():
    return RedirectResponse(url="/index.html")


@app.get("/api/status")
async def api_status():
    db = enricher.load_database()
    has_key = bool(os.environ.get("ELSEVIER_API_KEY"))
    return {
        "status": "ok",
        "version": "2.0.0",
        "database_size": len(db),
        "elsevier_api_key": has_key,
        "citeScoreAvailable": has_key,
        "circuits": cache.get_all_circuit_statuses(),
    }


@app.get("/api/db-summary")
async def api_db_summary():
    items = enricher.get_db_summary()
    return {"total": len(items), "items": items}


@app.get("/api/classify/{issn}", response_model=ClassifyResponse)
async def api_classify(issn: str):
    if not issn:
        raise HTTPException(status_code=400, detail="ISSN nao informado")
    client = get_http_client()
    result = await enricher.enrich_and_classify(issn, client)
    return result


@app.post("/api/classify/batch")
async def api_classify_batch(request: BatchClassifyRequest):
    if not request.issns:
        raise HTTPException(status_code=400, detail="Lista de ISSNs vazia")
    client = get_http_client()
    results = []
    for issn in request.issns:
        result = await enricher.enrich_and_classify(issn, client)
        results.append(result)
    return {"results": results, "count": len(results)}


LILACS_API_PRIMARY = "https://fi-admin-api.bvsalud.org/api/title/search/"
LILACS_API_FALLBACK = "https://lilacs.bvsalud.org/wp-json/test/v1/bvs/journals/search"


def _parse_lilacs_docs(raw_data: dict) -> list:
    dia = raw_data.get("diaServerResponse") or raw_data.get("data", {}).get("diaServerResponse", [{}])
    return (dia[0] if isinstance(dia, list) else {}).get("response", {}).get("docs", [])


async def _fetch_lilacs_search(q: str, client: httpx.AsyncClient) -> tuple[list, bool]:
    headers = {"Accept": "application/json", "User-Agent": "Mozilla/5.5"}
    for url_template in [LILACS_API_PRIMARY, LILACS_API_FALLBACK]:
        try:
            resp = await client.get(
                f"{url_template}?q={q}",
                headers=headers, timeout=10,
            )
            if resp.status_code == 200:
                docs = _parse_lilacs_docs(resp.json())
                return docs, True
        except Exception:
            continue
    return [], False


@app.get("/api/search")
async def api_search(q: str = ""):
    if not q or len(q.strip()) < 2:
        raise HTTPException(status_code=400, detail="Termo de busca deve ter pelo menos 2 caracteres")
    results = enricher.search_by_name(q)

    cb = cache.circuit_lilacs
    if cb.allow_request():
        docs, success = await _fetch_lilacs_search(q, get_http_client())
        if success:
            cb.record_success()
            bvs_results = []
            for doc in docs:
                issn_list = doc.get("issn", [])
                if issn_list:
                    bvs_results.append({
                        "issn": issn_list[0],
                        "title": doc.get("title", ""),
                        "area": "Enfermagem" if any("BDENF" in db.upper() for db in doc.get("indexed_database", [])) else "Outras Áreas",
                        "source": "lilacs",
                    })

            seen = set(r["issn"] for r in results)
            for br in bvs_results:
                if br["issn"] not in seen:
                    results.append(br)
                    seen.add(br["issn"])
        else:
            cb.record_failure()

    return {"results": results, "count": len(results)}


static_files = StaticFiles(directory=PROJECT_ROOT, html=True, check_dir=True)
app.mount("/", static_files, name="static")
