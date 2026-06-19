/**
 * Estado centralizado da aplicação.
 * Responsável por gerenciar os dados classificados e o resumo do banco de dados.
 */

const ESTRATO_WEIGHTS = { A1: 100, A2: 85, A3: 70, A4: 55, A5: 40, A6: 25, A7: 10, A8: 5, NC: 0 };

const appState = {
  classifiedItems: [],
  comparisonProfiles: [],
  dbSummary: { total: 0, items: [] },
  charts: {
    qualis: null,
    indexers: null,
    publicationsYear: null,
    qualisEvolution: null,
    radar: null,
    comparisonEstrato: null
  }
};

/**
 * Calcula um score de relevância para desempate dentro do mesmo estrato.
 * O estrato domina; JCR, CiteScore, indexadores e CUIDEN refinam a ordenação.
 * @param {Object} item Item classificado
 * @returns {number} Score numérico (maior = mais relevante)
 */
export function computeRelevanceScore(item) {
  const estrato = item.classification?.estrato || 'NC';
  const base = ESTRATO_WEIGHTS[estrato] ?? 0;
  const jcr = typeof item.jcr === 'number' ? item.jcr : 0;
  const citeScore = typeof item.citeScore === 'number' ? item.citeScore : 0;
  const indexerCount = Array.isArray(item.indexers) ? item.indexers.length : 0;
  const cuiden = (item.metrics && typeof item.metrics.cuiden === 'number') ? item.metrics.cuiden : 0;

  return base * 10000 + jcr * 100 + citeScore * 100 + indexerCount * 10 + cuiden;
}

/**
 * Ordena itens classificados conforme o critério selecionado.
 * @param {Object[]} items Itens a ordenar
 * @param {string} sortVal Critério ('recent' | 'relevance' | 'estrato' | 'jcr' | 'citescore' | 'indexers')
 * @returns {Object[]} Cópia ordenada
 */
export function sortItems(items, sortVal = 'recent') {
  const sorted = [...items];

  switch (sortVal) {
    case 'relevance':
      sorted.sort((a, b) => computeRelevanceScore(b) - computeRelevanceScore(a));
      break;
    case 'estrato':
      sorted.sort((a, b) => {
        const diff = (ESTRATO_WEIGHTS[b.classification?.estrato] ?? 0)
          - (ESTRATO_WEIGHTS[a.classification?.estrato] ?? 0);
        return diff !== 0 ? diff : computeRelevanceScore(b) - computeRelevanceScore(a);
      });
      break;
    case 'jcr':
      sorted.sort((a, b) => (b.jcr ?? -1) - (a.jcr ?? -1));
      break;
    case 'citescore':
      sorted.sort((a, b) => (b.citeScore ?? -1) - (a.citeScore ?? -1));
      break;
    case 'indexers':
      sorted.sort((a, b) => (b.indexers?.length ?? 0) - (a.indexers?.length ?? 0));
      break;
    default:
      break;
  }

  return sorted;
}

/**
 * Adiciona ou atualiza um item classificado no estado.
 * Se o item já existir (mesmo ISSN + título), ele é sobrescrito.
 * @param {Object} item Item classificado retornado pelo enrichAndClassify
 */
export function addClassifiedItem(item) {
  const index = appState.classifiedItems.findIndex(
    existing => existing.issn === item.issn && existing.title === item.title
  );
  if (index !== -1) {
    appState.classifiedItems[index] = item;
  } else {
    appState.classifiedItems.unshift(item);
  }
  persistResults();
}

/**
 * Limpa todos os itens classificados do estado.
 */
export function clearClassifiedItems() {
  appState.classifiedItems = [];
  sessionStorage.removeItem('qualis_results');
}

/**
 * Retorna os itens classificados aplicando filtros de busca, estrato e ano/quadriênio.
 * @param {string} searchVal Texto de busca (título ou ISSN)
 * @param {string} filterVal Estrato selecionado ('ALL' ou 'A1'..'NC')
 * @param {string} filterYearVal Ano ou Quadriênio selecionado ('ALL' ou '2025-2028' ou '2021-2024' ou '2017-2020')
 * @param {string} sortVal Critério de ordenação ('recent' | 'relevance' | 'estrato' | 'jcr' | 'citescore' | 'indexers')
 * @returns {Object[]} Itens filtrados e ordenados
 */
export function getFilteredItems(searchVal = '', filterVal = 'ALL', filterYearVal = 'ALL', sortVal = 'recent') {
  const search = searchVal.toLowerCase().trim();
  const filtered = appState.classifiedItems.filter(item => {
    const matchesSearch = item.issn.toLowerCase().includes(search) ||
      item.title.toLowerCase().includes(search);
    const matchesFilter = filterVal === 'ALL' || item.classification.estrato === filterVal;
    
    let matchesYear = true;
    if (filterYearVal !== 'ALL') {
      const year = parseInt(item.year, 10);
      if (filterYearVal === '2025-2028') {
        matchesYear = year >= 2025 && year <= 2028;
      } else if (filterYearVal === '2021-2024') {
        matchesYear = year >= 2021 && year <= 2024;
      } else if (filterYearVal === '2017-2020') {
        matchesYear = year >= 2017 && year <= 2020;
      } else {
        matchesYear = year === parseInt(filterYearVal, 10);
      }
    }
    
    return matchesSearch && matchesFilter && matchesYear;
  });

  return sortItems(filtered, sortVal);
}

/**
 * Persiste os resultados classificados no sessionStorage.
 */
function persistResults() {
  try {
    sessionStorage.setItem('qualis_results', JSON.stringify(appState.classifiedItems));
  } catch (e) {
    // sessionStorage cheio ou indisponível — falha silenciosa aceitável
    console.warn('[Persistência] Falha ao salvar resultados no sessionStorage:', e.message);
  }
}

/**
 * Restaura os resultados classificados do sessionStorage, se houver.
 */
export function restoreResults() {
  try {
    const saved = sessionStorage.getItem('qualis_results');
    if (saved) {
      appState.classifiedItems = JSON.parse(saved);
    }
  } catch (e) {
    console.warn('[Persistência] Falha ao restaurar resultados:', e.message);
  }
}

/**
 * Define os perfis de comparação no estado.
 * @param {Object[]} profiles Array de { name: string, items: Object[] }
 */
export function setComparisonProfiles(profiles) {
  appState.comparisonProfiles = profiles;
  persistComparison();
}

/**
 * Limpa os perfis de comparação.
 */
export function clearComparisonProfiles() {
  appState.comparisonProfiles = [];
  sessionStorage.removeItem('qualis_comparison');
}

/**
 * Restaura os perfis de comparação do sessionStorage.
 */
export function restoreComparisonProfiles() {
  try {
    const saved = sessionStorage.getItem('qualis_comparison');
    if (saved) {
      appState.comparisonProfiles = JSON.parse(saved);
    }
  } catch (e) {
    console.warn('[Persistência] Falha ao restaurar comparação:', e.message);
  }
}

function persistComparison() {
  try {
    sessionStorage.setItem('qualis_comparison', JSON.stringify(appState.comparisonProfiles));
  } catch (e) {
    console.warn('[Persistência] Falha ao salvar comparação:', e.message);
  }
}

export default appState;
