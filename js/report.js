/**
 * Módulo de Relatório PDF — download direto (jsPDF + autotable).
 *
 * Substitui o fluxo antigo baseado em `window.print()` / `@media print`,
 * que era frágil (canvas do Chart.js quebrado, tabela com scroll cortada,
 * dependência do diálogo de impressão de cada navegador).
 *
 * Gera um arquivo A4 com: timbre institucional, KPIs, gráficos como imagem,
 * top periódicos, insights e tabela detalhada completa e paginada.
 */

import dom from './dom.js';
import appState, { getFilteredItems, isNonConclusiveResult } from './state.js';
import { updateAnalytics } from './charts.js';
import { switchTab } from './ui.js';
import { getJournalTitle } from './utils.js';

const SCORE_WEIGHTS = { A1: 100, A2: 85, A3: 70, A4: 55, A5: 40, A6: 25, A7: 10, A8: 5, NC: 0 };

// Paleta do relatório (fundo branco, texto escuro — legível no papel)
const C = {
  primary: [141, 3, 51],
  ink: [15, 23, 42],
  muted: [100, 116, 139],
  line: [226, 232, 240],
  cardBg: [248, 250, 252]
};

const ESTRATO_FILL = {
  A1: [16, 185, 129], A2: [52, 211, 153], A3: [6, 182, 212], A4: [59, 130, 246],
  A5: [209, 26, 91], A6: [251, 191, 36], A7: [249, 115, 22], A8: [239, 68, 68],
  NC: [100, 116, 139]
};

/** Pausa cooperativa para não travar a UI durante a montagem do PDF. */
function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function fmtNum(value, digits = 2) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return value.toFixed(digits).replace('.', ',');
}

function sanitizeFileName(name) {
  return String(name || 'relatorio')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'relatorio';
}

/**
 * Calcula os KPIs do relatório a partir dos itens (mesmos pesos do dashboard).
 */
function computeKpis(dashboardItems, pendingCount) {
  const conclusive = dashboardItems.filter((item) => !isNonConclusiveResult(item));
  const total = conclusive.length;
  const qualified = conclusive.filter((i) => ['A1', 'A2'].includes(i.classification?.estrato)).length;
  const nc = conclusive.filter((i) => (i.classification?.estrato || 'NC') === 'NC').length;
  const scoreSum = conclusive.reduce((s, i) => s + (SCORE_WEIGHTS[i.classification?.estrato] ?? 0), 0);
  const ipp = total > 0 ? Math.round(scoreSum / total) : 0;
  const intl = conclusive.filter((i) => {
    const idx = (i.indexers || []).map((x) => String(x).toUpperCase());
    return idx.includes('MEDLINE') || idx.includes('SCOPUS') || (typeof i.jcr === 'number' && i.jcr > 0);
  }).length;
  const enf = conclusive.filter((i) => i.area === 'Enfermagem').length;
  return {
    total,
    qualified,
    qualifiedPct: total > 0 ? Math.round((qualified / total) * 100) : 0,
    ipp,
    nc,
    pending: pendingCount,
    intlPct: total > 0 ? Math.round((intl / total) * 100) : 0,
    enf,
    outras: total - enf
  };
}

function profileBand(ipp) {
  if (ipp >= 85) return 'Impacto muito alto';
  if (ipp >= 70) return 'Impacto alto';
  if (ipp >= 55) return 'Perfil consistente';
  if (ipp >= 40) return 'Em consolidacao';
  return 'Perfil emergente';
}

/**
 * Garante gráficos renderizados em tema claro e retorna as imagens PNG.
 * O texto dos gráficos no tema escuro é claro — ilegível sobre o fundo
 * branco do PDF — por isso re-renderiza temporariamente em modo claro.
 * A aba de analytics é ativada antes da captura: canvas em painel oculto
 * (`hidden`) tem dimensão zero e gera imagem vazia/erro no jsPDF.
 */
