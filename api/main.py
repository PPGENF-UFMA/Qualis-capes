import os
import sys
import time
import asyncio
from collections import defaultdict
from contextlib import asynccontextmanager

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Response, APIRouter, Query
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
audit_logger = logging.getLogger("audit")
audit_logger.setLevel(logging.INFO)
# Garantir que o log de auditoria tenha seu próprio handler saindo no console
_audit_handler = logging.StreamHandler(sys.stdout)
_audit_handler.setFormatter(logging.Formatter('%(asctime)s|AUDIT|%(message)s'))
audit_logger.addHandler(_audit_handler)
audit_logger.propagate = False

from . import cache
from . import enricher
from . import orcid_client
from .models import (
    BatchClassifyRequest, BatchSearchRequest, ClassifyResponse,
    MatchBatchRequest, MatchLattesRequest,
    OrcidAnalyzeRequest, SaveAliasRequest, FeedbackRequest,
)

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(PROJECT_ROOT, ".env"))

_is_production = os.environ.get("ENVIRONMENT", "development").lower() == "production"


# CORS restrito a origens locais (produção: adicionar domínio real)
_allowed_origins = os.environ.get("CORS_ORIGINS", "http://localhost:8080,http://127.0.0.1:8080").split(",")

_http_client: httpx.AsyncClient | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _http_client
    _http_client = httpx.AsyncClient(timeout=30.0)
    _load_trusted_proxies()
    enricher.load_database()
    api_key_set = "SIM" if os.environ.get("ELSEVIER_API_KEY") else "NAO"
    db_size = len(enricher.load_database())
    logger.info(f"Base carregada: {db_size} periodicos")
    logger.info(f"ELSEVIER_API_KEY configurada: {api_key_set}")
    logger.info(f"Servidor iniciado. Docs em /docs")
    asyncio.create_task(enricher.run_latindex_canary(_http_client))
    yield
    if _http_client:
        await _http_client.aclose()


app = FastAPI(
    title="Qualis CAPES Classifier API",
    description="Classificação de periódicos conforme os critérios da CAPES.",
    version="2.0.0",
    docs_url=None if _is_production else "/docs",
    redoc_url=None if _is_production else "/redoc",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=500)

router_v1 = APIRouter(prefix="/api/v1")


# ─── Rate Limiter simples (in-memory token bucket) ─────────────────

_rate_limits: dict[str, list[float]] = defaultdict(list)
_rate_limit_calls: int = 0
_RATE_LIMIT_GC_INTERVAL = 200


def _cleanup_rate_limits():
    """Remove chaves expiradas para evitar memory leak."""
    evicted = 0
    stale: list[str] = []
    now = time.time()
    for key, ts_list in _rate_limits.items():
        _rate_limits[key] = [timestamp for timestamp in ts_list if now - timestamp < 60]
        if not _rate_limits[key]:
            stale.append(key)
            evicted += 1
    for key in stale:
        del _rate_limits[key]
    if evicted > 0:
        logger.debug(f"Rate limiter GC: {evicted} chaves removidas, {len(_rate_limits)} restantes.")


def _check_rate_limit(key: str, max_requests: int, window_seconds: int) -> bool:
    """Retorna True se a request é permitida, False se excedeu o limite."""
    global _rate_limit_calls
    now = time.time()
    timestamps = _rate_limits[key]
    # Limpar timestamps antigos
    _rate_limits[key] = [t for t in timestamps if now - t < window_seconds]
    if len(_rate_limits[key]) >= max_requests:
        return False
    _rate_limits[key].append(now)

    _rate_limit_calls += 1
    if _rate_limit_calls % _RATE_LIMIT_GC_INTERVAL == 0:
        _cleanup_rate_limits()
    return True


_trusted_proxies: set[str] = set()

def _load_trusted_proxies():
    """Carrega lista de proxies confiáveis da env var TRUSTED_PROXIES (CSV ou IP único)."""
    raw = os.environ.get("TRUSTED_PROXIES", "")
    if raw:
        _trusted_proxies.update(ip.strip() for ip in raw.split(",") if ip.strip())


def _get_client_ip(request: Request) -> str:
    """Obtém IP do cliente para rate limiting.

    Só confia no header X-Forwarded-For se o request veio de um proxy
    listado em TRUSTED_PROXIES (env var). Caso contrário, usa o IP direto
    da conexão para evitar bypass via header spoofed.
    """
    client_host = request.client.host if request.client else None
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded and client_host and client_host in _trusted_proxies:
        return forwarded.split(",")[0].strip()
    return client_host or "unknown"


def get_http_client() -> httpx.AsyncClient:
    if _http_client is None:
        raise RuntimeError("HTTP client not initialized")
    return _http_client


