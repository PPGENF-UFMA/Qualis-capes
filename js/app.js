/**
 * Controlador Principal da Aplicação (Orquestrador)
 * 
 * Este módulo é responsável apenas pela inicialização e vinculação
 * de eventos. Toda lógica específica é delegada aos módulos especializados.
 */

import { loadDatabase, enrichAndClassify, normalizeISSN } from './enricher.js';
import { parseCSV, processCSVData, generateCSV, downloadFile } from './utils.js';
import { runTests } from './tests.js';

import dom from './dom.js';
import appState, { addClassifiedItem, clearClassifiedItems, getFilteredItems, restoreResults } from './state.js';
import { updateAnalytics } from './charts.js';
import { renderResultsTable } from './table.js';
import { parseLattesText } from './lattesParser.js';
import {
  switchTab, switchInputType,
  showLoadingState, hideLoadingState,
  showSearchModal, closeSearchModal,
  initTheme, toggleTheme, showToast,
  addRecentSearch, renderRecentSearches,
  updateLoadingProgress, showLattesPreviewModal, closeLattesPreviewModal
} from './ui.js';

// ─── Inicialização ───────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  setupEventListeners();
  restoreResults();
  renderRecentSearches();
  await initDatabase();

  // Se havia resultados restaurados da sessão anterior, renderiza-os
  if (appState.classifiedItems.length > 0) {
    renderResultsTable();
  }

  initUnitTests();

  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
});

// ─── Setup de Eventos ────────────────────────────────────────────

