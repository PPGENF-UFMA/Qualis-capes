/**
 * Módulo de Interpretação e Parser de Currículo Lattes.
 * Responsável por ler textos colados do Lattes, segmentar artigos,
 * extrair metadados e encontrar os ISSNs correspondentes (inclusive abreviados).
 *
 * Pipeline de matching (médio prazo):
 *   1. Alias lookup (aliases.json + aliases do usuário em localStorage)
 *   2. Match exato de string normalizada
 *   3. ISSN extraído diretamente do texto do artigo
 *   4. Containment (todos os tokens da query presentes no título do DB)
 *   5. Jaccard-IDF ponderado por IDF, com Jaro-Winkler como desempate
 *
 * Cada resultado carrega um campo `confidence`:
 *   - "high"    : alias ou match exato ou containment perfeito
 *   - "review"  : fuzzy em faixa cinzenta (0.65–0.82) — sugerir revisão manual
 *   - "none"    : sem correspondência (NC)
 */

// Dicionário de abreviações comuns (carregado dinamicamente)
let LATTES_ALIASES = {};

/**
 * Inicializa o parser carregando os aliases externos.
 */
export async function initLattesParser() {
  const rawAliases = {};
  try {
    const response = await fetch('/js/aliases.json');
    if (response.ok) {
      Object.assign(rawAliases, await response.json());
    }
  } catch (error) {
    console.warn('Não foi possível carregar aliases.json, usando padrão vazio.', error);
  }
  // Merge com aliases aprendidos do usuário (localStorage)
  try {
    const userAliases = JSON.parse(localStorage.getItem('lattes_user_aliases') || '{}');
    Object.assign(rawAliases, userAliases);
  } catch (_) { /* ignore */ }

  // Normalizar todas as chaves para garantir lookup com normalizeString(query)
  LATTES_ALIASES = {};
  for (const [key, issn] of Object.entries(rawAliases)) {
    const normKey = normalizeString(key);
    if (normKey) LATTES_ALIASES[normKey] = issn;
    // Também manter chave original como fallback (caso normalizeString esteja
    // desatualizada em relação ao aliases.json histórico)
    LATTES_ALIASES[key] = issn;
  }
}

/**
 * Normaliza uma string de texto removendo acentos, pontuações e
 * um conjunto mínimo de stopwords/preposições.
 *
 * Mantém "E" (as preposições relevantes como "E NUTRIÇÃO" viram diferenciador
 * via peso IDF no Jaccard — não removê-las cegamente aqui evita colapsar
 * títulos distintos num mesmo token).
 *
 * @param {string} str String de entrada
 * @returns {string} String normalizada
 */
