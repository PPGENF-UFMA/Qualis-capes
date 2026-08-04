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

let activeModal = null;
const INTRO_VISIT_KEY = 'qualis_intro_seen';

export function syncAdaptiveIntro() {
  const hasResults = appState.classifiedItems.length > 0 || appState.comparisonProfiles.length >= 2;
  let returningVisitor = false;
  try {
    returningVisitor = localStorage.getItem(INTRO_VISIT_KEY) === 'true';
  } catch (_) {
    // A interface continua funcional quando o armazenamento estiver indisponível.
  }

  document.body.classList.toggle('intro-condensed', returningVisitor || hasResults);
  document.body.classList.toggle('intro-has-results', hasResults);
  dom.editorialIntro?.setAttribute('data-intro-state', hasResults ? 'results' : returningVisitor ? 'returning' : 'welcome');
}

export function initAdaptiveIntro() {
  syncAdaptiveIntro();
  requestAnimationFrame(() => document.body.classList.add('intro-ready'));
  try {
    localStorage.setItem(INTRO_VISIT_KEY, 'true');
  } catch (_) {
    // Sem persistência, a apresentação compacta é exibida novamente na próxima visita.
  }
}
let lastFocusedElement = null;
let consultationInitialized = false;
let tabTransitionToken = 0;
let activeTabAnimations = [];
const customSelectRegistry = new Map();
let customSelectOutsideHandlerBound = false;

