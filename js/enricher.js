export function normalizeISSN(issn) {
  if (typeof issn !== 'string') return '';
  const cleaned = issn.replace(/[^0-9Xx]/g, '').toUpperCase();
  if (cleaned.length !== 8) return '';
  if (cleaned.slice(0, 7).includes('X')) return '';
  const weights = [8, 7, 6, 5, 4, 3, 2];
  let total = 0;
  for (let i = 0; i < 7; i++) {
    total += parseInt(cleaned[i], 10) * weights[i];
  }
  const rem = total % 11;
  const check = 11 - rem;
  let expected;
  if (check === 10) expected = 'X';
  else if (check === 11) expected = '0';
  else expected = String(check);
  if (cleaned[7] !== expected) return '';
  return `${cleaned.substring(0, 4)}-${cleaned.substring(4)}`;
}

export function normalizeORCID(orcid) {
  if (typeof orcid !== 'string') return '';
  const cleaned = orcid.replace(/[^0-9Xx]/g, '').toUpperCase();
  if (cleaned.length !== 16 || !/^\d{15}[0-9X]$/.test(cleaned)) return '';

  let total = 0;
  for (let i = 0; i < 15; i++) {
    total = (total + parseInt(cleaned[i], 10)) * 2;
  }
  const remainder = total % 11;
  const result = (12 - remainder) % 11;
  const expected = result === 10 ? 'X' : String(result);
  if (cleaned[15] !== expected) return '';
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}-${cleaned.slice(8, 12)}-${cleaned.slice(12)}`;
}

export async function analyzeOrcid(orcid, yearFrom = null, yearTo = null) {
  const normalized = normalizeORCID(orcid);
  if (!normalized) {
    throw new Error('ORCID invalido. Use o formato 0000-0000-0000-000X.');
  }

  const body = {
    orcid: normalized,
    include_unclassified: true
  };
  if (Number.isInteger(yearFrom)) body.year_from = yearFrom;
  if (Number.isInteger(yearTo)) body.year_to = yearTo;

  const response = await fetch('/api/v1/orcid/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || `Erro ao analisar ORCID: ${response.statusText}`);
  }
  return data;
}

export function createTechnicalErrorResult(rawIssn, message = 'Não foi possível concluir a consulta.') {
  return {
    issn: normalizeISSN(rawIssn) || rawIssn || 'N/A',
    title: 'Consulta não concluída',
    area: 'Outras Áreas',
    jcr: null,
    citeScore: null,
    indexers: [],
    metrics: { cuiden: null },
    classification: { estrato: 'NC', justification: `Falha técnica: ${message}`, all_candidates: [] },
    data_status: 'error',
    warnings: [{ source: 'Servidor', code: 'error', message }]
  };
}

export async function enrichAndClassify(rawIssn) {
  const normalized = normalizeISSN(rawIssn);
  if (!normalized) {
    return {
      issn: rawIssn || 'N/A',
      title: 'ISSN inválido',
      area: 'Outras Áreas',
      jcr: null,
      citeScore: null,
      indexers: [],
      metrics: { cuiden: null },
      classification: { estrato: 'NC', justification: 'ISSN em formato inválido.', all_candidates: [] },
      data_status: 'invalid',
      warnings: []
    };
  }

  try {
    const response = await fetch(`/api/v1/classify/${normalized}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || `API error: ${response.statusText}`);
    return data;
  } catch (error) {
    console.error(`[API] Falha ao classificar ${normalized}:`, error.message);
    return createTechnicalErrorResult(normalized, error.message);
  }
}

/**
 * Classifica uma lista de ISSNs em uma única chamada ao backend.
 * Entradas inválidas são preservadas na posição original com resposta NC.
 * @param {string[]} rawIssns Lista de ISSNs informados pelo usuário
 * @returns {Promise<Object[]>} Resultados na mesma ordem dos ISSNs válidos/invalidos
 */
