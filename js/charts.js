/**
 * Módulo de Renderização de Gráficos (Chart.js) e Analítica de Dados.
 * Responsável pela consolidação de KPIs, geração de gráficos temporais/distribuição,
 * tabela de top periódicos e painel de insights estruturados.
 */

import dom from './dom.js';
import appState from './state.js';
import { isNonConclusiveResult } from './state.js';
import { escapeHTML } from './utils.js';

// Pesos internos usados exclusivamente no Índice de Perfil de Publicação (IPP).
const SCORE_WEIGHTS = { A1: 100, A2: 85, A3: 70, A4: 55, A5: 40, A6: 25, A7: 10, A8: 5, NC: 0 };

// ─── UTILITÁRIOS INTERNOS ──────────────────────────────────────────

/**
 * Determina se o tema atual é escuro.
 * @returns {boolean}
 */
function isDarkTheme() {
  return !document.body.classList.contains('light-theme');
}

/**
 * Retorna o estrato mais próximo de um score numérico.
 * @param {number} score Score numérico (0-100)
 * @returns {string} Estrato correspondente
 */
function getEstratoFromScore(score) {
  let best = 'NC';
  let minDiff = Infinity;
  Object.entries(SCORE_WEIGHTS).forEach(([estrato, weight]) => {
    const diff = Math.abs(weight - score);
    if (diff < minDiff) {
      minDiff = diff;
      best = estrato;
    }
  });
  return best;
}

/**
 * Mapeia o IPP 0-100 para faixas descritivas internas.
 * @param {number} score Score numérico (0-100)
 * @returns {{ note: number, label: string }}
 */
function mapScoreToProfileBand(score) {
  if (score >= 85) return { label: 'Perfil de impacto muito alto' };
  if (score >= 70) return { label: 'Perfil de impacto alto' };
  if (score >= 55) return { label: 'Perfil consistente' };
  if (score >= 40) return { label: 'Perfil em consolidação' };
  return { label: 'Perfil emergente' };
}

/**
 * Retorna as configurações de tema reutilizáveis para todos os gráficos.
 * Elimina a duplicação de configs de tooltip, legend e scales.
 * @returns {{ isDark: boolean, tooltip: Object, legendLabels: Object, gridColor: string, tickColor: string, tickFont: Object }}
 */
function getChartThemeConfig() {
  const isDark = isDarkTheme();
  return {
    isDark,
    borderColor: isDark ? '#111516' : '#fffdf9',
    tooltip: {
      backgroundColor: isDark ? '#202725' : '#fffdf9',
      titleColor: isDark ? '#f4f1ec' : '#202124',
      bodyColor: isDark ? '#beb7b2' : '#5e5558',
      borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0,0,0,0.1)',
      borderWidth: 1,
      padding: 10
    },
    legendLabels: {
      color: isDark ? '#f4f1ec' : '#202124',
      font: { family: 'Atkinson Hyperlegible', size: 12, weight: '700' }
    },
    gridColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)',
    tickColor: isDark ? '#beb7b2' : '#5e5558',
    tickPrimaryColor: isDark ? '#f4f1ec' : '#202124',
    tickFont: { family: 'Atkinson Hyperlegible', size: 11, weight: '700' }
  };
}

// ─── FUNÇÃO PRINCIPAL ──────────────────────────────────────────────

/**
 * Recalcula métricas (KPIs) e atualiza gráficos dinamicamente.
 */