def _technical_result(issn: str, message: str) -> dict:
    return {
        "issn": issn,
        "title": "Consulta não concluída",
        "area": "Outras Áreas",
        "jcr": None,
        "citeScore": None,
        "indexers": [],
        "metrics": {"cuiden": None},
        "classification": {
            "estrato": "NC",
            "justification": message,
            "all_candidates": [],
        },
        "data_status": "error",
        "warnings": [{"source": "Servidor", "code": "error", "message": message}],
    }


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
        "identifier_count": enricher.get_identifier_count(),
        "compiled_at": meta.get("compiled_at", "")
    }


@router_v1.get("/status")
async def api_status():
    db = enricher.load_database()
    has_key = bool(os.environ.get("ELSEVIER_API_KEY"))
    meta = enricher.get_database_meta()
    total = len(db)
    with_cs = sum(1 for r in db.values() if isinstance(r.get("citeScore"), (int, float)))
    pct = round(with_cs / total * 100, 1) if total > 0 else 0
    return {
        "status": "ok",
        "version": "2.0.0",
        "database_size": total,
        "identifier_count": enricher.get_identifier_count(),
        "elsevier_api_key": has_key,
        "citeScoreAvailable": has_key,
        "citeScoreCoverage": {"count": with_cs, "total": total, "percent": pct},
        "circuits": cache.get_all_circuit_statuses(),
        "database_meta": meta,
    }


@router_v1.get("/db-summary")
async def api_db_summary(
    response: Response,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    q: str = Query(default="", max_length=160),
):
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
    audit_logger.info(f"classify|ip={ip}|issn={issn}|estrato={result.get('classification', {}).get('estrato', '?')}|area={result.get('area', '?')}")
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
    raw_results = await asyncio.gather(*tasks, return_exceptions=True)
    results = []
    for issn, result in zip(body.issns, raw_results):
        if isinstance(result, Exception):
            logger.error(
                "Falha inesperada na classificação em lote de %s",
                issn,
                exc_info=(type(result), result, result.__traceback__),
            )
            results.append(_technical_result(issn, "Falha interna ao processar este ISSN. Tente novamente."))
        else:
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

    audit_logger.info(f"search|ip={ip}|q={q[:80]}|results={len(results)}")
    return {"results": results, "count": len(results)}


@router_v1.post("/search/batch")
async def api_search_batch(body: BatchSearchRequest, request: Request):
    if not body.queries:
        raise HTTPException(status_code=400, detail="Lista de consultas vazia")
    if len(body.queries) > 100:
        raise HTTPException(status_code=400, detail="Máximo de 100 consultas por lote.")
    ip = _get_client_ip(request)
    if not _check_rate_limit(f"search:{ip}", max_requests=30, window_seconds=60):
        raise HTTPException(status_code=429, detail="Limite de buscas excedido. Tente novamente em 1 minuto.")

    def _resolve_one(name: str) -> dict | None:
        if not name or not name.strip():
            return None
        results = enricher.search_by_name(name)
        if results:
            return results[0]
        return None

    loop = asyncio.get_event_loop()
    resolved = await loop.run_in_executor(None, lambda: [_resolve_one(q) for q in body.queries])
    return {"results": resolved, "count": len(resolved)}


@router_v1.post("/match/batch")
async def api_match_batch(body: MatchBatchRequest, request: Request):
    """Matching de periódicos por nome — pipeline alias→exact→containment→Jaccard-IDF.

    Body: {"queries": [str], "article_titles": [str] | None}
    Retorna: {"results": [{issn, confidence, score, stage, candidates}], "count": int}
    """
    if not body.queries:
        raise HTTPException(status_code=400, detail="Lista de consultas vazia")
    if len(body.queries) > 200:
        raise HTTPException(status_code=400, detail="Máximo de 200 consultas por lote.")
    ip = _get_client_ip(request)
    if not _check_rate_limit(f"match:{ip}", max_requests=60, window_seconds=60):
        raise HTTPException(status_code=429, detail="Limite de matching excedido. Tente novamente em 1 minuto.")

    titles = body.article_titles or [None] * len(body.queries)
    if len(titles) != len(body.queries):
        titles = [None] * len(body.queries)

    def _resolve(query: str, article_title: str | None) -> dict:
        if not query or not query.strip():
            return {"issn": None, "confidence": "none", "score": 0.0, "stage": "none", "candidates": []}
        return enricher.match_journal(query, article_title=article_title)

    loop = asyncio.get_event_loop()
    resolved = await loop.run_in_executor(
        None, lambda: [_resolve(q, t) for q, t in zip(body.queries, titles)]
    )
    audit_logger.info(f"match|ip={ip}|n={len(body.queries)}|high={sum(1 for r in resolved if r.get('confidence') == 'high')}")
    return {"results": resolved, "count": len(resolved)}


