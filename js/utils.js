/**
 * Utilitários para Processamento e Exportação de Arquivos
 */

import { normalizeISSN } from './enricher.js';

/**
 * Faz o parse de uma string CSV para uma matriz de linhas e colunas.
 * Identifica automaticamente se o delimitador é vírgula (,) ou ponto e vírgula (;).
 * @param {string} text Conteúdo de texto do arquivo CSV
 * @returns {string[][]} Matriz bidimensional contendo as linhas e colunas
 */
export function parseCSV(text) {
  if (!text || typeof text !== 'string') return [];
  
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return [];

  // Detecta o delimitador na primeira linha não vazia
  let headerLine = '';
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim()) {
      headerLine = lines[i];
      break;
    }
  }
  
  const commaCount = (headerLine.match(/,/g) || []).length;
  const semicolonCount = (headerLine.match(/;/g) || []).length;
  const delimiter = semicolonCount > commaCount ? ';' : ',';

  const results = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const row = [];
    let insideQuotes = false;
    let entry = '';
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      
      if (char === '"') {
        insideQuotes = !insideQuotes;
      } else if (char === delimiter && !insideQuotes) {
        row.push(entry.trim());
        entry = '';
      } else {
        entry += char;
      }
    }
    row.push(entry.trim());
    
    if (row.length > 0 && row.some(cell => cell !== '')) {
      results.push(row);
    }
  }
  
  return results;
}

/**
 * Faz o parse de um arquivo Excel (.xlsx, .xls) para uma matriz de linhas e colunas.
 * Usa a biblioteca SheetJS (XLSX) carregada via CDN.
 * @param {File} file Arquivo Excel
 * @returns {Promise<string[][]>} Promessa que resolve para a matriz bidimensional
 */
export function parseXLSX(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        if (typeof XLSX === 'undefined') {
          throw new Error('Biblioteca SheetJS (XLSX) não carregada.');
        }
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.SheetNames[0];
        const sheet = workbook.Sheets[firstSheet];
        const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        resolve(matrix.map(row => row.map(cell => String(cell))));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Converte a matriz CSV em um array de objetos estruturados baseados no ISSN.
 * Identifica dinamicamente a coluna de ISSN e outras colunas auxiliares (Título, Artigo, etc.).
 * @param {string[][]} parsedCSV Matriz retornada por parseCSV
 * @returns {Object[]} Array de objetos com { issn, title, originalRow }
 */
export function processCSVData(parsedCSV) {
  if (parsedCSV.length === 0) return [];
  
  const headers = parsedCSV[0].map(h => h.toLowerCase().trim());
  
  // Tenta encontrar o índice da coluna de ISSN
  let issnIndex = headers.findIndex(h => h.includes('issn'));
  
  // Tenta encontrar o índice de uma coluna de título ou artigo
  let titleIndex = headers.findIndex(h => h.includes('titulo') || h.includes('título') || h.includes('title') || h.includes('artigo') || h.includes('nome'));

  // Se não encontrou coluna de ISSN pelo nome, tenta inspecionar as primeiras linhas para achar algo formatado como ISSN
  if (issnIndex === -1 && parsedCSV.length > 1) {
    const sampleRow = parsedCSV[1];
    for (let colIdx = 0; colIdx < sampleRow.length; colIdx++) {
      const cell = sampleRow[colIdx];
      if (normalizeISSN(cell).length === 9) { // Ex: 1234-5678 tem 9 chars
        issnIndex = colIdx;
        break;
      }
    }
  }

  // Se ainda assim não encontrou, assume a primeira coluna (índice 0)
  if (issnIndex === -1) {
    issnIndex = 0;
  }

  // Se o título não foi encontrado, define como -1
  if (titleIndex === issnIndex) {
    titleIndex = -1; // Evita usar a mesma coluna do ISSN
  }

  const records = [];
  
  // Começa a partir do índice 1 (ignorando o cabeçalho)
  for (let i = 1; i < parsedCSV.length; i++) {
    const row = parsedCSV[i];
    if (row.length <= issnIndex) continue;
    
    const rawIssn = row[issnIndex] || '';
    const cleanIssn = normalizeISSN(rawIssn);
    
    // Só processa se houver alguma tentativa de ISSN
    if (rawIssn.trim() === '') continue;

    let rowTitle = '';
    if (titleIndex !== -1 && row.length > titleIndex) {
      rowTitle = row[titleIndex];
    }

    records.push({
      issn: cleanIssn || rawIssn,
      inputIssn: rawIssn,
      title: rowTitle || 'Artigo Importado',
      originalRow: row
    });
  }

  return records;
}

/**
 * Converte os dados classificados de volta para o formato CSV.
 * @param {Object[]} classifiedItems Array de itens classificados
 * @returns {string} String CSV formatada
 */
export function generateCSV(classifiedItems) {
  const delimiter = ';'; // Ponto e vírgula é ideal para o Excel brasileiro
  
  const headers = [
    'Título do Artigo',
    'ISSN',
    'Área CAPES',
    'JCR',
    'CiteScore',
    'Indexadores Ativos',
    'CUIDEN (Índice)',
    'Estrato Final (Qualis)',
    'Justificativa da Regra'
  ];

  const escapeCSV = (val) => {
    if (val === null || val === undefined) return '';
    const stringVal = String(val);
    if (stringVal.includes(delimiter) || stringVal.includes('"') || stringVal.includes('\n')) {
      return `"${stringVal.replace(/"/g, '""')}"`;
    }
    return stringVal;
  };

  const rows = [headers.map(escapeCSV).join(delimiter)];

  for (const item of classifiedItems) {
    const indexersStr = Array.isArray(item.indexers) ? item.indexers.join(', ') : '';
    const cuidenVal = (item.metrics && item.metrics.cuiden) ? item.metrics.cuiden : '';
    
    const row = [
      item.title,
      item.issn,
      item.area,
      item.jcr !== null ? item.jcr.toString().replace('.', ',') : '', // Formato brasileiro de decimais
      item.citeScore !== null ? item.citeScore.toString().replace('.', ',') : '',
      indexersStr,
      cuidenVal !== '' ? cuidenVal.toString().replace('.', ',') : '',
      item.classification.estrato,
      item.classification.justification
    ];

    rows.push(row.map(escapeCSV).join(delimiter));
  }

  return rows.join('\r\n');
}

/**
 * Aciona o download de um arquivo no navegador.
 * Inclui o caractere BOM (\ufeff) se for um CSV para o Excel abrir com UTF-8 correto.
 * @param {string} content Conteúdo do arquivo
 * @param {string} fileName Nome do arquivo para salvar
 * @param {string} mimeType Tipo MIME do arquivo
 */
export function downloadFile(content, fileName, mimeType) {
  let blobContent = content;
  
  // Adiciona BOM se for CSV para garantir codificação UTF-8 no Excel
  if (mimeType.includes('csv')) {
    blobContent = '\ufeff' + content;
  }

  const blob = new Blob([blobContent], { type: `${mimeType};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  
  link.setAttribute('href', url);
  link.setAttribute('download', fileName);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Sanitiza uma string para inserção segura em HTML (previne XSS).
 * Deve ser usada em TODA renderização de dados externos via innerHTML.
 * 
 * IMPORTANTE: Manter sincronizada com qualquer lógica similar no backend.
 * @param {string} str String a ser sanitizada
 * @returns {string} String segura para inserção em HTML
 */
export function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}