async function captureChartImages(dashboardItems) {
  const wasDark = !document.body.classList.contains('light-theme');
  const activeBtn = dom.activeTab ? dom.activeTab() : null;
  const returnToTable = !activeBtn || activeBtn.id === 'tab-table';
  const shots = [];
  try {
    await switchTab('analytics');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (wasDark) {
      document.body.classList.add('light-theme');
      updateAnalytics(dashboardItems);
      await new Promise((resolve) => setTimeout(resolve, 700));
    } else {
      // Garante layout real antes da captura (resize após a aba ficar visível)
      Object.values(appState.charts).forEach((chart) => {
        try { if (chart && typeof chart.resize === 'function') chart.resize(); } catch (_) { /* ignora */ }
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const defs = [
      ['qualis', 'Distribuicao dos Estratos (Qualis)'],
      ['indexers', 'Distribuicao por Indexadores'],
      ['publicationsYear', 'Producao por Ano de Publicacao'],
      ['qualisEvolution', 'Evolucao do IPP']
    ];
    defs.forEach(([key, title]) => {
      const chart = appState.charts[key];
      if (!chart || typeof chart.toBase64Image !== 'function') return;
      try {
        shots.push({ title, img: chart.toBase64Image('image/png', 1) });
      } catch (_) { /* ignora gráfico individual com falha */ }
    });
  } finally {
    if (wasDark) {
      document.body.classList.remove('light-theme');
      updateAnalytics(dashboardItems);
    }
    if (returnToTable) await switchTab('table');
  }
  return shots;
}

function readInsights() {
  const container = dom.curriculumInsightsList;
  if (!container) return [];
  return [...container.querySelectorAll('.insight-text')]
    .map((el) => (el.textContent || '').trim())
    .filter(Boolean)
    .slice(0, 8);
}

function readTopJournals(dashboardItems) {
  const counts = {};
  dashboardItems
    .filter((item) => !isNonConclusiveResult(item))
    .forEach((item) => {
      const name = getJournalTitle(item) || item.title || 'Desconhecido';
      counts[name] = (counts[name] || 0) + 1;
    });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
}

let coverLogosCache = null;
let coverLogosPromise = null;

/** Converte a resposta de um fetch em dataURL. */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('logo unreadable'));
    reader.readAsDataURL(blob);
  });
}

/** Lê as dimensões reais de uma imagem a partir do dataURL. */
function readImageSize(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('logo invalid'));
    img.src = dataUrl;
  });
}

/**
 * Otimiza a logo para o PDF: reduz para no máximo 480px de largura,
 * achata a transparência sobre fundo branco e exporta em JPEG.
 * Sem isso o jsPDF incorpora o PNG em bitmap cru e o arquivo infla (MBs).
 */
function optimizeLogo(img) {
  const maxW = 480;
  const scale = Math.min(1, maxW / img.naturalWidth);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.85),
    width: img.naturalWidth,
    height: img.naturalHeight
  };
}

async function loadOneLogo(path) {
  const resp = await fetch(path);
  if (!resp.ok) throw new Error(`logo ${resp.status}`);
  const dataUrl = await blobToDataUrl(await resp.blob());
  const img = await readImageSize(dataUrl);
  if (!img.naturalWidth || !img.naturalHeight) throw new Error('logo empty');
  return optimizeLogo(img);
}

/**
 * Carrega as logos institucionais da capa (versões do rodapé do site).
 * Resultado em cache após a primeira geração. Falhas são silenciosas:
 * o relatório sai normalmente só com o texto.
 * @returns {Promise<{ ppgenf: Object|null, ufma: Object|null }|null>}
 */
function loadCoverLogos() {
  if (coverLogosCache) return Promise.resolve(coverLogosCache);
  if (!coverLogosPromise) {
    coverLogosPromise = (async () => {
      try {
        const [ppgenf, ufma] = await Promise.all([
          loadOneLogo('/assets/ppgenf_clean.png').catch(() => null),
          loadOneLogo('/assets/ufma_clean.png').catch(() => null)
        ]);
        if (!ppgenf && !ufma) return null;
        coverLogosCache = { ppgenf, ufma };
        return coverLogosCache;
      } catch (_) {
        return null;
      } finally {
        if (!coverLogosCache) coverLogosPromise = null;
      }
    })();
  }
  return coverLogosPromise;
}

function describeFilters(searchVal, filterVal, filterYearVal, sortVal) {
  const parts = [];
  if (searchVal) parts.push(`Busca: "${searchVal}"`);
  parts.push(filterVal === 'ALL' ? 'Estratos: todos'
    : filterVal === 'PENDING' ? 'Estratos: pendentes' : `Estrato: ${filterVal}`);
  parts.push(filterYearVal === 'ALL' ? 'Periodo: todos os anos' : `Periodo: ${filterYearVal}`);
  const sortLabels = { relevance: 'relevancia', year: 'ano', recent: 'entrada', estrato: 'estrato', jcr: 'JCR', citescore: 'CiteScore', indexers: 'indexadores' };
  parts.push(`Ordem: ${sortLabels[sortVal] || sortVal}`);
  return parts.join('  |  ');
}