function setupEventListeners() {
  // Tema
  dom.themeToggle.addEventListener('click', () => {
    toggleTheme();
    if (appState.classifiedItems.length > 0) {
      updateAnalytics();
    }
  });

  // Consulta Individual (Busca Híbrida por ISSN ou Nome)
  dom.singleIssnForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = dom.singleIssnInput.value.trim();
    if (!query) return;

    showLoadingState('Analisando Consulta', 'Verificando formato do termo digitado...', 'search');

    const normalized = normalizeISSN(query);
    if (normalized) {
      const classified = await enrichAndClassify(normalized);
      addClassifiedItem(classified);
      addRecentSearch(classified.issn, classified.title);
      dom.singleIssnInput.value = '';
      hideLoadingState();
      renderResultsTable();
      switchTab('table');
    } else {
      await handleSearchByName(query);
    }
  });

  // Lote de ISSNs
  dom.batchIssnForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const batchText = dom.batchIssnInput.value.trim();
    if (!batchText) return;

    showLoadingState('Processando Lote', 'Analisando múltiplos ISSNs e calculando estatísticas...', 'layers');
    const rawIssns = batchText.split(/[\n,;\s]+/).map(i => i.trim()).filter(i => i !== '');

    // Processamento em lotes paralelos (5 por vez) para melhor performance
    const CONCURRENCY = 5;
    let processedCount = 0;
    updateLoadingProgress(0, rawIssns.length);
    for (let i = 0; i < rawIssns.length; i += CONCURRENCY) {
      const chunk = rawIssns.slice(i, i + CONCURRENCY);
      const results = await Promise.all(chunk.map(issn => enrichAndClassify(issn)));
      results.forEach(addClassifiedItem);
      processedCount += chunk.length;
      updateLoadingProgress(processedCount, rawIssns.length);
    }

    dom.batchIssnInput.value = '';
    hideLoadingState();
    renderResultsTable();
    switchTab('analytics');
  });

  // Upload CSV (Drag & Drop + Click)
  const dropzone = dom.dropzone;
  dropzone.addEventListener('click', () => dom.fileInput.click());
  dom.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleUploadedFile(e.target.files[0]);
  });
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) handleUploadedFile(e.dataTransfer.files[0]);
  });

  // Filtros da tabela
  dom.searchBox.addEventListener('input', () => renderResultsTable());
  dom.filterEstrato.addEventListener('change', () => renderResultsTable());

  // Limpar e Exportar
  dom.btnClear.addEventListener('click', () => {
    clearClassifiedItems();
    if (dom.sessionResearcherTitle && dom.researcherNameDisplay) {
      dom.sessionResearcherTitle.style.display = 'none';
      dom.researcherNameDisplay.textContent = '-';
    }
    renderResultsTable();
    switchTab('table');
    switchInputType('single');
  });

  dom.btnExport.addEventListener('click', () => {
    if (appState.classifiedItems.length === 0) return;
    const searchVal = dom.searchBox.value;
    const filterVal = dom.filterEstrato.value;
    const filtered = getFilteredItems(searchVal, filterVal);
    const csvContent = generateCSV(filtered);
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadFile(csvContent, `qualis_classificado_${dateStr}.csv`, 'text/csv');
    showToast('Arquivo CSV exportado com sucesso!', 'success');
  });

  // Modal de Busca
  if (dom.btnCloseModal) {
    dom.btnCloseModal.addEventListener('click', closeSearchModal);
  }
  if (dom.searchModal) {
    dom.searchModal.addEventListener('click', (e) => {
      if (e.target === dom.searchModal) closeSearchModal();
    });
  }

  // Modal de Preview Lattes
  if (dom.btnCloseLattesPreview) {
    dom.btnCloseLattesPreview.addEventListener('click', closeLattesPreviewModal);
  }
  if (dom.btnCancelLattes) {
    dom.btnCancelLattes.addEventListener('click', closeLattesPreviewModal);
  }
  if (dom.lattesPreviewModal) {
    dom.lattesPreviewModal.addEventListener('click', (e) => {
      if (e.target === dom.lattesPreviewModal) closeLattesPreviewModal();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dom.lattesPreviewModal && dom.lattesPreviewModal.style.display === 'flex') {
      closeLattesPreviewModal();
    }
  });

  // Abas de Resultados
  if (dom.tabTable) dom.tabTable.addEventListener('click', () => switchTab('table'));
  if (dom.tabAnalytics) dom.tabAnalytics.addEventListener('click', () => switchTab('analytics'));

  // Seletor Segmentado (Sidebar)
  if (dom.selectorSingle) dom.selectorSingle.addEventListener('click', () => switchInputType('single'));
  if (dom.selectorBatch) dom.selectorBatch.addEventListener('click', () => switchInputType('batch'));
  if (dom.selectorUpload) dom.selectorUpload.addEventListener('click', () => switchInputType('upload'));
  if (dom.selectorLattes) dom.selectorLattes.addEventListener('click', () => switchInputType('lattes'));

  // Ajuda do Lattes
  if (dom.btnLattesHelp && dom.lattesHelpContent) {
    dom.btnLattesHelp.addEventListener('click', () => {
      const isHidden = dom.lattesHelpContent.style.display === 'none';
      dom.lattesHelpContent.style.display = isHidden ? 'block' : 'none';
    });
  }

  // Lattes Form Submit
  if (dom.lattesForm) {
    dom.lattesForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const researcherName = dom.lattesResearcherName.value.trim();
      const lattesText = dom.lattesTextInput.value.trim();
      if (!researcherName || !lattesText) return;

      showLoadingState('Analisando Currículo Lattes', 'Segmentando artigos e aplicando inteligência de abreviações...', 'file-text');

      try {
        const dbItems = appState.dbSummary.items;
        const parsedArticles = parseLattesText(lattesText, dbItems);
        
        if (parsedArticles.length === 0) {
          hideLoadingState();
          showToast('Nenhum artigo identificado no texto fornecido. Verifique o formato.', 'warning');
          return;
        }

        hideLoadingState();
        const modalOpened = showLattesPreviewModal(parsedArticles, async () => {
          await processLattesArticles(parsedArticles, researcherName);
        });

        if (!modalOpened) {
          // Fallback: processa os artigos diretamente se o modal nao abrir
          console.log('[Lattes] Modal preview indisponivel, processando diretamente...');
          showLoadingState('Analisando Currículo Lattes', 'Classificando os artigos...', 'file-text');
          await processLattesArticles(parsedArticles, researcherName);
        }
      } catch (err) {
        console.error("[Lattes Submit Error]", err);
        try { hideLoadingState(); } catch (e) { /* silencioso */ }
        showToast('Erro crítico ao processar o Currículo Lattes.', 'error');
      }
    });
  }

  // Cliques nos atalhos rápidos e buscas recentes (delegação de evento)
  const historyCard = document.getElementById('sidebar-history-card');
  if (historyCard) {
    historyCard.addEventListener('click', async (e) => {
      const btn = e.target.closest('.quick-link-btn, .recent-search-btn');
      if (!btn) return;

      const issn = btn.getAttribute('data-issn');
      if (!issn) return;

      showLoadingState('Analisando Consulta', 'Classificando periódico a partir do atalho...', 'search');
      const classified = await enrichAndClassify(issn);
      addClassifiedItem(classified);
      addRecentSearch(classified.issn, classified.title);
      hideLoadingState();
      renderResultsTable();
      switchTab('table');
    });
  }
}

// ─── Handlers ────────────────────────────────────────────────────

/**
 * Inicializa a Base de Dados e exibe status na interface.
 */
async function initDatabase() {
  try {
    const db = await loadDatabase();
    const entries = Object.entries(db);
    appState.dbSummary.total = entries.length;
    appState.dbSummary.items = entries.map(([issn, value]) => ({
      issn,
      title: value.title,
      area: value.area,
      jcr: value.jcr,
      citeScore: value.citeScore
    }));

    dom.dbStatus.textContent = `Base Conectada (${appState.dbSummary.total} revistas)`;
  } catch (error) {
    dom.dbStatus.textContent = 'Erro ao carregar banco';
    dom.dbStatus.style.background = 'var(--error-bg)';
    dom.dbStatus.style.color = 'var(--error)';
    showToast('Falha ao carregar a base de dados de periódicos.', 'error');
  }
}

/**
 * Executa silenciosamente os Testes Unitários de Diagnóstico.
 */
