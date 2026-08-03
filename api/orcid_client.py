import asyncio
import os
import re
from datetime import datetime
from urllib.parse import quote

import httpx

from . import enricher


ORCID_PUBLIC_BASE = os.environ.get("ORCID_PUBLIC_BASE", "https://pub.orcid.org/v3.0")
ORCID_TOKEN_URL = os.environ.get("ORCID_TOKEN_URL", "https://orcid.org/oauth/token")
CROSSREF_WORKS_BASE = "https://api.crossref.org/works"
DEFAULT_HEADERS = {
    "Accept": "application/json",
    "User-Agent": "QualisCapesClassifier/2.0 (mailto:qualis-capes@example.invalid)",
}
ARTICLE_TYPES = {"journal-article", "preprint", "peer-review"}

_orcid_token_cache: str | None = None


def normalize_orcid(orcid: str) -> str:
    if not isinstance(orcid, str):
        return ""
    cleaned = re.sub(r"[^0-9Xx]", "", orcid).upper()
    if len(cleaned) != 16 or not cleaned[:15].isdigit():
        return ""

    total = 0
    for digit in cleaned[:15]:
        total = (total + int(digit)) * 2
    remainder = total % 11
    result = (12 - remainder) % 11
    expected = "X" if result == 10 else str(result)
    if cleaned[-1] != expected:
        return ""
    return f"{cleaned[:4]}-{cleaned[4:8]}-{cleaned[8:12]}-{cleaned[12:]}"


def normalize_doi(doi: str | None) -> str:
    if not doi:
        return ""
    cleaned = doi.strip()
    cleaned = re.sub(r"^https?://(dx\.)?doi\.org/", "", cleaned, flags=re.I)
    cleaned = cleaned.replace("doi:", "").strip()
    return cleaned


def _value(node: dict | None) -> str:
    if isinstance(node, dict):
        value = node.get("value")
        return str(value).strip() if value is not None else ""
    return ""


def _title_value(summary: dict) -> str:
    title = summary.get("title") or {}
    return _value(title.get("title"))


def _journal_value(summary: dict) -> str:
    return _value(summary.get("journal-title"))


def _publication_year(summary: dict) -> int | None:
    pub_date = summary.get("publication-date") or {}
    year = _value(pub_date.get("year"))
    if year and year.isdigit():
        return int(year)
    return None


def _external_ids(summary: dict) -> list[dict]:
    return ((summary.get("external-ids") or {}).get("external-id")) or []


def _extract_external_values(summary: dict) -> dict:
    ids = {"doi": "", "issn": ""}
    for ext_id in _external_ids(summary):
        ext_type = str(ext_id.get("external-id-type") or "").lower()
        ext_value = str(ext_id.get("external-id-value") or "").strip()
        if not ext_value:
            continue
        if ext_type == "doi" and not ids["doi"]:
            ids["doi"] = normalize_doi(ext_value)
        elif ext_type in {"issn", "eissn"} and not ids["issn"]:
            ids["issn"] = enricher.normalize_issn(ext_value)
    return ids


def _extract_work_summaries(payload: dict) -> list[dict]:
    works = []
    seen = set()
    for group in payload.get("group") or []:
        summaries = group.get("work-summary") or []
        if not summaries:
            continue
        summary = summaries[0]
        work_type = summary.get("type") or ""
        journal = _journal_value(summary)
        ext_values = _extract_external_values(summary)
        if work_type and work_type not in ARTICLE_TYPES and not (journal or ext_values["issn"] or ext_values["doi"]):
            continue

        title = _title_value(summary)
        key = ext_values["doi"].lower() or "|".join([
            title.lower(),
            journal.lower(),
            str(_publication_year(summary) or ""),
        ])
        if key in seen:
            continue
        seen.add(key)

        works.append({
            "title": title,
            "journal": journal,
            "year": _publication_year(summary),
            "doi": ext_values["doi"],
            "issn": ext_values["issn"],
            "type": work_type,
            "put_code": summary.get("put-code"),
            "url": _value(summary.get("url")),
        })
    return works


def _date_parts_year(message: dict) -> int | None:
    for key in ("published-print", "published-online", "published", "issued"):
        parts = ((message.get(key) or {}).get("date-parts")) or []
        if parts and parts[0]:
            try:
                return int(parts[0][0])
            except (TypeError, ValueError):
                continue
    return None