export async function classifyBatch(rawIssns) {
  const normalizedEntries = rawIssns.map((raw, index) => ({
    raw,
    index,
    normalized: normalizeISSN(raw)
  }));
  const results = new Array(rawIssns.length);
  const valid = normalizedEntries.filter(entry => entry.normalized);

  normalizedEntries
    .filter(entry => !entry.normalized)
    .forEach(entry => {
      results[entry.index] = {
        issn: entry.raw || 'N/A',
        title: 'ISSN invalido',
        area: 'Outras Areas',
        jcr: null,
        citeScore: null,
        indexers: [],
        metrics: { cuiden: null },
        classification: { estrato: 'NC', justification: 'ISSN em formato inválido.', all_candidates: [] },
        data_status: 'invalid',
        warnings: []
      };
    });

  if (valid.length === 0) return results;

  const BATCH_LIMIT = 500;
  for (let i = 0; i < valid.length; i += BATCH_LIMIT) {
    const chunk = valid.slice(i, i + BATCH_LIMIT);
    try {
      const response = await fetch('/api/v1/classify/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issns: chunk.map(entry => entry.normalized) })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || `API error: ${response.statusText}`);
      const classified = data.results || [];
      chunk.forEach((entry, j) => {
        results[entry.index] = classified[j] || {
          issn: entry.normalized,
          title: 'Consulta não concluída',
          area: 'Outras Areas',
          jcr: null,
          citeScore: null,
          indexers: [],
          metrics: { cuiden: null },
          classification: { estrato: 'NC', justification: 'Resposta ausente no lote.', all_candidates: [] },
          data_status: 'error',
          warnings: [{ source: 'Servidor', code: 'error', message: 'Resposta ausente no lote.' }]
        };
      });
    } catch (error) {
      console.error('[API] Falha ao classificar bloco do lote:', error.message);
      const fallback = await Promise.all(chunk.map(entry => enrichAndClassify(entry.normalized)));
      chunk.forEach((entry, index) => {
        results[entry.index] = fallback[index];
      });
    }
  }
  return results;
}

/**
 * Executa segmentação, extração e matching Lattes no backend autoritativo.
 */
export async function matchLattes(text, researcherName = '') {
  const response = await fetch('/api/v1/match/lattes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, researcher_name: researcherName || null })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || `Erro ao analisar texto Lattes: ${response.statusText}`);
  }
  return data.results || [];
}

export async function searchByName(query) {
  try {
    const response = await fetch(`/api/v1/search?q=${encodeURIComponent(query)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || `Erro na busca: ${response.statusText}`);
    return data.results || [];
  } catch (error) {
    console.error('[API] Erro na busca por nome:', error);
    throw error;
  }
}

/**
 * Tenta classificar um periódico pelo nome quando não há ISSN.
 * Faz busca por nome no backend; se encontrar exatamente 1 resultado,
 * classifica esse ISSN. Se encontrar múltiplos, não decide automaticamente.
 * @param {string} journalName Nome do periódico
 * @returns {Promise<Object|null>} Item classificado ou null se não encontrado/ambíguo
 */
export async function classifyByName(journalName) {
  if (!journalName || !journalName.trim()) return null;

  const results = await searchByName(journalName);
  if (results.length === 1) {
    return await enrichAndClassify(results[0].issn);
  }
  return null;
}

/**
 * Salva um alias aprendido no servidor (compartilhado entre clientes).
 * @param {string} journalName Nome do periódico
 * @param {string} issn ISSN correto
 */
export async function saveServerAlias(journalName, issn) {
  try {
    await fetch('/api/v1/alias', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ journal_name: journalName, issn })
    });
  } catch (error) {
    console.error('[API] Erro ao salvar alias:', error);
  }
}

/**
 * Envia feedback de correção manual (Fase 3d).
 * @param {string} query Nome do periódico original
 * @param {string} wrongIssn ISSN errado (ou null)
 * @param {string} rightIssn ISSN correto escolhido pelo usuário
 */
export async function sendMatchFeedback(query, wrongIssn, rightIssn) {
  try {
    await fetch('/api/v1/match/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, wrong_issn: wrongIssn, right_issn: rightIssn })
    });
  } catch (error) {
    console.error('[API] Erro ao enviar feedback:', error);
  }
}
