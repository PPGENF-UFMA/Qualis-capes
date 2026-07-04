let dbSummary = null;

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

export async function loadDatabase() {
  if (dbSummary !== null) return dbSummary;
  try {
    const response = await fetch('/api/v1/db-summary?limit=100000');
    if (!response.ok) throw new Error(`Erro ao carregar banco: ${response.statusText}`);
    const data = await response.json();
    dbSummary = {
      total: data.total,
      items: data.items
    };
    return dbSummary;
  } catch (error) {
    console.error('Falha ao carregar base de dados:', error);
    dbSummary = {};
    return dbSummary;
  }
}

export function setDatabase(data) {
  dbSummary = { total: 0, items: [] };
  // Mock function if needed
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
      classification: { estrato: 'NC', justification: 'ISSN em formato inválido.' }
    };
  }

  try {
    const response = await fetch(`/api/v1/classify/${normalized}`);
    if (!response.ok) throw new Error(`API error: ${response.statusText}`);
    return await response.json();
  } catch (error) {
    console.error(`[API] Falha ao classificar ${normalized}:`, error.message);
    return {
      issn: normalized,
      title: 'Erro ao consultar API',
      area: 'Outras Áreas',
      jcr: null,
      citeScore: null,
      indexers: [],
      metrics: { cuiden: null },
      classification: { estrato: 'NC', justification: `Erro ao consultar servidor: ${error.message}` }
    };
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
        classification: { estrato: 'NC', justification: 'ISSN em formato invalido.' }
      };
    });

  if (valid.length === 0) return results;

  try {
    const BATCH_LIMIT = 500;
    for (let i = 0; i < valid.length; i += BATCH_LIMIT) {
      const chunk = valid.slice(i, i + BATCH_LIMIT);
      const response = await fetch('/api/v1/classify/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issns: chunk.map(entry => entry.normalized) })
      });
      if (!response.ok) throw new Error(`API error: ${response.statusText}`);
      const data = await response.json();
      const classified = data.results || [];
      chunk.forEach((entry, j) => {
        results[entry.index] = classified[j] || {
          issn: entry.normalized,
          title: 'Erro ao consultar API',
          area: 'Outras Areas',
          jcr: null,
          citeScore: null,
          indexers: [],
          metrics: { cuiden: null },
          classification: { estrato: 'NC', justification: 'Resposta ausente no lote.' }
        };
      });
    }
    return results;
  } catch (error) {
    console.error('[API] Falha ao classificar lote:', error.message);
    return Promise.all(rawIssns.map(issn => enrichAndClassify(issn)));
  }
}

export async function searchByName(query) {
  try {
    const response = await fetch(`/api/v1/search?q=${encodeURIComponent(query)}`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.results || [];
  } catch (error) {
    console.error('[API] Erro na busca por nome:', error);
    return [];
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
 * Busca em lote por nomes de periódicos no backend.
 * @param {string[]} queries Lista de nomes de periódicos
 * @returns {Promise<Object[]>} Lista de resultados (cada posição corresponde à query)
 */
export async function searchBatch(queries) {
  try {
    const response = await fetch('/api/v1/search/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries })
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.results || [];
  } catch (error) {
    console.error('[API] Erro na busca em lote:', error);
    return [];
  }
}

/**
 * Matching de periódicos por nome — pipeline server-side:
 * alias → exato → containment → Jaccard-IDF + Jaro-Winkler.
 *
 * @param {string[]} queries Lista de nomes de periódicos (1 por artigo).
 * @param {string[]|null} articleTitles Títulos de artigo (opcional, usado
 *        em Fase 2 p/ desambiguação Crossref; hoje ignorado pelo backend).
 * @returns {Promise<Object[]>} Results: {issn, confidence, score, stage, candidates}
 */
export async function matchBatch(queries, articleTitles = null) {
  try {
    const body = { queries };
    if (articleTitles && articleTitles.length === queries.length) {
      body.article_titles = articleTitles;
    }
    const response = await fetch('/api/v1/match/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.results || [];
  } catch (error) {
    console.error('[API] Erro no matchBatch:', error);
    return [];
  }
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
