/**
 * Módulo de Comparação de Currículos.
 * Renderiza KPIs comparativos, radar chart e distribuição por estrato lado a lado.
 */

import dom from './dom.js';
import appState from './state.js';

const SCORE_WEIGHTS = { A1: 100, A2: 85, A3: 70, A4: 55, A5: 40, A6: 25, A7: 10, A8: 5, NC: 0 };
const PROFILE_COLORS = {
  a: { fill: 'rgba(99, 102, 241, 0.2)', stroke: '#6366f1', bg: 'rgba(99, 102, 241, 0.7)' },
  b: { fill: 'rgba(245, 158, 11, 0.2)', stroke: '#f59e0b', bg: 'rgba(245, 158, 11, 0.7)' }
};

// ─── COMPUTAÇÃO DE KPIs ──────────────────────────────────────────

function computeProfileMetrics(items) {
  const total = items.length;
  if (total === 0) return { total: 0, a1a2: 0, a1a2Pct: 0, avgScore: 0, internationalPct: 0, enfPct: 0, ncCount: 0 };

  const a1a2 = items.filter(i => i.classification.estrato === 'A1' || i.classification.estrato === 'A2').length;
  const totalScore = items.reduce((sum, i) => sum + (SCORE_WEIGHTS[i.classification.estrato] || 0), 0);
  const avgScore = Math.round(totalScore / total);
  const international = items.filter(i => {
    const idx = (i.indexers || []).map(x => x.toUpperCase());
    return idx.includes('MEDLINE') || idx.includes('SCOPUS') || (i.jcr !== null && i.jcr > 0);
  }).length;
  const enf = items.filter(i => i.area === 'Enfermagem').length;
  const nc = items.filter(i => i.classification.estrato === 'NC').length;

  return {
    total,
    a1a2,
    a1a2Pct: Math.round((a1a2 / total) * 100),
    avgScore,
    internationalPct: Math.round((international / total) * 100),
    enfPct: Math.round((enf / total) * 100),
    ncCount: nc
  };
}

// ─── FUNÇÃO PRINCIPAL ─────────────────────────────────────────────

export function updateComparisonDashboard(profiles) {
  if (!profiles || profiles.length < 2) return;

  // Mostrar aba de comparação
  if (dom.tabComparison) dom.tabComparison.style.display = 'flex';

  renderComparisonKPIs(profiles);
  renderRadarChart(profiles);
  renderComparisonEstratoChart(profiles);
}

// ─── TABELA DE KPIs COMPARATIVOS ──────────────────────────────────

function renderComparisonKPIs(profiles) {
  const tbody = dom.comparisonKpisBody;
  if (!tbody) return;

  const mA = computeProfileMetrics(profiles[0].items);
  const mB = computeProfileMetrics(profiles[1].items);

  const colsA = dom.comparisonKpisBody?.closest('table')?.querySelector('.profile-a-header');
  const colsB = dom.comparisonKpisBody?.closest('table')?.querySelector('.profile-b-header');
  if (colsA) colsA.textContent = profiles[0].name || 'Perfil A';
  if (colsB) colsB.textContent = profiles[1].name || 'Perfil B';

  const rows = [
    { label: 'Produção Intelectual', keyA: mA.total, keyB: mB.total, suffix: ' artigos', higherIsBetter: true },
    { label: 'Produção Qualificada (A1+A2)', keyA: mA.a1a2Pct, keyB: mB.a1a2Pct, suffix: '%', higherIsBetter: true },
    { label: 'Nota CAPES (Score)', keyA: mA.avgScore, keyB: mB.avgScore, suffix: '/100', higherIsBetter: true },
    { label: 'Cobertura Internacional', keyA: mA.internationalPct, keyB: mB.internationalPct, suffix: '%', higherIsBetter: true },
    { label: 'Área Enfermagem', keyA: mA.enfPct, keyB: mB.enfPct, suffix: '%', higherIsBetter: false },
    { label: 'Não Classificados (NC)', keyA: mA.ncCount, keyB: mB.ncCount, suffix: '', higherIsBetter: false }
  ];

  tbody.innerHTML = rows.map((row, idx) => {
    const aIsBetter = row.higherIsBetter ? row.keyA > row.keyB : row.keyA < row.keyB;
    const bIsBetter = row.higherIsBetter ? row.keyB > row.keyA : row.keyB < row.keyA;
    const tie = row.keyA === row.keyB;

    return `
      <tr>
        <td>${row.label}</td>
        <td class="kpi-col-a${!tie && aIsBetter ? ' kpi-best' : ''}">${row.keyA}${row.suffix}</td>
        <td class="kpi-col-b${!tie && bIsBetter ? ' kpi-best' : ''}">${row.keyB}${row.suffix}</td>
      </tr>
    `;
  }).join('');

  // Atualizar header com nomes
  updateComparisonHeaders(profiles);
}

function updateComparisonHeaders(profiles) {
  const table = dom.comparisonKpisBody?.closest('table');
  if (!table) return;

  const headerA = table.querySelector('.profile-a-header');
  const headerB = table.querySelector('.profile-b-header');
  if (headerA) headerA.textContent = profiles[0]?.name || 'Perfil A';
  if (headerB) headerB.textContent = profiles[1]?.name || 'Perfil B';
}

// ─── RADAR CHART ──────────────────────────────────────────────────