function getFocusableElements(container) {
  return Array.from(container.querySelectorAll(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(el => el.offsetParent !== null);
}

function handleModalKeydown(e) {
  if (!activeModal || e.key !== 'Tab') return;
  const focusable = getFocusableElements(activeModal);
  if (focusable.length === 0) {
    e.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function openManagedModal(modal, preferredFocus) {
  if (!modal) return;
  lastFocusedElement = document.activeElement;
  activeModal = modal;
  document.addEventListener('keydown', handleModalKeydown);
  modal.classList.add('active');
  modal.style.display = 'flex';
  const focusTarget = preferredFocus || getFocusableElements(modal)[0];
  if (focusTarget) focusTarget.focus();
}

function closeManagedModal(modal) {
  if (!modal) return;
  modal.classList.remove('active');
  modal.style.display = 'none';
  if (activeModal === modal) {
    activeModal = null;
    document.removeEventListener('keydown', handleModalKeydown);
  }
  if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
    lastFocusedElement.focus();
  }
  lastFocusedElement = null;
}

// ─── SELECTS EDITORIAIS ──────────────────────────────────────────

function closeCustomSelect(entry, restoreFocus = false) {
  if (!entry || !entry.wrapper.classList.contains('is-open')) return;
  entry.wrapper.classList.remove('is-open', 'align-right');
  entry.menu.hidden = true;
  entry.button.setAttribute('aria-expanded', 'false');
  entry.button.removeAttribute('aria-activedescendant');
  if (restoreFocus) entry.button.focus();
}

function closeOtherCustomSelects(currentSelect = null) {
  customSelectRegistry.forEach((entry, select) => {
    if (select !== currentSelect) closeCustomSelect(entry);
  });
}

function setCustomSelectActiveOption(entry, index) {
  const optionElements = Array.from(entry.menu.querySelectorAll('[role="option"]'));
  if (optionElements.length === 0) return;
  const nextIndex = Math.max(0, Math.min(index, optionElements.length - 1));
  optionElements.forEach((option, optionIndex) => {
    option.classList.toggle('is-active', optionIndex === nextIndex);
  });
  entry.activeIndex = nextIndex;
  entry.button.setAttribute('aria-activedescendant', optionElements[nextIndex].id);
  optionElements[nextIndex].scrollIntoView({ block: 'nearest' });
}

function syncCustomSelect(select) {
  const entry = customSelectRegistry.get(select);
  if (!entry) return;
  const selectedOption = select.options[select.selectedIndex] || select.options[0];
  if (!selectedOption) return;

  entry.value.textContent = selectedOption.textContent;
  entry.button.setAttribute('aria-label', `${select.getAttribute('aria-label') || 'Selecionar'}: ${selectedOption.textContent}`);
  Array.from(entry.menu.querySelectorAll('[role="option"]')).forEach((option, index) => {
    const selected = index === select.selectedIndex;
    option.classList.toggle('is-selected', selected);
    option.setAttribute('aria-selected', String(selected));
  });
  entry.activeIndex = select.selectedIndex;
}

function selectCustomOption(select, index) {
  const entry = customSelectRegistry.get(select);
  if (!entry || !select.options[index]) return;
  const previousValue = select.value;
  select.selectedIndex = index;
  syncCustomSelect(select);
  closeCustomSelect(entry, true);
  if (select.value !== previousValue) {
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function openCustomSelect(select) {
  const entry = customSelectRegistry.get(select);
  if (!entry) return;
  closeOtherCustomSelects(select);
  entry.menu.hidden = false;
  entry.wrapper.classList.add('is-open');
  entry.button.setAttribute('aria-expanded', 'true');
  setCustomSelectActiveOption(entry, Math.max(0, select.selectedIndex));

  const menuRect = entry.menu.getBoundingClientRect();
  if (menuRect.right > window.innerWidth - 16) {
    entry.wrapper.classList.add('align-right');
  }
}

function enhanceSelect(select) {
  if (!select || customSelectRegistry.has(select)) return;

  const wrapper = document.createElement('div');
  wrapper.className = `custom-select custom-select-${select.id}`;
  select.parentNode.insertBefore(wrapper, select);
  wrapper.appendChild(select);

  select.classList.add('custom-select-native');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'custom-select-trigger';
  button.setAttribute('role', 'combobox');
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');

  const value = document.createElement('span');
  value.className = 'custom-select-value';
  const arrow = document.createElement('span');
  arrow.className = 'custom-select-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  button.append(value, arrow);

  const menu = document.createElement('div');
  menu.id = `${select.id}-menu`;
  menu.className = 'custom-select-menu';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', select.getAttribute('aria-label') || 'Opções');
  menu.hidden = true;
  button.setAttribute('aria-controls', menu.id);

  Array.from(select.options).forEach((nativeOption, index) => {
    const option = document.createElement('div');
    option.id = `${select.id}-option-${index}`;
    option.className = 'custom-select-option';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'false');
    option.textContent = nativeOption.textContent;
    option.addEventListener('pointermove', () => setCustomSelectActiveOption(customSelectRegistry.get(select), index));
    option.addEventListener('click', () => selectCustomOption(select, index));
    menu.appendChild(option);
  });

  wrapper.append(button, menu);
  customSelectRegistry.set(select, { wrapper, button, value, menu, activeIndex: select.selectedIndex });
  syncCustomSelect(select);

  button.addEventListener('click', () => {
    if (wrapper.classList.contains('is-open')) closeCustomSelect(customSelectRegistry.get(select));
    else openCustomSelect(select);
  });

  button.addEventListener('keydown', (event) => {
    const entry = customSelectRegistry.get(select);
    const isOpen = wrapper.classList.contains('is-open');
    if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      closeCustomSelect(entry, true);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (isOpen) selectCustomOption(select, entry.activeIndex);
      else openCustomSelect(select);
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!isOpen) openCustomSelect(select);
      const optionCount = select.options.length;
      let nextIndex = entry.activeIndex;
      if (event.key === 'ArrowDown') nextIndex = Math.min(optionCount - 1, nextIndex + 1);
      if (event.key === 'ArrowUp') nextIndex = Math.max(0, nextIndex - 1);
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = optionCount - 1;
      setCustomSelectActiveOption(entry, nextIndex);
    }
  });

  select.addEventListener('change', () => syncCustomSelect(select));
}

export function initCustomSelects() {
  [dom.filterEstrato, dom.filterYear, dom.sortBy].forEach(enhanceSelect);
  if (!customSelectOutsideHandlerBound) {
    document.addEventListener('pointerdown', event => {
      customSelectRegistry.forEach(entry => {
        if (!entry.wrapper.contains(event.target)) closeCustomSelect(entry);
      });
    });
    customSelectOutsideHandlerBound = true;
  }
}

export function syncCustomSelects() {
  customSelectRegistry.forEach((_entry, select) => syncCustomSelect(select));
}

// ─── CENTRAL DE CONSULTA RESPONSIVA ──────────────────────────────

function resizeVisibleCharts(tabId) {
  const chartKeys = tabId === 'analytics'
    ? ['qualis', 'indexers', 'publicationsYear', 'qualisEvolution']
    : tabId === 'comparison'
      ? ['radar', 'comparisonEstrato']
      : [];

  chartKeys.forEach(key => {
    const chart = appState.charts[key];
    if (chart && typeof chart.resize === 'function') chart.resize();
  });
}

function setConsultationInteractive(interactive) {
  if (!dom.consultationPanel) return;
  dom.consultationPanel.inert = !interactive;
  if (interactive) {
    dom.consultationPanel.removeAttribute('aria-hidden');
  } else {
    dom.consultationPanel.setAttribute('aria-hidden', 'true');
  }
}

function isDashboardFocus() {
  return Boolean(dom.workspace?.classList.contains('dashboard-focus'));
}

export function openConsultationSidebar() {
  if (!dom.workspace || !isDashboardFocus()) return;
  dom.workspace.classList.add('consultation-open');
  document.body.classList.add('consultation-drawer-open');
  setConsultationInteractive(true);
  dom.sidebarOpen?.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => dom.sidebarClose?.focus());
}

export function closeConsultationSidebar({ restoreFocus = true } = {}) {
  if (!dom.workspace || !isDashboardFocus()) return;
  dom.workspace.classList.remove('consultation-open');
  document.body.classList.remove('consultation-drawer-open');
  if (restoreFocus) dom.sidebarOpen?.focus({ preventScroll: true });
  setConsultationInteractive(false);
  dom.sidebarOpen?.setAttribute('aria-expanded', 'false');
}

function syncConsultationWithTab(tabId) {
  if (!dom.workspace || !dom.consultationPanel) return;
  const dashboardFocus = tabId === 'analytics' || tabId === 'comparison';
  const focusWasInside = dom.consultationPanel.contains(document.activeElement);

  dom.workspace.classList.toggle('dashboard-focus', dashboardFocus);
  dom.workspace.classList.remove('consultation-open');
  document.body.classList.remove('consultation-drawer-open');
  if (dashboardFocus && focusWasInside) {
    dom.activeTab()?.focus({ preventScroll: true });
  }
  setConsultationInteractive(!dashboardFocus);
  dom.sidebarOpen?.setAttribute('aria-expanded', dashboardFocus ? 'false' : 'true');
}

function handleConsultationKeydown(event) {
  if (!dom.workspace?.classList.contains('consultation-open')) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    closeConsultationSidebar();
    return;
  }

  if (event.key !== 'Tab' || !dom.consultationPanel) return;
  const focusable = getFocusableElements(dom.consultationPanel);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function initConsultationSidebar() {
  if (consultationInitialized || !dom.workspace || !dom.consultationPanel) return;
  consultationInitialized = true;

  dom.sidebarOpen?.addEventListener('click', openConsultationSidebar);
  dom.sidebarClose?.addEventListener('click', () => closeConsultationSidebar());
  dom.sidebarBackdrop?.addEventListener('click', () => closeConsultationSidebar());
  document.addEventListener('keydown', handleConsultationKeydown);

  syncConsultationWithTab('table');
}

// ─── SISTEMA DE ABAS ──────────────────────────────────────────────

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function getActiveTabId() {
  if (dom.tabAnalytics?.classList.contains('active')) return 'analytics';
  if (dom.tabComparison?.classList.contains('active')) return 'comparison';
  return 'table';
}

function isDashboardTab(tabId) {
  return tabId === 'analytics' || tabId === 'comparison';
}

function cancelTabAnimations() {
  activeTabAnimations.forEach(animation => animation.cancel());
  activeTabAnimations = [];
  [dom.mainContent, dom.consultationPanel, dom.sidebarOpen].forEach(element => {
    if (!element) return;
    element.style.removeProperty('opacity');
    element.style.removeProperty('transform');
  });
}

async function playTabAnimation(element, keyframes, options) {
  if (!element || prefersReducedMotion() || typeof element.animate !== 'function') return;
  const animation = element.animate(keyframes, { fill: 'both', ...options });
  activeTabAnimations.push(animation);
  try {
    await animation.finished;
  } catch (_) {
    // Uma nova troca de aba cancela a animação anterior intencionalmente.
  } finally {
    activeTabAnimations = activeTabAnimations.filter(item => item !== animation);
    animation.cancel();
  }
}

function nextLayoutFrame() {
  return new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function applyTabState(tabId) {
  [dom.tabTable, dom.tabAnalytics, dom.tabComparison].forEach(tab => {
    if (!tab) return;
    tab.classList.remove('active');
    tab.setAttribute('aria-selected', 'false');
    tab.setAttribute('tabindex', '-1');
  });
  [dom.paneTable, dom.paneAnalytics, dom.paneComparison].forEach(pane => {
    if (!pane) return;
    pane.classList.remove('active');
    pane.setAttribute('hidden', '');
  });

  const tab = tabId === 'analytics' ? dom.tabAnalytics : tabId === 'comparison' ? dom.tabComparison : dom.tabTable;
  const pane = tabId === 'analytics' ? dom.paneAnalytics : tabId === 'comparison' ? dom.paneComparison : dom.paneTable;
  if (!tab || !pane) return;
  tab.classList.add('active');
  tab.setAttribute('aria-selected', 'true');
  tab.setAttribute('tabindex', '0');
  pane.classList.add('active');
  pane.removeAttribute('hidden');
}

async function animateTabOut(element, token) {
  if (!element) return;
  if (prefersReducedMotion() || typeof element.animate !== 'function') {
    element.style.opacity = '0';
    return;
  }

  await playTabAnimation(element, [
    { opacity: 1, transform: 'translateY(0)' },
    { opacity: 0, transform: 'translateY(-4px)' }
  ], { duration: 90, easing: 'ease-in' });

  if (token === tabTransitionToken) {
    element.style.opacity = '0';
    element.style.transform = 'translateY(-4px)';
  }
}

async function animateTabIn(element) {
  if (!element) return;
  if (prefersReducedMotion() || typeof element.animate !== 'function') {
    element.style.removeProperty('opacity');
    element.style.removeProperty('transform');
    return;
  }

  const animation = element.animate([
    { opacity: 0, transform: 'translateY(5px)' },
    { opacity: 1, transform: 'translateY(0)' }
  ], { duration: 140, easing: 'ease-out', fill: 'both' });
  activeTabAnimations.push(animation);
  element.style.opacity = '1';
  element.style.transform = 'none';
  try {
    await animation.finished;
  } catch (_) {
    // Cancelamento esperado quando o usuário alterna rapidamente.
  } finally {
    activeTabAnimations = activeTabAnimations.filter(item => item !== animation);
    animation.cancel();
    element.style.removeProperty('opacity');
    element.style.removeProperty('transform');
  }
}

/**
 * Alterna entre as abas de resultados (Tabela / Estatísticas / Comparação).
 * @param {'table'|'analytics'|'comparison'} tabId Identificador da aba
 */
export async function switchTab(tabId) {
  if (!dom.tabTable || !dom.tabAnalytics || !dom.paneTable || !dom.paneAnalytics || !dom.mainContent) return;
  if (!['table', 'analytics', 'comparison'].includes(tabId)) return;

  syncAdaptiveIntro();

  const currentTabId = getActiveTabId();
  const token = ++tabTransitionToken;
  cancelTabAnimations();

  if (currentTabId === tabId) {
    applyTabState(tabId);
    syncConsultationWithTab(tabId);
    await nextLayoutFrame();
    resizeVisibleCharts(tabId);
    dom.mainContent.removeAttribute('aria-busy');
    return;
  }

  if (prefersReducedMotion()) {
    applyTabState(tabId);
    syncConsultationWithTab(tabId);
    await nextLayoutFrame();
    resizeVisibleCharts(tabId);
    dom.mainContent.removeAttribute('aria-busy');
    return;
  }

  const modeChanges = isDashboardTab(currentTabId) !== isDashboardTab(tabId);
  const oldSidebarElement = isDashboardTab(currentTabId) ? dom.sidebarOpen : dom.consultationPanel;
  const newSidebarElement = isDashboardTab(tabId) ? dom.sidebarOpen : dom.consultationPanel;
  dom.mainContent.setAttribute('aria-busy', 'true');

  await Promise.all([
    animateTabOut(dom.mainContent, token),
    modeChanges
      ? playTabAnimation(oldSidebarElement, [
        { opacity: 1, transform: 'translateX(0)' },
        { opacity: 0, transform: 'translateX(-10px)' }
      ], { duration: 90, easing: 'ease-in' })
      : Promise.resolve()
  ]);

  if (token !== tabTransitionToken) return;
  if (modeChanges && newSidebarElement) newSidebarElement.style.opacity = '0';
  applyTabState(tabId);
  syncConsultationWithTab(tabId);
  await nextLayoutFrame();
  if (token !== tabTransitionToken) return;
  resizeVisibleCharts(tabId);

  const entranceAnimations = [animateTabIn(dom.mainContent)];
  if (modeChanges && newSidebarElement) {
    const sidebarAnimation = playTabAnimation(newSidebarElement, [
      { opacity: 0, transform: 'translateX(-8px)' },
      { opacity: 1, transform: 'translateX(0)' }
    ], { duration: 140, easing: 'ease-out' });
    newSidebarElement.style.removeProperty('opacity');
    entranceAnimations.push(sidebarAnimation);
  }
  await Promise.all(entranceAnimations);

  if (token === tabTransitionToken) dom.mainContent.removeAttribute('aria-busy');
}

/**
 * Alterna o formulário de entrada da barra lateral (Individual / Lote / Planilha / Currículo).
 * @param {'single'|'batch'|'upload'|'lattes'|'orcid'} type Tipo de input selecionado
 */
export function switchInputType(type) {
  if (!dom.selectorSingle || !dom.selectorBatch || !dom.selectorUpload || !dom.selectorLattes || !dom.selectorOrcid ||
    !dom.paneInputSingle || !dom.paneInputBatch || !dom.paneInputUpload || !dom.paneInputLattes || !dom.paneInputOrcid) return;

  // Resetar classes active
  [dom.selectorSingle, dom.selectorBatch, dom.selectorUpload, dom.selectorLattes, dom.selectorOrcid].forEach(s => {
    if (s) {
      s.classList.remove('active');
      s.setAttribute('aria-pressed', 'false');
    }
  });
  [dom.paneInputSingle, dom.paneInputBatch, dom.paneInputUpload, dom.paneInputLattes, dom.paneInputOrcid].forEach(p => {
    if (p) p.classList.remove('active');
  });

  // Ativar o correspondente
  const selectorMap = {
    single: [dom.selectorSingle, dom.paneInputSingle],
    batch: [dom.selectorBatch, dom.paneInputBatch],
    upload: [dom.selectorUpload, dom.paneInputUpload],
    lattes: [dom.selectorLattes, dom.paneInputLattes],
    orcid: [dom.selectorOrcid, dom.paneInputOrcid]
  };

  const [selector, pane] = selectorMap[type] || selectorMap.single;
  if (selector) {
    selector.classList.add('active');
    selector.setAttribute('aria-pressed', 'true');
  }
  if (pane) pane.classList.add('active');
}

// ─── LOADING OVERLAY ──────────────────────────────────────────────────────

/**
 * Desabilita ou reabilita todos os botões de submit.
 * @param {boolean} disabled
 */
function setSubmitButtonsDisabled(disabled) {
  [dom.btnSubmitSingle, dom.btnSubmitBatch, dom.btnSubmitLattes, dom.btnSubmitOrcid, dom.btnSubmitComparison].forEach(btn => {
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

  openManagedModal(dom.lattesPreviewModal, dom.btnConfirmLattes);

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
  closeManagedModal(dom.lattesPreviewModal);
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
    itemEl.setAttribute('role', 'button');
    itemEl.setAttribute('tabindex', '0');
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

    const classifySelected = async () => {
      closeSearchModal();
      showLoadingState('Analisando ISSN', 'Consultando APIs e aplicando regras de extratos CAPES...', 'search');
      const classified = await enrichAndClassify(item.issn);
      addClassifiedItem(classified);
      addRecentSearch(classified.issn, classified.title);
      renderResultsTable();
      dom.singleIssnInput.value = '';
      hideLoadingState();
      switchTab('table');
    };

    itemEl.addEventListener('click', classifySelected);
    itemEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        classifySelected();
      }
    });

    dom.searchResultsList.appendChild(itemEl);
  });

  if (dom.searchModal) {
    openManagedModal(dom.searchModal, dom.searchResultsList.querySelector('.search-result-item'));

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
  closeManagedModal(dom.searchModal);
}

