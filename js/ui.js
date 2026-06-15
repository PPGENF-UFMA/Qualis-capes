/**
 * Módulo de UI — Controles de interface.
 * Abas, modais, loading overlay, tema, seletor segmentado e toasts.
 */

import dom from './dom.js';
import appState from './state.js';
import { escapeHTML } from './utils.js';
import { enrichAndClassify } from './enricher.js';
import { addClassifiedItem } from './state.js';
import { renderResultsTable } from './table.js';

// ─── SISTEMA DE ABAS ──────────────────────────────────────────────

/**
 * Alterna entre as abas de resultados (Tabela / Estatísticas).
 * @param {'table'|'analytics'} tabId Identificador da aba
 */
export function switchTab(tabId) {
  if (!dom.tabTable || !dom.tabAnalytics || !dom.paneTable || !dom.paneAnalytics) return;

  if (tabId === 'table') {
    dom.tabTable.classList.add('active');
    dom.tabAnalytics.classList.remove('active');
    dom.paneTable.classList.add('active');
    dom.paneAnalytics.classList.remove('active');
  } else if (tabId === 'analytics') {
    dom.tabTable.classList.remove('active');
    dom.tabAnalytics.classList.add('active');
    dom.paneTable.classList.remove('active');
    dom.paneAnalytics.classList.add('active');

    // Forçar redimensionamento dos gráficos criados em display: none
    if (appState.charts.qualis) appState.charts.qualis.resize();
    if (appState.charts.indexers) appState.charts.indexers.resize();
    if (appState.charts.publicationsYear) appState.charts.publicationsYear.resize();
    if (appState.charts.qualisEvolution) appState.charts.qualisEvolution.resize();
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
  dom.selectorSingle.classList.remove('active');
  dom.selectorBatch.classList.remove('active');
  dom.selectorUpload.classList.remove('active');
  dom.selectorLattes.classList.remove('active');
  dom.paneInputSingle.classList.remove('active');
  dom.paneInputBatch.classList.remove('active');
  dom.paneInputUpload.classList.remove('active');
  dom.paneInputLattes.classList.remove('active');

  // Ativar o correspondente
  const selectorMap = {
    single: [dom.selectorSingle, dom.paneInputSingle],
    batch: [dom.selectorBatch, dom.paneInputBatch],
    upload: [dom.selectorUpload, dom.paneInputUpload],
    lattes: [dom.selectorLattes, dom.paneInputLattes]
  };

  const [selector, pane] = selectorMap[type] || selectorMap.single;
  selector.classList.add('active');
  pane.classList.add('active');
}

// ─── LOADING OVERLAY ──────────────────────────────────────────────────────

/**
 * Desabilita ou reabilita todos os botões de submit.
 * @param {boolean} disabled
 */
function setSubmitButtonsDisabled(disabled) {
  [dom.btnSubmitSingle, dom.btnSubmitBatch, dom.btnSubmitLattes].forEach(btn => {
    if (btn) btn.disabled = disabled;
  });
}

/**
 * Exibe o overlay de carregamento premium.
 * @param {string} title Título exibido
 * @param {string} subtitle Subtítulo descritivo
 * @param {string} iconName Nome do ícone Lucide
 */
export function showLoadingState(title = 'Processando Periódico', subtitle = 'Consultando bases oficiais e aplicando critérios CAPES...', iconName = 'search') {
  document.body.style.cursor = 'wait';
  setSubmitButtonsDisabled(true);
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

// ─── MODAL DE BUSCA ───────────────────────────────────────────────

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