def _crossref_cache_get(key: str) -> dict | None:
    entry = enricher._crossref_cache.get(key)
    if not entry:
        return None
    try:
        cached_at = datetime.strptime(entry.get("_ts", ""), "%Y-%m-%d")
        if (datetime.now() - cached_at).days <= 30:
            return entry
    except ValueError:
        return None
    return None


def _crossref_cache_set(key: str, entry: dict) -> None:
    entry["_ts"] = datetime.now().strftime("%Y-%m-%d")
    enricher._crossref_cache[key] = entry
    enricher._save_crossref_cache()


async def resolve_doi_with_crossref(doi: str, http_client: httpx.AsyncClient) -> dict | None:
    normalized_doi = normalize_doi(doi)
    if not normalized_doi:
        return None

    cache_key = f"doi:{normalized_doi.lower()}"
    cached = _crossref_cache_get(cache_key)
    if cached is not None:
        return cached if cached.get("found") else None

    try:
        response = await http_client.get(
            f"{CROSSREF_WORKS_BASE}/{quote(normalized_doi, safe='')}",
            headers=DEFAULT_HEADERS,
            timeout=12,
            follow_redirects=True,
        )
        if response.status_code != 200:
            _crossref_cache_set(cache_key, {"found": False})
            return None
        message = (response.json().get("message") or {})
        issns = [
            enricher.normalize_issn(issn)
            for issn in (message.get("ISSN") or [])
            if enricher.normalize_issn(issn)
        ]
        result = {
            "found": True,
            "doi": normalized_doi,
            "issns": list(dict.fromkeys(issns)),
            "journal": (message.get("container-title") or [""])[0] or "",
            "title": (message.get("title") or [""])[0] or "",
            "year": _date_parts_year(message),
        }
        _crossref_cache_set(cache_key, result)
        return result
    except Exception:
        return None


async def _get_orcid_access_token(http_client: httpx.AsyncClient) -> str | None:
    global _orcid_token_cache
    env_token = os.environ.get("ORCID_ACCESS_TOKEN")
    if env_token:
        return env_token
    if _orcid_token_cache:
        return _orcid_token_cache

    client_id = os.environ.get("ORCID_CLIENT_ID")
    client_secret = os.environ.get("ORCID_CLIENT_SECRET")
    if not client_id or not client_secret:
        return None

    try:
        response = await http_client.post(
            ORCID_TOKEN_URL,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "grant_type": "client_credentials",
                "scope": "/read-public",
            },
            headers={"Accept": "application/json"},
            timeout=12,
        )
        response.raise_for_status()
        token = response.json().get("access_token")
        if token:
            _orcid_token_cache = token
            return token
    except Exception:
        return None
    return None


async def _orcid_get(path: str, http_client: httpx.AsyncClient) -> dict:
    headers = dict(DEFAULT_HEADERS)
    token = await _get_orcid_access_token(http_client)
    if token:
        headers["Authorization"] = f"Bearer {token}"

    response = await http_client.get(
        f"{ORCID_PUBLIC_BASE}{path}",
        headers=headers,
        timeout=20,
        follow_redirects=True,
    )
    if response.status_code in {401, 403}:
        raise PermissionError("Registro ORCID publico indisponivel ou credenciais publicas ausentes.")
    response.raise_for_status()
    return response.json()


async def fetch_person_name(orcid: str, http_client: httpx.AsyncClient) -> str:
    try:
        payload = await _orcid_get(f"/{orcid}/person", http_client)
        name = payload.get("name") or {}
        credit_name = _value(name.get("credit-name"))
        given = _value(name.get("given-names"))
        family = _value(name.get("family-name"))
        return credit_name or " ".join(part for part in [given, family] if part)
    except Exception:
        return ""


async def fetch_public_works(orcid: str, http_client: httpx.AsyncClient) -> list[dict]:
    payload = await _orcid_get(f"/{orcid}/works", http_client)
    return _extract_work_summaries(payload)


def _unclassified_work(work: dict, reason: str) -> dict:
    title = work.get("title") or "Artigo ORCID sem titulo"
    journal = work.get("journal") or "Periodico nao identificado"
    return {
        "issn": "N/A",
        "title": f"[Nao Identificado] {title} ({journal})",
        "area": "Outras Areas",
        "jcr": None,
        "citeScore": None,
        "indexers": [],
        "metrics": {"cuiden": None},
        "classification": {"estrato": "NC", "justification": reason, "all_candidates": []},
        "data_status": "complete",
        "warnings": [],
        "year": work.get("year"),
        "doi": work.get("doi"),
        "orcidPutCode": work.get("put_code"),
        "orcidWorkType": work.get("type"),
        "confidence": "none",
        "matchStage": "none",
        "orcidSource": "orcid-public",
    }


