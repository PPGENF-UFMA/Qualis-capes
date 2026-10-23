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


def test_check_author_match_refinement():
    from api.scopus_client import _check_author_match

    # Casos corretos
    assert _check_author_match({"ce:surname": "Cunha", "ce:given-name": "Carlos L."}, "carlos", "cunha")
    assert _check_author_match({"ce:surname": "Cunha", "ce:given-name": "C."}, "carlos", "cunha")
    assert _check_author_match({"ce:surname": "Cunha", "ce:given-name": "Carlos Leonardo"}, "c", "cunha")

    # Falsos positivos que NÃO devem casar
    assert not _check_author_match({"ce:surname": "Cunha", "ce:given-name": "Claudio"}, "carlos", "cunha")
    assert not _check_author_match({"ce:surname": "Silva", "ce:given-name": "Carlos"}, "carlos", "cunha")


def test_parse_brazilian_name():
    from api.scopus_client import parse_brazilian_name

    p1 = parse_brazilian_name("Bruno Luciano Carneiro Alves de Oliveira")
    assert p1["first"] == "bruno"
    assert p1["search_first"] == "bruno"
    assert p1["search_last"] == "oliveira"
    assert "luciano" in p1["middles"]
    assert "alves" in p1["middles"]

    p2 = parse_brazilian_name("João de Deus Cabral Júnior")
    assert p2["first"] == "joao"
    assert p2["search_first"] == "joao"
    assert p2["search_last"] == "cabral"
    assert p2["agnome"] == "junior"
    assert p2["last_tokens"] == {"cabral", "junior"}


def test_check_author_match_anti_homonym():
    from api.scopus_client import _check_author_match

    # Celso José Bruno de Oliveira vs ("bruno", "oliveira") -> NÃO deve casar!
    assert not _check_author_match(
        {"ce:surname": "de Oliveira", "ce:given-name": "Celso José Bruno"},
        "bruno",
        "oliveira",
    )

    # Bruno L. C. A. de Oliveira -> DEVE casar!
    assert _check_author_match(
        {"ce:surname": "de Oliveira", "ce:given-name": "Bruno L. C. A."},
        "bruno",
        "oliveira",
    )

    # Coautor com ORCID diferente do pesquisador -> NÃO deve casar!
    assert not _check_author_match(
        {
            "ce:surname": "de Oliveira",
            "ce:given-name": "Bruno Luciano",
            "@orcid": "0000-0002-9999-9999",
        },
        "bruno",
        "oliveira",
        target_orcid="0000-0001-8053-7972",
    )

    # Coautor com ORCID idêntico -> DEVE casar!
    assert _check_author_match(
        {
            "ce:surname": "de Oliveira",
            "ce:given-name": "Bruno Luciano",
            "@orcid": "0000-0001-8053-7972",
        },
        "bruno",
        "oliveira",
        target_orcid="0000-0001-8053-7972",
    )


def test_is_orcid_conflict():
    from api.scopus_client import _is_orcid_conflict

    entry_with_other_orcid = {
        "coredata": {"orcid": "0000-0002-1234-5678"}
    }
    entry_with_same_orcid = {
        "coredata": {"orcid": "0000-0001-8053-7972"}
    }
    entry_without_orcid = {
        "coredata": {}
    }

    assert _is_orcid_conflict(entry_with_other_orcid, "0000-0001-8053-7972") is True
    assert _is_orcid_conflict(entry_with_same_orcid, "0000-0001-8053-7972") is False
    assert _is_orcid_conflict(entry_without_orcid, "0000-0001-8053-7972") is False