/** Cabeçalho + rodapé aplicados em todas as páginas via didDrawPage. */
function pageChrome(doc, headerInfo) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  return () => {
    // Faixa superior institucional
    doc.setFillColor(...C.primary);
    doc.rect(0, 0, pageW, 10, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('CLASSIFICADOR DE PRODUCAO INTELECTUAL  |  PPGENF - UFMA', 14, 6.5);
    // Rodapé
    doc.setDrawColor(...C.line);
    doc.line(14, pageH - 12, pageW - 14, pageH - 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...C.muted);
    doc.text(headerInfo.footerLeft, 14, pageH - 8);
    const pageLabel = `Pagina ${doc.internal.getNumberOfPages()}`;
    doc.text(pageLabel, pageW - 14, pageH - 8, { align: 'right' });
  };
}

function sectionTitle(doc, text, y) {
  const pageW = doc.internal.pageSize.getWidth();
  if (y > pageH(doc) - 25) { doc.addPage(); y = 20; }
  doc.setFillColor(...C.primary);
  doc.rect(14, y - 5, 1.6, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...C.ink);
  doc.text(text, 19, y);
  return y + 8;
}

function pageH(doc) {
  return doc.internal.pageSize.getHeight();
}

function ensureSpace(doc, y, needed) {
  if (y + needed > pageH(doc) - 16) { doc.addPage(); return 20; }
  return y;
}

/**
 * Gera e baixa o relatório PDF. Retorna o nome do arquivo gerado.
 * @param {Object} [opts]
 * @param {(current:number,total:number)=>void} [opts.onProgress]
 */
