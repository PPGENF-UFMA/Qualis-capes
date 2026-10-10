import logging
import os
import httpx

logger = logging.getLogger(__name__)

OPENALEX_AUTHORS_BASE = os.environ.get(
    "OPENALEX_AUTHORS_BASE", "https://api.openalex.org/authors"
)


def _parse_openalex_stats(author: dict) -> dict:
    """Extrai indicadores da resposta do OpenAlex."""
    stats = author.get("summary_stats") or {}

    h_idx = None
    if stats.get("h_index") is not None:
        try:
            h_idx = int(stats["h_index"])
        except (ValueError, TypeError):
            h_idx = None

    i10 = None
    if stats.get("i10_index") is not None:
        try:
            i10 = int(stats["i10_index"])
        except (ValueError, TypeError):
            i10 = None

    citations = None
    if author.get("cited_by_count") is not None:
        try:
            citations = int(author["cited_by_count"])
        except (ValueError, TypeError):
            citations = None

    works_count = None
    if author.get("works_count") is not None:
        try:
            works_count = int(author["works_count"])
        except (ValueError, TypeError):
            works_count = None

    return {
        "h_index": h_idx,
        "i10_index": i10,
        "citations": citations,
        "works_count": works_count,
        "openalex_id": author.get("id"),
        "profile_url": author.get("id"),
        "source": "OpenAlex",
        "available": True,
    }


async def fetch_openalex_author_metrics(
    orcid: str, http_client: httpx.AsyncClient
) -> dict | None:
    """Consulta métricas cienciométricas abertas do pesquisador no OpenAlex."""
    try:
        response = await http_client.get(
            OPENALEX_AUTHORS_BASE,
            params={"filter": f"orcid:{orcid}"},
            headers={
                "User-Agent": "QualisClassifier/2.0 (mailto:qualis-capes@ufma.br)",
                "Accept": "application/json",
            },
            timeout=10,
        )
        if response.status_code != 200:
            return None
        payload = response.json()
        results = payload.get("results") or []
        if not results:
            return None
        return _parse_openalex_stats(results[0])
    except Exception as exc:
        logger.debug(f"OpenAlex author metrics failed for {orcid}: {exc}")
        return None