def test_score_scopus_author_candidate():
    from api.scopus_client import _score_scopus_author_candidate, parse_brazilian_name

    target_name = parse_brazilian_name("Bruno Luciano Carneiro Alves de Oliveira")
    target_orcid = "0000-0001-8053-7972"

    # Candidato 1: Celso José Bruno de Oliveira -> Primeiro nome Celso -> deve ser rejeitado (-1.0)
    cand_celso = {
        "preferred-name": {
            "given-name": "Celso José Bruno",
            "surname": "de Oliveira",
        },
        "affiliation-current": {"affiliation-country": "Brazil"},
    }
    assert _score_scopus_author_candidate(cand_celso, target_name, target_orcid) == -1.0

    # Candidato 2: Bruno de Oliveira com ORCID diferente -> deve ser rejeitado (-1.0)
    cand_wrong_orcid = {
        "orcid": "0000-0003-9999-0000",
        "preferred-name": {
            "given-name": "Bruno",
            "surname": "de Oliveira",
        },
    }
    assert _score_scopus_author_candidate(cand_wrong_orcid, target_name, target_orcid) == -1.0

    # Candidato 3: Bruno Luciano Carneiro Alves de Oliveira -> Pontuação 100.0 (ORCID confirmado)
    cand_bruno = {
        "orcid": "0000-0001-8053-7972",
        "preferred-name": {
            "given-name": "Bruno Luciano Carneiro Alves",
            "surname": "de Oliveira",
        },
        "affiliation-current": {"affiliation-country": "Brazil"},
        "subject-area": "NURS",
    }
    assert _score_scopus_author_candidate(cand_bruno, target_name, target_orcid) == 100.0

    # Candidato 4: Sem ORCID, mas nomes do meio batem
    cand_bruno_no_orcid = {
        "preferred-name": {
            "given-name": "Bruno Luciano",
            "surname": "de Oliveira",
        },
        "affiliation-current": {"affiliation-country": "Brazil"},
    }
    score = _score_scopus_author_candidate(cand_bruno_no_orcid, target_name, target_orcid)
    assert score >= 15.0


def test_discover_scopus_auid_from_name_homonym_resolution():
    import asyncio
    import httpx
    from api.scopus_client import _discover_scopus_auid_from_name

    class MockSearchClient:
        async def get(self, url, params=None, headers=None, timeout=None):
            return httpx.Response(
                200,
                json={
                    "search-results": {
                        "entry": [
                            {
                                "dc:identifier": "AUTHOR_ID:58609280600",
                                "preferred-name": {
                                    "given-name": "Celso José Bruno",
                                    "surname": "de Oliveira",
                                },
                                "affiliation-current": {"affiliation-country": "Brazil"},
                            },
                            {
                                "dc:identifier": "AUTHOR_ID:56579067700",
                                "preferred-name": {
                                    "given-name": "Bruno Luciano Carneiro Alves",
                                    "surname": "de Oliveira",
                                },
                                "affiliation-current": {"affiliation-country": "Brazil"},
                            },
                        ]
                    }
                },
                request=httpx.Request("GET", url),
            )

    auid = asyncio.run(
        _discover_scopus_auid_from_name(
            "Bruno Luciano Carneiro Alves de Oliveira",
            MockSearchClient(),
            api_key="fake-key",
            target_orcid="0000-0001-8053-7972",
        )
    )
    # Deve selecionar o AUID correto do Bruno e descartar o homônimo Celso
    assert auid == "56579067700"


def test_negative_cache_for_scopus(monkeypatch):
    import asyncio

    fake_cache = {}
    monkeypatch.setattr("api.cache.get_author_metrics_cache", lambda: fake_cache)
    monkeypatch.setattr("api.cache.save_author_metrics_cache", lambda data: fake_cache.update(data))

    call_count = {"scopus": 0}

    async def mock_scopus_failing(orcid, client, **kwargs):
        call_count["scopus"] += 1
        return None

    async def mock_openalex(orcid, client, **kwargs):
        return {"h_index": 10, "source": "OpenAlex", "available": True}

    monkeypatch.setattr(orcid_client, "fetch_scopus_author_metrics", mock_scopus_failing)
    monkeypatch.setattr(orcid_client, "fetch_openalex_author_metrics", mock_openalex)

    # Primeira chamada: executa mock_scopus e salva tentativa no cache
    res1 = asyncio.run(orcid_client.fetch_author_impact_metrics("0000-0002-1825-0097", None, dois=["10.1234/abc"]))
    assert call_count["scopus"] == 1
    assert res1["scopus"] is None
    assert res1["h_index"] == 10

    # Segunda chamada: deve vir do cache com negative cache, sem chamar Scopus de novo!
    res2 = asyncio.run(orcid_client.fetch_author_impact_metrics("0000-0002-1825-0097", None, dois=["10.1234/abc"]))
    assert call_count["scopus"] == 1  # Não aumentou!
    assert res2["scopus"] is None
    assert res2["h_index"] == 10

    # Terceira chamada com force_refresh=True: deve ignorar cache e re-tentar
    res3 = asyncio.run(orcid_client.fetch_author_impact_metrics("0000-0002-1825-0097", None, dois=["10.1234/abc"], force_refresh=True))
    assert call_count["scopus"] == 2  # Aumentou!