export function updateAnalytics(items = appState.classifiedItems) {
  if (appState.classifiedItems.length === 0) {
    dom.emptyState.style.display = 'grid';
    dom.analyticsResults.style.display = 'none';
    destroyAllCharts();
    return;
  }

  dom.emptyState.style.display = 'none';
  dom.analyticsResults.style.display = 'block';

  const pendingCount = items.filter(isNonConclusiveResult).length;
  if (dom.kpiPendingCount) dom.kpiPendingCount.textContent = pendingCount;
  items = items.filter(item => !isNonConclusiveResult(item));

  if (items.length === 0) {
    // Zerar KPIs
    dom.kpiTotal.textContent = 0;
    dom.kpiQualifiedValue.textContent = 0;
    dom.kpiQualifiedSub.textContent = '0% do total (A1 + A2)';
    dom.kpiAvgScoreValue.textContent = '0 / 100';
    dom.kpiAvgScoreSub.textContent = 'IPP interno · sem itens concluídos';
    dom.kpiNcCount.textContent = 0;
    dom.kpiInternationalCoverage.textContent = '0%';
    if (dom.kpiAreaDistribution) {
      dom.kpiAreaDistribution.textContent = '0 artigos';
    }
    
    // Destruir gráficos pois não há dados
    destroyAllCharts();
    
    // Limpar periódicos e insights
    if (dom.topJournalsTableBody) dom.topJournalsTableBody.innerHTML = '';
    if (dom.curriculumInsightsList) {
      dom.curriculumInsightsList.innerHTML = `
        <div class="insight-item">
          <div class="insight-icon"><i data-lucide="info"></i></div>
          <p class="insight-text">${pendingCount > 0
            ? `${pendingCount} item(ns) ainda não foram concluídos e, por isso, não entraram nos indicadores.`
            : 'Nenhum artigo corresponde aos filtros de ano/quadriênio aplicados.'}</p>
        </div>
      `;
      if (typeof lucide !== 'undefined') {
        lucide.createIcons({ node: dom.curriculumInsightsList });
      }
    }
    return;
  }

  const total = items.length;
  dom.kpiTotal.textContent = total;

  // ─── KPIs ──────────────────────────────────────────────────────

  // Produção Qualificada (A1 + A2)
  const qualifiedCount = items.filter(item =>
    item.classification.estrato === 'A1' || item.classification.estrato === 'A2'
  ).length;
  const qualifiedPercent = total > 0 ? Math.round((qualifiedCount / total) * 100) : 0;
  dom.kpiQualifiedValue.textContent = qualifiedCount;
  dom.kpiQualifiedSub.textContent = `${qualifiedPercent}% do total (A1 + A2)`;

  // Índice de Perfil de Publicação (IPP) e estrato médio aproximado
  const totalScore = items.reduce((sum, item) => sum + (SCORE_WEIGHTS[item.classification.estrato] || 0), 0);
  const avgScore = total > 0 ? Math.round(totalScore / total) : 0;
  const avgEstrato = getEstratoFromScore(avgScore);
  const profileBand = mapScoreToProfileBand(avgScore);
  dom.kpiAvgScoreValue.textContent = `${avgScore} / 100`;
  dom.kpiAvgScoreSub.textContent = `${profileBand.label} · Estrato médio aproximado: ${avgEstrato}`;

  // Não Classificados (NC)
  const ncCount = items.filter(item => item.classification.estrato === 'NC').length;
  dom.kpiNcCount.textContent = ncCount;

  // Cobertura Internacional (Scopus + WoS + Medline)
  const internationalCount = items.filter(item => {
    const indexers = (item.indexers || []).map(idx => idx.toUpperCase());
    const hasJcr = item.jcr !== null && item.jcr > 0;
    return indexers.includes('MEDLINE') || indexers.includes('SCOPUS') || hasJcr;
  }).length;
  const internationalPercent = total > 0 ? Math.round((internationalCount / total) * 100) : 0;
  dom.kpiInternationalCoverage.textContent = `${internationalPercent}%`;

  // Distribuição por Área (Enfermagem vs Outras)
  const enfCount = items.filter(item => item.area === 'Enfermagem').length;
  const outrasCount = total - enfCount;
  if (dom.kpiAreaDistribution) {
    if (outrasCount === 0) {
      dom.kpiAreaDistribution.textContent = `100% Enfermagem`;
    } else {
      dom.kpiAreaDistribution.textContent = `${enfCount} Enfermagem · ${outrasCount} Outras Áreas`;
    }
  }

  // ─── DADOS PARA GRÁFICOS ─────────────────────────────────────

  const { qualisCounts, indexerCounts, yearAvgScores, yearEstratoCounts } = processChartData(items);

  // ─── RENDER ──────────────────────────────────────────────────
  renderQualisChart(qualisCounts);
  renderIndexersChart(indexerCounts);
  renderPublicationsYearChart(yearEstratoCounts);
  renderQualisEvolutionChart(yearAvgScores);
  renderTopJournals(items);
  renderCurriculumInsights(items, avgScore, avgEstrato, qualifiedPercent, internationalPercent, ncCount, pendingCount);
}

