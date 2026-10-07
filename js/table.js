/**
 * Módulo de Renderização da Tabela de Resultados.
 * Responsável por exibir, filtrar e formatar a tabela de periódicos classificados.
 */

import dom from './dom.js';
import appState from './state.js';
import { getFilteredItems, isTechnicalError, isProvisionalResult } from './state.js';
import { escapeHTML, getJournalTitle, cleanJournalTitle, getRevenfPid } from './utils.js';
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

/**
 * Retorna as informações de validação oficial para um indexador específico.
 * @param {string} rawIndexer Nome do indexador (ex: 'SCIELO', 'MEDLINE', etc.)
 * @param {string} issn ISSN do periódico (XXXX-XXXX)
 * @param {object} item Objeto completo do periódico
 * @returns {{ url: string|null, tooltip: string, label: string }}
 */
function getIndexerValidationInfo(rawIndexer, issn, item) {
  const upper = (rawIndexer || '').toUpperCase().trim();
  const safeIssn = encodeURIComponent(issn || '');
  const hasValidIssn = Boolean(issn && /^\d{4}-\d{3}[\dX]$/i.test(issn.trim()));

  if (upper === 'SCIELO') {
    const journalTitle = getJournalTitle(item);
    const dateStr = item?.scieloUpdatedAt ? ` (verificado em ${formatDate(item.scieloUpdatedAt)})` : '';
    
    // O motor de busca do SciELO (search.scielo.org) indexa revistas pelo campo ta:(TÍTULO)
    const queryStr = journalTitle ? `(ta:("${cleanJournalTitle(journalTitle)}"))` : (hasValidIssn ? issn : '');
    const url = queryStr
      ? `https://search.scielo.org/?q=${encodeURIComponent(queryStr)}&lang=pt`
      : (hasValidIssn
        ? `https://www.scielo.br/scielo.php?script=sci_serial&pid=${safeIssn}&lng=pt&nrm=iso`
        : 'https://search.scielo.org/');

    return {
      url,
      tooltip: `Indexado no SciELO${dateStr}. Clique para validar acervo na base oficial SciELO ↗`,
      label: 'SciELO'
    };
  }

  if (upper === 'MEDLINE') {
    return {
      url: hasValidIssn ? `https://www.ncbi.nlm.nih.gov/nlmcatalog/?term=${safeIssn}` : 'https://www.ncbi.nlm.nih.gov/nlmcatalog/',
      tooltip: 'Indexado no MEDLINE. Clique para validar no NLM Catalog (PubMed) ↗',
      label: 'MEDLINE'
    };
  }

  if (upper === 'LILACS') {
    const dateStr = item?.lilacsUpdatedAt ? ` (verificado em ${formatDate(item.lilacsUpdatedAt)})` : '';
    return {
      url: hasValidIssn ? `https://portal.revistas.bvs.br/pt/journals/?q=${safeIssn}` : 'https://portal.revistas.bvs.br/pt/journals/',
      tooltip: `Indexado no LILACS${dateStr}. Clique para validar no Portal de Revistas da BVS ↗`,
      label: 'LILACS'
    };
  }

  if (upper === 'BDENF') {
    const dateStr = item?.lilacsUpdatedAt ? ` (verificado em ${formatDate(item.lilacsUpdatedAt)})` : '';
    return {
      url: hasValidIssn ? `https://portal.revistas.bvs.br/pt/journals/?q=${safeIssn}` : 'https://portal.revistas.bvs.br/pt/journals/',
      tooltip: `Indexado na BDENF (Base de Dados em Enfermagem${dateStr}). Clique para validar no Portal de Revistas da BVS ↗`,
      label: 'BDENF'
    };
  }

  if (upper === 'REVENF') {
    const pid = getRevenfPid(issn);
    const hasValidPid = Boolean(pid && /^\d{4}-\d{3}[\dX]$/i.test(pid.trim()));
    return {
      url: hasValidPid
        ? `https://www.revenf.bvs.br/scielo.php?script=sci_serial&pid=${encodeURIComponent(pid)}&lng=pt&nrm=iso`
        : 'https://www.revenf.bvs.br/scielo.php?script=sci_alphabetic&lng=pt&nrm=iso',
      tooltip: 'Indexado no Portal de Revistas de Enfermagem (Rev@Enf / SciELO). Clique para validar na coleção oficial ↗',
      label: 'RevEnf'
    };
  }

  if (upper === 'SCOPUS') {
    return {
      url: hasValidIssn
        ? `https://www.scopus.com/sources.uri?sortField=citeScore&sortDirection=desc&searchTerms=${safeIssn}&searchType=issn`
        : 'https://www.scopus.com/sources.uri',
      tooltip: 'Indexado no Scopus. Clique para validar fontes e métricas no Scopus Preview (Elsevier) ↗',
      label: 'Scopus'
    };
  }

  if (upper === 'LATINDEX') {
    const dateStr = item?.latindexUpdatedAt ? ` (verificado em ${formatDate(item.latindexUpdatedAt)})` : '';
    return {
      url: hasValidIssn
        ? `https://latindex.org/latindex/bAvanzada/resultado?idMod=0&send=Buscar&issn=${safeIssn}`
        : 'https://latindex.org/',
      tooltip: `Indexado no Latindex (Catálogo 2.0 / Diretório${dateStr}). Clique para validar no Latindex ↗`,
      label: 'Latindex'
    };
  }

  if (upper === 'CUIDEN' || upper === 'RIC/CUIDEN') {
    return {
      url: 'https://fundacionindex.com/?page_id=1190',
      tooltip: 'Indexado no RIC/CUIDEN (Fundación Index). Clique para validar no último ranking publicado ↗',
      label: rawIndexer
    };
  }

  if (upper === 'CINAHL') {
    return {
      url: 'https://www.ebsco.com/products/research-databases/cinahl-database',
      tooltip: 'Indexado no CINAHL (EBSCO). Clique para consultar informações da base ↗',
      label: 'CINAHL'
    };
  }

  return {
    url: null,
    tooltip: `Indexador: ${rawIndexer}`,
    label: rawIndexer
  };
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
        <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 30px;">
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
      const info = getIndexerValidationInfo(idx, item.issn, item);
      
      if (info.url) {
        return `<a href="${escapeHTML(info.url)}" target="_blank" rel="noopener noreferrer" class="indexer-tag ${lowerIdx} indexer-link" data-tooltip="${escapeHTML(info.tooltip)}" aria-label="${escapeHTML(info.label)} - validação externa">${safeIdx} <i data-lucide="external-link" class="indexer-icon" aria-hidden="true"></i></a>`;
      }
      return `<span class="indexer-tag ${lowerIdx}" data-tooltip="${escapeHTML(info.tooltip)}">${safeIdx}</span>`;
    }).join('');

    const cuidenVal = (item.metrics && typeof item.metrics.cuiden === 'number') ? item.metrics.cuiden : null;
    const cuidenTag = cuidenVal !== null
      ? `<br><a href="https://fundacionindex.com/?page_id=1190" target="_blank" rel="noopener noreferrer" class="indexer-tag cuiden indexer-link" data-tooltip="Índice CUIDEN = ${cuidenVal.toFixed(2)}. Clique para validar no último ranking publicado (Fundación Index) ↗" aria-label="CUIDEN: ${cuidenVal.toFixed(2)} - validação externa">CUIDEN: ${cuidenVal.toFixed(2)} <i data-lucide="external-link" class="indexer-icon" aria-hidden="true"></i></a>`
      : '';

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
    const hasValidIssn = Boolean(item.issn && /^\d{4}-\d{3}[\dX]$/i.test(item.issn.trim()));

    const jcrCell = jcrValue !== null
      ? (hasValidIssn
          ? `<a href="https://mjl.clarivate.com/search-results?issn=${encodeURIComponent(item.issn)}" target="_blank" rel="noopener noreferrer" class="metric-link" data-tooltip="Fator de Impacto JCR = ${jcrValue}. Clique para validar na Clarivate Master Journal List (Web of Science) ↗" aria-label="JCR ${jcrValue} - validar na Master Journal List">${jcrValue} <i data-lucide="external-link" class="metric-icon" aria-hidden="true"></i></a>`
          : `<span class="metric-value">${jcrValue}</span>`)
      : `
        <span class="metric-missing" data-tooltip="Métrica JCR não disponível para este periódico na base de dados.">
          - <i data-lucide="help-circle" class="help-icon" style="width: 12px; height: 12px;"></i>
        </span>
      `;

    const citeScoreCell = citeScoreValue !== null
      ? (hasValidIssn
          ? `<a href="https://www.scopus.com/sources.uri?sortField=citeScore&sortDirection=desc&searchTerms=${encodeURIComponent(item.issn)}&searchType=issn" target="_blank" rel="noopener noreferrer" class="metric-link" data-tooltip="CiteScore = ${citeScoreValue}. Clique para validar no Scopus Preview (Elsevier) ↗" aria-label="CiteScore ${citeScoreValue} - validar no Scopus">${citeScoreValue} <i data-lucide="external-link" class="metric-icon" aria-hidden="true"></i></a>`
          : `<span class="metric-value">${citeScoreValue}</span>`)
      : `
        <span class="metric-missing" data-tooltip="Métrica CiteScore não disponível para este periódico na base de dados.">
          - <i data-lucide="help-circle" class="help-icon" style="width: 12px; height: 12px;"></i>
        </span>
      `;

    const safeYear = item.year ? escapeHTML(String(item.year)) : null;
    const yearCell = safeYear
      ? `<span class="year-badge" title="Ano de publicação: ${safeYear}">${safeYear}</span>`
      : `<span class="metric-missing" data-tooltip="Ano de publicação não informado">-</span>`;

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
      <td class="year-cell">${yearCell}</td>
      <td class="issn-cell">${safeIssn}</td>
      <td>${jcrCell}</td>
      <td>${citeScoreCell}</td>
      <td>
        <div class="indexers-cell">
          ${indexersTags || `
            <span class="metric-missing" data-tooltip="Nenhum indexador ativo registrado para este periódico na base.">
              - <i data-lucide="help-circle" class="help-icon" style="width: 12px; height: 12px;"></i>
            </span>
          `}
          ${cuidenTag}
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
      <td><div class="skeleton-bar year shimmer-effect"></div></td>
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
