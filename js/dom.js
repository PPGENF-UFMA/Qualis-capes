/**
 * Referências DOM centralizadas.
 * Mapeia todos os elementos da interface uma única vez para evitar
 * lookups repetidos e garantir consistência entre módulos.
 */

const dom = {
  dbStatus: document.getElementById('db-status'),
  dbSourcesInfo: document.getElementById('db-sources-info'),
  statusIndicatorDot: document.getElementById('status-indicator-dot'),
  dbCompiledAt: document.getElementById('db-compiled-at'),
  citeScoreStatus: document.getElementById('citescore-status'),
  circuitsStatus: document.getElementById('circuits-status'),

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
  filterYear: document.getElementById('filter-year'),
  sortBy: document.getElementById('sort-by'),
  btnExport: document.getElementById('btn-export'),
  btnReport: document.getElementById('btn-report'),
  btnClear: document.getElementById('btn-clear'),
  printReportDate: document.getElementById('print-report-date'),

  themeToggle: document.getElementById('theme-toggle'),
  editorialIntro: document.querySelector('.editorial-intro'),

  // Dashboard
  emptyState: document.getElementById('empty-state'),
  analyticsResults: document.getElementById('analytics-results'),
  kpiTotal: document.getElementById('kpi-total'),
  kpiQualifiedValue: document.getElementById('kpi-qualified-value'),
  kpiQualifiedSub: document.getElementById('kpi-qualified-sub'),
  kpiAvgScoreValue: document.getElementById('kpi-avg-score-value'),
  kpiAvgScoreSub: document.getElementById('kpi-avg-score-sub'),
  kpiNcCount: document.getElementById('kpi-nc-count'),
  kpiPendingCount: document.getElementById('kpi-pending-count'),
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
  mainContent: document.getElementById('main-content'),
  resultsTabs: document.getElementById('results-tabs'),
  tabTable: document.getElementById('tab-table'),
  tabAnalytics: document.getElementById('tab-analytics'),
  activeTab: () => document.querySelector('.tab-btn.active'),
  paneTable: document.getElementById('tab-content-table'),
  paneAnalytics: document.getElementById('tab-content-analytics'),

  // Seletor Segmentado (Sidebar)
  workspace: document.getElementById('workspace'),
  consultationSidebar: document.getElementById('consultation-sidebar'),
  consultationPanel: document.getElementById('consultation-panel'),
  sidebarOpen: document.getElementById('sidebar-open'),
  sidebarClose: document.getElementById('sidebar-close'),
  sidebarBackdrop: document.getElementById('sidebar-backdrop'),
  selectorSingle: document.getElementById('selector-single'),
  selectorBatch: document.getElementById('selector-batch'),
  selectorUpload: document.getElementById('selector-upload'),
  selectorOrcid: document.getElementById('selector-orcid'),
  paneInputSingle: document.getElementById('input-pane-single'),
  paneInputBatch: document.getElementById('input-pane-batch'),
  paneInputUpload: document.getElementById('input-pane-upload'),
  paneInputOrcid: document.getElementById('input-pane-orcid'),

  // Container de Toasts
  toastContainer: document.getElementById('toast-container'),

  // Lista de Buscas Recentes
  recentSearchesList: document.getElementById('recent-searches-list'),
  sidebarHistoryCard: document.getElementById('sidebar-history-card'),

  // Lattes
  selectorLattes: document.getElementById('selector-lattes'),
  paneInputLattes: document.getElementById('input-pane-lattes'),
  lattesForm: document.getElementById('lattes-form'),
  lattesResearcherName: document.getElementById('lattes-researcher-name'),
  lattesTextInput: document.getElementById('lattes-text-input'),
  orcidForm: document.getElementById('orcid-form'),
  orcidInput: document.getElementById('orcid-input'),
  orcidYearFrom: document.getElementById('orcid-year-from'),
  orcidYearTo: document.getElementById('orcid-year-to'),
  sessionResearcherTitle: document.getElementById('session-researcher-title'),
  researcherNameDisplay: document.getElementById('researcher-name-display'),

  // Botões de Submit (para desabilitar durante loading)
  btnSubmitSingle: document.getElementById('btn-submit-single'),
  btnSubmitBatch: document.getElementById('btn-submit-batch'),
  btnSubmitLattes: document.getElementById('btn-submit-lattes'),
  btnSubmitOrcid: document.getElementById('btn-submit-orcid'),

  // Instruções Lattes
  btnLattesHelp: document.getElementById('btn-lattes-help'),
  lattesHelpContent: document.getElementById('lattes-help-content'),

  // Modal de Preview Lattes
  lattesPreviewModal: document.getElementById('lattes-preview-modal'),
  btnCloseLattesPreview: document.getElementById('btn-close-lattes-preview'),
  lattesPreviewCountText: document.getElementById('lattes-preview-count-text'),
  lattesPreviewList: document.getElementById('lattes-preview-list'),
  btnCancelLattes: document.getElementById('btn-cancel-lattes'),
  btnConfirmLattes: document.getElementById('btn-confirm-lattes'),

  // Barra de Progresso
  loadingProgressContainer: document.getElementById('loading-progress-container'),
  loadingProgressText: document.getElementById('loading-progress-text'),
  loadingProgressPercent: document.getElementById('loading-progress-percent'),
  loadingProgressBar: document.getElementById('loading-progress-bar'),

  // Comparação de Currículos
  selectorComparison: document.getElementById('selector-comparison'),
  comparisonModal: document.getElementById('comparison-modal'),
  btnCloseComparisonModal: document.getElementById('btn-close-comparison-modal'),
  btnCancelComparison: document.getElementById('btn-cancel-comparison'),
  comparisonForm: document.getElementById('comparison-form'),
  comparisonNameA: document.getElementById('comparison-name-a'),
  comparisonTextA: document.getElementById('comparison-text-a'),
  comparisonNameB: document.getElementById('comparison-name-b'),
  comparisonTextB: document.getElementById('comparison-text-b'),
  btnSubmitComparison: document.getElementById('btn-submit-comparison'),
  tabComparison: document.getElementById('tab-comparison'),
  paneComparison: document.getElementById('tab-content-comparison'),
  comparisonKpisBody: document.getElementById('comparison-kpis-body'),
  comparisonRadarChart: document.getElementById('comparison-radar-chart'),
  comparisonEstratoChart: document.getElementById('comparison-estrato-chart'),

  // Modal "Como funciona a classificação"
  btnClassificationInfo: document.getElementById('btn-classification-info'),
  classificationInfoModal: document.getElementById('classification-info-modal'),
  btnCloseClassificationInfo: document.getElementById('btn-close-classification-info')
};

export default dom;