// ─── PROCESSAMENTO DE DADOS ────────────────────────────────────────

/**
 * Processa os dados de items para alimentar os gráficos.
 * @param {Object[]} items Lista de itens classificados
 * @returns {{ qualisCounts: Object, indexerCounts: Object, yearCounts: Object, yearAvgScores: Object }}
 */
function processChartData(items) {
  const qualisCounts = { A1: 0, A2: 0, A3: 0, A4: 0, A5: 0, A6: 0, A7: 0, A8: 0, NC: 0 };
  const indexerCounts = {
    'SciELO': 0, 'Medline': 0, 'Scopus': 0, 'JCR (WoS)': 0, 'Latindex': 0,
    'RIC/CUIDEN': 0, 'LILACS': 0, 'BDENF': 0, 'CINAHL': 0, 'RevEnf': 0
  };
  const yearCounts = {};
  const yearScores = {};
  const yearEstratoCounts = {};

  items.forEach(item => {
    // Qualis
    const estrato = item.classification.estrato || 'NC';
    qualisCounts[estrato] !== undefined ? qualisCounts[estrato]++ : qualisCounts.NC++;

    // Indexadores
    const indexers = (item.indexers || []).map(idx => idx.toUpperCase());
    if (indexers.includes('SCIELO')) indexerCounts['SciELO']++;
    if (indexers.includes('MEDLINE')) indexerCounts['Medline']++;
    if (indexers.includes('SCOPUS')) indexerCounts['Scopus']++;
    if (item.jcr !== null && item.jcr > 0) indexerCounts['JCR (WoS)']++;
    if (indexers.includes('LATINDEX')) indexerCounts['Latindex']++;
    if (indexers.includes('CUIDEN') || indexers.includes('RIC/CUIDEN') || indexers.includes('RIC')) indexerCounts['RIC/CUIDEN']++;
    if (indexers.includes('LILACS')) indexerCounts['LILACS']++;
    if (indexers.includes('BDENF')) indexerCounts['BDENF']++;
    if (indexers.includes('CINAHL')) indexerCounts['CINAHL']++;
    if (indexers.includes('REVENF')) indexerCounts['RevEnf']++;

    // Agrupamento por ano
    if (item.year) {
      const yr = item.year;
      const score = SCORE_WEIGHTS[estrato] || 0;
      yearCounts[yr] = (yearCounts[yr] || 0) + 1;
      yearScores[yr] = (yearScores[yr] || 0) + score;

      if (!yearEstratoCounts[yr]) {
        yearEstratoCounts[yr] = { A1: 0, A2: 0, A3: 0, A4: 0, A5: 0, A6: 0, A7: 0, A8: 0, NC: 0 };
      }
      if (yearEstratoCounts[yr][estrato] !== undefined) {
        yearEstratoCounts[yr][estrato]++;
      } else {
        yearEstratoCounts[yr].NC++;
      }
    }
  });

  // Score médio por ano (reutiliza yearCounts em vez de variável separada)
  const yearAvgScores = {};
  Object.keys(yearScores).forEach(yr => {
    yearAvgScores[yr] = Math.round(yearScores[yr] / yearCounts[yr]);
  });

  return { qualisCounts, indexerCounts, yearCounts, yearAvgScores, yearEstratoCounts };
}

// ─── LIFECYCLE ─────────────────────────────────────────────────────

/** Destrói todas as instâncias de gráficos ativas. */
function destroyAllCharts() {
  Object.keys(appState.charts).forEach(key => {
    if (appState.charts[key]) {
      appState.charts[key].destroy();
      appState.charts[key] = null;
    }
  });
}

/**
 * Destrói e recria um gráfico de forma segura.
 * @param {string} chartKey Chave em appState.charts
 * @param {HTMLCanvasElement} canvas Elemento canvas
 * @returns {CanvasRenderingContext2D|null} Contexto 2D ou null se inválido
 */
