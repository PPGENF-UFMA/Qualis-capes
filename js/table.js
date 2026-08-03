/**
 * Módulo de Renderização da Tabela de Resultados.
 * Responsável por exibir, filtrar e formatar a tabela de periódicos classificados.
 */

import dom from './dom.js';
import appState from './state.js';
import { getFilteredItems, isTechnicalError, isProvisionalResult } from './state.js';
import { escapeHTML } from './utils.js';
import { updateAnalytics } from './charts.js';

let lattesCandidatesModal = null;

/**
 * Formata uma data no formato YYYY-MM-DD para DD/MM/YYYY.
 * @param {string} dateStr String contendo a data
 * @returns {string} Data formatada ou string vazia
 */
function formatDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('T')[0].split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

function formatRelevanceTooltip(item) {
  if (isTechnicalError(item)) return 'Consulta não concluída por falha técnica';
  if (item.data_status === 'invalid') return 'ISSN inválido: corrija a entrada e tente novamente';
  if (isProvisionalResult(item)) return 'Resultado pendente: uma ou mais fontes estavam indisponíveis';
  const estrato = item.classification?.estrato || 'NC';
  const parts = [`Estrato ${estrato}`];
  if (typeof item.jcr === 'number') parts.push(`JCR ${item.jcr.toFixed(2)}`);
  if (typeof item.citeScore === 'number') parts.push(`CiteScore ${item.citeScore.toFixed(2)}`);
  const idxCount = Array.isArray(item.indexers) ? item.indexers.length : 0;
  if (idxCount > 0) parts.push(`${idxCount} indexador${idxCount > 1 ? 'es' : ''}`);
  if (item.metrics?.cuiden != null) parts.push(`CUIDEN ${item.metrics.cuiden.toFixed(2)}`);
  return `Relevância: ${parts.join(' · ')}`;
}

function formatClassificationTooltip(item, displayStatus) {
  const messages = [item.classification?.justification || 'Critério não informado.'];
  if (isTechnicalError(item)) {
    messages.push('Tente novamente em alguns instantes.');
  } else if (item.data_status === 'invalid') {
    messages.push('Informe um ISSN válido no formato XXXX-XXXX.');
  } else if (isProvisionalResult(item)) {
    messages.push('Resultado não incluído nos indicadores; tente novamente mais tarde.');
  } else if (displayStatus === 'NC') {
    messages.push('Confira o ISSN impresso/eletrônico ou pesquise pelo nome completo.');
  }
  if (item.data_status === 'partial' && !isProvisionalResult(item)) {
    messages.push('Classificação calculada com os dados disponíveis.');
  }
  return messages.join(' ');
}

/**
 * Renderiza a Tabela de Resultados com sanitização XSS.
 */