async def _classify_work(work: dict, http_client: httpx.AsyncClient, include_unclassified: bool) -> dict | None:
    doi_meta = None
    issn = work.get("issn") or ""
    journal = work.get("journal") or ""
    title = work.get("title") or ""
    year = work.get("year")
    match_stage = "orcid-issn" if issn else ""
    confidence = "high" if issn else "none"
    candidates = []

    if not issn and work.get("doi"):
        doi_meta = await resolve_doi_with_crossref(work["doi"], http_client)
        if doi_meta:
            title = title or doi_meta.get("title") or ""
            journal = journal or doi_meta.get("journal") or ""
            year = year or doi_meta.get("year")
            if doi_meta.get("issns"):
                issn = doi_meta["issns"][0]
                match_stage = "crossref-doi"
                confidence = "high"

    if not issn and journal:
        match = enricher.match_journal(journal)
        if match.get("issn"):
            issn = match["issn"]
            match_stage = match.get("stage") or "journal-name"
            confidence = match.get("confidence") or "review"
            candidates = match.get("candidates") or []

    enriched_work = {
        **work,
        "title": title or work.get("title"),
        "journal": journal or work.get("journal"),
        "year": year,
    }

    if not issn:
        if not include_unclassified:
            return None
        return _unclassified_work(
            enriched_work,
            "Nao foi possivel identificar ISSN a partir do ORCID, DOI/Crossref ou matching por nome.",
        )

    classified = await enricher.enrich_and_classify(issn, http_client)
    journal_label = journal or classified.get("title") or "Periodico identificado"
    article_title = title or "Artigo ORCID sem titulo"
    if article_title and classified.get("title"):
        classified["title"] = f"{article_title} ({journal_label})"
    classified["year"] = year
    classified["doi"] = work.get("doi") or (doi_meta or {}).get("doi")
    classified["orcidPutCode"] = work.get("put_code")
    classified["orcidWorkType"] = work.get("type")
    classified["orcidSource"] = "orcid-public"
    classified["confidence"] = confidence
    classified["matchStage"] = match_stage or "journal-name"
    if candidates:
        classified["lattesCandidates"] = candidates
    return classified


async def analyze_orcid_public(
    orcid: str,
    year_from: int | None,
    year_to: int | None,
    http_client: httpx.AsyncClient,
    include_unclassified: bool = True,
) -> dict:
    normalized_orcid = normalize_orcid(orcid)
    if not normalized_orcid:
        raise ValueError("ORCID invalido. Use o formato 0000-0000-0000-000X.")
    if year_from and year_to and year_from > year_to:
        raise ValueError("Ano inicial nao pode ser maior que o ano final.")
    if year_from and year_to and (year_to - year_from) > 20:
        raise ValueError("Intervalo maximo permitido: 20 anos.")

    person_task = asyncio.create_task(fetch_person_name(normalized_orcid, http_client))
    try:
        works = await fetch_public_works(normalized_orcid, http_client)
    except Exception:
        person_task.cancel()
        raise
    filtered = [
        work for work in works
        if (year_from is None or (work.get("year") is not None and work["year"] >= year_from))
        and (year_to is None or (work.get("year") is not None and work["year"] <= year_to))
    ]

    semaphore = asyncio.Semaphore(8)

    async def classify_one(work: dict) -> dict | None:
        async with semaphore:
            return await _classify_work(work, http_client, include_unclassified)

    results = [item for item in await asyncio.gather(*(classify_one(work) for work in filtered)) if item]
    researcher_name = await person_task
    classified_count = sum(1 for item in results if item.get("issn") and item.get("issn") != "N/A")
    review_count = sum(1 for item in results if item.get("confidence") == "review")

    return {
        "orcid": normalized_orcid,
        "researcher_name": researcher_name,
        "year_from": year_from,
        "year_to": year_to,
        "works_found": len(works),
        "works_in_range": len(filtered),
        "works_classified": classified_count,
        "works_review": review_count,
        "results": results,
        "count": len(results),
    }
