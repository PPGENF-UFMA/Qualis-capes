/**
 * Controlador Principal da Aplicação (Orquestrador)
 * 
 * Este módulo é responsável apenas pela inicialização e vinculação
 * de eventos. Toda lógica específica é delegada aos módulos especializados.
 */

import { enrichAndClassify, classifyBatch, normalizeISSN, normalizeORCID, analyzeOrcid, searchByName, classifyByName, searchBatch, matchBatch, saveServerAlias, sendMatchFeedback, loadDatabase } from './enricher.js';
import { parseCSV, processCSVData, generateCSV, downloadFile, parseXLSX } from './utils.js';

import dom from './dom.js';
import appState, { addClassifiedItem, clearClassifiedItems, getFilteredItems, restoreResults, setComparisonProfiles, clearComparisonProfiles, restoreComparisonProfiles } from './state.js';
import { updateAnalytics } from './charts.js';
import { renderResultsTable } from './table.js';
import { initLattesParser, segmentLattesText, parseSingleArticle, parseLattesText, matchJournalToISSN, saveUserAlias } from './lattesParser.js';
import { updateComparisonDashboard } from './compare.js';
import {
  switchTab, switchInputType,
  showLoadingState, hideLoadingState,
  showSearchModal, closeSearchModal,
  showComparisonModal, closeComparisonModal,
  initTheme, toggleTheme, showToast,
  addRecentSearch, renderRecentSearches,
  updateLoadingProgress, showLattesPreviewModal, closeLattesPreviewModal,
  initQuadrienios,
  showClassificationInfoModal, closeClassificationInfoModal
} from './ui.js';

// ─── Inicialização ───────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initQuadrienios();
  initOrcidYearDefaults();
  setupEventListeners();
  restoreResults();
  restoreComparisonProfiles();
  renderRecentSearches();
  await initDatabase();
  await initLattesParser();
  await checkCiteScoreStatus();
  await checkCircuitsStatus();

  // Se havia resultados restaurados da sessão anterior, renderiza-os
  if (appState.classifiedItems.length > 0) {
    renderResultsTable();
  }

  // Se havia dados de comparação restaurados, renderiza-os
  if (appState.comparisonProfiles.length >= 2) {
    if (dom.analyticsResults) dom.analyticsResults.style.display = 'block';
    if (dom.emptyState) dom.emptyState.style.display = 'none';
    if (dom.tabComparison) dom.tabComparison.style.display = 'flex';
    updateComparisonDashboard(appState.comparisonProfiles);
  }

  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
});

function initOrcidYearDefaults() {
  if (!dom.orcidYearFrom || !dom.orcidYearTo) return;
  const currentYear = new Date().getFullYear();
  dom.orcidYearFrom.value = String(currentYear - 4);
  dom.orcidYearTo.value = String(currentYear);
}

// ─── Setup de Eventos ────────────────────────────────────────────

