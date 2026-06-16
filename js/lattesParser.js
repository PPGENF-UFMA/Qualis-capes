/**
 * Módulo de Interpretação e Parser de Currículo Lattes.
 * Responsável por ler textos colados do Lattes, segmentar artigos,
 * extrair metadados e encontrar os ISSNs correspondentes (inclusive abreviados).
 */

// Dicionário estático de abreviações comuns de enfermagem e saúde correlatas
const LATTES_ALIASES = {
  "ACTA PAUL ENFERM": "1982-0194",
  "ACTA PAUL DE ENFERM": "1982-0194",
  "ACTA PAULISTA ENFERMAGEM": "1982-0194",
  "ACTA PAUL": "1982-0194",
  "REV LATINO AM ENFERM": "0104-1169",
  "REV LATINO AM ENFERMAGEM": "0104-1169",
  "REVISTA LATINO AMERICANA ENFERMAGEM": "0104-1169",
  "REV BRAS ENFERM": "0034-7167",
  "REVISTA BRASILEIRA ENFERMAGEM": "0034-7167",
  "TEXTO CONTEXTO ENFERM": "0104-0707",
  "TEXTO CONTEXTO ENFERMAGEM": "0104-0707",
  "ENFERM FOCO": "2357-707X",
  "ENFERMAGEM FOCO COFEN": "2357-707X",
  "ENFERMAGEM FOCO": "2357-707X",
  "REV ESC ENFERM USP": "0080-6234",
  "REV GAUCHA ENFERM": "0102-6933",
  "REV MINEIRA ENFERM": "1415-2762",
  "REME REVISTA MINEIRA ENFERMAGEM": "1415-2762",
  "REME": "1415-2762",
  "REV ELETR ACERVO SAUDE": "2178-2091",
  "REVISTA ELETRONICA ACERVO EM SAUDE": "2178-2091",
  "BMC PUBLIC HEALTH": "1471-2458",
  "REV SOBECC": "1414-4425",
  "REVISTA SOBECC": "1414-4425"
};

/**
 * Normaliza uma string de texto removendo acentos, pontuações e preposições.
 * @param {string} str String de entrada
 * @returns {string} String normalizada
 */
export function normalizeString(str) {
  if (!str) return "";
  return str
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[\.\,\-\&\;\:\?\!\"\'\(\)\[\]\/]/g, " ") // substitui pontuações por espaço
    .replace(/\b(DE|DA|DO|EM|OF|AND|THE|IN|ON|PARA|SOB|A|O|AS|OS|UM|UNS|UMA|UMAS)\b/g, " ") // remove preposições/artigos comuns
    .replace(/\s+/g, " ") // remove múltiplos espaços
    .trim();
}

/**
 * Algoritmo de Similaridade Jaro-Winkler.
 * Retorna um coeficiente entre 0.0 (sem similaridade) e 1.0 (idêntico).
 */
export function jaroWinkler(s1, s2) {
  if (s1 === s2) return 1.0;
  
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0.0;

  const maxDist = Math.floor(Math.max(len1, len2) / 2) - 1;

  const hash_s1 = new Array(len1).fill(0);
  const hash_s2 = new Array(len2).fill(0);

  let m = 0; // correspondências

  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - maxDist);
    const end = Math.min(len2, i + maxDist + 1);
    for (let j = start; j < end; j++) {
      if (s1[i] === s2[j] && hash_s2[j] === 0) {
        hash_s1[i] = 1;
        hash_s2[j] = 1;
        m++;
        break;
      }
    }
  }

  if (m === 0) return 0.0;

  let t = 0; // transposições
  let point = 0;

  for (let i = 0; i < len1; i++) {
    if (hash_s1[i] === 1) {
      while (hash_s2[point] === 0) {
        point++;
      }
      if (s1[i] !== s2[point]) {
        t++;
      }
      point++;
    }
  }

  t = t / 2;

  const jaro = (m / len1 + m / len2 + (m - t) / m) / 3.0;

  // Modificação de Winkler
  const p = 0.1; // constante de Winkler
  let l = 0;     // prefixo comum
  for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
    if (s1[i] === s2[i]) {
      l++;
    } else {
      break;
    }
  }

  return jaro + l * p * (1 - jaro);
}