function prepareChart(chartKey, canvas) {
  if (!canvas) return null;
  if (appState.charts[chartKey]) {
    appState.charts[chartKey].destroy();
  }
  return canvas.getContext('2d');
}

// ─── RENDERIZAÇÃO DE GRÁFICOS ──────────────────────────────────────

/** Renderiza o gráfico Donut de distribuição de Qualis. */
function renderQualisChart(counts) {
  const ctx = prepareChart('qualis', dom.qualisChart);
  if (!ctx) return;

  const theme = getChartThemeConfig();
  const colorMapping = {
    A1: '#12584b', A2: '#176b5b', A3: '#2e725f', A4: '#4f685c',
    A5: '#765b50', A6: '#8b4b45', A7: '#913247', A8: '#7a1538', NC: '#5f6261'
  };

  const labels = [];
  const data = [];
  const colors = [];

  Object.entries(counts).forEach(([key, val]) => {
    if (val > 0) {
      labels.push(`Qualis ${key}`);
      data.push(val);
      colors.push(colorMapping[key]);
    }
  });

  if (data.length === 0) return;

  appState.charts.qualis = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderWidth: theme.isDark ? 2 : 1,
        borderColor: theme.borderColor
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: theme.legendLabels },
        tooltip: {
          ...theme.tooltip,
          callbacks: {
            label: function (context) {
              const val = context.raw;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percent = Math.round((val / total) * 100);
              return ` ${context.label}: ${val} (${percent}%)`;
            }
          }
        }
      },
      cutout: '65%'
    }
  });
}

/** Renderiza o gráfico de barras horizontais de indexadores. */
function renderIndexersChart(counts) {
  const ctx = prepareChart('indexers', dom.indexersChart);
  if (!ctx) return;

  const theme = getChartThemeConfig();
  const indexerColors = {
    'SciELO': { bg: 'rgba(145, 50, 71, 0.88)', hover: '#913247' },
    'Medline': { bg: 'rgba(76, 111, 101, 0.88)', hover: '#4c6f65' },
    'Scopus': { bg: 'rgba(197, 139, 42, 0.88)', hover: '#c58b2a' },
    'JCR (WoS)': { bg: 'rgba(122, 21, 56, 0.88)', hover: '#7a1538' },
    'Latindex': { bg: 'rgba(23, 107, 91, 0.88)', hover: '#176b5b' },
    'RIC/CUIDEN': { bg: 'rgba(118, 91, 80, 0.88)', hover: '#765b50' },
    'LILACS': { bg: 'rgba(111, 195, 174, 0.88)', hover: '#6fc3ae' },
    'BDENF': { bg: 'rgba(46, 114, 95, 0.88)', hover: '#2e725f' },
    'CINAHL': { bg: 'rgba(139, 75, 69, 0.88)', hover: '#8b4b45' },
    'RevEnf': { bg: 'rgba(95, 98, 97, 0.88)', hover: '#5f6261' }
  };

  const labels = [];
  const data = [];
  const backgroundColors = [];
  const hoverBackgroundColors = [];

  Object.entries(counts).forEach(([key, val]) => {
    if (val > 0) {
      labels.push(key);
      data.push(val);
      const color = indexerColors[key] || { bg: 'rgba(99, 102, 241, 0.75)', hover: '#6366f1' };
      backgroundColors.push(color.bg);
      hoverBackgroundColors.push(color.hover);
    }
  });

  if (data.length === 0) return;

  appState.charts.indexers = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Periódicos',
        data,
        backgroundColor: backgroundColors,
        hoverBackgroundColor: hoverBackgroundColors,
        borderRadius: 6,
        borderWidth: 0
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: theme.tooltip
      },
      scales: {
        x: {
          grid: { color: theme.gridColor },
          ticks: { color: theme.tickColor, stepSize: 1, precision: 0 }
        },
        y: {
          grid: { display: false },
          ticks: { color: theme.tickPrimaryColor, font: theme.tickFont }
        }
      }
    }
  });
}

