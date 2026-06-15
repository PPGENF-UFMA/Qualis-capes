/**
 * Referências DOM centralizadas.
 * Mapeia todos os elementos da interface uma única vez para evitar
 * lookups repetidos e garantir consistência entre módulos.
 */

const dom = {
  dbStatus: document.getElementById('db-status'),

  singleIssnForm: document.getElementById('single-issn-form'),
  singleIssnInput: document.getElementById('single-issn-input'),

  batchIssnForm: document.getElementById('batch-issn-form'),
  batchIssnInput: document.getElementById('batch-issn-input'),

  dropzone: document.getElementById('dropzone'),
  fileInput: document.getElementById('file-input'),

  resultsContainer: document.getElementById('results-container'),
  resultsTableBody: document.getElementById('results-table-body'),

  searchBox: document.getElementById('search-box'),
  filterEstrato: document.getElementById('filter-estrato'),
  btnExport: document.getElementById('btn-export'),
  btnClear: document.getElementById('btn-clear'),

  themeToggle: document.getElementById('theme-toggle'),

  // Dashboard
  emptyState: document.getElementById('empty-state'),
  analyticsResults: document.getElementById('analytics-results'),
  kpiTotal: document.getElementById('kpi-total'),
  kpiQualifiedValue: document.getElementById('kpi-qualified-value'),
  kpiQualifiedSub: document.getElementById('kpi-qualified-sub'),
  kpiAvgScoreValue: document.getElementById('kpi-avg-score-value'),
  kpiAvgScoreSub: document.getElementById('kpi-avg-score-sub'),
  kpiNcCount: document.getElementById('kpi-nc-count'),
  kpiInternationalCoverage: document.getElementById('kpi-international-coverage'),
  kpiAreaDistribution: document.getElementById('kpi-area-distribution'),
  qualisChart: document.getElementById('qualis-chart'),
  indexersChart: document.getElementById('indexers-chart'),
  publicationsYearChart: document.getElementById('publications-year-chart'),
  qualisEvolutionChart: document.getElementById('qualis-evolution-chart'),
  topJournalsTableBody: document.getElementById('top-journals-table-body'),
  curriculumInsightsList: document.getElementById('curriculum-insights-list'),

  // Loading Overlay
  loadingOverlay: document.getElementById('loading-overlay'),
  loadingTitle: document.getElementById('loading-title'),
  loadingSubtitle: document.getElementById('loading-subtitle'),
  loadingIcon: document.getElementById('loading-icon'),

  // Modal de Seleção
  searchModal: document.getElementById('search-modal'),
  btnCloseModal: document.getElementById('btn-close-modal'),
  searchResultsList: document.getElementById('search-results-list'),

  // Abas de Resultados
  resultsTabs: document.getElementById('results-tabs'),
  tabTable: document.getElementById('tab-table'),
  tabAnalytics: document.getElementById('tab-analytics'),
  paneTable: document.getElementById('tab-content-table'),
  paneAnalytics: document.getElementById('tab-content-analytics'),

  // Seletor Segmentado (Sidebar)
  selectorSingle: document.getElementById('selector-single'),
  selectorBatch: document.getElementById('selector-batch'),
  selectorUpload: document.getElementById('selector-upload'),
  paneInputSingle: document.getElementById('input-pane-single'),
  paneInputBatch: document.getElementById('input-pane-batch'),
  paneInputUpload: document.getElementById('input-pane-upload'),

  // Container de Toasts
  toastContainer: document.getElementById('toast-container'),

  // Lista de Buscas Recentes
  recentSearchesList: document.getElementById('recent-searches-list'),

  // Lattes
  selectorLattes: document.getElementById('selector-lattes'),
  paneInputLattes: document.getElementById('input-pane-lattes'),
  lattesForm: document.getElementById('lattes-form'),
  lattesResearcherName: document.getElementById('lattes-researcher-name'),
  lattesTextInput: document.getElementById('lattes-text-input'),
  sessionResearcherTitle: document.getElementById('session-researcher-title'),
  researcherNameDisplay: document.getElementById('researcher-name-display'),

  // Botões de Submit (para desabilitar durante loading)
  btnSubmitSingle: document.getElementById('btn-submit-single'),
  btnSubmitBatch: document.getElementById('btn-submit-batch'),
  btnSubmitLattes: document.getElementById('btn-submit-lattes')
};

export default dom;
