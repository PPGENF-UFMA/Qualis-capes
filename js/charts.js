/**
 * Módulo de Renderização de Gráficos (Chart.js) e Analítica de Dados.
 * Responsável pela consolidação de KPIs, geração de gráficos temporais/distribuição,
 * tabela de top periódicos e painel de insights estruturados.
 */

import dom from './dom.js';
import appState from './state.js';

// Pesos de Score CAPES recomendados
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
 * Retorna as configurações de tema reutilizáveis para todos os gráficos.
 * Elimina a duplicação de configs de tooltip, legend e scales.
 * @returns {{ isDark: boolean, tooltip: Object, legendLabels: Object, gridColor: string, tickColor: string, tickFont: Object }}
 */
function getChartThemeConfig() {
  const isDark = isDarkTheme();
  return {
    isDark,
    borderColor: isDark ? '#0b0f19' : '#ffffff',
    tooltip: {
      backgroundColor: isDark ? '#111827' : '#ffffff',
      titleColor: isDark ? '#f3f4f6' : '#0f172a',
      bodyColor: isDark ? '#9ca3af' : '#475569',
      borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0,0,0,0.1)',
      borderWidth: 1,
      padding: 10
    },
    legendLabels: {
      color: isDark ? '#f3f4f6' : '#0f172a',
      font: { family: 'Outfit', size: 12, weight: '500' }
    },
    gridColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)',
    tickColor: isDark ? '#9ca3af' : '#475569',
    tickPrimaryColor: isDark ? '#f3f4f6' : '#0f172a',
    tickFont: { family: 'Outfit', size: 11, weight: '500' }
  };
}

// ─── FUNÇÃO PRINCIPAL ──────────────────────────────────────────────

/**
 * Recalcula métricas (KPIs) e atualiza gráficos dinamicamente.
 */
export function updateAnalytics() {
  const items = appState.classifiedItems;

  if (items.length === 0) {
    dom.emptyState.style.display = 'flex';
    dom.analyticsResults.style.display = 'none';
    destroyAllCharts();
    return;
  }

  dom.emptyState.style.display = 'none';
  dom.analyticsResults.style.display = 'block';

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

  // Score CAPES Médio e Estrato Médio
  const totalScore = items.reduce((sum, item) => sum + (SCORE_WEIGHTS[item.classification.estrato] || 0), 0);
  const avgScore = total > 0 ? Math.round(totalScore / total) : 0;
  const avgEstrato = getEstratoFromScore(avgScore);
  dom.kpiAvgScoreValue.textContent = `${avgScore} / 100`;
  dom.kpiAvgScoreSub.textContent = `Estrato Médio: ${avgEstrato}`;

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

  const { qualisCounts, indexerCounts, yearCounts, yearAvgScores } = processChartData(items);

  // ─── RENDER ──────────────────────────────────────────────────
  renderQualisChart(qualisCounts);
  renderIndexersChart(indexerCounts);
  renderPublicationsYearChart(yearCounts);
  renderQualisEvolutionChart(yearAvgScores);
  renderTopJournals(items);
  renderCurriculumInsights(items, avgScore, avgEstrato, qualifiedPercent, internationalPercent, ncCount);
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

  items.forEach(item => {
    // Qualis
    const estrato = item.classification.estrato;
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
    }
  });

  // Score médio por ano (reutiliza yearCounts em vez de variável separada)
  const yearAvgScores = {};
  Object.keys(yearScores).forEach(yr => {
    yearAvgScores[yr] = Math.round(yearScores[yr] / yearCounts[yr]);
  });

  return { qualisCounts, indexerCounts, yearCounts, yearAvgScores };
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
    A1: '#f59e0b', A2: '#94a3b8', A3: '#b7791f', A4: '#db2777',
    A5: '#1d4ed8', A6: '#0891b2', A7: '#0f766e', A8: '#047857', NC: '#4b5563'
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
    'SciELO': { bg: 'rgba(249, 115, 22, 0.85)', hover: '#fb7185' },
    'Medline': { bg: 'rgba(59, 130, 246, 0.85)', hover: '#3b82f6' },
    'Scopus': { bg: 'rgba(245, 158, 11, 0.85)', hover: '#f59e0b' },
    'JCR (WoS)': { bg: 'rgba(168, 85, 247, 0.85)', hover: '#a855f7' },
    'Latindex': { bg: 'rgba(16, 185, 129, 0.85)', hover: '#10b981' },
    'RIC/CUIDEN': { bg: 'rgba(99, 102, 241, 0.85)', hover: '#6366f1' },
    'LILACS': { bg: 'rgba(6, 182, 212, 0.85)', hover: '#06b6d4' },
    'BDENF': { bg: 'rgba(20, 184, 166, 0.85)', hover: '#14b8a6' },
    'CINAHL': { bg: 'rgba(79, 70, 229, 0.85)', hover: '#4f46e5' },
    'RevEnf': { bg: 'rgba(107, 114, 128, 0.85)', hover: '#6b7280' }
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
function renderPublicationsYearChart(counts) {
  const ctx = prepareChart('publicationsYear', dom.publicationsYearChart);
  if (!ctx) return;

  const sortedYears = Object.keys(counts).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const data = sortedYears.map(yr => counts[yr]);
  if (sortedYears.length === 0) return;

  const theme = getChartThemeConfig();

  appState.charts.publicationsYear = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sortedYears,
      datasets: [{
        label: 'Artigos Publicados',
        data,
        backgroundColor: 'rgba(99, 102, 241, 0.85)',
        hoverBackgroundColor: '#6366f1',
        borderRadius: 6,
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: theme.tooltip
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: theme.tickPrimaryColor, font: theme.tickFont }
        },
        y: {
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

  appState.charts.qualisEvolution = new Chart(ctx, {
    type: 'line',
    data: {
      labels: sortedYears,
      datasets: [{
        label: 'Score Qualis Médio',
        data,
        borderColor: '#a855f7',
        backgroundColor: 'rgba(168, 85, 247, 0.1)',
        borderWidth: 3,
        fill: true,
        tension: 0.3,
        pointBackgroundColor: '#a855f7',
        pointBorderColor: theme.borderColor,
        pointBorderWidth: 2,
        pointRadius: 6,
        pointHoverRadius: 8
      }]
    },
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
              return ` Score: ${val}/100 (Médio: Qualis ${getEstratoFromScore(val)})`;
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

  tableBody.innerHTML = sorted.map(([journal, qty]) => `
    <tr>
      <td class="top-journal-name" title="${journal}">${journal}</td>
      <td class="top-journal-count">${qty}</td>
    </tr>
  `).join('');
}

/** Renderiza a lista de insights do currículo baseado em regras heurísticas. */
function renderCurriculumInsights(items, avgScore, avgEstrato, qualifiedPercent, internationalPercent, ncCount) {
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

  // Insight 4: Avaliação do Score
  let scoreText = '';
  if (avgScore >= 75) scoreText = 'Perfil com altíssimo impacto científico (Excelente).';
  else if (avgScore >= 55) scoreText = 'Produção qualificada e consistente (Forte).';
  else if (avgScore >= 30) scoreText = 'Produção em desenvolvimento científico (Regular).';
  else scoreText = 'Baixo impacto relativo nas bases CAPES.';

  insights.push({
    icon: 'activity',
    text: `<strong>Score do Currículo:</strong> Nota <strong>${avgScore}/100</strong> (Estrato Médio equivalente a <strong>${avgEstrato}</strong>). ${scoreText}`
  });

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