/** Renderiza o gráfico de volume de produção por ano. */
function renderPublicationsYearChart(yearEstratoCounts) {
  const ctx = prepareChart('publicationsYear', dom.publicationsYearChart);
  if (!ctx) return;

  const sortedYears = Object.keys(yearEstratoCounts).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  if (sortedYears.length === 0) return;

  const theme = getChartThemeConfig();
  const colorMapping = {
    A1: '#12584b', A2: '#176b5b', A3: '#2e725f', A4: '#4f685c',
    A5: '#765b50', A6: '#8b4b45', A7: '#913247', A8: '#7a1538', NC: '#5f6261'
  };

  const datasets = [];
  // Stacked order: NC at the bottom, A1 at the top
  const estratos = ['NC', 'A8', 'A7', 'A6', 'A5', 'A4', 'A3', 'A2', 'A1'];
  
  estratos.forEach(estrato => {
    const estratoData = sortedYears.map(yr => yearEstratoCounts[yr][estrato] || 0);
    const hasData = estratoData.some(val => val > 0);
    if (hasData) {
      datasets.push({
        label: `Qualis ${estrato}`,
        data: estratoData,
        backgroundColor: colorMapping[estrato],
        hoverBackgroundColor: colorMapping[estrato],
        borderRadius: 0,
        borderWidth: 0
      });
    }
  });

  appState.charts.publicationsYear = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sortedYears,
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: theme.legendLabels
        },
        tooltip: theme.tooltip
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { color: theme.tickPrimaryColor, font: theme.tickFont }
        },
        y: {
          stacked: true,
          grid: { color: theme.gridColor },
          ticks: { color: theme.tickColor, stepSize: 1, precision: 0 }
        }
      }
    }
  });
}