def test_is_attempt_expired():
    import time
    from api.orcid_client import _is_attempt_expired

    # Entrada não-dict
    assert _is_attempt_expired(None) is True
    assert _is_attempt_expired("invalid") is True

    # Entrada com sucesso confirmado nunca expira pelo TTL curto
    assert _is_attempt_expired({"available": True}) is False

    # Entrada de cache legado sem attempted_at: expira imediatamente para liberar re-tentativa
    assert _is_attempt_expired({"available": False, "attempted": True}) is True

    # Tentativa recente (< 3600s)
    recent_entry = {"available": False, "attempted": True, "attempted_at": time.time() - 300}
    assert _is_attempt_expired(recent_entry, max_age_seconds=3600) is False

    # Tentativa antiga (> 3600s)
    old_entry = {"available": False, "attempted": True, "attempted_at": time.time() - 4000}
    assert _is_attempt_expired(old_entry, max_age_seconds=3600) is True


def test_api_author_metrics_endpoint(monkeypatch):
    from fastapi.testclient import TestClient
    from api.main import app

    async def mock_metrics(orcid, client, **kwargs):
        return {
            "orcid": orcid,
            "h_index": 15,
            "h_index_source": "Scopus",
            "citations": 450,
            "scopus": {"h_index": 15, "citations": 450, "available": True, "source": "Scopus (Elsevier)"},
            "openalex": {"h_index": 16, "citations": 480, "available": True, "source": "OpenAlex"},
            "updated_at": "2026-10-23",
        }

    monkeypatch.setattr(orcid_client, "fetch_author_impact_metrics", mock_metrics)

    with TestClient(app) as client:
        # 1. ORCID válido
        resp = client.get("/api/v1/author-metrics/0000-0001-8053-7972?name=Bruno%20Oliveira")
        assert resp.status_code == 200
        data = resp.json()
        assert data["orcid"] == "0000-0001-8053-7972"
        assert data["h_index"] == 15
        assert data["h_index_source"] == "Scopus"
        assert data["scopus"]["available"] is True

        # 2. ORCID inválido
        resp_bad = client.get("/api/v1/author-metrics/invalid-orcid")
        assert resp_bad.status_code == 400



def test_build_orcid_search_query():
    from api.orcid_client import _build_orcid_search_query
    
    # Empty query
    assert _build_orcid_search_query("") == ""
    assert _build_orcid_search_query("  ") == ""
    
    # Single name
    assert _build_orcid_search_query("Maria") == '((given-and-family-names:"Maria" OR other-names:"Maria" OR credit-name:"Maria"))'
    
    # Both names (split by space)
    assert _build_orcid_search_query("Maria Silva") == '((given-and-family-names:"Maria" OR other-names:"Maria" OR credit-name:"Maria") AND (given-and-family-names:"Silva" OR other-names:"Silva" OR credit-name:"Silva"))'
    
    # Names and affiliation
    assert _build_orcid_search_query("Maria Silva", "Universidade de Sao Paulo") == '((given-and-family-names:"Maria" OR other-names:"Maria" OR credit-name:"Maria") AND (given-and-family-names:"Silva" OR other-names:"Silva" OR credit-name:"Silva")) AND affiliation-org-name:"Universidade de Sao Paulo"'


def test_extract_search_results():
    from api.orcid_client import _extract_search_results
    
    payload = {
        "expanded-result": [
            {
                "orcid-id": "0000-0002-1825-0097",
                "given-names": "Carlos",
                "family-names": "Cunha",
                "institution-name": ["Universidade Federal do Maranhao", "Universidade Federal do Maranhao"]
            },
            {
                "orcid-id": "0000-0001-2345-6789",
                "credit-name": "Maria Silva (credit)",
                "institution-name": "USP"
            },
            {
                # Missing ORCID, should be skipped
                "given-names": "Invalid",
                "family-names": "User"
            }
        ]
    }
    
    results = _extract_search_results(payload)
    assert len(results) == 2
    
    # First result: dedup institutions, fallback name format
    assert results[0]["orcid"] == "0000-0002-1825-0097"
    assert results[0]["name"] == "Carlos Cunha"
    assert results[0]["institutions"] == ["Universidade Federal do Maranhao"]
    
    # Second result: uses credit-name, handles string institution-name
    assert results[1]["orcid"] == "0000-0001-2345-6789"
    assert results[1]["name"] == "Maria Silva (credit)"
    assert results[1]["institutions"] == ["USP"]


