/**
 * Módulo de UI — Controles de interface.
 * Abas, modais, loading overlay, tema, seletor segmentado e toasts.
 */

import dom from './dom.js';
import appState from './state.js';
import { escapeHTML } from './utils.js';
import { enrichAndClassify } from './enricher.js';
import { addClassifiedItem } from './state.js';
import { renderResultsTable, showTableSkeletons } from './table.js';

// ─── SISTEMA DE ABAS ──────────────────────────────────────────────

/**
 * Alterna entre as abas de resultados (Tabela / Estatísticas / Comparação).
 * @param {'table'|'analytics'|'comparison'} tabId Identificador da aba
 */
export function switchTab(tabId) {
  if (!dom.tabTable || !dom.tabAnalytics || !dom.paneTable || !dom.paneAnalytics) return;

  // Reset all tabs
  [dom.tabTable, dom.tabAnalytics, dom.tabComparison].forEach(t => {
    if (t) t.classList.remove('active');
  });
  [dom.paneTable, dom.paneAnalytics, dom.paneComparison].forEach(p => {
    if (p) p.classList.remove('active');
  });

  if (tabId === 'table') {
    dom.tabTable.classList.add('active');
    dom.paneTable.classList.add('active');
  } else if (tabId === 'analytics') {
    dom.tabAnalytics.classList.add('active');
    dom.paneAnalytics.classList.add('active');

    if (appState.charts.qualis) appState.charts.qualis.resize();
    if (appState.charts.indexers) appState.charts.indexers.resize();
    if (appState.charts.publicationsYear) appState.charts.publicationsYear.resize();
    if (appState.charts.qualisEvolution) appState.charts.qualisEvolution.resize();
  } else if (tabId === 'comparison') {
    if (dom.tabComparison) dom.tabComparison.classList.add('active');
    if (dom.paneComparison) dom.paneComparison.classList.add('active');

    if (appState.charts.radar) appState.charts.radar.resize();
    if (appState.charts.comparisonEstrato) appState.charts.comparisonEstrato.resize();
  }
}

/**
 * Alterna o formulário de entrada da barra lateral (Individual / Lote / Planilha / Currículo).
 * @param {'single'|'batch'|'upload'|'lattes'} type Tipo de input selecionado
 */
export function switchInputType(type) {
  if (!dom.selectorSingle || !dom.selectorBatch || !dom.selectorUpload || !dom.selectorLattes ||
    !dom.paneInputSingle || !dom.paneInputBatch || !dom.paneInputUpload || !dom.paneInputLattes) return;

  // Resetar classes active
  [dom.selectorSingle, dom.selectorBatch, dom.selectorUpload, dom.selectorLattes].forEach(s => {
    if (s) s.classList.remove('active');
  });
  [dom.paneInputSingle, dom.paneInputBatch, dom.paneInputUpload, dom.paneInputLattes].forEach(p => {
    if (p) p.classList.remove('active');
  });

  // Ativar o correspondente
  const selectorMap = {
    single: [dom.selectorSingle, dom.paneInputSingle],
    batch: [dom.selectorBatch, dom.paneInputBatch],
    upload: [dom.selectorUpload, dom.paneInputUpload],
    lattes: [dom.selectorLattes, dom.paneInputLattes]
  };

  const [selector, pane] = selectorMap[type] || selectorMap.single;
  if (selector) selector.classList.add('active');
  if (pane) pane.classList.add('active');
}

// ─── LOADING OVERLAY ──────────────────────────────────────────────────────

/**
 * Desabilita ou reabilita todos os botões de submit.
 * @param {boolean} disabled
 */
function setSubmitButtonsDisabled(disabled) {
  [dom.btnSubmitSingle, dom.btnSubmitBatch, dom.btnSubmitLattes, dom.btnSubmitComparison].forEach(btn => {
    if (btn) btn.disabled = disabled;
  });
}

/**
 * Exibe o overlay de carregamento premium.
 * @param {string} title Título exibido
 * @param {string} subtitle Subtítulo descritivo
 * @param {string} iconName Nome do ícone Lucide
 */