export function normalizeString(str) {
  if (!str) return "";
  return str
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/&/g, " E ")            // & -> E
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'") // aspas curvas
    .replace(/[\.\,\-\;\:\?\!\"\'\(\)\[\]\/]/g, " ") // pontuações -> espaço
    .replace(/\b(?:DE|DA|DOS|DAS|DO|EM|OF|THE|IN|ON|PARA|SOB|A|O|AS|OS|UM|UNS|UMA|UMAS)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Stopwords "generalistas" que recebem peso IDF baixo no Jaccard.
 * Sao termos que aparecem em milhares de periódicos (REVISTA, JOURNAL,
 * CIENCIAS, SAUDE, EDUCACAO, HUMANAS) e nao discriminam títulos.
 * Permitem o matching mas reduzem o score para títulos distintos colidirem.
 */
const GENERIC_TERMS = new Set([
  "REVISTA", "JOURNAL", "JOURNALS", "REV", "R",
  "CIENCIA", "CIENCIAS", "CIENCE", "SCIENCES", "SCIENCE",
  "SAUDE", "HEALTH", "SAUDAVEL",
  "EDUCACAO", "EDUCATION", "EDUCATIONAL", "EDUCAÇÃO",
  "HUMANAS", "HUMANITIES", "SOCIAIS", "SOCIAL",
  "BRASILEIRA", "BRASILEIRAS", "BRASIL", "BRAZIL", "BRASIL", "BR",
  "INTERNACIONAL", "INTERNATIONAL", "INTER", "NACIONAL", "NATIONAL",
  "E", "Y", "ET", "UND",
  "DA", "DE", "DO", "DAS", "DOS",
  "OF", "THE", "IN", "ON", "FOR", "AND",
  "ARTIGO", "ARTICLES", "PAPER", "JOURNAL",
  "ONLINE", "IMPRESSO", "PRINT", "DIGITAL", "ELETRONICA", "ELETRONICO",
  "COLETIVA", "COLETIVAS", "PUBLICA", "PUBLICAS",
  "PUBLIC", "PUBLICAÇÃO", "PUBLICACAO"
]);

/**
 * Algoritmo de Similaridade Jaro-Winkler.
 * Retorna um coeficiente entre 0.0 (sem similaridade) e 1.0 (idêntico).
 *
 * Implementação sem bônus de prefixo Winkler exagerado: bônus limitado a
 * 2 caracteres (em vez de 4) para evitar viés de "REVI"/"JOUR" inflar
 * scores entre periódicos que compartilham prefixos genéricos.
 */
export function jaroWinkler(s1, s2) {
  if (s1 === s2) return 1.0;

  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0.0;

  const maxDist = Math.floor(Math.max(len1, len2) / 2) - 1;

  const hash_s1 = new Array(len1).fill(0);
  const hash_s2 = new Array(len2).fill(0);

  let m = 0;

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

  let t = 0;
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

  // Bônus de prefixo Winkler — limitado a 2 caracteres e p=0.1
  const p = 0.1;
  let l = 0;
  for (let i = 0; i < Math.min(2, Math.min(len1, len2)); i++) {
    if (s1[i] === s2[i]) l++;
    else break;
  }

  return jaro + l * p * (1 - jaro);
}

function fixEncoding(text) {
  const replacements = {
    'Ã©': 'é', 'Ã£': 'ã', 'Ã¡': 'á', 'Ã­': 'í',
    'Ãµ': 'õ', 'Ã³': 'ó', 'Ãº': 'ú', 'Ã§': 'ç',
    'Ã¢': 'â', 'Ãª': 'ê', 'Ã´': 'ô', 'Ã ': 'à',
    'Ã¼': 'ü', 'Ã±': 'ñ',
    'Ã‰': 'É', 'Ã‡': 'Ç', 'Ã"': 'Ó', 'Ãš': 'Ú',
  };
  let result = text;
  for (const [bad, good] of Object.entries(replacements)) {
    result = result.replaceAll(bad, good);
  }
  result = result.replace(/[\u0000-\u001F\uFFFD□]/g, '');
  return result;
}

/**
 * Segmenta o texto copiado do Lattes em artigos individuais.
 * @param {string} text Texto bruto colado
 * @returns {string[]} Lista de strings de artigos
 */
export function segmentLattesText(text) {
  if (!text) return [];

  let cleanText = fixEncoding(text);
  cleanText = cleanText.replace(/M\?BATNA/gi, "M'BATNA");

  // Remover injeções textuais de extensões de navegador (ex: Qualis Lattes) antes de linearizar
  cleanText = cleanText.replace(/.*Qualis\s*\(ISSN:.*\n?/gi, "");
  cleanText = cleanText.replace(/.*fonte Qualis\/CAPES.*\n?/gi, "");
  cleanText = cleanText.replace(/.*Não classificado,\s*ISSN.*\n?/gi, "");

  // Linearizar o texto substituindo quebras de linha simples
  cleanText = cleanText.replace(/\r?\n/g, " ");
  cleanText = cleanText.replace(/\s+/g, " ");

  // Regex primária: artigos que terminam com ano + ponto (ex: "..., 2023.")
  // Aceita ano composto por AAAA-MM seguido de AAAA final (publicações online em fascículo dupla)
  const articleRegex = /(.*?,\s*(?:\d{4}-\d{2}\s*,\s*)?\d{4}\.(?:\s*Citações:\d+)?)/gi;
  const matches = cleanText.match(articleRegex) || [];

  // Regex secundária: artigos "no prelo" / "in press" (sem ano)
  const inPressPattern = /(.*?,\s*(?:no prelo|in press|aceito para publica[çc][aã]o)\s*\.?(?:\s*Citações:\d+)?)/gi;
  const inPressMatches = cleanText.match(inPressPattern) || [];

  const allMatches = [...matches, ...inPressMatches];

  if (allMatches.length === 0) {
    // Se a regex global falhar, tenta quebrar por numeração clássica (ex: "1. ", "2. ")
    const numberedSplit = cleanText.split(/\s+\b\d+\.\s+/);
    return numberedSplit.map(s => s.trim()).filter(s => s.length > 20);
  }

  return allMatches.map(s => s.trim()).filter(s => s.length > 20);
}

const CONGRESS_KEYWORDS = [
  'anais', 'congresso', 'simposio', 'simpósio', 'encontro',
  'conference', 'proceedings', 'workshop', 'seminário', 'jornada'
];

function isCongressProceedings(text) {
  const lower = text.toLowerCase();
  return CONGRESS_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Tenta extrair um ISSN literal diretamente do texto do artigo.
 * Padrões Lattes às vezes inserem ISSN entre parênteses ou
 * extensões como Qualis Lattes podem tê-lo reinjetado.
 *
 * @param {string} text Texto do artigo
 * @returns {string|null} ISSN em formato XXXX-XXXX ou null
 */
function extractISSNFromText(text) {
  if (!text) return null;
  // Padrão ISSN: 4 dígitos, hífen, 3 dígitos + dígito ou X
  const m = text.match(/\b(\d{4}-\d{3}[\dXx])\b/g);
  if (!m) return null;
  for (const candidate of m) {
    const raw = candidate.toUpperCase();
    const cleaned = raw.replace(/[^0-9X]/g, '');
    if (cleaned.length !== 8 || cleaned.slice(0, 7).includes('X')) continue;
    const weights = [8, 7, 6, 5, 4, 3, 2];
    let total = 0;
    for (let i = 0; i < 7; i++) total += parseInt(cleaned[i], 10) * weights[i];
    const rem = total % 11;
    const expected = 11 - rem === 10 ? 'X' : 11 - rem === 11 ? '0' : String(11 - rem);
    if (cleaned[7] === expected) return raw;
  }
  return null;
}

/**
 * Realiza o parser de um artigo individual extraindo metadados.
 * @param {string} articleText Texto do artigo completo
 * @returns {Object} Dados estruturados do artigo
 */
export function parseSingleArticle(articleText) {
  // Remover indicação de citações do Lattes para não poluir
  let cleanText = articleText.replace(/\s*Citações.*$/gi, "").trim();

  // Remover numerações iniciais (ex: "2. ")
  cleanText = cleanText.replace(/^\s*\d+\.\s*/, "");

  // Regex de cabeçalho de publicação mais robusta:
  //   , v. N, p. P, [AAAA-MM,] AAAA.
  //   , v. N, p. P, AAAA.
  //   , p. P, AAAA.
  //   , v. N, AAAA.
  //   , AAAA.
  // P / V são "lazy" para tolerar formatos como "e025136-15", "1/ e135", "1-11", "e19764"
  //  , [v. N,] [p. P,] [AAAA-MM,] AAAA.
  // P / V são "lazy" para tolerar formatos como "e025136-15", "1/ e135", "1-11", "e19764"
  const pubRegex = /,\s*(?:v\.\s*([^,]+?)\s*,\s*)?(?:p\.\s*([^,]+?)\s*,\s*)?(?:\d{4}-\d{2}\s*,\s*)?(\d{4})\s*\.?(?:\s*Cita.*?\d+)?$/i;
  const match = cleanText.match(pubRegex);

  let authors = "Autores Não Identificados";
  let title = "Título Não Identificado";
  let journal = "Periódico Não Identificado";
  let journalRaw = "";
  let year = null;
  let volume = "";
  let pages = "";
  let extractedIssn = null;

  if (match) {
    volume = match[1] ? match[1].trim() : "";
    pages = match[2] ? match[2].trim() : "";
    year = parseInt(match[3], 10);

    const mainBlock = cleanText.substring(0, match.index).trim();
    extractedIssn = extractISSNFromText(mainBlock);

    // Isolar o periódico: procurar o último ponto final fora de parênteses
    // (siglas abreviadas como "OSCE:", "MMSE:", "ACE-R" não devem ser confundidas).
    let nesting = 0;
    let lastDotIndex = -1;
    for (let i = 0; i < mainBlock.length; i++) {
      const ch = mainBlock[i];
      if (ch === '(') nesting++;
      else if (ch === ')') nesting--;
      else if (ch === '.' && nesting === 0) {
        const textAfter = mainBlock.substring(i + 1).trim();
        // Ignora ponto seguido apenas por qualificador entre parênteses
        if (!textAfter.startsWith('(')) lastDotIndex = i;
      }
    }

    let remainingBlock = mainBlock;
    if (lastDotIndex !== -1) {
      journal = mainBlock.substring(lastDotIndex + 1).trim();
      remainingBlock = mainBlock.substring(0, lastDotIndex).trim();
    } else {
      journal = mainBlock;
    }
    journalRaw = journal;

    // Tratar padrão Lattes "Título-Subtítulo" — usar só a primeira parte p/ matching
    // O hífen já foi convertido para espaço em normalizeString, mas preservamos
    // journalRaw original. Aqui detectamos separadores longos (" - " ou " – "):
    journal = splitJournalTitleSubTitle(journal);

    // Separar autores e título no ponto final após o último ponto-e-vírgula
    const lastSemicolon = remainingBlock.lastIndexOf(";");
    if (lastSemicolon !== -1) {
      const firstDotAfterSemicolon = remainingBlock.indexOf(".", lastSemicolon);
      if (firstDotAfterSemicolon !== -1) {
        authors = remainingBlock.substring(0, firstDotAfterSemicolon).trim();
        title = remainingBlock.substring(firstDotAfterSemicolon + 1).trim();
      } else {
        authors = remainingBlock.substring(0, lastSemicolon).trim();
        title = remainingBlock.substring(lastSemicolon + 1).trim();
      }
    } else {
      // Autor único: pegar primeiro ponto após sobrenome maiúsculo
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
      journalRaw = journal;
      journal = splitJournalTitleSubTitle(journal);
    } else {
      title = cleanText;
    }
    extractedIssn = extractISSNFromText(cleanText);
  }

  // Limpar pontos finais residuais
  title = title.replace(/\.$/, "").trim();

  let type = 'article';
  if (isCongressProceedings(journal) || isCongressProceedings(title)) {
    type = 'congresso';
  }

  return {
    authors,
    title,
    journal,
    journalRaw,
    year,
    volume,
    pages,
    type,
    extractedIssn,
  };
}

/**
 * Quebra um nome de periódico que contém separador de subtítulo
 * (hífen isolado, travessão) e retorna apenas a primeira parte.
 *
 * Casos típicos do Lattes:
 *   "Simulation In Healthcare-Journal Of The Society For Simulation In Healthcare"
 *      -> "Simulation In Healthcare"
 *
 * Heurística: só quebrar se houver pelo menos 3 palavras antes e depois
 * do separador, para não destruir abreviações como "ACE-R".
 *
 * @param {string} journal
 * @returns {string}
 */
function splitJournalTitleSubTitle(journal) {
  if (!journal) return journal;
  // Match padrão "cabeça - calda" (hífen/travessão isolado entre espaços,
  // ou hífen entre palavras de >=3 chars).
  const m = journal.match(/^(.{3,}?)\s*[-–]\s*(.{3,})$/);
  if (!m) return journal;

  const head = m[1].trim();
  const tail = m[2].trim();
  const headWords = head.split(/\s+/).length;
  const tailWords = tail.split(/\s+/).length;

  // Critério conservador:
  //   - head deve ter >=3 palavras (para evitar cortar abreviações/siglas
  //     como "REBEN - X" ou "REVISTA IBERO - AMERICANA") e
  //   - tail deve ser substancialmente mais longa (>=1.5x palavras) —
  //     indica expansão do nome, não categoria entre hifens.
  // Exemplo válido: "Simulation In Healthcare-Journal Of The Society For Simulation In Healthcare"
  //   head = 3 palavras, tail = 8 palavras → split (>1.5x).
  // Exemplo inválido: "REBEN - REVISTA BRASILEIRA DE ENFERMAGEM"
  //   head = 1 palavra → não split (head é sigla, tail contém nome real).
  // Exemplo inválido: "INTERFACES CIENTÍFICAS - HUMANAS E SOCIAIS"
  //   head = 2 palavras → não split.
  if (headWords >= 3 && tailWords >= 3 && tailWords >= headWords * 1.5) {
    return head;
  }
  return journal;
}

/**
 * Calcula contagem de documentos (df) por termo na base local.
 * Usado para ponderar IDF no score Jaccard.
 * Resultado memoizado por dbItems (referência).
 */
let _dfCache = null;
let _dfCacheRef = null;
function computeDocumentFrequency(dbItems) {
  if (_dfCacheRef === dbItems && _dfCache) return _dfCache;
  const df = new Map();
  for (const item of dbItems) {
    if (!item.title) continue;
    const norm = normalizeString(item.title);
    if (!norm) continue;
    const seen = new Set();
    for (const tok of norm.split(" ")) {
      if (tok.length < 2) continue;
      if (seen.has(tok)) continue;
      seen.add(tok);
      df.set(tok, (df.get(tok) || 0) + 1);
    }
  }
  _dfCache = df;
  _dfCacheRef = dbItems;
  return df;
}

/**
 * Tokeniza uma string normalizada em um Set de termos,
 * filtrando tokens muito curtos.
 * @param {string} norm
 * @returns {Set<string>}
 */
function tokenize(norm) {
  const set = new Set();
  if (!norm) return set;
  for (const tok of norm.split(" ")) {
    if (tok.length < 2) continue;
    set.add(tok);
  }
  return set;
}

/**
 * Peso IDF de um termo. Stopwords generalistas (REVISTA, JOURNAL,
 * SAUDE, etc.) recebem peso 0.1. Demais termos recebem
 * log((N+1)/(df+1)) + 1.
 *
 * @param {string} term
 * @param {Map<string,number>} df
 * @param {number} N total de documentos
 * @returns {number}
 */
function idfWeight(term, df, N) {
  if (GENERIC_TERMS.has(term)) return 0.1;
  const d = df.get(term) || 0;
  return Math.log((N + 1) / (d + 1)) + 1;
}

/**
 * Score de similaridade Jaccard ponderado por IDF.
 * Soma dos pesos dos termos na interseção dividida pela soma de pesos
 * na união. Faz uma ponderação mais justa para títulos com termos
 * distintivos (DERME, NUTRICAO, OSCE) versus termos genericos.
 *
 * @param {Set<string>} qTokens
 * @param {Set<string>} dbTokens
 * @param {Map<string,number>} df
 * @param {number} N
 * @returns {number} score em [0,1]
 */
function weightedJaccard(qTokens, dbTokens, df, N) {
  let interW = 0;
  let unionW = 0;
  for (const t of qTokens) {
    const w = idfWeight(t, df, N);
    unionW += w;
    if (dbTokens.has(t)) interW += w;
  }
  for (const t of dbTokens) {
    if (qTokens.has(t)) continue;
    unionW += idfWeight(t, df, N);
  }
  if (unionW === 0) return 0;
  return interW / unionW;
}

/**
 * Resolve o nome de um periódico para o seu correspondente ISSN na base de dados.
 *
 * Retorna um objeto { issn, confidence, score, candidates } onde:
 *   - confidence: "high" | "review" | "none"
 *   - score: valor numérico do melhor match (para debug/UI)
 *   - candidates: top-3 candidatos do DB (para modal de troca manual)
 *
 * @param {string} journalName Nome (ou abreviação) do periódico
 * @param {Array} dbItems Lista de periódicos da base local
 * @returns {{issn: string|null, confidence: string, score: number, candidates: Array}}
 */
export function matchJournalToISSN(journalName, dbItems) {
  if (!journalName || !dbItems || dbItems.length === 0) {
    return { issn: null, confidence: "none", score: 0, candidates: [] };
  }

  const normalizedQuery = normalizeString(journalName);
  if (!normalizedQuery) {
    return { issn: null, confidence: "none", score: 0, candidates: [] };
  }

  const candidates = [];

  // 1. Alias lookup (aliases.json + user aliases merged em initLattesParser)
  if (LATTES_ALIASES[normalizedQuery]) {
    const issn = LATTES_ALIASES[normalizedQuery];
    candidates.push({ issn, title: journalName, score: 1.0 });
    return { issn, confidence: "high", score: 1.0, candidates };
  }

  // 2. Match exato de string normalizada
  for (const item of dbItems) {
    if (!item.title) continue;
    const normDbTitle = normalizeString(item.title);
    if (normDbTitle === normalizedQuery) {
      candidates.push({ issn: item.issn, title: item.title, score: 1.0 });
      return { issn: item.issn, confidence: "high", score: 1.0, candidates };
    }
  }

  // 3. Containment: todos os tokens (>=2 chars) da query existem em algum título DB
  //    Desempate por MENOR comprimento do título (preferir conciso)
  const qTokens = tokenize(normalizedQuery);
  const containmentHits = [];
  for (const item of dbItems) {
    if (!item.title) continue;
    const normDbTitle = normalizeString(item.title);
    const dbTokensSet = tokenize(normDbTitle);
    let allIn = true;
    for (const t of qTokens) {
      if (!dbTokensSet.has(t)) { allIn = false; break; }
    }
    if (allIn && qTokens.size > 0) {
      containmentHits.push({
        issn: item.issn,
        title: item.title,
        normTitle: normDbTitle,
        length: normDbTitle.length,
      });
    }
  }
  if (containmentHits.length > 0) {
    containmentHits.sort((a, b) => a.length - b.length);
    const best = containmentHits[0];
    candidates.push(
      ...containmentHits.slice(0, 3).map(h => ({
        issn: h.issn, title: h.title, score: 0.95
      }))
    );
    return { issn: best.issn, confidence: "high", score: 0.95, candidates };
  }

  // 4-5. Jaccard-IDF ponderado + Jaro-Winkler como desempate
  const df = computeDocumentFrequency(dbItems);
  const N = dbItems.length;

  // Pré-filtragem: candidatos que compartilham ao menos 1 token
  const fuzzyCandidates = [];
  for (const item of dbItems) {
    if (!item.title) continue;
    const normDbTitle = normalizeString(item.title);
    const dbTokensSet = tokenize(normDbTitle);
    let inter = 0;
    for (const t of qTokens) if (dbTokensSet.has(t)) inter++;
    if (inter === 0) continue;
    const jaccard = weightedJaccard(qTokens, dbTokensSet, df, N);
    fuzzyCandidates.push({
      issn: item.issn,
      title: item.title,
      normTitle: normDbTitle,
      jaccard,
    });
  }

  if (fuzzyCandidates.length === 0) {
    return { issn: null, confidence: "none", score: 0, candidates: [] };
  }

  // Combinar Jaccard + Jaro-Winkler como desempate pós-filtro
  // Score final = 0.7 * Jaccard + 0.3 * JaroWinkler
  for (const c of fuzzyCandidates) {
    const jw = jaroWinkler(normalizedQuery, c.normTitle);
    c.score = 0.7 * c.jaccard + 0.3 * jw;
    c.jw = jw;
  }

  fuzzyCandidates.sort((a, b) => b.score - a.score);

  const best = fuzzyCandidates[0];
  const top3 = fuzzyCandidates.slice(0, 3).map(c => ({
    issn: c.issn, title: c.title, score: c.score
  }));

  // Threshold adaptativo:
  //   >= 0.78  -> "high"
  //   0.62–0.78 -> "review"
  //   < 0.62   -> "none"
  let confidence = "none";
  if (best.score >= 0.78) confidence = "high";
  else if (best.score >= 0.62) confidence = "review";

  return {
    issn: confidence === "high" ? best.issn : (confidence === "review" ? best.issn : null),
    confidence,
    score: best.score,
    candidates: top3,
  };
}

/**
 * Salva um alias aprendido pelo usuário (manual override) em localStorage.
 * Permite feedback loop: se o usuário troca uma classificação, o par
 * (nome normalizado -> ISSN) fica persistente para futuras execuções.
 *
 * @param {string} journalName
 * @param {string} issn
 */
export function saveUserAlias(journalName, issn) {
  if (!journalName || !issn) return;
  try {
    const userAliases = JSON.parse(localStorage.getItem('lattes_user_aliases') || '{}');
    userAliases[normalizeString(journalName)] = issn;
    localStorage.setItem('lattes_user_aliases', JSON.stringify(userAliases));
    LATTES_ALIASES[normalizeString(journalName)] = issn;
  } catch (_) { /* ignore */ }
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

    // ISSN extraído literalmente do texto tem precedência sobre
    // qualquer match fuzzy — é evidência primária.
    let matchResult;
    if (parsed.extractedIssn) {
      matchResult = {
        issn: parsed.extractedIssn,
        confidence: "high",
        score: 1.0,
        candidates: [],
      };
    } else {
      matchResult = matchJournalToISSN(parsed.journal, dbItems);
    }

    results.push({
      ...parsed,
      matchedIssn: matchResult.issn,
      confidence: matchResult.confidence,
      matchScore: matchResult.score,
      matchCandidates: matchResult.candidates || [],
    });
  }

  return results;
}