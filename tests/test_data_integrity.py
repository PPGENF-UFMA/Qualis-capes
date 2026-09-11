"""Regressões para identidade de periódicos e estados de consulta."""

import asyncio
from datetime import datetime

from api import cache, enricher
from api.models import ClassificationResult, ClassifyResponse


def test_print_and_electronic_issn_resolve_to_one_journal():
    printed = enricher.find_journal("0034-7167")
    electronic = enricher.find_journal("1984-0446")

    assert printed is electronic
    assert enricher.resolve_issn("1984-0446") == "0034-7167"
    assert len(enricher.load_database()) < enricher.get_identifier_count()


def test_transient_error_is_never_a_valid_negative_cache_entry():
    entry = {
        "1234-5679": {
            "status": "error",
            "updated_at": datetime.now().strftime("%Y-%m-%d"),
            "scielo": False,
        }
    }

    assert cache.check_cache_validity(entry, "1234-5679") is None


def test_response_mutable_defaults_are_isolated():
    first = ClassifyResponse(
        issn="0034-7167",
        title="A",
        area="Enfermagem",
        classification=ClassificationResult(estrato="A1", justification="teste"),
    )
    second = ClassifyResponse(
        issn="1984-0446",
        title="B",
        area="Enfermagem",
        classification=ClassificationResult(estrato="A1", justification="teste"),
    )

    first.warnings.append({"source": "teste"})
    assert second.warnings == []


def test_all_external_failures_produce_technical_error(monkeypatch):
    async def scielo(*_args):
        return {"scielo": False, "revenf": False, "status": "error", "error": "SciELO indisponível"}

    async def lilacs(*_args):
        return {"lilacs": False, "bdenf": False, "status": "error", "error": "LILACS indisponível"}

    async def latindex(*_args):
        return {"latindex": False, "status": "error", "error": "Latindex indisponível"}

    async def citescore(*_args):
        return {"citeScore": None, "status": "error", "error": "Elsevier indisponível"}

    monkeypatch.setattr(enricher, "fetch_scielo", scielo)
    monkeypatch.setattr(enricher, "fetch_lilacs", lilacs)
    monkeypatch.setattr(enricher, "fetch_latindex", latindex)
    monkeypatch.setattr(enricher, "fetch_citescore_result", citescore)

    # ISSN válido e ausente da base local.
    result = asyncio.run(enricher.enrich_and_classify("0000-0019", None))

    assert result["data_status"] == "error"
    assert result["title"] == "Consulta não concluída"
    assert len(result["warnings"]) == 4


def test_reme_both_issns_classify_as_a4():
    """Garante que REME tanto impresso quanto online sejam classificados como A4."""
    for issn in ["1415-2762", "2316-9389"]:
        res = asyncio.run(enricher.enrich_and_classify(issn, None))
        assert res["classification"]["estrato"] == "A4", f"Falha para REME {issn}: {res['classification']}"
        assert "RevEnf" in res["indexers"] or "REVENF" in [idx.upper() for idx in res["indexers"]]
        assert res["area"] == "Enfermagem"


def test_saude_em_debate_both_issns_classify_as_a6(monkeypatch):
    """Garante que Saúde em Debate tanto impresso quanto online sejam classificados como A6."""
    async def mock_scielo(issn, _client):
        return {
            "scielo": True,
            "revenf": False,
            "title": "Saúde em Debate",
            "updated_at": "2026-09-11",
            "status": "ok",
        }

    monkeypatch.setattr(enricher, "fetch_scielo", mock_scielo)

    for issn in ["0103-1104", "2358-2898"]:
        res = asyncio.run(enricher.enrich_and_classify(issn, None))
        assert res["classification"]["estrato"] == "A6", f"Falha para Saúde em Debate {issn}: {res['classification']}"
        assert "SCIELO" in [idx.upper() for idx in res["indexers"]]
        assert res["area"] == "Outras Áreas"