/** Renderiza o gráfico de linha da evolução da qualidade (Score). */
function renderQualisEvolutionChart(scores) {
  const ctx = prepareChart('qualisEvolution', dom.qualisEvolutionChart);
  if (!ctx) return;

  const sortedYears = Object.keys(scores).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const data = sortedYears.map(yr => scores[yr]);
  if (sortedYears.length === 0) return;

  const theme = getChartThemeConfig();

  // Plugin inline customizado para desenhar as faixas de qualidade e limites
  const scoreBandsPlugin = {
    id: 'scoreBands',
    beforeDraw(chart) {
      const { ctx, chartArea: { left, right, top, bottom }, scales: { y } } = chart;
      ctx.save();
      
      const y100 = y.getPixelForValue(100);
      const y85 = y.getPixelForValue(85);
      const y55 = y.getPixelForValue(55);
      const y0 = y.getPixelForValue(0);

      const isDark = !document.body.classList.contains('light-theme');
      
      // Cores semitransparentes por faixa interna do IPP
      const colorExcellent = isDark ? 'rgba(16, 185, 129, 0.08)' : 'rgba(16, 185, 129, 0.05)';
      const colorRegular = isDark ? 'rgba(59, 130, 246, 0.05)' : 'rgba(59, 130, 246, 0.03)';
      const colorAttention = isDark ? 'rgba(239, 68, 68, 0.08)' : 'rgba(239, 68, 68, 0.05)';
      
      // Preenche os retângulos de fundo
      // Impacto muito alto (85 a 100)
      ctx.fillStyle = colorExcellent;
      ctx.fillRect(left, y100, right - left, y85 - y100);
      
      // Perfil consistente/alto (55 a 85)
      ctx.fillStyle = colorRegular;
      ctx.fillRect(left, y85, right - left, y55 - y85);
      
      // Perfil emergente/em consolidação (0 a 55)
      ctx.fillStyle = colorAttention;
      ctx.fillRect(left, y55, right - left, y0 - y55);

      // Limites pontilhados das faixas
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.15)';
      
      // Limite superior (85)
      ctx.beginPath();
      ctx.moveTo(left, y85);
      ctx.lineTo(right, y85);
      ctx.stroke();
      
      // Limite intermediário (55)
      ctx.beginPath();
      ctx.moveTo(left, y55);
      ctx.lineTo(right, y55);
      ctx.stroke();

      // Rótulos de texto
      ctx.setLineDash([]);
      ctx.font = '700 10px Atkinson Hyperlegible, sans-serif';
      ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.4)' : 'rgba(0, 0, 0, 0.4)';
      ctx.textAlign = 'right';
      
      const textX = right - 10;
      
      ctx.fillText('Impacto muito alto (≥85)', textX, y85 - 6);
      ctx.fillText('Perfil consistente (≥55)', textX, y55 - 6);
      
      ctx.restore();
    }
  };

  const chartGradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.clientHeight || 200);
  chartGradient.addColorStop(0, 'rgba(122, 21, 56, 0.28)');
  chartGradient.addColorStop(1, 'rgba(122, 21, 56, 0.01)');

  appState.charts.qualisEvolution = new Chart(ctx, {
    type: 'line',
    data: {
      labels: sortedYears,
      datasets: [{
        label: 'IPP médio',
        data,
        borderColor: '#7a1538',
        backgroundColor: chartGradient,
        borderWidth: 3,
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#7a1538',
        pointBorderColor: theme.borderColor,
        pointBorderWidth: 2,
        pointRadius: 6,
        pointHoverRadius: 8
      }]
    },
    plugins: [scoreBandsPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...theme.tooltip,
          callbacks: {
            label: function(context) {
              const val = context.raw;
              const profile = mapScoreToProfileBand(val);
              return ` IPP ${val}/100 · ${profile.label} · Estrato médio aproximado: ${getEstratoFromScore(val)}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: theme.tickPrimaryColor, font: theme.tickFont }
        },
        y: {
          grid: { color: theme.gridColor },
          ticks: { color: theme.tickColor },
          min: 0,
          max: 100
        }
      }
    }
  });
}

// ─── COMPONENTES TEXTUAIS ──────────────────────────────────────────

/** Renderiza a tabela dos top periódicos mais publicados. */
function renderTopJournals(items) {
  const tableBody = dom.topJournalsTableBody;
  if (!tableBody) return;

  const counts = {};
  items.forEach(item => {
    const journalName = item.journal || item.title;
    let cleanJournalName = journalName;
    if (journalName.includes('(') && journalName.endsWith(')')) {
      const parts = journalName.split('(');
      cleanJournalName = parts[parts.length - 1].replace(')', '').trim();
    }
    counts[cleanJournalName] = (counts[cleanJournalName] || 0) + 1;
  });

  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  tableBody.innerHTML = sorted.map(([journal, qty]) => {
    const safeJournal = escapeHTML(journal);
    const safeQty = escapeHTML(qty);
    return `
    <tr>
      <td class="top-journal-name" title="${safeJournal}">${safeJournal}</td>
      <td class="top-journal-count">${safeQty}</td>
    </tr>
  `;
  }).join('');
}

/** Renderiza a lista de insights do currículo baseado em regras heurísticas. */
function renderCurriculumInsights(items, avgScore, avgEstrato, qualifiedPercent, internationalPercent, ncCount, pendingCount) {
  const container = dom.curriculumInsightsList;
  if (!container) return;

  const insights = [];

  // Insight 1: Produção Qualificada
  if (qualifiedPercent >= 50) {
    insights.push({ icon: 'award', text: `<strong>Forte Produção Qualificada:</strong> ${qualifiedPercent}% dos artigos estão nos estratos de excelência <strong>A1 e A2</strong>.` });
  } else if (qualifiedPercent > 0) {
    insights.push({ icon: 'info', text: `<strong>Perfil de Publicações:</strong> ${qualifiedPercent}% da produção está classificada em <strong>A1 ou A2</strong>.` });
  } else {
    insights.push({ icon: 'alert-triangle', text: `<strong>Atenção à Qualidade:</strong> Nenhuma publicação identificada nos estratos mais altos (A1 ou A2) do Qualis.` });
  }

  // Insight 2: Cobertura Internacional
  if (internationalPercent >= 60) {
    insights.push({ icon: 'globe', text: `<strong>Alta Visibilidade Internacional:</strong> ${internationalPercent}% dos artigos estão indexados em bases globais (Scopus, WoS ou Medline).` });
  } else if (internationalPercent >= 30) {
    insights.push({ icon: 'info', text: `<strong>Inserção Internacional:</strong> ${internationalPercent}% dos periódicos possuem indexação em bases internacionais de referência.` });
  } else {
    insights.push({ icon: 'trending-down', text: `<strong>Baixa Inserção Global:</strong> Apenas ${internationalPercent}% dos artigos têm indexação internacional relevante.` });
  }

  // Insight 3: Não Classificados
  if (ncCount > 0) {
    insights.push({ icon: 'help-circle', text: `<strong>Pendências de Classificação:</strong> Há <strong>${ncCount} periódico(s) não classificado(s) (NC)</strong>. Verifique possíveis abreviações no Lattes.` });
  } else {
    insights.push({ icon: 'check-circle-2', text: `<strong>Dados Coerentes:</strong> 100% dos periódicos analisados estão classificados no Qualis CAPES.` });
  }

  // Insight 4: índice interno, sem equivalência com notas oficiais da CAPES.
  const profileBand = mapScoreToProfileBand(avgScore);
  insights.push({
    icon: 'activity',
    text: `<strong>Índice de Perfil de Publicação (IPP):</strong> <strong>${avgScore}/100</strong> · ${profileBand.label} · Estrato médio aproximado: <strong>${avgEstrato}</strong>. É um indicador interno de apoio à leitura do conjunto, sem equivalência com nota oficial da CAPES.`
  });

  if (pendingCount > 0) {
    insights.push({
      icon: 'cloud-alert',
      text: `<strong>Consultas pendentes:</strong> <strong>${pendingCount} item(ns)</strong> não entraram nos indicadores porque dependem de uma nova tentativa ou tiveram fontes externas indisponíveis.`
    });
  }

  // Insight 5: Concentração excessiva em um único periódico (mais de 30% das publicações)
  const journalCounts = {};
  items.forEach(item => {
    const journalName = item.journal || item.title || 'Desconhecido';
    let cleanJournalName = journalName;
    if (journalName.includes('(') && journalName.endsWith(')')) {
      const parts = journalName.split('(');
      cleanJournalName = parts[parts.length - 1].replace(')', '').trim();
    }
    journalCounts[cleanJournalName] = (journalCounts[cleanJournalName] || 0) + 1;
  });

  const totalItems = items.length;
  let maxJournal = '';
  let maxCount = 0;
  Object.entries(journalCounts).forEach(([journal, count]) => {
    if (count > maxCount) {
      maxCount = count;
      maxJournal = journal;
    }
  });

  const concentrationPercent = totalItems > 0 ? Math.round((maxCount / totalItems) * 100) : 0;
  if (concentrationPercent > 30 && totalItems >= 3) {
    insights.push({
      icon: 'alert-circle',
      text: `<strong>Alta Concentração:</strong> ${concentrationPercent}% das publicações estão concentradas no periódico <strong>${escapeHTML(maxJournal)}</strong> (máx. recomendado: 30%). Recomenda-se diversificar os canais para fortalecer o currículo frente aos critérios CAPES.`
    });
  }

  // Insight 6: Potencial de upgrade de artigos A4/A5 para MEDLINE/SciELO
  const upgradeableItems = items.filter(item => {
    const estrato = item.classification.estrato;
    return ['A4', 'A5', 'A6', 'A7', 'A8'].includes(estrato);
  });

  if (upgradeableItems.length > 0) {
    insights.push({
      icon: 'sparkles',
      text: `<strong>Oportunidade de Upgrade:</strong> Há <strong>${upgradeableItems.length} artigos</strong> classificados entre A4 e A8. Priorizar submissões em periódicos indexados na <strong>SciELO</strong> ou <strong>MEDLINE</strong> pode elevar a classificação de trabalhos futuros para estratos mais altos (mínimo A4 e A3).`
    });
  }

  container.innerHTML = insights.map(ins => `
    <div class="insight-item">
      <div class="insight-icon">
        <i data-lucide="${ins.icon}"></i>
      </div>
      <p class="insight-text">${ins.text}</p>
    </div>
  `).join('');

  if (typeof lucide !== 'undefined') {
    lucide.createIcons({ node: container });
  }
}
