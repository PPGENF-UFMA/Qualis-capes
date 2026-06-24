"""
Engine de Classificação Qualis CAPES.

Função pura: classifyJournal(journal_dict) → {estrato, justification}

REGRA FUNDAMENTAL: Avaliar TODOS os critérios disponíveis (JCR, CiteScore,
indexadores) e retornar o MAIOR estrato possível ("regra do melhor caso").
"""

# Ordem dos estratos do maior para o menor
ESTRATO_ORDER = ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "NC"]

def _best(candidates: list[tuple[str, str]]) -> dict:
    """Retorna o melhor estrato dentre os candidatos coletados.
    
    Cada candidato é uma tupla (estrato, justificativa).
    Retorna o de maior prioridade conforme ESTRATO_ORDER.
    """
    if not candidates:
        return {"estrato": "NC", "justification": "Não classificada nas bases de referência CAPES."}

    best_idx = len(ESTRATO_ORDER) - 1
    best_just = ""
    for estrato, justification in candidates:
        idx = ESTRATO_ORDER.index(estrato) if estrato in ESTRATO_ORDER else len(ESTRATO_ORDER) - 1
        if idx < best_idx:
            best_idx = idx
            best_just = justification

    formatted_candidates = [{"estrato": c[0], "reason": c[1]} for c in candidates]
    
    return {
        "estrato": ESTRATO_ORDER[best_idx], 
        "justification": best_just,
        "all_candidates": formatted_candidates
    }


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

    # Coletar TODOS os estratos possíveis de TODOS os critérios
    candidates: list[tuple[str, str]] = []

    if area == "Enfermagem":
        _collect_enfermagem(candidates, jcr, citeScore, has_indexer, cuiden)
    else:
        _collect_outras_areas(candidates, jcr, citeScore, has_indexer)

    return _best(candidates)


def _collect_enfermagem(candidates, jcr, citeScore, has_indexer, cuiden):
    """Coleta TODOS os estratos possíveis para a área de Enfermagem."""

    # === A1 ===
    if jcr is not None and jcr >= 1.8:
        candidates.append(("A1", f"JCR = {jcr:.2f} (>= 1.8) — Fonte: Base local"))
    if citeScore is not None and citeScore >= 2.9:
        candidates.append(("A1", f"CiteScore = {citeScore:.2f} (>= 2.9) — Fonte: API Elsevier"))

    # === A2 ===
    if jcr is not None and 1.1 <= jcr < 1.8:
        candidates.append(("A2", f"JCR = {jcr:.2f} (entre 1.1 e 1.8) — Fonte: Base local"))
    if citeScore is not None and 1.8 <= citeScore < 2.9:
        candidates.append(("A2", f"CiteScore = {citeScore:.2f} (entre 1.8 e 2.9) — Fonte: API Elsevier"))

    # === A3 ===
    if jcr is not None and 0.6 <= jcr < 1.1:
        candidates.append(("A3", f"JCR = {jcr:.2f} (entre 0.6 e 1.1) — Fonte: Base local"))
    if citeScore is not None and 0.7 <= citeScore < 1.8:
        candidates.append(("A3", f"CiteScore = {citeScore:.2f} (entre 0.7 e 1.8) — Fonte: API Elsevier"))
    if has_indexer("MEDLINE"):
        candidates.append(("A3", "Indexado no MEDLINE — Fonte: Base local"))

    # === A4 ===
    if jcr is not None and 0.1 <= jcr < 0.6:
        candidates.append(("A4", f"JCR = {jcr:.2f} (entre 0.1 e 0.6) — Fonte: Base local"))
    if citeScore is not None and 0.1 <= citeScore < 0.7:
        candidates.append(("A4", f"CiteScore = {citeScore:.2f} (entre 0.1 e 0.7) — Fonte: API Elsevier"))
    if has_indexer("SCIELO"):
        candidates.append(("A4", "Indexado no SCIELO — Fonte: API SciELO"))
    if has_indexer("REVENF"):
        candidates.append(("A4", "Indexado no RevEnf — Fonte: API SciELO"))

    # === A5 ===
    if has_indexer("LILACS"):
        candidates.append(("A5", "Indexado no LILACS — Fonte: API BVS/LILACS"))
    if has_indexer("BDENF"):
        candidates.append(("A5", "Indexado no BDENF — Fonte: API BVS/LILACS"))

    # === A6 ===
    if (has_indexer("RIC/CUIDEN") or has_indexer("CUIDEN")) and cuiden is not None and cuiden >= 1.5:
        candidates.append(("A6", f"Indexado no RIC/CUIDEN com índice = {cuiden:.2f} (>= 1.5) — Fonte: Base local"))

    # === A7 ===
    if has_indexer("CINAHL"):
        candidates.append(("A7", "Indexado no CINAHL"))
    if (has_indexer("RIC/CUIDEN") or has_indexer("CUIDEN")) and cuiden is not None and 0.1 <= cuiden <= 1.4:
        candidates.append(("A7", f"Indexado no RIC/CUIDEN com índice = {cuiden:.2f} (entre 0.1 e 1.4)"))

    # === A8 ===
    if has_indexer("LATINDEX"):
        candidates.append(("A8", "Indexado no Latindex"))