function setupEventListeners() {
  // Tema
  dom.themeToggle.addEventListener('click', () => {
    toggleTheme();
    if (appState.classifiedItems.length > 0) {
      renderResultsTable();
    }
  });

  // Reclassifica um item quando o usuário troca manualmente a revista
  // no modal de candidatos (parser Lattes). Persiste alias aprendido.
  window.addEventListener('lattes-reclassify', async (e) => {
    const { oldIssn, newIssn, newTitle } = e.detail || {};
    if (!newIssn) return;

    const idx = appState.classifiedItems.findIndex(
      it => it.issn === oldIssn && it.confidence === 'review'
    );
    if (idx === -1) return;

    showLoadingState('Reclassificando', `Buscando ${newIssn}...`, 'refresh-cw');
    const newClassified = await enrichAndClassify(newIssn);
    if (newTitle) newClassified.title = `${appState.classifiedItems[idx].title.replace(/^\[[^\]]+\]\s*/, '').replace(/\n/g, ' ').split(' (')[0]} (${newTitle})`;

    newClassified.confidence = 'high';
    newClassified.lattesCandidates = undefined;
    newClassified.year = appState.classifiedItems[idx].year;

    // Persiste alias no servidor (compartilhado) + localStorage (fallback offlline)
    const journalRaw = appState.classifiedItems[idx].lattesJournalRaw || appState.classifiedItems[idx].title;
    saveUserAlias(journalRaw, newIssn);
    saveServerAlias(journalRaw, newIssn);
    sendMatchFeedback(journalRaw, oldIssn, newIssn);

    appState.classifiedItems[idx] = newClassified;
    hideLoadingState();
    renderResultsTable();
    showToast('Revista atualizada, classificada e alias salvo no servidor.', 'success');
  });

  // Consulta Individual (Busca Híbrida por ISSN ou Nome)
  dom.singleIssnForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = dom.singleIssnInput.value.trim();
    if (!query) return;

    showLoadingState('Analisando Consulta', 'Verificando formato do termo digitado...', 'search', true);

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

    updateLoadingProgress(0, rawIssns.length);
    const results = await classifyBatch(rawIssns);
    results.forEach(addClassifiedItem);
    updateLoadingProgress(results.length, rawIssns.length);

    dom.batchIssnInput.value = '';
    hideLoadingState();
    renderResultsTable();
    switchTab('analytics');
  });

  // Upload CSV (Drag & Drop + Click)
  const dropzone = dom.dropzone;
  dropzone.addEventListener('click', () => dom.fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      dom.fileInput.click();
    }
  });
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
  if (dom.filterYear) {
    dom.filterYear.addEventListener('change', () => renderResultsTable());
  }
  if (dom.sortBy) {
    dom.sortBy.addEventListener('change', () => renderResultsTable());
  }

  // Limpar e Exportar
  dom.btnClear.addEventListener('click', () => {
    clearClassifiedItems();
    if (dom.sessionResearcherTitle && dom.researcherNameDisplay) {
      dom.sessionResearcherTitle.style.display = 'none';
      dom.researcherNameDisplay.textContent = '-';
    }
    if (dom.filterYear) {
      dom.filterYear.value = 'ALL';
    }
    if (dom.sortBy) {
      dom.sortBy.value = 'relevance';
    }
    renderResultsTable();
    switchTab('table');
    switchInputType('single');
  });

  dom.btnExport.addEventListener('click', async () => {
    if (appState.classifiedItems.length === 0) return;
    const searchVal = dom.searchBox.value;
    const filterVal = dom.filterEstrato.value;
    const filterYearVal = dom.filterYear ? dom.filterYear.value : 'ALL';
    const sortVal = dom.sortBy ? dom.sortBy.value : 'relevance';
    const filtered = getFilteredItems(searchVal, filterVal, filterYearVal, sortVal);

    // Buscar metadados da base para incluir no CSV
    let csvMeta = {};
    try {
      const statusResp = await fetch('/api/v1/status');
      if (statusResp.ok) {
        const statusData = await statusResp.json();
        const meta = statusData.database_meta || {};
        csvMeta = {
          date: new Date().toISOString(),
          compiledAt: meta.compiled_at || '',
          jcrYear: meta.jcr_year || '',
          cuidenEdition: meta.cuiden_edition || '',
          totalItems: filtered.length
        };
      }
    } catch (_) { /* silencioso — metadados são opcionais */ }

    const csvContent = generateCSV(filtered, csvMeta);
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadFile(csvContent, `qualis_classificado_${dateStr}.csv`, 'text/csv');
    showToast('Arquivo CSV exportado com sucesso!', 'success');
  });

  // Gerar Relatório PDF (via @media print com gráficos e KPIs)
  if (dom.btnReport) {
    dom.btnReport.addEventListener('click', () => {
      if (appState.classifiedItems.length === 0) return;

      // Preencher data no cabeçalho do relatório
      const reportDate = dom.printReportDate;
      if (reportDate) {
        const now = new Date();
        reportDate.textContent = `Gerado em ${now.toLocaleDateString('pt-BR')} às ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
      }

      // Salvar estado do tema
      const wasDark = !document.body.classList.contains('light-theme');

      // Forçar tema claro para gráficos legíveis em papel
      if (wasDark) {
        document.body.classList.add('light-theme');
      }

      // Garantir que a aba de analytics está ativa (gráficos precisam de dimensões)
      const originalTab = dom.activeTab ? dom.activeTab() : null;
      switchTab('analytics');

      // Re-renderizar gráficos com tema claro
      const filterYearVal = dom.filterYear ? dom.filterYear.value : 'ALL';
      const dashboardItems = getFilteredItems('', 'ALL', filterYearVal);
      updateAnalytics(dashboardItems);

      // Aguardar renderização dos gráficos (Chart.js é assíncrono)
      setTimeout(() => {
        window.print();

        // Restaurar após fechar o diálogo de impressão
        const cleanup = () => {
          window.removeEventListener('afterprint', cleanup);
          if (wasDark) {
            document.body.classList.remove('light-theme');
          }
          if (originalTab && originalTab.id === 'tab-table') {
            switchTab('table');
          }
          // Re-renderizar com o tema original
          updateAnalytics(dashboardItems);
        };
        window.addEventListener('afterprint', cleanup, { once: true });
      }, 400);
    });
  }

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
    if (e.key === 'Escape' && dom.searchModal && dom.searchModal.classList.contains('active')) {
      closeSearchModal();
    }
    if (e.key === 'Escape' && dom.comparisonModal && dom.comparisonModal.classList.contains('active')) {
      closeComparisonModal();
    }
    if (e.key === 'Escape' && dom.classificationInfoModal && dom.classificationInfoModal.style.display === 'flex') {
      closeClassificationInfoModal();
    }
  });

  // Modal de Comparação
  if (dom.btnCloseComparisonModal) {
    dom.btnCloseComparisonModal.addEventListener('click', closeComparisonModal);
  }
  if (dom.btnCancelComparison) {
    dom.btnCancelComparison.addEventListener('click', closeComparisonModal);
  }
  if (dom.comparisonModal) {
    dom.comparisonModal.addEventListener('click', (e) => {
      if (e.target === dom.comparisonModal) closeComparisonModal();
    });
  }

  // Modal "Como funciona a classificação"
  if (dom.btnClassificationInfo) {
    dom.btnClassificationInfo.addEventListener('click', showClassificationInfoModal);
  }
  if (dom.btnCloseClassificationInfo) {
    dom.btnCloseClassificationInfo.addEventListener('click', closeClassificationInfoModal);
  }
  if (dom.classificationInfoModal) {
    dom.classificationInfoModal.addEventListener('click', (e) => {
      if (e.target === dom.classificationInfoModal) closeClassificationInfoModal();
    });
  }

  // Abas de Resultados
  if (dom.tabTable) dom.tabTable.addEventListener('click', () => switchTab('table'));
  if (dom.tabAnalytics) dom.tabAnalytics.addEventListener('click', () => switchTab('analytics'));
  if (dom.tabComparison) dom.tabComparison.addEventListener('click', () => switchTab('comparison'));
  if (dom.resultsTabs) {
    dom.resultsTabs.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      const tabs = [dom.tabTable, dom.tabAnalytics, dom.tabComparison].filter(tab => tab && tab.style.display !== 'none');
      const currentIndex = tabs.indexOf(document.activeElement);
      if (currentIndex === -1) return;
      e.preventDefault();
      let nextIndex = currentIndex;
      if (e.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
      if (e.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      if (e.key === 'Home') nextIndex = 0;
      if (e.key === 'End') nextIndex = tabs.length - 1;
      tabs[nextIndex].focus();
      const tabId = tabs[nextIndex] === dom.tabAnalytics ? 'analytics' : tabs[nextIndex] === dom.tabComparison ? 'comparison' : 'table';
      switchTab(tabId);
    });
  }

  // Seletor Segmentado (Sidebar)
  if (dom.selectorSingle) dom.selectorSingle.addEventListener('click', () => switchInputType('single'));
  if (dom.selectorBatch) dom.selectorBatch.addEventListener('click', () => switchInputType('batch'));
  if (dom.selectorUpload) dom.selectorUpload.addEventListener('click', () => switchInputType('upload'));
  if (dom.selectorLattes) dom.selectorLattes.addEventListener('click', () => switchInputType('lattes'));
  if (dom.selectorOrcid) dom.selectorOrcid.addEventListener('click', () => switchInputType('orcid'));
  if (dom.selectorComparison) dom.selectorComparison.addEventListener('click', () => showComparisonModal());

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
        const parsedArticles = await parseLattesWithServerMatching(lattesText);
        
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

  // ORCID Form Submit
  if (dom.orcidForm) {
    dom.orcidForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const orcid = dom.orcidInput.value.trim();
      const normalizedOrcid = normalizeORCID(orcid);
      const yearFrom = dom.orcidYearFrom.value ? parseInt(dom.orcidYearFrom.value, 10) : null;
      const yearTo = dom.orcidYearTo.value ? parseInt(dom.orcidYearTo.value, 10) : null;

      if (!normalizedOrcid) {
        showToast('ORCID invalido. Verifique o formato e o digito final.', 'warning');
        return;
      }
      if ((Number.isInteger(yearFrom) && yearFrom < 1900) || (Number.isInteger(yearTo) && yearTo > 2100) || (Number.isInteger(yearFrom) && Number.isInteger(yearTo) && yearFrom > yearTo)) {
        showToast('Intervalo de anos invalido.', 'warning');
        return;
      }

      showLoadingState('Analisando ORCID', 'Buscando obras publicas, DOI/Crossref e matching por periodico...', 'fingerprint');

      try {
        const payload = await analyzeOrcid(normalizedOrcid, yearFrom, yearTo);
        processOrcidResults(payload);
      } catch (err) {
        console.error('[ORCID Submit Error]', err);
        try { hideLoadingState(); } catch (e) { /* silencioso */ }
        showToast(err.message || 'Erro ao processar ORCID.', 'error');
      }
    });
  }

  // Form de Comparação de Currículos
  if (dom.comparisonForm) {
    dom.comparisonForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nameA = dom.comparisonNameA.value.trim();
      const textA = dom.comparisonTextA.value.trim();
      const nameB = dom.comparisonNameB.value.trim();
      const textB = dom.comparisonTextB.value.trim();
      if (!nameA || !textA || !nameB || !textB) return;

      showLoadingState('Comparando Currículos', 'Processando artigos e calculando indicadores...', 'git-compare');

      try {
        const articlesA = await parseLattesWithServerMatching(textA);
        const articlesB = await parseLattesWithServerMatching(textB);

        if (articlesA.length === 0 && articlesB.length === 0) {
          hideLoadingState();
          showToast('Nenhum artigo identificado nos textos fornecidos.', 'warning');
          return;
        }

        const [itemsA, itemsB] = await Promise.all([
          classifyArticlesWithFallbackBatch(articlesA, () => {}),
          classifyArticlesWithFallbackBatch(articlesB, () => {})
        ]);

        const profiles = [
          { name: nameA, items: itemsA },
          { name: nameB, items: itemsB }
        ];

        setComparisonProfiles(profiles);

        // Mostrar aba de comparação
        if (dom.tabComparison) dom.tabComparison.style.display = 'flex';

        // Garantir que o container de analytics esteja visível
        if (dom.analyticsResults) dom.analyticsResults.style.display = 'block';
        if (dom.emptyState) dom.emptyState.style.display = 'none';

        // Renderizar dashboard comparativo
        updateComparisonDashboard(profiles);

        closeComparisonModal();
        hideLoadingState();
        renderResultsTable();
        switchTab('comparison');
        showToast(`${itemsA.length + itemsB.length} artigos comparados com sucesso!`, 'success');
      } catch (err) {
        console.error('[Comparação Submit Error]', err);
        try { hideLoadingState(); } catch (e) { /* silencioso */ }
        showToast('Erro crítico ao processar a comparação de currículos.', 'error');
      }
    });
  }

  // Cliques nos atalhos rápidos e buscas recentes (delegação de evento)
  const historyCard = dom.sidebarHistoryCard;
  if (historyCard) {
    historyCard.addEventListener('click', async (e) => {
      const btn = e.target.closest('.quick-link-btn, .recent-search-btn');
      if (!btn) return;

      const issn = btn.getAttribute('data-issn');
      if (!issn) return;

      showLoadingState('Analisando Consulta', 'Classificando periódico a partir do atalho...', 'search', true);
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
 * Verifica se o CiteScore está disponível (API key configurada)
 * e exibe um badge na sidebar avisando se não estiver.
 */
async function checkCiteScoreStatus() {
  try {
    const resp = await fetch('/api/v1/status');
    if (!resp.ok) return;
    const data = await resp.json();
    if (!dom.citeScoreStatus) return;
    
    const citescoreItem = dom.citeScoreStatus.parentElement;
    citescoreItem.style.display = 'flex';
    citescoreItem.className = 'status-item'; // reset
    if (!data.citeScoreAvailable) {
      dom.citeScoreStatus.textContent = 'CiteScore indisponível (sem API key)';
      citescoreItem.classList.add('warning');
    } else {
      dom.citeScoreStatus.textContent = 'CiteScore disponível';
      citescoreItem.classList.add('success');
    }

    // Exibir data de compilação da base (DB-3/UX-1)
    if (dom.dbCompiledAt && data.database_meta && data.database_meta.compiled_at) {
      try {
        const compiledDate = new Date(data.database_meta.compiled_at);
        const formatted = compiledDate.toLocaleDateString('pt-BR', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit'
        });
        const daysSince = Math.floor((Date.now() - compiledDate.getTime()) / 86400000);
        let statusClass = 'success';
        let warning = '';
        if (daysSince > 180) {
          statusClass = 'error';
          warning = ' ⚠ Desatualizado!';
        } else if (daysSince > 90) {
          statusClass = 'warning';
          warning = ' ⚠ Verificar atualização';
        }
        dom.dbCompiledAt.textContent = `Base compilada: ${formatted}${warning}`;
        const compiledItem = dom.dbCompiledAt.parentElement;
        compiledItem.style.display = 'flex';
        compiledItem.className = `status-item ${statusClass}`;

        // Exibir edições das fontes de dados
        if (data.database_meta) {
          const parts = [];
          if (data.database_meta.jcr_year) parts.push(`JCR ${data.database_meta.jcr_year}`);
          if (data.database_meta.cuiden_edition) parts.push(`CUIDEN ${data.database_meta.cuiden_edition}`);
          if (parts.length > 0) {
            const el = dom.dbSourcesInfo;
            if (el) {
              el.textContent = `Fontes: ${parts.join(' · ')}`;
              el.parentElement.style.display = 'flex';
            }
          }
        }
      } catch (_) { /* ignore date parse errors */ }
    }
  } catch (e) {
    // silencioso
  }
}

async function checkCircuitsStatus() {
  try {
    const resp = await fetch('/api/v1/status');
    if (!resp.ok) return;
    const data = await resp.json();
    if (!dom.circuitsStatus) return;
    const circuits = data.circuits || {};
    const openCircuits = Object.entries(circuits)
      .filter(([_, s]) => s.state === 'OPEN')
      .map(([name, s]) => {
        const label = { scielo: 'SciELO', lilacs: 'LILACS', latindex: 'Latindex', elsevier: 'Elsevier' }[name] || name;
        return `${label} (${s.cooldown_remaining}s)`;
      });

    const circuitsItem = dom.circuitsStatus.parentElement;
    const indicator = dom.statusIndicatorDot;
    if (openCircuits.length > 0) {
      dom.circuitsStatus.textContent = `APIs offline: ${openCircuits.join(', ')}`;
      circuitsItem.style.display = 'flex';
      circuitsItem.className = 'status-item error';
      if (indicator) {
        indicator.className = 'status-dot red pulsing';
      }
    } else {
      circuitsItem.style.display = 'none';
      if (indicator && dom.dbStatus && !dom.dbStatus.parentElement.classList.contains('error')) {
        indicator.className = 'status-dot green pulsing';
      }
    }
  } catch (e) {
    // silencioso
  }
}

/**
 * Inicializa a Base de Dados e exibe status na interface.
 * Busca a contagem de periódicos via API de status e carrega a lista
 * completa (issn + título + área) em memória para o matching local
 * do parser Lattes (Jaccard-IDF + aliases).
 */
async function initDatabase() {
  try {
    const resp = await fetch('/api/v1/status');
    if (!resp.ok) throw new Error('Status API error');
    const data = await resp.json();
    appState.dbSummary.total = data.database_size || 0;

    const dbStatusItem = dom.dbStatus.parentElement;
    dbStatusItem.className = 'status-item success';
    dom.dbStatus.textContent = `Base Conectada (${appState.dbSummary.total} revistas)`;

    // Carrega items {issn,title,area} para matching local do Lattes
    try {
      await loadDatabase();
    } catch (_) { /* ignore — fallback server-side mantém fluxo */ }
  } catch (error) {
    const dbStatusItem = dom.dbStatus.parentElement;
    dbStatusItem.className = 'status-item error';
    dom.dbStatus.textContent = 'Erro ao carregar banco';
    const indicator = dom.statusIndicatorDot;
    if (indicator) {
      indicator.className = 'status-dot red pulsing';
    }
    showToast('Falha ao carregar a base de dados de periódicos.', 'error');
  }
}

/**
 * Parseia texto Lattes — pipeline Fase 1 (backend matching authoritative).
 *
 * Fluxo:
 *   1. Segmentação + parser via lattesParser.js (cliente) — só regex.
 *   2. ISSN extraído literalmente do texto tem precedência (client-side).
 *   3. Restante enviado para `/api/v1/match/batch` (backend) com IDF + índice
 *      invertido + aliases compartilhados server-side.
 *   4. Se servidor falhar (offline, erro 5xx), cai no matcher local
 *      `parseLattesText` (Jaccard-IDF cliente) como fallback offline.
 *
 * @param {string} text Texto bruto do Lattes
 * @returns {Promise<Object[]>} Artigos parseados com matchedIssn/confidence resolvidos
 */
async function parseLattesWithServerMatching(text) {
  // 1. Pipeline local: segmentar + parsear (regex) — sempre no cliente.
  //    Mesmo fallback, garante estrutura consistente.
  let dbItems = [];
  try {
    const db = await loadDatabase();
    dbItems = (db && db.items) ? db.items : [];
  } catch (_) { /* ignore — server-side ainda funcionará */ }

  const segments = segmentLattesText(text);
  const parsed = segments.map(s => parseSingleArticle(s)).filter(a => a.type !== 'congresso');
  if (parsed.length === 0) return [];

  // 2. ISSN extraído do texto (client-side) tem precedência absoluta.
  for (const a of parsed) {
    if (a.extractedIssn) {
      a.matchedIssn = a.extractedIssn;
      a.confidence = 'high';
      a.matchScore = 1.0;
      a.matchStage = 'issn-extracted';
      a.matchCandidates = [];
    }
  }

  // 3. Restante vai para o backend (matching authoritative com IDF + aliases + Crossref).
  const needsServer = parsed.filter(a => !a.matchedIssn);
  if (needsServer.length > 0) {
    const queries = needsServer.map(a => a.journalRaw || a.journal);
    const articleTitles = needsServer.map(a => a.title);
    try {
      const resolved = await matchBatch(queries, articleTitles);
      if (resolved.length === needsServer.length) {
        for (let i = 0; i < needsServer.length; i++) {
          const m = resolved[i];
          const a = needsServer[i];
          if (m && m.issn) {
            a.matchedIssn = m.issn;
            a.confidence = m.confidence || 'high';
            a.matchScore = m.score || 0.95;
            a.matchStage = m.stage || 'jaccard';
            a.matchCandidates = m.candidates || [];
          } else if (m) {
            // Backend retornou explicitamente "none" com score baixo
            a.matchedIssn = null;
            a.confidence = m.confidence || 'none';
            a.matchScore = m.score || 0;
            a.matchStage = m.stage || 'none';
            a.matchCandidates = m.candidates || [];
          }
        }
      }
    } catch (_) { /* ignore — fallback abaixo */ }
  }

  // 4. Quem ainda não foi resolvido pelo servidor (offline, erro, ou sem match)
  //    cai no matcher local Jaccard-IDF como fallback offline.
  const stillUnresolved = parsed.filter(a => !a.matchedIssn && !a.confidence);
  if (stillUnresolved.length > 0 && dbItems.length > 0) {
    for (const a of stillUnresolved) {
      const local = matchJournalToISSN(a.journal, dbItems);
      if (local.issn) {
        a.matchedIssn = local.issn;
        a.confidence = local.confidence;
        a.matchScore = local.score;
        a.matchStage = local.confidence === 'high' ? 'local-jaccard' : 'local-fuzzy';
        a.matchCandidates = local.candidates || [];
      } else {
        a.matchedIssn = null;
        a.confidence = 'none';
        a.matchScore = local.score || 0;
        a.matchStage = 'none';
        a.matchCandidates = local.candidates || [];
      }
    }
  }

  return parsed;
}

/**
 * Classifica um artigo do Lattes com fallback de busca por nome.
 * Se o artigo tem matchedIssn, classifica diretamente.
 * Se não tem, tenta busca por nome; se encontrar 1 resultado, usa.
 * Caso contrário, marca como não identificado.
 * @param {Object} article Artigo parseado pelo lattesParser
 * @returns {Promise<Object>} Item classificado
 */
async function classifyArticleWithFallback(article) {
  let classified;

  if (article.matchedIssn) {
    classified = await enrichAndClassify(article.matchedIssn);
  } else {
    const fallback = await classifyByName(article.journal);
    if (fallback) {
      classified = fallback;
    } else {
      classified = await enrichAndClassify(article.journal);
      classified.unmatchedLattes = true;
    }
  }

  return applyArticleMetadata(classified, article);
}

async function classifyArticlesWithFallbackBatch(articles, onProgress) {
  const articleList = articles.filter(article => article.type !== 'congresso');
  const results = new Array(articleList.length);
  const direct = [];
  let processed = 0;

  articleList.forEach((article, index) => {
    if (article.matchedIssn) {
      direct.push({ article, index });
    }
  });

  if (direct.length > 0) {
    const classifiedBatch = await classifyBatch(direct.map(item => item.article.matchedIssn));
    direct.forEach((item, i) => {
      results[item.index] = applyArticleMetadata(classifiedBatch[i], item.article);
      processed++;
      if (onProgress) onProgress(processed, articleList.length);
    });
  }

  for (let i = 0; i < articleList.length; i++) {
    if (results[i]) continue;
    results[i] = await classifyArticleWithFallback(articleList[i]);
    processed++;
    if (onProgress) onProgress(processed, articleList.length);
  }

  return results.filter(Boolean);
}

function applyArticleMetadata(classified, article) {
  if (!classified) {
    classified = {
      issn: article.matchedIssn || article.journal || 'N/A',
      title: 'Erro ao consultar API',
      area: 'Outras Áreas',
      jcr: null,
      citeScore: null,
      indexers: [],
      metrics: { cuiden: null },
      classification: { estrato: 'NC', justification: 'Resposta ausente no lote.' }
    };
  }

  if (article.confidence) {
    classified.confidence = article.confidence;
  }
  if (article.matchStage) {
    classified.matchStage = article.matchStage;
  }
  if (article.matchCandidates && article.matchCandidates.length > 0) {
    classified.lattesCandidates = article.matchCandidates;
  }
  if (article.journalRaw) {
    classified.lattesJournalRaw = article.journalRaw;
  }

  if (article.title && classified.title === 'Periódico Não Identificado na Base') {
    classified.title = `[Não Identificado] ${article.journal}`;
  } else if (article.title && classified.title) {
    classified.title = `${article.title} (${classified.title})`;
  }

  classified.year = article.year;
  return classified;
}

/**
 * Processa a lista de artigos do Lattes: enriquece, classifica e atualiza a UI.
 * @param {Object[]} parsedArticles Artigos parseados pelo lattesParser
 * @param {string} researcherName Nome do pesquisador
 */
async function processLattesArticles(parsedArticles, researcherName) {
  showLoadingState('Analisando Currículo Lattes', 'Classificando os artigos...', 'file-text');
  
  let countNew = 0;
  let unmatchedCount = 0;
  let reviewCount = 0;
  updateLoadingProgress(0, parsedArticles.length);

  const classifiedArticles = await classifyArticlesWithFallbackBatch(parsedArticles, (current, total) => {
    updateLoadingProgress(current, total);
  });

  for (const classified of classifiedArticles) {
    if (classified.unmatchedLattes) {
      unmatchedCount++;
    } else if (classified.confidence === 'review') {
      reviewCount++;
    }

    addClassifiedItem(classified);
    countNew++;
  }

  if (dom.sessionResearcherTitle && dom.researcherNameDisplay) {
    dom.researcherNameDisplay.textContent = researcherName;
    dom.sessionResearcherTitle.style.display = 'block';
  }

  dom.lattesTextInput.value = '';
  
  hideLoadingState();
  renderResultsTable();
  switchTab('analytics');

  if (unmatchedCount > 0) {
    showToast(`⚠ ${unmatchedCount} de ${parsedArticles.length} artigos não foram reconhecidos. Verifique a tabela manualmente.`, 'warning');
  } else if (reviewCount > 0) {
    showToast(`✓ ${countNew} artigos processados. ${reviewCount} precisam de revisão (linhas destacadas).`, 'warning');
  } else {
    showToast(`${countNew} artigos do currículo processados com sucesso!`, 'success');
  }
}

function processOrcidResults(payload) {
  const results = payload.results || [];
  let countNew = 0;
  let unmatchedCount = 0;
  let reviewCount = 0;

  for (const item of results) {
    if (!item.issn || item.issn === 'N/A' || item.confidence === 'none') {
      unmatchedCount++;
    } else if (item.confidence === 'review') {
      reviewCount++;
    }
    addClassifiedItem(item);
    countNew++;
  }

  if (dom.sessionResearcherTitle && dom.researcherNameDisplay) {
    const label = payload.researcher_name || payload.orcid || 'ORCID';
    const rangeLabel = payload.year_from && payload.year_to ? ` (${payload.year_from}-${payload.year_to})` : '';
    dom.researcherNameDisplay.textContent = `${label}${rangeLabel}`;
    dom.sessionResearcherTitle.style.display = 'block';
  }

  if (dom.orcidInput) dom.orcidInput.value = '';

  hideLoadingState();
  renderResultsTable();
  switchTab(results.length > 0 ? 'analytics' : 'table');

  if (results.length === 0) {
    showToast('Nenhuma obra publica encontrada no ORCID para o intervalo informado.', 'warning');
  } else if (unmatchedCount > 0) {
    showToast(`${countNew} obras ORCID processadas. ${unmatchedCount} ficaram sem ISSN identificado.`, 'warning');
  } else if (reviewCount > 0) {
    showToast(`${countNew} obras ORCID processadas. ${reviewCount} precisam de revisao.`, 'warning');
  } else {
    showToast(`${countNew} obras ORCID classificadas com sucesso!`, 'success');
  }
}

/**
 * Lê e processa o arquivo CSV/Excel inserido pelo usuário.
 */
async function handleUploadedFile(file) {
  const fileName = file.name.toLowerCase();
  
  showLoadingState('Processando Planilha', 'Importando dados do arquivo e enriquecendo periódicos...', 'file-spreadsheet');

  let parsed;
  try {
    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      parsed = await parseXLSX(file);
    } else {
      const text = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (err) => reject(err);
        reader.readAsText(file);
      });
      parsed = parseCSV(text);
    }
  } catch (err) {
    hideLoadingState();
    showToast('Erro ao processar o arquivo. Verifique o formato.', 'error');
    console.error('[Upload] Erro ao ler arquivo:', err);
    return;
  }

  const records = processCSVData(parsed);

  let countNew = 0;
  updateLoadingProgress(0, records.length);
  const classifiedRecords = await classifyBatch(records.map(record => record.issn));
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const classified = classifiedRecords[i];

    if (record.title && record.title !== 'Artigo Importado' && classified.title === 'Periódico Não Identificado na Base') {
      classified.title = record.title;
    } else if (record.title && record.title !== 'Artigo Importado' && classified.title) {
      classified.title = `${record.title} (${classified.title})`;
    }

    addClassifiedItem(classified);
    countNew++;
    updateLoadingProgress(countNew, records.length);
  }

  hideLoadingState();
  renderResultsTable();
  switchTab('analytics');
  showToast(`${countNew} artigos importados e classificados com sucesso!`, 'success');
}

/**
 * Trata a busca de periódicos por nome (título).
 * @param {string} nameQuery Nome buscado
 */
async function handleSearchByName(nameQuery) {
  hideLoadingState();
  const results = await searchByName(nameQuery);

  if (results.length === 0) {
    showToast('Nenhum periódico encontrado com este nome.', 'warning');
    return;
  }

  if (results.length === 1) {
    showLoadingState('Analisando ISSN', 'Consultando APIs e aplicando regras de extratos CAPES...', 'search', true);
    const classified = await enrichAndClassify(results[0].issn);
    addClassifiedItem(classified);
    addRecentSearch(classified.issn, classified.title);
    renderResultsTable();
    dom.singleIssnInput.value = '';
    hideLoadingState();
    switchTab('table');
    return;
  }

  showSearchModal(results);
}