export function showLoadingState(title = 'Processando Periódico', subtitle = 'Consultando bases oficiais e aplicando critérios CAPES...', iconName = 'search', useSkeleton = false) {
  document.body.style.cursor = 'wait';
  setSubmitButtonsDisabled(true);
  
  if (useSkeleton) {
    showTableSkeletons(1);
    switchTab('table');
    return;
  }

  if (dom.loadingOverlay) {
    dom.loadingTitle.textContent = title;
    dom.loadingSubtitle.textContent = subtitle;

    if (dom.loadingIcon) {
      dom.loadingIcon.innerHTML = `<i data-lucide="${iconName}"></i>`;
      if (typeof lucide !== 'undefined') {
        lucide.createIcons({
          attrs: { class: 'lucide' },
          nameAttr: 'data-lucide',
          node: dom.loadingIcon
        });
      }
    }

    if (dom.loadingProgressContainer) {
      dom.loadingProgressContainer.style.display = 'none';
      if (dom.loadingProgressBar) dom.loadingProgressBar.style.width = '0%';
      if (dom.loadingProgressText) dom.loadingProgressText.textContent = '';
      if (dom.loadingProgressPercent) dom.loadingProgressPercent.textContent = '0%';
    }

    dom.loadingOverlay.classList.add('active');
  }
}

/**
 * Oculta o overlay de carregamento.
 */
export function hideLoadingState() {
  document.body.style.cursor = 'default';
  setSubmitButtonsDisabled(false);
  if (dom.loadingOverlay) {
    dom.loadingOverlay.classList.remove('active');
  }
}

/**
 * Atualiza a barra de progresso do loading overlay.
 * @param {number} current Item atual
 * @param {number} total Total de itens
 */
export function updateLoadingProgress(current, total) {
  if (dom.loadingProgressContainer) {
    dom.loadingProgressContainer.style.display = 'block';
    
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
    
    if (dom.loadingProgressBar) dom.loadingProgressBar.style.width = `${percent}%`;
    if (dom.loadingProgressText) dom.loadingProgressText.textContent = `Processando ${current} de ${total}...`;
    if (dom.loadingProgressPercent) dom.loadingProgressPercent.textContent = `${percent}%`;
  }
}

// ─── MODAL DE PREVIEW LATTES ──────────────────────────────────────

let confirmLattesHandler = null;

export function showLattesPreviewModal(articles, onConfirm) {
  if (!dom.lattesPreviewModal) {
    console.warn('[Lattes Preview] Modal element #lattes-preview-modal not found in DOM. Falling back to direct processing.');
    return false;
  }
  if (!dom.lattesPreviewList) {
    console.warn('[Lattes Preview] List element #lattes-preview-list not found in DOM. Falling back to direct processing.');
    return false;
  }

  dom.lattesPreviewModal.classList.add('active');
  dom.lattesPreviewModal.style.display = 'flex';
  
  if (dom.lattesPreviewCountText) {
    dom.lattesPreviewCountText.textContent = `Foram detectados ${articles.length} artigos no texto fornecido. Confirme a lista abaixo para iniciar a classificacao.`;
  }
  if (dom.lattesPreviewList) {
    dom.lattesPreviewList.innerHTML = '';
    
    articles.forEach((article, index) => {
      const itemEl = document.createElement('div');
      itemEl.className = 'search-result-item';
      itemEl.style.cursor = 'default';
      itemEl.style.display = 'flex';
      itemEl.style.justifyContent = 'space-between';
      itemEl.style.alignItems = 'center';
      
      const safeTitle = escapeHTML(article.title || article.journal || 'Artigo sem titulo');
      const safeYear = escapeHTML(article.year || '-');
      
      itemEl.innerHTML = `
        <div class="search-result-info" style="flex: 1; overflow: hidden;">
          <div class="search-result-title" title="${safeTitle}" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13px;">${index + 1}. ${safeTitle}</div>
          <div class="search-result-meta" style="font-size: 11px;">Revista: ${escapeHTML(article.journal || '-')} ${article.matchedIssn ? `(ISSN: ${escapeHTML(article.matchedIssn)})` : ''}</div>
        </div>
        <div style="font-weight: 600; color: var(--primary-color); font-size: 13px; margin-left: 10px;">
          ${safeYear}
        </div>
      `;
      dom.lattesPreviewList.appendChild(itemEl);
    });
  }
  
  // Clean up previous listeners
  if (confirmLattesHandler && dom.btnConfirmLattes) {
    dom.btnConfirmLattes.removeEventListener('click', confirmLattesHandler);
  }
  
  confirmLattesHandler = () => {
    closeLattesPreviewModal();
    if (onConfirm) onConfirm();
  };
  
  if (dom.btnConfirmLattes) {
    dom.btnConfirmLattes.addEventListener('click', confirmLattesHandler);
  }

  console.log(`[Lattes Preview] Modal opened with ${articles.length} articles.`);
  return true;
}

export function closeLattesPreviewModal() {
  if (dom.lattesPreviewModal) {
    dom.lattesPreviewModal.classList.remove('active');
    dom.lattesPreviewModal.style.display = 'none';
  }
}

// ─── TABS & PANELS ─────────────────────────────────────────────────

/**
 * Exibe o modal com a lista de resultados da busca por nome.
 * @param {Object[]} items Lista de periódicos encontrados
 */
