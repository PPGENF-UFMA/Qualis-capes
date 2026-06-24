let dbSummary = null;

export function normalizeISSN(issn) {
  if (typeof issn !== 'string') return '';
  const cleaned = issn.replace(/[^0-9Xx]/g, '').toUpperCase();
  if (cleaned.length === 8) {
    return `${cleaned.substring(0, 4)}-${cleaned.substring(4)}`;
  }
  return '';
}

export async function loadDatabase() {
  if (dbSummary !== null) return dbSummary;
  try {
    const response = await fetch('/api/db-summary?limit=100');
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
    const response = await fetch(`/api/classify/${normalized}`);
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

export async function searchByName(query) {
  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.results || [];
  } catch (error) {
    console.error('[API] Erro na busca por nome:', error);
    return [];
  }
}
