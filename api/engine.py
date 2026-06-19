def classify_journal(journal: dict) -> dict:
    if not journal:
        return {"estrato": "NC", "justification": "Periódico não cadastrado na base de referência."}

    area = journal.get("area", "Outras Áreas")
    jcr = journal.get("jcr") if isinstance(journal.get("jcr"), (int, float)) else None
    citeScore = journal.get("citeScore") if isinstance(journal.get("citeScore"), (int, float)) else None
    indexers_raw = journal.get("indexers") or []
    indexers = [idx.strip().upper() for idx in indexers_raw]
    cuiden_raw = journal.get("metrics", {}) if isinstance(journal.get("metrics"), dict) else {}
    cuiden = cuiden_raw.get("cuiden") if isinstance(cuiden_raw.get("cuiden"), (int, float)) else None

    has_indexer = lambda name: name.upper() in indexers

    if area == "Enfermagem":
        if jcr is not None and jcr >= 1.8:
            return {"estrato": "A1", "justification": f"JCR = {jcr:.2f} (>= 1.8)"}
        if citeScore is not None and citeScore >= 2.9:
            return {"estrato": "A1", "justification": f"CiteScore = {citeScore:.2f} (>= 2.9)"}

        if jcr is not None and 1.1 <= jcr < 1.8:
            return {"estrato": "A2", "justification": f"JCR = {jcr:.2f} (entre 1.1 e 1.8)"}
        if citeScore is not None and 1.8 <= citeScore < 2.9:
            return {"estrato": "A2", "justification": f"CiteScore = {citeScore:.2f} (entre 1.8 e 2.9)"}

        if jcr is not None and 0.6 <= jcr < 1.1:
            return {"estrato": "A3", "justification": f"JCR = {jcr:.2f} (entre 0.6 e 1.1)"}
        if citeScore is not None and 0.7 <= citeScore < 1.8:
            return {"estrato": "A3", "justification": f"CiteScore = {citeScore:.2f} (entre 0.7 e 1.8)"}
        if has_indexer("MEDLINE"):
            return {"estrato": "A3", "justification": "Indexado no MEDLINE"}

        if jcr is not None and 0.1 <= jcr < 0.6:
            return {"estrato": "A4", "justification": f"JCR = {jcr:.2f} (entre 0.1 e 0.6)"}
        if citeScore is not None and 0.1 <= citeScore < 0.7:
            return {"estrato": "A4", "justification": f"CiteScore = {citeScore:.2f} (entre 0.1 e 0.7)"}
        if has_indexer("SCIELO"):
            return {"estrato": "A4", "justification": "Indexado no SCIELO"}
        if has_indexer("REVENF"):
            return {"estrato": "A4", "justification": "Indexado no RevEnf"}

        if has_indexer("LILACS"):
            return {"estrato": "A5", "justification": "Indexado no LILACS"}
        if has_indexer("BDENF"):
            return {"estrato": "A5", "justification": "Indexado no BDENF"}

        if has_indexer("RIC/CUIDEN") or has_indexer("CUIDEN"):
            if cuiden is not None and cuiden >= 1.5:
                return {"estrato": "A6", "justification": f"Indexado no RIC/CUIDEN com índice = {cuiden:.2f} (>= 1.5)"}

        if has_indexer("CINAHL"):
            return {"estrato": "A7", "justification": "Indexado no CINAHL"}
        if has_indexer("RIC/CUIDEN") or has_indexer("CUIDEN"):
            if cuiden is not None and 0.1 <= cuiden <= 1.4:
                return {"estrato": "A7", "justification": f"Indexado no RIC/CUIDEN com índice = {cuiden:.2f} (entre 0.1 e 1.4)"}

        if has_indexer("LATINDEX"):
            return {"estrato": "A8", "justification": "Indexado no Latindex"}

    else:
        if jcr is not None and jcr >= 5.0:
            return {"estrato": "A1", "justification": f"JCR = {jcr:.2f} (>= 5.0)"}
        if citeScore is not None and citeScore >= 5.0:
            return {"estrato": "A1", "justification": f"CiteScore = {citeScore:.2f} (>= 5.0)"}

        if jcr is not None and 4.0 <= jcr < 5.0:
            return {"estrato": "A2", "justification": f"JCR = {jcr:.2f} (entre 4.0 e 5.0)"}
        if citeScore is not None and 4.0 <= citeScore < 5.0:
            return {"estrato": "A2", "justification": f"CiteScore = {citeScore:.2f} (entre 4.0 e 5.0)"}

        if jcr is not None and 3.0 <= jcr < 4.0:
            return {"estrato": "A3", "justification": f"JCR = {jcr:.2f} (entre 3.0 e 4.0)"}
        if citeScore is not None and 3.0 <= citeScore < 4.0:
            return {"estrato": "A3", "justification": f"CiteScore = {citeScore:.2f} (entre 3.0 e 4.0)"}

        if jcr is not None and 2.0 <= jcr < 3.0:
            return {"estrato": "A4", "justification": f"JCR = {jcr:.2f} (entre 2.0 e 3.0)"}
        if citeScore is not None and 2.0 <= citeScore < 3.0:
            return {"estrato": "A4", "justification": f"CiteScore = {citeScore:.2f} (entre 2.0 e 3.0)"}

        if jcr is not None and 1.0 <= jcr < 2.0:
            return {"estrato": "A5", "justification": f"JCR = {jcr:.2f} (entre 1.0 e 2.0)"}
        if citeScore is not None and 0.1 <= citeScore < 2.0:
            return {"estrato": "A5", "justification": f"CiteScore = {citeScore:.2f} (entre 0.1 e 2.0)"}
        if has_indexer("MEDLINE"):
            return {"estrato": "A5", "justification": "Indexado no MEDLINE"}

        if jcr is not None and 0.1 <= jcr < 1.0:
            return {"estrato": "A6", "justification": f"JCR = {jcr:.2f} (entre 0.1 e 1.0)"}
        if has_indexer("SCIELO"):
            return {"estrato": "A6", "justification": "Indexado no SCIELO"}

        if has_indexer("LILACS"):
            return {"estrato": "A7", "justification": "Indexado no LILACS"}

        if has_indexer("LATINDEX"):
            return {"estrato": "A8", "justification": "Indexado no Latindex"}

    return {"estrato": "NC", "justification": "Não classificada nas bases de referência CAPES."}