function initUnitTests() {
  try {
    const results = runTests();
    const passed = results.filter(r => r.passed);
    const failed = results.filter(r => !r.passed);

    console.group('🩺 Diagnóstico do Motor de Regras Qualis CAPES');
    console.info(`🟢 Testes que passaram: ${passed.length}/${results.length}`);

    if (failed.length > 0) {
      console.error(`🔴 Testes que falharam: ${failed.length}/${results.length}`);
      console.table(failed);
    } else {
      console.info('Sucesso Absoluto: Todos os cenários de classificação da CAPES passaram com 100% de exatidão!');
    }
    console.groupEnd();
  } catch (err) {
    console.error('Falha crítica ao executar a suíte de testes unitários:', err);
  }
}

/**
 * Processa a lista de artigos do Lattes: enriquece, classifica e atualiza a UI.
 * @param {Object[]} parsedArticles Artigos parseados pelo lattesParser
 * @param {string} researcherName Nome do pesquisador
 */
async function processLattesArticles(parsedArticles, researcherName) {
  showLoadingState('Analisando Currículo Lattes', 'Classificando os artigos...', 'file-text');
  
  let countNew = 0;
  updateLoadingProgress(0, parsedArticles.length);
  
  for (const article of parsedArticles) {
    const classified = await enrichAndClassify(article.matchedIssn || article.journal);
    
    if (article.title && classified.title === 'Periódico Não Identificado na Base') {
      classified.title = `[Não Identificado] ${article.journal}`;
    } else if (article.title && classified.title) {
      classified.title = `${article.title} (${classified.title})`;
    }

    classified.year = article.year;

    addClassifiedItem(classified);
    countNew++;
    updateLoadingProgress(countNew, parsedArticles.length);
  }

  if (dom.sessionResearcherTitle && dom.researcherNameDisplay) {
    dom.researcherNameDisplay.textContent = researcherName;
    dom.sessionResearcherTitle.style.display = 'block';
  }

  dom.lattesTextInput.value = '';
  
  hideLoadingState();
  renderResultsTable();
  switchTab('analytics');
  showToast(`${countNew} artigos do currículo processados com sucesso!`, 'success');
}

/**
 * Lê e processa o arquivo CSV inserido pelo usuário.
 */
function handleUploadedFile(file) {
  const reader = new FileReader();

  reader.onload = async (e) => {
    showLoadingState('Processando Planilha', 'Importando dados do arquivo CSV e enriquecendo periódicos...', 'file-spreadsheet');
    const text = e.target.result;
    const parsed = parseCSV(text);
    const records = processCSVData(parsed);

    let countNew = 0;
    for (const record of records) {
      const classified = await enrichAndClassify(record.issn);

      if (record.title && record.title !== 'Artigo Importado' && classified.title === 'Periódico Não Identificado na Base') {
        classified.title = record.title;
      } else if (record.title && record.title !== 'Artigo Importado' && classified.title) {
        classified.title = `${record.title} (${classified.title})`;
      }

      addClassifiedItem(classified);
      countNew++;
    }

    hideLoadingState();
    renderResultsTable();
    switchTab('analytics');
    showToast(`${countNew} artigos importados e classificados com sucesso!`, 'success');
  };

  reader.readAsText(file);
}

/**
 * Trata a busca de periódicos por nome (título).
 * @param {string} nameQuery Nome buscado
 */
async function handleSearchByName(nameQuery) {
  const queryLower = nameQuery.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  // Filtrar no banco local
  const matches = appState.dbSummary.items.filter(item => {
    if (!item.title) return false;
    const titleClean = item.title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return titleClean.includes(queryLower);
  });

  // Busca remota na API LILACS (BVS)
  let bvsMatches = [];
  try {
    const response = await fetch(`/api/lilacs/${encodeURIComponent(nameQuery)}`);
    if (response.ok) {
      const data = await response.json();
      if ((data.lilacs || data.bdenf) && data.title && data.issn) {
        bvsMatches.push({
          issn: data.issn,
          title: data.title,
          area: data.bdenf ? 'Enfermagem' : 'Outras Áreas',
          isRemote: true
        });
      }
    }
  } catch (err) {
    console.warn("[Busca Remota por Nome] Falha na API LILACS:", err);
    showToast('Busca remota LILACS indisponível. Resultados baseados apenas na base local.', 'warning');
  }

  // Consolidar resultados locais e remotos
  let allMatches = [...matches];
  bvsMatches.forEach(bvsItem => {
    if (!allMatches.some(m => m.issn === bvsItem.issn)) {
      allMatches.push(bvsItem);
    }
  });

  hideLoadingState();

  if (allMatches.length === 0) {
    showToast('Nenhum periódico encontrado com este nome.', 'warning');
    return;
  }

  if (allMatches.length === 1) {
    showLoadingState('Analisando ISSN', 'Consultando APIs e aplicando regras de extratos CAPES...', 'search');
    const classified = await enrichAndClassify(allMatches[0].issn);
    addClassifiedItem(classified);
    addRecentSearch(classified.issn, classified.title);
    renderResultsTable();
    dom.singleIssnInput.value = '';
    hideLoadingState();
    switchTab('table');
    return;
  }

  // Múltiplos resultados: abrir modal de seleção
  showSearchModal(allMatches);
}