export function renderResultsTable() {
  const searchVal = dom.searchBox.value;
  const filterVal = dom.filterEstrato.value;
  const filterYearVal = dom.filterYear ? dom.filterYear.value : 'ALL';
  const sortVal = dom.sortBy ? dom.sortBy.value : 'relevance';
  const filtered = getFilteredItems(searchVal, filterVal, filterYearVal, sortVal);
  const showRank = sortVal === 'relevance' || sortVal === 'estrato';

  // Atualiza os KPIs e gráficos com base nos itens filtrados pelo ano selecionado
  const dashboardItems = getFilteredItems('', 'ALL', filterYearVal);
  updateAnalytics(dashboardItems);

  dom.resultsTableBody.innerHTML = '';

  if (appState.classifiedItems.length === 0) {
    dom.resultsContainer.style.display = 'none';
    return;
  }

  dom.resultsContainer.style.display = 'block';

  if (filtered.length === 0) {
    dom.resultsTableBody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 30px;">
          Nenhum artigo correspondente aos filtros aplicados.
        </td>
      </tr>
    `;
    return;
  }

  filtered.forEach((item, index) => {
    const row = document.createElement('tr');
    const technicalError = isTechnicalError(item);
    const provisional = isProvisionalResult(item);
    const invalid = item.data_status === 'invalid';
    row.className = `animated-row${technicalError ? ' row-technical-error' : provisional || invalid ? ' row-pending' : item.data_status === 'partial' ? ' row-partial' : ''}`;

    // Sanitizar dados externos para prevenir XSS
    const safeTitle = escapeHTML(item.title || 'Periódico sem título');
    const safeIssn = escapeHTML(item.issn || 'N/A');
    const safeArea = escapeHTML(item.area || 'Outras Áreas');
    const actualEstrato = item.classification?.estrato || 'NC';
    const displayStatus = technicalError ? 'ERRO' : invalid ? 'INVÁLIDO' : provisional ? 'PENDENTE' : actualEstrato;
    const badgeClass = technicalError ? 'ERRO' : invalid ? 'INVALIDO' : provisional ? 'PENDENTE' : escapeHTML(actualEstrato);
    const relevanceTooltip = escapeHTML(formatRelevanceTooltip(item));
    const rankBadge = showRank
      ? `<span class="relevance-rank" data-tooltip="${relevanceTooltip}">#${index + 1}</span>`
      : '';

    const indexersTags = (item.indexers || []).map(idx => {
      const safeIdx = escapeHTML(idx);
      const lowerIdx = idx.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      const upperIdx = idx.toUpperCase();
      
      let tooltipAttr = '';
      if (upperIdx === 'SCIELO' && item.scieloUpdatedAt) {
        tooltipAttr = ` data-tooltip="Dado obtido de SciELO em ${escapeHTML(formatDate(item.scieloUpdatedAt))}"`;
      } else if (upperIdx === 'LILACS' && item.lilacsUpdatedAt) {
        tooltipAttr = ` data-tooltip="Dado obtido de LILACS em ${escapeHTML(formatDate(item.lilacsUpdatedAt))}"`;
      } else if (upperIdx === 'BDENF' && item.lilacsUpdatedAt) {
        tooltipAttr = ` data-tooltip="Dado obtido de BDENF em ${escapeHTML(formatDate(item.lilacsUpdatedAt))}"`;
      } else if (upperIdx === 'LATINDEX' && item.latindexUpdatedAt) {
        tooltipAttr = ` data-tooltip="Dado obtido de Latindex em ${escapeHTML(formatDate(item.latindexUpdatedAt))}"`;
      }
      
      return `<span class="indexer-tag ${lowerIdx}"${tooltipAttr}>${safeIdx}</span>`;
    }).join('');
    const cuidenVal = (item.metrics && typeof item.metrics.cuiden === 'number') ? item.metrics.cuiden : null;

    // Área como badge inline no título (antes era coluna separada)
    const areaBadge = `<span class="area-badge ${safeArea === 'Enfermagem' ? 'enfermagem' : 'outras'}">${safeArea}</span>`;

    let titleWarning = '';
    let reviewButton = '';
    if (item.unmatchedLattes) {
      row.classList.add('row-pending');
      titleWarning = `<span class="table-row-warning warning">
        <i data-lucide="alert-triangle"></i> Não encontrado na base
      </span>`;
    } else if (item.confidence === 'review') {
      row.classList.add('row-review');
      titleWarning = `<span class="table-row-warning review">
        <i data-lucide="help-circle"></i> Correspondência aproximada — revise
      </span>`;
      if (item.lattesCandidates && item.lattesCandidates.length > 0) {
        reviewButton = `<button type="button" class="btn-details btn-review-candidates" data-candidates="${escapeHTML(JSON.stringify(item.lattesCandidates))}" data-item-key="${escapeHTML((item.issn || '') + '|' + (item.title || ''))}">Trocar revista</button>`;
      }
    }

    const classificationTooltip = escapeHTML(formatClassificationTooltip(item, displayStatus));
    const jcrValue = typeof item.jcr === 'number' ? item.jcr.toFixed(2) : null;
    const citeScoreValue = typeof item.citeScore === 'number' ? item.citeScore.toFixed(2) : null;

    row.innerHTML = `
      <td>
        <div class="table-title-cell" title="${safeTitle}">
          ${rankBadge}
          <div class="table-title-stack">
            <span>${safeTitle}</span>
            ${areaBadge}
            ${titleWarning}
            ${reviewButton}
          </div>
        </div>
      </td>
      <td class="issn-cell">${safeIssn}</td>
      <td>${jcrValue !== null ? jcrValue : `
        <span class="metric-missing" data-tooltip="Métrica JCR não disponível para este periódico na base de dados.">
          - <i data-lucide="help-circle" class="help-icon" style="width: 12px; height: 12px;"></i>
        </span>
      `}</td>
      <td>${citeScoreValue !== null ? citeScoreValue : `
        <span class="metric-missing" data-tooltip="Métrica CiteScore não disponível para este periódico na base de dados.">
          - <i data-lucide="help-circle" class="help-icon" style="width: 12px; height: 12px;"></i>
        </span>
      `}</td>
      <td>
        <div class="indexers-cell">
          ${indexersTags || `
            <span class="metric-missing" data-tooltip="Nenhum indexador ativo registrado para este periódico na base.">
              - <i data-lucide="help-circle" class="help-icon" style="width: 12px; height: 12px;"></i>
            </span>
          `}
          ${cuidenVal !== null ? `<br><span class="indexer-tag cuiden">CUIDEN: ${cuidenVal.toFixed(2)}</span>` : ''}
        </div>
      </td>
      <td>
        <div class="classification-cell">
          <div class="estrato-badge-container" data-tooltip="${classificationTooltip}" tabindex="0"
            aria-label="${escapeHTML(displayStatus)}. ${classificationTooltip}">
            <span class="estrato-badge ${badgeClass}">${escapeHTML(displayStatus)}</span>
            <i data-lucide="info" class="info-icon" aria-hidden="true"></i>
          </div>
          ${item.data_status === 'partial' && !provisional ? '<span class="partial-label">dados parciais</span>' : ''}
        </div>
      </td>
    `;

    dom.resultsTableBody.appendChild(row);

    const reviewCandidateButton = row.querySelector('.btn-review-candidates');
    if (reviewCandidateButton) {
      reviewCandidateButton.addEventListener('click', () => showLattesCandidatesModal(reviewCandidateButton));
    }
  });

  // Re-inicializa os ícones Lucide apenas na tabela dinâmica
  if (typeof lucide !== 'undefined') {
    lucide.createIcons({ node: dom.resultsTableBody });
  }
}