// ─── MODAL DE COMPARAÇÃO ──────────────────────────────────────────

/**
 * Abre o modal de comparação de currículos.
 */
export function showComparisonModal() {
  if (dom.comparisonModal) {
    openManagedModal(dom.comparisonModal, dom.comparisonNameA);

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
  closeManagedModal(dom.comparisonModal);
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
    openManagedModal(dom.classificationInfoModal, dom.btnCloseClassificationInfo);

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
  closeManagedModal(dom.classificationInfoModal);
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
    ? '<i data-lucide="moon"></i> <span>Usar tema escuro</span>'
    : '<i data-lucide="sun"></i> <span>Usar tema claro</span>';
  dom.themeToggle.setAttribute('aria-label', isLight ? 'Usar tema escuro' : 'Usar tema claro');

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
 * Renderiza as consultas recentes dentro do formulário individual.
 * A seção permanece oculta enquanto não houver histórico real.
 */
export function renderRecentSearches() {
  const container = dom.recentSearchesList;
  if (!container) return;

  try {
    const saved = localStorage.getItem('qualis_recent_searches');
    const history = saved ? JSON.parse(saved) : [];

    if (history.length === 0) {
      container.innerHTML = '';
      if (dom.sidebarHistoryCard) dom.sidebarHistoryCard.hidden = true;
      return;
    }

    if (dom.sidebarHistoryCard) dom.sidebarHistoryCard.hidden = false;

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
    if (dom.sidebarHistoryCard) dom.sidebarHistoryCard.hidden = true;
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

  const currentPeriodStart = 2013 + Math.floor((currentYear - 2013) / 4) * 4;
  for (let start = currentPeriodStart; start >= 2013; start -= 4) {
    periods.push(`${start}-${start + 3}`);
  }

  // A opção "ALL" já está no HTML
  periods.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = `Quadriênio ${p}`;
    dom.filterYear.appendChild(opt);
  });
}
