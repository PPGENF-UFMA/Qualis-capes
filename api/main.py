import os
import sys
import time
from collections import defaultdict

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Response, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.responses import RedirectResponse

import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

from . import cache
from . import enricher
from .models import BatchClassifyRequest, ClassifyResponse

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(PROJECT_ROOT, ".env"))

_is_production = os.environ.get("ENVIRONMENT", "development").lower() == "production"

app = FastAPI(
    title="Qualis CAPES Classifier API",
    description="Classificação de periódicos conforme os critérios da CAPES.",
    version="2.0.0",
    docs_url=None if _is_production else "/docs",
    redoc_url=None if _is_production else "/redoc",
)

# CORS restrito a origens locais (produção: adicionar domínio real)
_allowed_origins = os.environ.get("CORS_ORIGINS", "http://localhost:8080,http://127.0.0.1:8080").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)

router_v1 = APIRouter(prefix="/api/v1")


# ─── Rate Limiter simples (in-memory token bucket) ─────────────────

_rate_limits: dict[str, list[float]] = defaultdict(list)


def _check_rate_limit(key: str, max_requests: int, window_seconds: int) -> bool:
    """Retorna True se a request é permitida, False se excedeu o limite."""
    now = time.time()
    timestamps = _rate_limits[key]
    # Limpar timestamps antigos
    _rate_limits[key] = [t for t in timestamps if now - t < window_seconds]
    if len(_rate_limits[key]) >= max_requests:
        return False
    _rate_limits[key].append(now)
    return True


def _get_client_ip(request: Request) -> str:
    """Obtém IP do cliente para rate limiting."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"

_http_client: httpx.AsyncClient | None = None


@app.on_event("startup")
async def startup():
    global _http_client
    _http_client = httpx.AsyncClient(timeout=30.0)
    enricher.load_database()
    api_key_set = "SIM" if os.environ.get("ELSEVIER_API_KEY") else "NAO"
    db_size = len(enricher.load_database())
    logger.info(f"Base carregada: {db_size} periodicos")
    logger.info(f"ELSEVIER_API_KEY configurada: {api_key_set}")
    logger.info(f"Servidor iniciado. Docs em /docs")


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


@app.get("/api/health")
async def api_health():
    db = enricher.load_database()
    meta = enricher.get_database_meta()
    return {
        "status": "healthy" if len(db) > 0 else "degraded",
        "db_loaded": len(db) > 0,
        "db_size": len(db),
        "compiled_at": meta.get("compiled_at", "")
    }


@router_v1.get("/status")
async def api_status():
    db = enricher.load_database()
    has_key = bool(os.environ.get("ELSEVIER_API_KEY"))
    meta = enricher.get_database_meta()
    return {
        "status": "ok",
        "version": "2.0.0",
        "database_size": len(db),
        "elsevier_api_key": has_key,
        "citeScoreAvailable": has_key,
        "circuits": cache.get_all_circuit_statuses(),
        "database_meta": meta,
    }


@router_v1.get("/db-summary")
async def api_db_summary(response: Response, page: int = 1, limit: int = 100, q: str = ""):
    items = enricher.get_db_summary()
    if q:
        q_lower = q.lower()
        items = [i for i in items if q_lower in i["title"].lower()]
    response.headers["Cache-Control"] = "max-age=300"
    start = (page - 1) * limit
    return {"total": len(items), "page": page, "items": items[start:start+limit]}


@router_v1.get("/classify/{issn}", response_model=ClassifyResponse)
async def api_classify(issn: str, request: Request):
    if not issn:
        raise HTTPException(status_code=400, detail="ISSN nao informado")
    ip = _get_client_ip(request)
    if not _check_rate_limit(f"classify:{ip}", max_requests=60, window_seconds=60):
        raise HTTPException(status_code=429, detail="Limite de requisições excedido. Tente novamente em 1 minuto.")
    client = get_http_client()
    result = await enricher.enrich_and_classify(issn, client)
    return result


@router_v1.post("/classify/batch")
async def api_classify_batch(body: BatchClassifyRequest, request: Request):
    if not body.issns:
        raise HTTPException(status_code=400, detail="Lista de ISSNs vazia")
    if len(body.issns) > 500:
        raise HTTPException(status_code=400, detail="Máximo de 500 ISSNs por lote.")
    ip = _get_client_ip(request)
    if not _check_rate_limit(f"batch:{ip}", max_requests=10, window_seconds=60):
        raise HTTPException(status_code=429, detail="Limite de requisições de lote excedido. Tente novamente em 1 minuto.")
    client = get_http_client()
    
    import asyncio
    semaphore = asyncio.Semaphore(10)

    async def classify_one(issn):
        async with semaphore:
            return await enricher.enrich_and_classify(issn, client)

    tasks = [classify_one(issn) for issn in body.issns]
    results = await asyncio.gather(*tasks)
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
                url_template,
                params={"q": q},
                headers=headers, timeout=10,
            )
            if resp.status_code == 200:
                docs = _parse_lilacs_docs(resp.json())
                return docs, True
        except Exception:
            continue
    return [], False


@router_v1.get("/search")
async def api_search(q: str = "", request: Request = None):
    if not q or len(q.strip()) < 2:
        raise HTTPException(status_code=400, detail="Termo de busca deve ter pelo menos 2 caracteres")
    if request:
        ip = _get_client_ip(request)
        if not _check_rate_limit(f"search:{ip}", max_requests=30, window_seconds=60):
            raise HTTPException(status_code=429, detail="Limite de buscas excedido. Tente novamente em 1 minuto.")
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


# Aliases temporários (deprecated) com redirect
@app.get("/api/status")
async def legacy_status(request: Request):
    return RedirectResponse(url=f"/api/v1/status?{request.query_params}", status_code=308)

@app.get("/api/db-summary")
async def legacy_db_summary(request: Request):
    return RedirectResponse(url=f"/api/v1/db-summary?{request.query_params}", status_code=308)

@app.get("/api/classify/{issn}")
async def legacy_classify(issn: str, request: Request):
    return RedirectResponse(url=f"/api/v1/classify/{issn}?{request.query_params}", status_code=308)

@app.post("/api/classify/batch")
async def legacy_classify_batch(request: Request):
    # Nota: 308 preserva o método POST
    return RedirectResponse(url=f"/api/v1/classify/batch?{request.query_params}", status_code=308)

@app.get("/api/search")
async def legacy_search(request: Request):
    return RedirectResponse(url=f"/api/v1/search?{request.query_params}", status_code=308)

app.include_router(router_v1)


# ─── Static Files (SEGURANÇA: servir apenas diretórios seguros) ────
# NÃO servir PROJECT_ROOT inteiro — exporia .env, data/, api/, __pycache__/

# Servir CSS e JS como subdiretórios
_css_dir = os.path.join(PROJECT_ROOT, "css")
_js_dir = os.path.join(PROJECT_ROOT, "js")
if os.path.isdir(_css_dir):
    app.mount("/css", StaticFiles(directory=_css_dir), name="css")
if os.path.isdir(_js_dir):
    app.mount("/js", StaticFiles(directory=_js_dir), name="js")

# Servir logo.svg e index.html como arquivos individuais
from starlette.responses import FileResponse


@app.get("/index.html", include_in_schema=False)
async def serve_index():
    return FileResponse(os.path.join(PROJECT_ROOT, "index.html"), media_type="text/html")


@app.get("/logo.svg", include_in_schema=False)
async def serve_logo():
    return FileResponse(os.path.join(PROJECT_ROOT, "logo.svg"), media_type="image/svg+xml")