function showLattesCandidatesModal(btn) {
  const candidatesRaw = btn.getAttribute('data-candidates');
  const itemKeyRaw = btn.getAttribute('data-item-key');
  if (!candidatesRaw) return;

  let candidates = [];
  try { candidates = JSON.parse(candidatesRaw); } catch (_) { return; }

  // Constrói/reativa modal reusando o container de candidates-modal
  let modal = lattesCandidatesModal;
  if (!modal) {
    modal = document.createElement('div');
    lattesCandidatesModal = modal;
    modal.id = 'lattes-candidates-modal';
    modal.className = 'search-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'lattes-candidates-title');
    modal.innerHTML = `
      <div class="search-modal-card" style="max-width: 620px;">
        <div class="search-modal-header">
          <h2 id="lattes-candidates-title" class="search-modal-title">Confirmar revista correta</h2>
          <button id="btn-close-lattes-modal" class="btn-close-modal" aria-label="Fechar">&times;</button>
        </div>
        <p id="lattes-modal-subtitle" class="search-modal-subtitle" style="margin-bottom: 12px;"></p>
        <div style="max-height: 380px; overflow-y: auto;">
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="text-align: left; font-size: 12px; color: var(--text-muted);">
                <th style="padding: 6px;">ISSN</th>
                <th style="padding: 6px;">Título</th>
                <th style="padding: 6px;">Score</th>
                <th style="padding: 6px;"></th>
              </tr>
            </thead>
            <tbody id="lattes-modal-body"></tbody>
          </table>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const subtitle = modal.querySelector('#lattes-modal-subtitle');
  const tbody = modal.querySelector('#lattes-modal-body');
  subtitle.textContent = `Candidatos sugeridos para: ${itemKeyRaw || ''}`;
  tbody.innerHTML = '';

  candidates.forEach(c => {
    const tr = document.createElement('tr');
    tr.style.borderTop = '1px solid var(--border-color)';
    tr.innerHTML = `
      <td style="padding: 8px; font-family: monospace; font-size: 12px;">${escapeHTML(c.issn || '')}</td>
      <td style="padding: 8px; font-size: 13px;">${escapeHTML(c.title || '')}</td>
      <td style="padding: 8px; font-size: 12px; color: var(--text-muted);">${(c.score || 0).toFixed(3)}</td>
      <td style="padding: 8px; text-align: right;">
        <button class="btn-primary" style="font-size: 11px; padding: 5px 10px;"
          data-issn="${escapeHTML(c.issn || '')}"
          data-title="${escapeHTML(c.title || '')}">Selecionar</button>
      </td>
    `;
    tr.querySelector('button').addEventListener('click', () => {
      const newIssn = c.issn;
      const newTitle = c.title;
      // O orquestrador reclassifica e persiste o alias usando o nome cru do Lattes.
      window.dispatchEvent(new CustomEvent('lattes-reclassify', {
        detail: { oldIssn: itemKeyRaw ? itemKeyRaw.split('|')[0] : null, newIssn, newTitle }
      }));
      modal.classList.remove('active');
    });
    tbody.appendChild(tr);
  });

  modal.classList.add('active');
  const closeBtn = modal.querySelector('#btn-close-lattes-modal');
  if (closeBtn) closeBtn.onclick = () => modal.classList.remove('active');
  modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('active'); };
  if (closeBtn) closeBtn.focus();
}



/**
 * Exibe linhas esqueléticas (Skeleton Loader) na tabela de resultados.
 * @param {number} rowCount Quantidade de linhas de esqueleto a renderizar
 */
export function showTableSkeletons(rowCount = 3) {
  if (!dom.resultsTableBody) return;
  dom.resultsContainer.style.display = 'block';
  dom.resultsTableBody.innerHTML = '';
  
  for (let i = 0; i < rowCount; i++) {
    const row = document.createElement('tr');
    row.className = 'skeleton-row';
    row.innerHTML = `
      <td>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <div class="skeleton-bar title shimmer-effect"></div>
          <div class="skeleton-bar shimmer-effect" style="width: 80px; height: 14px;"></div>
        </div>
      </td>
      <td><div class="skeleton-bar issn shimmer-effect"></div></td>
      <td><div class="skeleton-bar metric shimmer-effect"></div></td>
      <td><div class="skeleton-bar metric shimmer-effect"></div></td>
      <td>
        <div style="display: flex; gap: 4px;">
          <div class="skeleton-bar shimmer-effect" style="width: 50px; height: 18px; border-radius: 4px;"></div>
          <div class="skeleton-bar shimmer-effect" style="width: 60px; height: 18px; border-radius: 4px;"></div>
        </div>
      </td>
      <td><div class="skeleton-bar badge shimmer-effect"></div></td>
    `;
    dom.resultsTableBody.appendChild(row);
  }
}