def _collect_outras_areas(candidates, jcr, citeScore, has_indexer):
    """Coleta TODOS os estratos possíveis para Outras Áreas."""

    # === A1 ===
    if jcr is not None and jcr >= 5.0:
        candidates.append(("A1", f"JCR = {jcr:.2f} (>= 5.0) — Fonte: Base local"))
    if citeScore is not None and citeScore >= 5.0:
        candidates.append(("A1", f"CiteScore = {citeScore:.2f} (>= 5.0) — Fonte: API Elsevier"))

    # === A2 ===
    if jcr is not None and 4.0 <= jcr < 5.0:
        candidates.append(("A2", f"JCR = {jcr:.2f} (entre 4.0 e 5.0) — Fonte: Base local"))
    if citeScore is not None and 4.0 <= citeScore < 5.0:
        candidates.append(("A2", f"CiteScore = {citeScore:.2f} (entre 4.0 e 5.0) — Fonte: API Elsevier"))

    # === A3 ===
    if jcr is not None and 3.0 <= jcr < 4.0:
        candidates.append(("A3", f"JCR = {jcr:.2f} (entre 3.0 e 4.0) — Fonte: Base local"))
    if citeScore is not None and 3.0 <= citeScore < 4.0:
        candidates.append(("A3", f"CiteScore = {citeScore:.2f} (entre 3.0 e 4.0) — Fonte: API Elsevier"))

    # === A4 ===
    if jcr is not None and 2.0 <= jcr < 3.0:
        candidates.append(("A4", f"JCR = {jcr:.2f} (entre 2.0 e 3.0) — Fonte: Base local"))
    if citeScore is not None and 2.0 <= citeScore < 3.0:
        candidates.append(("A4", f"CiteScore = {citeScore:.2f} (entre 2.0 e 3.0) — Fonte: API Elsevier"))

    # === A5 ===
    if jcr is not None and 1.0 <= jcr < 2.0:
        candidates.append(("A5", f"JCR = {jcr:.2f} (entre 1.0 e 2.0) — Fonte: Base local"))
    if citeScore is not None and 0.1 <= citeScore < 2.0:
        candidates.append(("A5", f"CiteScore = {citeScore:.2f} (entre 0.1 e 2.0) — Fonte: API Elsevier"))
    if has_indexer("MEDLINE"):
        candidates.append(("A5", "Indexado no MEDLINE — Fonte: Base local"))

    # === A6 ===
    if jcr is not None and 0.1 <= jcr < 1.0:
        candidates.append(("A6", f"JCR = {jcr:.2f} (entre 0.1 e 1.0) — Fonte: Base local"))
    if has_indexer("SCIELO"):
        candidates.append(("A6", "Indexado no SCIELO — Fonte: API SciELO"))

    # === A7 ===
    if has_indexer("LILACS"):
        candidates.append(("A7", "Indexado no LILACS — Fonte: API BVS/LILACS"))

    # === A8 ===
    if has_indexer("LATINDEX"):
        candidates.append(("A8", "Indexado no Latindex — Fonte: API Latindex"))