export async function generateReportPDF(opts = {}) {
  const { onProgress } = opts;
  const report = (c, t) => { if (onProgress) onProgress(c, t); };

  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error('Biblioteca de PDF nao carregada. Verifique a conexao e recarregue a pagina.');
  }
  if (appState.classifiedItems.length === 0) {
    throw new Error('Nenhum resultado para incluir no relatorio.');
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();

  const searchVal = dom.searchBox?.value || '';
  const filterVal = dom.filterEstrato?.value || 'ALL';
  const filterYearVal = dom.filterYear?.value || 'ALL';
  const sortVal = dom.sortBy?.value || 'relevance';

  const tableItems = getFilteredItems(searchVal, filterVal, filterYearVal, sortVal);
  const dashboardItems = getFilteredItems('', 'ALL', filterYearVal);
  const pendingCount = dashboardItems.filter(isNonConclusiveResult).length;
  const kpis = computeKpis(dashboardItems, pendingCount);
  const researcher = appState.researcherName || '-';
  const now = new Date();
  const dateStr = `${now.toLocaleDateString('pt-BR')} as ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;

  report(1, 5);
  const [chartShots, coverLogos] = await Promise.all([
    captureChartImages(dashboardItems),
    loadCoverLogos()
  ]);
  const insights = readInsights();
  const topJournals = readTopJournals(dashboardItems);
  await tick();

  const footerLeft = 'CPI - Classificador de Producao Intelectual (PPGENF/UFMA) - Qualis em contexto. Decisões com evidência.';
  const drawChrome = pageChrome(doc, { footerLeft });
  const autoTableDefaults = {
    didDrawPage: drawChrome,
    styles: { font: 'helvetica', fontSize: 7.5, textColor: C.ink, cellPadding: 2 },
    headStyles: { fillColor: C.primary, textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
    alternateRowStyles: { fillColor: [245, 247, 250] }
  };

  // ── Capa / timbre ──
  drawChrome();
  if (coverLogos) {
    // Logos institucionais à direita do título (área livre da capa).
    // Cada logo é ajustada à altura da caixa preservando a proporção.
    const logoBoxH = 16;
    const logoY = 15;
    let cursorX = pageW - 14;
    // Desenha da direita para a esquerda: UFMA por último (mais à direita).
    [coverLogos.ufma, coverLogos.ppgenf].forEach((logo) => {
      if (!logo) return;
      const w = (logoBoxH * logo.width) / logo.height;
      cursorX -= w;
      doc.addImage(logo.dataUrl, 'JPEG', cursorX, logoY, w, logoBoxH);
      cursorX -= 4; // respiro entre as logos
    });
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.setTextColor(...C.ink);
  doc.text('Relatório de Classificação', 14, 24);

  doc.setDrawColor(...C.primary);
  doc.setLineWidth(0.8);
  doc.line(14, 31, pageW - 14, 31);

  let y = 38;
  doc.setFontSize(10);
  const metaLines = [
    ['Pesquisador:', researcher],
    ['Gerado em:', dateStr],
    ['Itens no relatorio:', `${tableItems.length} (tabela)  |  ${kpis.total} conclusivos no dashboard`],
    ['Filtros:', describeFilters(searchVal, filterVal, filterYearVal, sortVal)]
  ];

  const impact = appState.authorImpactMetrics;
  const hasImpact = Boolean(
    impact && (impact.scopus?.h_index != null || impact.openalex?.h_index != null || impact.h_index != null)
  );

  if (impact?.orcid) {
    metaLines.splice(1, 0, ['Identificador ORCID:', impact.orcid]);
  }

  metaLines.forEach(([label, value]) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...C.ink);
    doc.text(label, 14, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 65, 85);
    const wrapped = doc.splitTextToSize(String(value), pageW - 62);
    doc.text(wrapped, 52, y);
    y += Math.max(6, wrapped.length * 4.6);
  });

  // ── Métricas de Impacto Científico (Carreira) ──
  if (hasImpact) {
    y = ensureSpace(doc, y + 2, 35);
    y = sectionTitle(doc, 'Metricas de impacto cientifico (Carreira)', y);

    const impactCards = [];

    // Card 1: Scopus
    if (impact.scopus && impact.scopus.h_index != null) {
      const citStr = impact.scopus.citations != null
        ? `${impact.scopus.citations.toLocaleString('pt-BR')} citacoes`
        : 'Base Scopus (Elsevier)';
      impactCards.push(['Indice H (Scopus)', String(impact.scopus.h_index), citStr]);
    } else {
      impactCards.push(['Indice H (Scopus)', 'N/D', 'Nao indexado na Scopus']);
    }

    // Card 2: OpenAlex
    if (impact.openalex && impact.openalex.h_index != null) {
      const i10Str = impact.openalex.i10_index != null ? `i10: ${impact.openalex.i10_index} | ` : '';
      const citStr = impact.openalex.citations != null
        ? `${i10Str}${impact.openalex.citations.toLocaleString('pt-BR')} cit.`
        : 'OpenAlex Global';
      impactCards.push(['Indice H (OpenAlex)', String(impact.openalex.h_index), citStr]);
    } else {
      impactCards.push(['Indice H (OpenAlex)', 'N/D', 'Catalogo aberto']);
    }

    // Card 3: Citações globais / Referência
    const totalCit = impact.citations != null
      ? impact.citations.toLocaleString('pt-BR')
      : (impact.scopus?.citations != null
        ? impact.scopus.citations.toLocaleString('pt-BR')
        : (impact.openalex?.citations != null ? impact.openalex.citations.toLocaleString('pt-BR') : '-'));
    const sourceLabel = impact.h_index_source ? `Referencia: ${impact.h_index_source}` : 'Trajetoria historica';
    impactCards.push(['Citacoes totais', String(totalCit), sourceLabel]);

    const impW = (pageW - 28 - 4) / 3;
    const impH = 20;
    impactCards.forEach(([title, value, sub], i) => {
      const x = 14 + i * (impW + 2);
      const cy = y;
      doc.setFillColor(...C.cardBg);
      doc.setDrawColor(...C.line);
      doc.roundedRect(x, cy, impW, impH, 1.5, 1.5, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(...C.muted);
      doc.text(String(title).toUpperCase().slice(0, 32), x + 3, cy + 5);
      doc.setFontSize(13);
      doc.setTextColor(...C.primary);
      doc.text(String(value), x + 3, cy + 12);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...C.muted);
      doc.text(String(sub).slice(0, 40), x + 3, cy + 16.5);
    });
    y += impH + 6;
  }

  // ── KPIs Qualis ──
  report(2, 5);
  await tick();
  y = ensureSpace(doc, y + 2, 60);
  y = sectionTitle(doc, 'Indicadores consolidados (Producao)', y);
  const kpiCards = [
    ['Producao intelectual', String(kpis.total), kpis.enf === kpis.total && kpis.total > 0 ? '100% Enfermagem' : `${kpis.enf} Enf. / ${kpis.outras} Outras`],
    ['Producao qualificada (A1+A2)', String(kpis.qualified), `${kpis.qualifiedPct}% do total`],
    ['IPP (0-100)', `${kpis.ipp} / 100`, profileBand(kpis.ipp)],
    ['Nao classificados (NC)', String(kpis.nc), 'Itens com estrato NC'],
    ['Consultas pendentes', String(kpis.pending), 'Erro, invalido ou parcial'],
    ['Cobertura internacional', `${kpis.intlPct}%`, 'Scopus + WoS + Medline']
  ];
  const cardW = (pageW - 28 - 4) / 3;
  const cardH = 20;
  kpiCards.forEach(([title, value, sub], i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 14 + col * (cardW + 2);
    const cy = y + row * (cardH + 2);
    doc.setFillColor(...C.cardBg);
    doc.setDrawColor(...C.line);
    doc.roundedRect(x, cy, cardW, cardH, 1.5, 1.5, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...C.muted);
    doc.text(String(title).toUpperCase().slice(0, 32), x + 3, cy + 5);
    doc.setFontSize(13);
    doc.setTextColor(...C.primary);
    doc.text(String(value), x + 3, cy + 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...C.muted);
    doc.text(String(sub).slice(0, 40), x + 3, cy + 16.5);
  });
  y += 2 * (cardH + 2) + 6;

  // ── Gráficos ──
  report(3, 5);
  await tick();
  if (chartShots.length > 0) {
    y = sectionTitle(doc, 'Graficos do dashboard', y);
    chartShots.forEach(({ title, img }) => {
      const imgH = 68;
      y = ensureSpace(doc, y, imgH + 12);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(...C.ink);
      doc.text(title, 14, y);
      y += 3;
      try {
        doc.setDrawColor(...C.line);
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(14, y, pageW - 28, imgH, 1.5, 1.5, 'FD');
        doc.addImage(img, 'PNG', 16, y + 2, pageW - 32, imgH - 4, undefined, 'FAST');
      } catch (_) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...C.muted);
        doc.text('(nao foi possivel incorporar este grafico)', 16, y + 10);
      }
      y += imgH + 6;
    });
  }

  // ── Top periódicos + insights ──
  report(4, 5);
  await tick();
  if (topJournals.length > 0) {
    y = sectionTitle(doc, 'Principais periodicos', y);
    doc.autoTable({
      ...autoTableDefaults,
      startY: y,
      margin: { left: 14, right: 14 },
      head: [['Periodico', 'Qtd']],
      body: topJournals.map(([name, qty]) => [String(name).slice(0, 110), String(qty)]),
      columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 18, halign: 'center' } }
    });
    y = doc.lastAutoTable.finalY + 8;
  }
  if (insights.length > 0) {
    y = sectionTitle(doc, 'Insights e destaques', y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    insights.forEach((text) => {
      const lines = doc.splitTextToSize(`- ${text}`, pageW - 32);
      y = ensureSpace(doc, y, lines.length * 4.4 + 2);
      doc.text(lines, 18, y);
      y += lines.length * 4.4 + 2;
    });
    y += 4;
  }

  // ── Tabela detalhada ──
  report(5, 5);
  await tick();
  y = sectionTitle(doc, `Tabela detalhada (${tableItems.length} ${tableItems.length === 1 ? 'item' : 'itens'})`, y);
  const body = tableItems.map((item, i) => {
    const estrato = item.data_status === 'error' ? 'ERRO'
      : item.data_status === 'invalid' ? 'INVALIDO'
        : (item.classification?.estrato || 'NC');
    return [
      String(i + 1),
      String(item.title || '-').replace(/\s+/g, ' ').slice(0, 160),
      item.year ? String(item.year) : '-',
      item.issn || '-',
      fmtNum(item.jcr),
      fmtNum(item.citeScore),
      Array.isArray(item.indexers) && item.indexers.length > 0 ? item.indexers.join(', ').slice(0, 60) : '-',
      estrato
    ];
  });
  doc.autoTable({
    ...autoTableDefaults,
    startY: y,
    margin: { left: 10, right: 10 },
    head: [['#', 'Titulo / Revista', 'Ano', 'ISSN', 'JCR', 'CiteScore', 'Indexadores', 'Estrato']],
    body,
    styles: { ...autoTableDefaults.styles, fontSize: 7, cellPadding: 1.8 },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 11, halign: 'center' },
      3: { cellWidth: 20, halign: 'center' },
      4: { cellWidth: 13, halign: 'center' },
      5: { cellWidth: 17, halign: 'center' },
      6: { cellWidth: 38 },
      7: { cellWidth: 17, halign: 'center', fontStyle: 'bold' }
    },
    didParseCell(data) {
      if (data.section === 'body' && data.column.index === 7) {
        const fill = ESTRATO_FILL[data.cell.raw] || ESTRATO_FILL.NC;
        data.cell.styles.fillColor = fill;
        data.cell.styles.textColor = 255;
      }
    }
  });
  y = doc.lastAutoTable.finalY + 8;

  const base = appState.researcherName ? sanitizeFileName(appState.researcherName) : 'lote';
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const fileName = `relatorio-qualis_${base}_${stamp}.pdf`;
  doc.save(fileName);
  return fileName;
}