export function showSearchModal(items) {
  if (!dom.searchResultsList) return;
  dom.searchResultsList.innerHTML = '';

  items.forEach(item => {
    const itemEl = document.createElement('div');
    itemEl.className = 'search-result-item';
    const safeTitleModal = escapeHTML(item.title);
    const safeAreaModal = escapeHTML(item.area);
    const safeIssnModal = escapeHTML(item.issn);
    itemEl.innerHTML = `
      <div class="search-result-info">
        <div class="search-result-title" title="${safeTitleModal}">${safeTitleModal}</div>
        <div class="search-result-meta">${safeAreaModal}</div>
      </div>
      <div class="search-result-issn">${safeIssnModal}</div>
    `;

    itemEl.addEventListener('click', async () => {
      closeSearchModal();
      showLoadingState('Analisando ISSN', 'Consultando APIs e aplicando regras de extratos CAPES...', 'search');
      const classified = await enrichAndClassify(item.issn);
      addClassifiedItem(classified);
      addRecentSearch(classified.issn, classified.title);
      renderResultsTable();
      dom.singleIssnInput.value = '';
      hideLoadingState();
      switchTab('table');
    });

    dom.searchResultsList.appendChild(itemEl);
  });

  if (dom.searchModal) {
    dom.searchModal.classList.add('active');

    if (typeof lucide !== 'undefined') {
      lucide.createIcons({
        attrs: { class: 'lucide' },
        nameAttr: 'data-lucide',
        node: dom.searchModal
      });
    }
  }
}

/**
 * Fecha o modal de seleção de periódicos.
 */
export function closeSearchModal() {
  if (dom.searchModal) {
    dom.searchModal.classList.remove('active');
  }
}

// ─── MODAL DE COMPARAÇÃO ──────────────────────────────────────────

/**
 * Abre o modal de comparação de currículos.
 */
export function showComparisonModal() {
  if (dom.comparisonModal) {
    dom.comparisonModal.classList.add('active');
    dom.comparisonModal.style.display = 'flex';

    if (typeof lucide !== 'undefined') {
      lucide.createIcons({
        attrs: { class: 'lucide' },
        nameAttr: 'data-lucide',
        node: dom.comparisonModal
      });
    }
  }
}

/**
 * Fecha o modal de comparação de currículos e limpa o formulário.
 */
export function closeComparisonModal() {
  if (dom.comparisonModal) {
    dom.comparisonModal.classList.remove('active');
    dom.comparisonModal.style.display = 'none';
  }
  if (dom.comparisonNameA) dom.comparisonNameA.value = '';
  if (dom.comparisonTextA) dom.comparisonTextA.value = '';
  if (dom.comparisonNameB) dom.comparisonNameB.value = '';
  if (dom.comparisonTextB) dom.comparisonTextB.value = '';
}

// ─── MODAL "COMO FUNCIONA A CLASSIFICAÇÃO" ────────────────────────

/**
 * Abre o modal explicativo com as regras de classificação, fontes e limitações.
 */
export function showClassificationInfoModal() {
  if (dom.classificationInfoModal) {
    dom.classificationInfoModal.classList.add('active');
    dom.classificationInfoModal.style.display = 'flex';

    if (typeof lucide !== 'undefined') {
      lucide.createIcons({
        attrs: { class: 'lucide' },
        nameAttr: 'data-lucide',
        node: dom.classificationInfoModal
      });
    }
  }
}

/**
 * Fecha o modal explicativo de classificação.
 */
export function closeClassificationInfoModal() {
  if (dom.classificationInfoModal) {
    dom.classificationInfoModal.classList.remove('active');
    dom.classificationInfoModal.style.display = 'none';
  }
}

// ─── TEMA CLARO/ESCURO ────────────────────────────────────────────

/**
 * Inicializa o tema com base em localStorage ou preferência do sistema.
 */
export function initTheme() {
  const savedTheme = localStorage.getItem('qualis_theme');
  if (savedTheme === 'light') {
    document.body.classList.add('light-theme');
  } else if (!savedTheme && window.matchMedia('(prefers-color-scheme: light)').matches) {
    document.body.classList.add('light-theme');
  }
  updateThemeButtonLabel();
}

/**
 * Alterna entre tema claro e escuro e persiste a preferência.
 */
export function toggleTheme() {
  document.body.classList.toggle('light-theme');
  const isLight = document.body.classList.contains('light-theme');
  localStorage.setItem('qualis_theme', isLight ? 'light' : 'dark');
  updateThemeButtonLabel();
}

/**
 * Atualiza o texto e ícone do botão de tema.
 */