function renderRadarChart(profiles) {
  const canvas = dom.comparisonRadarChart;
  if (!canvas) return;

  if (appState.charts.radar) {
    appState.charts.radar.destroy();
  }
  const ctx = canvas.getContext('2d');

  const mA = computeProfileMetrics(profiles[0].items);
  const mB = computeProfileMetrics(profiles[1].items);

  const nameA = profiles[0].name || 'Perfil A';
  const nameB = profiles[1].name || 'Perfil B';

  const isDark = !document.body.classList.contains('light-theme');

  appState.charts.radar = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: ['Produção Intelectual', 'Qualificada (A1+A2)', 'Nota CAPES', 'Cobertura Internacional', 'Área Enfermagem'],
      datasets: [
        {
          label: nameA,
          data: [normalize(mA.total, 30), mA.a1a2Pct, mA.avgScore, mA.internationalPct, mA.enfPct],
          backgroundColor: PROFILE_COLORS.a.fill,
          borderColor: PROFILE_COLORS.a.stroke,
          borderWidth: 2,
          pointBackgroundColor: PROFILE_COLORS.a.stroke,
          pointBorderColor: isDark ? '#0b0f19' : '#ffffff',
          pointBorderWidth: 2,
          pointRadius: 5
        },
        {
          label: nameB,
          data: [normalize(mB.total, 30), mB.a1a2Pct, mB.avgScore, mB.internationalPct, mB.enfPct],
          backgroundColor: PROFILE_COLORS.b.fill,
          borderColor: PROFILE_COLORS.b.stroke,
          borderWidth: 2,
          pointBackgroundColor: PROFILE_COLORS.b.stroke,
          pointBorderColor: isDark ? '#0b0f19' : '#ffffff',
          pointBorderWidth: 2,
          pointRadius: 5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          beginAtZero: true,
          max: 100,
          ticks: {
            stepSize: 20,
            color: isDark ? '#9ca3af' : '#475569',
            backdropColor: 'transparent',
            font: { size: 10 }
          },
          pointLabels: {
            color: isDark ? '#f3f4f6' : '#0f172a',
            font: { size: 11, weight: '500' }
          },
          grid: {
            color: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
          },
          angleLines: {
            color: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
          }
        }
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: isDark ? '#f3f4f6' : '#0f172a',
            font: { size: 13, family: 'Outfit', weight: '600' },
            padding: 16,
            usePointStyle: true,
            pointStyleWidth: 10
          }
        },
        tooltip: {
          backgroundColor: isDark ? '#111827' : '#ffffff',
          titleColor: isDark ? '#f3f4f6' : '#0f172a',
          bodyColor: isDark ? '#9ca3af' : '#475569',
          borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
          borderWidth: 1,
          padding: 10
        }
      }
    }
  });
}

function normalize(value, max) {
  // Scale to 0-100 for radar chart (e.g., total articles capped at 30 = 100%)
  return Math.min(Math.round((value / max) * 100), 100);
}

// ─── DISTRIBUIÇÃO POR ESTRATO (GROUPED BAR) ──────────────────────

function renderComparisonEstratoChart(profiles) {
  const canvas = dom.comparisonEstratoChart;
  if (!canvas) return;

  if (appState.charts.comparisonEstrato) {
    appState.charts.comparisonEstrato.destroy();
  }
  const ctx = canvas.getContext('2d');

  const estratos = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'NC'];
  const estratoColors = {
    A1: 'rgba(16, 185, 129, 0.8)', A2: 'rgba(52, 211, 153, 0.8)', A3: 'rgba(6, 182, 212, 0.8)',
    A4: 'rgba(59, 130, 246, 0.8)', A5: 'rgba(99, 102, 241, 0.8)', A6: 'rgba(251, 191, 36, 0.8)',
    A7: 'rgba(249, 115, 22, 0.8)', A8: 'rgba(239, 68, 68, 0.8)', NC: 'rgba(100, 116, 139, 0.8)'
  };

  const isDark = !document.body.classList.contains('light-theme');
  const nameA = profiles[0].name || 'Perfil A';
  const nameB = profiles[1].name || 'Perfil B';

  const countsA = countEstratos(profiles[0].items);
  const countsB = countEstratos(profiles[1].items);

  const datasets = estratos.map(estrato => ({
    label: `Qualis ${estrato}`,
    data: [countsA[estrato] || 0, countsB[estrato] || 0],
    backgroundColor: estratoColors[estrato] || 'rgba(99, 102, 241, 0.7)',
    borderWidth: 0,
    borderRadius: 4
  }));

  appState.charts.comparisonEstrato = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: [nameA, nameB],
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: isDark ? '#f3f4f6' : '#0f172a',
            font: { size: 11, family: 'Outfit' },
            padding: 8,
            usePointStyle: true,
            pointStyleWidth: 8
          }
        },
        tooltip: {
          backgroundColor: isDark ? '#111827' : '#ffffff',
          titleColor: isDark ? '#f3f4f6' : '#0f172a',
          bodyColor: isDark ? '#9ca3af' : '#475569',
          borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
          borderWidth: 1,
          padding: 10
        }
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: {
            color: isDark ? '#f3f4f6' : '#0f172a',
            font: { size: 13, weight: '600', family: 'Outfit' }
          }
        },
        y: {
          stacked: true,
          grid: {
            color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'
          },
          ticks: {
            color: isDark ? '#9ca3af' : '#475569',
            stepSize: 1,
            precision: 0
          }
        }
      }
    }
  });
}

function countEstratos(items) {
  const counts = {};
  items.forEach(item => {
    const e = item.classification.estrato || 'NC';
    counts[e] = (counts[e] || 0) + 1;
  });
  return counts;
}