@router_v1.post("/match/lattes")
async def api_match_lattes(body: MatchLattesRequest, request: Request):
    """Pipeline completo: segmenta + parseia + match em 1 round-trip.

    Body: {"text": str, "researcher_name": str | None}
    Retorna: {"results": [{...parseSingleArticle, matchedIssn, confidence, matchScore, matchStage, matchCandidates}]}
    """
    if not body.text or not body.text.strip():
        raise HTTPException(status_code=400, detail="Texto vazio")
    if len(body.text) > 200_000:
        raise HTTPException(status_code=413, detail="Texto excede 200KB")
    ip = _get_client_ip(request)
    if not _check_rate_limit(f"match:{ip}", max_requests=60, window_seconds=60):
        raise HTTPException(status_code=429, detail="Limite de matching excedido.")

    def _process() -> list[dict]:
        return enricher.parse_lattes_text(body.text)

    loop = asyncio.get_event_loop()
    results = await loop.run_in_executor(None, _process)
    articles = [r for r in results if r.get("type") != "congresso"]
    audit_logger.info(f"match_lattes|ip={ip}|segments={len(results)}|articles={len(articles)}|high={sum(1 for r in articles if r.get('confidence') == 'high')}")
    return {"results": articles, "count": len(articles)}


@router_v1.post("/orcid/analyze")
async def api_orcid_analyze(body: OrcidAnalyzeRequest, request: Request):
    if not body.orcid or not body.orcid.strip():
        raise HTTPException(status_code=400, detail="ORCID nao informado")
    ip = _get_client_ip(request)
    if not _check_rate_limit(f"orcid:{ip}", max_requests=12, window_seconds=60):
        raise HTTPException(status_code=429, detail="Limite de analises ORCID excedido. Tente novamente em 1 minuto.")

    try:
        result = await orcid_client.analyze_orcid_public(
            body.orcid,
            body.year_from,
            body.year_to,
            get_http_client(),
            include_unclassified=body.include_unclassified,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except PermissionError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise HTTPException(status_code=404, detail="Registro ORCID nao encontrado.")
        raise HTTPException(status_code=502, detail=f"Falha ao consultar ORCID Public API: {exc.response.status_code}")
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="Falha de rede ao consultar ORCID Public API.")

    audit_logger.info(
        f"orcid|ip={ip}|orcid={result.get('orcid')}|range={body.year_from}-{body.year_to}|"
        f"works={result.get('works_in_range')}|classified={result.get('works_classified')}"
    )
    return result


@router_v1.post("/alias")
async def api_save_alias(body: SaveAliasRequest, request: Request):
    """Persiste um alias aprendido pelo usuário no servidor (Fase 2d).

    O alias fica em data/user_aliases.json e é carregado em memória
    por todos os clientes no próximo startup.
    """
    if not body.journal_name or not body.journal_name.strip() or not body.issn:
        raise HTTPException(status_code=400, detail="journal_name e issn são obrigatórios")
    ip = _get_client_ip(request)
    enricher.save_user_alias(body.journal_name.strip(), body.issn.strip())
    audit_logger.info(f"alias|ip={ip}|name={body.journal_name[:80]}|issn={body.issn}")
    return {"status": "ok", "journal_name": body.journal_name, "issn": body.issn}


@router_v1.post("/match/feedback")
async def api_match_feedback(body: FeedbackRequest, request: Request):
    """Registra feedback de correção via "Trocar revista" (Fase 3d).

    Persiste o alias correto e registra para análise posterior.
    """
    if not body.query or not body.right_issn:
        raise HTTPException(status_code=400, detail="query e right_issn são obrigatórios")
    ip = _get_client_ip(request)
    enricher.save_user_alias(body.query.strip(), body.right_issn.strip())
    audit_logger.info(f"feedback|ip={ip}|query={body.query[:80]}|wrong={body.wrong_issn}|right={body.right_issn}")
    return {"status": "ok", "saved_alias": body.right_issn}


@router_v1.get("/stats/matching")
async def api_match_stats(request: Request):
    """Dashboard de taxa de acerto do matching (Fase 3e)."""
    return enricher.get_match_stats()


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

# Servir CSS, JS e Assets como subdiretórios
_css_dir = os.path.join(PROJECT_ROOT, "css")
_js_dir = os.path.join(PROJECT_ROOT, "js")
_assets_dir = os.path.join(PROJECT_ROOT, "assets")
if os.path.isdir(_css_dir):
    app.mount("/css", StaticFiles(directory=_css_dir), name="css")
if os.path.isdir(_js_dir):
    app.mount("/js", StaticFiles(directory=_js_dir), name="js")
if os.path.isdir(_assets_dir):
    app.mount("/assets", StaticFiles(directory=_assets_dir), name="assets")

# Servir logo.svg e index.html como arquivos individuais
from starlette.responses import FileResponse


@app.get("/index.html", include_in_schema=False)
async def serve_index():
    return FileResponse(os.path.join(PROJECT_ROOT, "index.html"), media_type="text/html")


@app.get("/logo.svg", include_in_schema=False)
async def serve_logo():
    return FileResponse(os.path.join(PROJECT_ROOT, "logo.svg"), media_type="image/svg+xml")


@app.get("/favicon.ico", include_in_schema=False)
async def serve_favicon():
    return FileResponse(os.path.join(PROJECT_ROOT, "favicon.ico"), media_type="image/x-icon")