def test_normalize_canonical_doi():
    # SciELO: sufixos pt, en, es (com e sem delimitador) colapsam para o mesmo canônico
    assert orcid_client.normalize_canonical_doi("10.1590/1980-220x-reeusp-2025-0180es") == "10.1590/1980-220x-reeusp-2025-0180"
    assert orcid_client.normalize_canonical_doi("10.1590/1980-220x-reeusp-2025-0180en") == "10.1590/1980-220x-reeusp-2025-0180"
    assert orcid_client.normalize_canonical_doi("10.1590/1980-220x-reeusp-2025-0180pt") == "10.1590/1980-220x-reeusp-2025-0180"

    # REBEn: versão base sem sufixo vs versão com sufixo pt
    assert orcid_client.normalize_canonical_doi("10.1590/0034-7167-2022-0714pt") == "10.1590/0034-7167-2022-0714"
    assert orcid_client.normalize_canonical_doi("10.1590/0034-7167-2022-0714") == "10.1590/0034-7167-2022-0714"

    # Não SciELO com delimitador explícito
    assert orcid_client.normalize_canonical_doi("10.1234/artigo-pt") == "10.1234/artigo"
    assert orcid_client.normalize_canonical_doi("10.1234/artigo-en") == "10.1234/artigo"

    # DOIs sem sufixo de língua não sofrem alteração indevida
    assert orcid_client.normalize_canonical_doi("10.1016/j.athoracsur.2020.01.015") == "10.1016/j.athoracsur.2020.01.015"
    assert orcid_client.normalize_canonical_doi("") == ""
    assert orcid_client.normalize_canonical_doi(None) == ""


def test_extract_work_summaries_deduplicates_multilingual_scielo_works():
    payload = {
        "group": [
            {
                "work-summary": [
                    {
                        "put-code": 101,
                        "type": "journal-article",
                        "title": {"title": {"value": "Alfabetización en salud entre mujeres lactantes"}},
                        "journal-title": {"value": "Revista da Escola de Enfermagem da USP"},
                        "publication-date": {"year": {"value": "2025"}},
                        "external-ids": {
                            "external-id": [
                                {"external-id-type": "doi", "external-id-value": "10.1590/1980-220x-reeusp-2025-0180es"},
                                {"external-id-type": "issn", "external-id-value": "1980-220X"},
                            ]
                        },
                    }
                ]
            },
            {
                "work-summary": [
                    {
                        "put-code": 102,
                        "type": "journal-article",
                        "title": {"title": {"value": "Health literacy among lactating women"}},
                        "journal-title": {"value": "Revista da Escola de Enfermagem da USP"},
                        "publication-date": {"year": {"value": "2025"}},
                        "external-ids": {
                            "external-id": [
                                {"external-id-type": "doi", "external-id-value": "10.1590/1980-220x-reeusp-2025-0180en"},
                            ]
                        },
                    }
                ]
            },
            {
                "work-summary": [
                    {
                        "put-code": 103,
                        "type": "journal-article",
                        "title": {"title": {"value": "Letramento em saúde entre mulheres lactantes e promoção"}},
                        "journal-title": {"value": "Revista da Escola de Enfermagem da USP"},
                        "publication-date": {"year": {"value": "2025"}},
                        "external-ids": {
                            "external-id": [
                                {"external-id-type": "doi", "external-id-value": "10.1590/1980-220x-reeusp-2025-0180pt"},
                            ]
                        },
                    }
                ]
            },
        ]
    }

    works = orcid_client._extract_work_summaries(payload)

    # Deve consolidar os 3 grupos em apenas 1 trabalho
    assert len(works) == 1

    selected = works[0]
    # Deve priorizar o título em português
    assert selected["title"] == "Letramento em saúde entre mulheres lactantes e promoção"
    assert selected["doi"] == "10.1590/1980-220x-reeusp-2025-0180pt"
    assert selected["year"] == 2025
    # Deve herdar o ISSN presente na versão em espanhol
    assert selected["issn"] == "1980-220X"
    # Deve listar os DOIs alternativos/traduzidos
    assert set(selected["alternate_dois"]) == {
        "10.1590/1980-220x-reeusp-2025-0180es",
        "10.1590/1980-220x-reeusp-2025-0180en",
    }

