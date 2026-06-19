/**
 * Módulo de Renderização da Tabela de Resultados.
 * Responsável por exibir, filtrar e formatar a tabela de periódicos classificados.
 */

import dom from './dom.js';
import appState from './state.js';
import { getFilteredItems } from './state.js';
import { escapeHTML } from './utils.js';
import { updateAnalytics } from './charts.js';

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
  const estrato = item.classification?.estrato || 'NC';
  const parts = [`Estrato ${estrato}`];
  if (typeof item.jcr === 'number') parts.push(`JCR ${item.jcr.toFixed(2)}`);
  if (typeof item.citeScore === 'number') parts.push(`CiteScore ${item.citeScore.toFixed(2)}`);
  const idxCount = Array.isArray(item.indexers) ? item.indexers.length : 0;
  if (idxCount > 0) parts.push(`${idxCount} indexador${idxCount > 1 ? 'es' : ''}`);
  if (item.metrics?.cuiden != null) parts.push(`CUIDEN ${item.metrics.cuiden.toFixed(2)}`);
  return `Relevância: ${parts.join(' · ')}`;
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

    // Sanitizar dados externos para prevenir XSS
    const safeTitle = escapeHTML(item.title);
    const safeIssn = escapeHTML(item.issn);
    const safeArea = escapeHTML(item.area);
    const safeEstrato = escapeHTML(item.classification.estrato);
    const safeJustification = escapeHTML(item.classification.justification);
    const relevanceTooltip = escapeHTML(formatRelevanceTooltip(item));
    const rankBadge = showRank
      ? `<span class="relevance-rank" data-tooltip="${relevanceTooltip}">#${index + 1}</span>`
      : '';

    const indexersTags = item.indexers.map(idx => {
      const safeIdx = escapeHTML(idx);
      const lowerIdx = idx.toLowerCase();
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
    const cuidenVal = (item.metrics && item.metrics.cuiden) ? item.metrics.cuiden : null;

    // Área como badge inline no título (antes era coluna separada)
    const areaBadge = `<span class="area-badge ${safeArea === 'Enfermagem' ? 'enfermagem' : 'outras'}">${safeArea}</span>`;

    row.innerHTML = `
      <td>
        <div class="table-title-cell" title="${safeTitle}">
          ${rankBadge}${safeTitle}
        </div>
        ${areaBadge}
      </td>
      <td style="font-family: monospace; font-size: 13px;">${safeIssn}</td>
      <td>${item.jcr !== null ? item.jcr.toFixed(2) : `
        <span class="metric-missing" data-tooltip="Métrica JCR não disponível para este periódico na base de dados.">
          - <i data-lucide="help-circle" class="help-icon" style="width: 12px; height: 12px;"></i>
        </span>
      `}</td>
      <td>${item.citeScore !== null ? item.citeScore.toFixed(2) : `
        <span class="metric-missing" data-tooltip="Métrica CiteScore não disponível para este periódico na base de dados.">
          - <i data-lucide="help-circle" class="help-icon" style="width: 12px; height: 12px;"></i>
        </span>
      `}</td>
      <td>
        <div style="max-width: 200px;">
          ${indexersTags || `
            <span class="metric-missing" data-tooltip="Nenhum indexador ativo registrado para este periódico na base.">
              - <i data-lucide="help-circle" class="help-icon" style="width: 12px; height: 12px;"></i>
            </span>
          `}
          ${cuidenVal !== null ? `<br><span class="indexer-tag cuiden">CUIDEN: ${cuidenVal.toFixed(2)}</span>` : ''}
        </div>
      </td>
      <td>
        <div class="estrato-badge-container" data-tooltip="${safeJustification}">
          <span class="estrato-badge ${safeEstrato}">
            ${safeEstrato}
          </span>
          <i data-lucide="info" class="info-icon"></i>
        </div>
      </td>
    `;

    dom.resultsTableBody.appendChild(row);
  });

  // Re-inicializa os ícones Lucide apenas na tabela dinâmica
  if (typeof lucide !== 'undefined') {
    lucide.createIcons({ node: dom.resultsTableBody });
  }
}