/**
 * Segmenta o texto copiado do Lattes em artigos individuais.
 * @param {string} text Texto bruto colado
 * @returns {string[]} Lista de strings de artigos
 */
export function segmentLattesText(text) {
  if (!text) return [];
  
  // Substituir interrogações estranhas (falhas de encoding comuns no Lattes) por aspas ou apóstrofo
  let cleanText = text.replace(/M\?BATNA/gi, "M'BATNA");
  
  // Remover injeções textuais de extensões de navegador (ex: Qualis Lattes) antes de linearizar
  cleanText = cleanText.replace(/.*Qualis\s*\(ISSN:.*\n?/gi, "");
  cleanText = cleanText.replace(/.*fonte Qualis\/CAPES.*\n?/gi, "");
  cleanText = cleanText.replace(/.*Não classificado,\s*ISSN.*\n?/gi, "");

  // Linearizar o texto substituindo quebras de linha simples
  cleanText = cleanText.replace(/\r?\n/g, " ");
  cleanText = cleanText.replace(/\s+/g, " ");

  // Expressão regular para encontrar artigos (cada um termina com o ano e ponto)
  // O padrão busca por: conteúdo geral + vírgula + volume/páginas (opcional) + ano (4 dígitos) + ponto final
  const articleRegex = /(.*?,\s*\d{4}\.(?:\s*Citações:\d+)?)/gi;
  const matches = cleanText.match(articleRegex);
  
  if (!matches) {
    // Se a regex global falhar, tenta quebrar por numeração clássica (ex: "1. ", "2. ")
    const numberedSplit = cleanText.split(/\s+\b\d+\.\s+/);
    return numberedSplit.map(s => s.trim()).filter(s => s.length > 20);
  }

  return matches.map(s => s.trim()).filter(s => s.length > 20);
}

/**
 * Realiza o parser de um artigo individual extraindo metadados.
 * @param {string} articleText Texto do artigo completo
 * @returns {Object} Dados estruturados do artigo
 */
export function parseSingleArticle(articleText) {
  // Remover indicação de citações do Lattes para não poluir
  let cleanText = articleText.replace(/\s*Citações:\d+/gi, "").trim();
  
  // Remover numerações iniciais (ex: "2. ")
  cleanText = cleanText.replace(/^\s*\d+\.\s*/, "");

  // Regex para capturar os dados de publicação no final (Volume, Página, Ano)
  const pubRegex = /,\s*(?:v\.\s*([^,]+),)?\s*(?:p\.\s*([^,]+),)?\s*(\d{4})\.?$/i;
  const match = cleanText.match(pubRegex);

  let authors = "Autores Não Identificados";
  let title = "Título Não Identificado";
  let journal = "Periódico Não Identificado";
  let year = null;
  let volume = "";
  let pages = "";

  if (match) {
    volume = match[1] ? match[1].trim() : "";
    pages = match[2] ? match[2].trim() : "";
    year = parseInt(match[3], 10);

    // O que ficou antes é Autores + Título + Periódico
    const mainBlock = cleanText.substring(0, match.index).trim();
    
    // Encontrar o último ponto final fora de parênteses no mainBlock para isolar o Periódico (Revista)
    let nesting = 0;
    let lastDotIndex = -1;
    for (let i = 0; i < mainBlock.length; i++) {
      if (mainBlock[i] === '(') {
        nesting++;
      } else if (mainBlock[i] === ')') {
        nesting--;
      } else if (mainBlock[i] === '.' && nesting === 0) {
        lastDotIndex = i;
      }
    }

    let remainingBlock = mainBlock;
    if (lastDotIndex !== -1) {
      journal = mainBlock.substring(lastDotIndex + 1).trim();
      remainingBlock = mainBlock.substring(0, lastDotIndex).trim();
    } else {
      journal = mainBlock;
    }
    
    // Separar autores e título no ponto final após o último ponto-e-vírgula (;)
    const lastSemicolon = remainingBlock.lastIndexOf(";");
    if (lastSemicolon !== -1) {
      const firstDotAfterSemicolon = remainingBlock.indexOf(".", lastSemicolon);
      if (firstDotAfterSemicolon !== -1) {
        authors = remainingBlock.substring(0, firstDotAfterSemicolon).trim();
        title = remainingBlock.substring(firstDotAfterSemicolon + 1).trim();
      } else {
        // Fallback se não achar o ponto final
        authors = remainingBlock.substring(0, lastSemicolon).trim();
        title = remainingBlock.substring(lastSemicolon + 1).trim();
      }
    } else {
      // Se não houver ponto-e-vírgula (autor único)
      // Encontrar o primeiro ponto final após o sobrenome (geralmente maiúsculo)
      const firstDot = remainingBlock.indexOf(".");
      if (firstDot !== -1 && firstDot < remainingBlock.length - 15) {
        authors = remainingBlock.substring(0, firstDot).trim();
        title = remainingBlock.substring(firstDot + 1).trim();
      } else {
        title = remainingBlock;
      }
    }
  } else {
    // Parser alternativo se a regex falhar
    const parts = cleanText.split(".");
    if (parts.length >= 3) {
      authors = parts[0].trim();
      title = parts[1].trim();
      journal = parts[2].trim();
    } else {
      title = cleanText;
    }
  }

  // Limpar possíveis pontos finais residuais
  title = title.replace(/\.$/, "").trim();

  return {
    authors,
    title,
    journal,
    year,
    volume,
    pages
  };
}

/**
 * Resolve o nome de um periódico para o seu correspondente ISSN na base de dados.
 * @param {string} journalName Nome ou abreviação do periódico
 * @param {Array} dbItems Lista de periódicos da base local
 * @returns {string|null} ISSN correspondente ou null
 */
export function matchJournalToISSN(journalName, dbItems) {
  if (!journalName || !dbItems || dbItems.length === 0) return null;

  const normalizedQuery = normalizeString(journalName);
  if (!normalizedQuery) return null;

  // 1. Verificação na Tabela Estática de Aliases (Abreviações comuns)
  if (LATTES_ALIASES[normalizedQuery]) {
    return LATTES_ALIASES[normalizedQuery];
  }

  // 2. Busca exata de String Normalizada contra a base local
  // Criar uma versão normalizada de cada item do banco para comparação
  for (const item of dbItems) {
    if (item.title) {
      const normDbTitle = normalizeString(item.title);
      if (normDbTitle === normalizedQuery) {
        return item.issn;
      }
    }
  }

  // 3. Otimização Heurística para Fuzzy Match
  // Divide a query em termos significativos de pelo menos 3 caracteres
  const queryTerms = normalizedQuery.split(" ").filter(t => t.length >= 3);
  if (queryTerms.length === 0) return null;

  // Filtra candidatos na base local que contenham pelo menos um dos termos principais
  const candidates = [];
  for (const item of dbItems) {
    if (!item.title) continue;
    const normDbTitle = normalizeString(item.title);
    
    // Verifica se há intersecção de palavras
    const hasIntersection = queryTerms.some(term => normDbTitle.includes(term));
    if (hasIntersection) {
      candidates.push({
        issn: item.issn,
        normalizedTitle: normDbTitle
      });
    }
  }

  // 4. Executa Jaro-Winkler apenas na lista reduzida de candidatos
  let bestMatch = null;
  let highestScore = 0.0;

  for (const candidate of candidates) {
    const score = jaroWinkler(normalizedQuery, candidate.normalizedTitle);
    if (score > highestScore) {
      highestScore = score;
      bestMatch = candidate;
    }
  }

  // Limiar de corte para associação automática (85%)
  if (highestScore >= 0.85 && bestMatch) {
    return bestMatch.issn;
  }

  return null;
}

/**
 * Executa o parser completo do texto do Currículo Lattes.
 * @param {string} text Texto bruto colado
 * @param {Array} dbItems Lista de periódicos da base local
 * @returns {Object[]} Lista de artigos extraídos e mapeados
 */
export function parseLattesText(text, dbItems) {
  const segments = segmentLattesText(text);
  const results = [];

  for (const segment of segments) {
    const parsed = parseSingleArticle(segment);
    const matchedIssn = matchJournalToISSN(parsed.journal, dbItems);
    
    results.push({
      ...parsed,
      matchedIssn
    });
  }

  return results;
}
