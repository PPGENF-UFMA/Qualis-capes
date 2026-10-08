from api import orcid_client


def test_normalize_orcid_accepts_plain_and_url():
    expected = "0000-0002-1825-0097"

    assert orcid_client.normalize_orcid("0000000218250097") == expected
    assert orcid_client.normalize_orcid("https://orcid.org/0000-0002-1825-0097") == expected


def test_normalize_orcid_rejects_bad_checksum():
    assert orcid_client.normalize_orcid("0000-0002-1825-0098") == ""
    assert orcid_client.normalize_orcid("not an orcid") == ""


def test_extract_work_summaries_uses_doi_issn_journal_and_year():
    payload = {
        "group": [
            {
                "work-summary": [
                    {
                        "put-code": 123,
                        "type": "journal-article",
                        "title": {"title": {"value": "Article title"}},
                        "journal-title": {"value": "Journal Name"},
                        "publication-date": {"year": {"value": "2024"}},
                        "external-ids": {
                            "external-id": [
                                {"external-id-type": "doi", "external-id-value": "https://doi.org/10.1234/abc"},
                                {"external-id-type": "issn", "external-id-value": "0034-7167"},
                            ]
                        },
                    }
                ]
            }
        ]
    }

    works = orcid_client._extract_work_summaries(payload)

    assert works == [
        {
            "title": "Article title",
            "journal": "Journal Name",
            "year": 2024,
            "doi": "10.1234/abc",
            "issn": "0034-7167",
            "type": "journal-article",
            "put_code": 123,
            "url": "",
        }
    ]


def test_crossref_date_parts_year_prefers_publication_dates():
    message = {
        "issued": {"date-parts": [[2022]]},
        "published-online": {"date-parts": [[2023, 5, 1]]},
    }

    assert orcid_client._date_parts_year(message) == 2023


def test_unclassified_work_includes_journal_and_article_title():
    work = {"title": "Artigo Sobre Ansiedade", "journal": "Revista de Psicologia"}
    result = orcid_client._unclassified_work(work, "Teste sem classificacao")

    assert result["journalTitle"] == "Revista de Psicologia"
    assert result["articleTitle"] == "Artigo Sobre Ansiedade"
    assert "[Nao Identificado]" in result["title"]


def test_fetch_scopus_author_metrics_success(monkeypatch):
    import asyncio
    import httpx

    monkeypatch.setattr("api.enricher.get_api_key", lambda: "fake-key")

    mock_resp = httpx.Response(
        200,
        json={
            "author-retrieval-response": [
                {
                    "@status": "found",
                    "h-index": "42",
                    "coredata": {
                        "citation-count": "1500",
                        "document-count": "80",
                        "link": [{"@rel": "scopus-author", "@href": "https://www.scopus.com/authid/detail.uri?authorId=123"}],
                        "dc:identifier": "AUTHOR_ID:123",
                    },
                }
            ]
        },
        request=httpx.Request("GET", "https://api.elsevier.com/content/author"),
    )

    class MockClient:
        async def get(self, *args, **kwargs):
            return mock_resp

    result = asyncio.run(orcid_client.fetch_scopus_author_metrics("0000-0002-1825-0097", MockClient()))
    assert result is not None
    assert result["h_index"] == 42
    assert result["citations"] == 1500
    assert result["documents"] == 80
    assert result["profile_url"] == "https://www.scopus.com/authid/detail.uri?authorId=123"
    assert result["source"] == "Scopus (Elsevier)"


def test_fetch_openalex_author_metrics_success():
    import asyncio
    import httpx

    mock_resp = httpx.Response(
        200,
        json={
            "results": [
                {
                    "id": "https://openalex.org/A123",
                    "works_count": 65,
                    "cited_by_count": 920,
                    "summary_stats": {
                        "h_index": 28,
                        "i10_index": 45,
                    },
                }
            ]
        },
        request=httpx.Request("GET", "https://api.openalex.org/authors"),
    )

    class MockClient:
        async def get(self, *args, **kwargs):
            return mock_resp

    result = asyncio.run(orcid_client.fetch_openalex_author_metrics("0000-0002-1825-0097", MockClient()))
    assert result is not None
    assert result["h_index"] == 28
    assert result["i10_index"] == 45
    assert result["citations"] == 920
    assert result["works_count"] == 65
    assert result["profile_url"] == "https://openalex.org/A123"
    assert result["source"] == "OpenAlex"


def test_fetch_author_impact_metrics_prioritization(monkeypatch):
    import asyncio

    # Força cache vazio
    monkeypatch.setattr("api.cache.get_author_metrics_cache", lambda: {})
    monkeypatch.setattr("api.cache.save_author_metrics_cache", lambda data: None)

    async def mock_scopus(orcid, client, **kwargs):
        return {"h_index": 35, "citations": 2000, "source": "Scopus (Elsevier)", "available": True}

    async def mock_openalex(orcid, client, **kwargs):
        return {"h_index": 40, "i10_index": 60, "citations": 2500, "source": "OpenAlex", "available": True}

    monkeypatch.setattr(orcid_client, "fetch_scopus_author_metrics", mock_scopus)
    monkeypatch.setattr(orcid_client, "fetch_openalex_author_metrics", mock_openalex)

    result = asyncio.run(orcid_client.fetch_author_impact_metrics("0000-0002-1825-0097", None))
    assert result["h_index"] == 35
    assert result["h_index_source"] == "Scopus"
    assert result["citations"] == 2000
    assert result["scopus"]["h_index"] == 35
    assert result["openalex"]["h_index"] == 40