function updateThemeButtonLabel() {
  const isLight = document.body.classList.contains('light-theme');
  dom.themeToggle.innerHTML = isLight
    ? '<i data-lucide="sun"></i> <span>Modo Claro</span>'
    : '<i data-lucide="moon"></i> <span>Modo Escuro</span>';

  if (typeof lucide !== 'undefined') {
    lucide.createIcons({ node: dom.themeToggle });
  }
}

// ─── SISTEMA DE TOASTS ────────────────────────────────────────────

/**
 * Exibe uma notificação toast não-bloqueante.
 * @param {string} message Mensagem a ser exibida
 * @param {'success'|'warning'|'error'|'info'} type Tipo visual do toast
 * @param {number} duration Duração em ms (padrão: 4000)
 */
export function showToast(message, type = 'info', duration = 4000) {
  let container = dom.toastContainer;
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
    dom.toastContainer = container;
  }

  const iconMap = {
    success: 'check-circle-2',
    warning: 'alert-triangle',
    error: 'x-circle',
    info: 'info'
  };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <i data-lucide="${iconMap[type] || 'info'}" class="toast-icon"></i>
    <span class="toast-message">${escapeHTML(message)}</span>
    <button class="toast-close" aria-label="Fechar notificação"><i data-lucide="x"></i></button>
    <div class="toast-progress" style="animation-duration: ${duration}ms;"></div>
  `;

  const closeBtn = toast.querySelector('.toast-close');
  closeBtn.addEventListener('click', () => dismissToast(toast));

  container.appendChild(toast);

  if (typeof lucide !== 'undefined') {
    lucide.createIcons({ node: toast });
  }

  // Forçar reflow para ativar a animação de entrada
  toast.offsetHeight;
  toast.classList.add('toast-visible');

  // Auto-dismiss após a duração
  setTimeout(() => dismissToast(toast), duration);
}

/**
 * Remove um toast com animação de saída.
 * @param {HTMLElement} toast Elemento do toast
 */
function dismissToast(toast) {
  if (!toast || toast.classList.contains('toast-dismissing')) return;
  toast.classList.add('toast-dismissing');
  toast.addEventListener('animationend', () => toast.remove(), { once: true });
}

/**
 * Adiciona uma consulta ao histórico de buscas recentes no localStorage.
 * @param {string} issn ISSN do periódico
 * @param {string} title Título do periódico
 */
export function addRecentSearch(issn, title) {
  if (!issn || !title || title === 'Periódico Não Identificado na Base') return;
  try {
    const saved = localStorage.getItem('qualis_recent_searches');
    let history = saved ? JSON.parse(saved) : [];
    
    // Remover duplicados
    history = history.filter(item => item.issn !== issn);
    
    // Adicionar no topo
    history.unshift({ issn, title });
    
    // Limitar a 4 itens
    if (history.length > 4) {
      history = history.slice(0, 4);
    }
    
    localStorage.setItem('qualis_recent_searches', JSON.stringify(history));
    renderRecentSearches();
  } catch (e) {
    console.warn('[Histórico] Falha ao adicionar busca recente:', e.message);
  }
}

/**
 * Renderiza dinamicamente a lista de buscas recentes na sidebar.
 */
export function renderRecentSearches() {
  const container = dom.recentSearchesList;
  if (!container) return;
  
  try {
    const saved = localStorage.getItem('qualis_recent_searches');
    const history = saved ? JSON.parse(saved) : [];
    
    if (history.length === 0) {
      container.innerHTML = '<span class="no-history-msg">Nenhuma busca recente realizada.</span>';
      return;
    }
    
    container.innerHTML = history.map(item => {
      const safeTitle = escapeHTML(item.title);
      const safeIssn = escapeHTML(item.issn);
      return `
        <button class="recent-search-btn" data-issn="${safeIssn}" title="Clique para buscar ${safeTitle}">
          <span class="recent-search-title">${safeTitle}</span>
          <span class="recent-search-issn">${safeIssn}</span>
        </button>
      `;
    }).join('');
  } catch (e) {
    console.warn('[Histórico] Falha ao renderizar buscas recentes:', e.message);
  }
}

/**
 * Gera os quadriênios dinamicamente e os adiciona ao <select>
 */
export function initQuadrienios() {
  if (!dom.filterYear) return;
  const currentYear = new Date().getFullYear();
  const periods = [];
  
  // Quadriênios começam em 2013, 2017, 2021, 2025... até o próximo ciclo
  for (let start = 2013; start <= currentYear + 4; start += 4) {
    periods.unshift(`${start}-${start + 3}`); // do mais recente para o mais antigo
  }
  
  // A opção "ALL" já está no HTML
  periods.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = `Quadriênio ${p}`;
    dom.filterYear.appendChild(opt);
  });
}
