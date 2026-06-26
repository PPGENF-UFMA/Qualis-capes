/**
 * Suite de regressão do parser Lattes (lattesParser.js).
 *
 * Executa:  node test_parser.js
 *
 * Strategy:
 *   1. Carrega data/journals.json como dbItems ({issn, title, area}).
 *   2. Mocka fetch global p/ retornar js/aliases.json.
 *   3. Importa dinamicamente js/lattesParser.js (ES module).
 *   4. Segmenta + parseia cada artigo da lista CV abaixo e compara
 *      o ISSN retornado com o esperado.
 *
 * Falha com exit code 1 se qualquer caso divergir.
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

// --- 1. Mock fetch global ------------------------------------------------
const aliasesRaw = readFileSync(join(ROOT, 'js', 'aliases.json'), 'utf-8');
globalThis.fetch = async (url) => {
  if (String(url).includes('aliases.json')) {
    return { ok: true, json: async () => JSON.parse(aliasesRaw) };
  }
  throw new Error(`unexpected fetch: ${url}`);
};

// localStorage mock
globalThis.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};

// --- 2. Carregar dbItems -------------------------------------------------
const db = JSON.parse(readFileSync(join(ROOT, 'data', 'journals.json'), 'utf-8'));
const dbItems = Object.entries(db).map(([issn, rec]) => ({
  issn,
  title: rec.title || '',
  area: rec.area || 'Outras Áreas',
}));

// --- 3. Importar lattesParser.js -----------------------------------------
const parser = await import(pathToFileURL(join(ROOT, 'js', 'lattesParser.js')).href);
await parser.initLattesParser();

// --- 4. Casos de regressão (texto integral de cada artigo) --------------
const ARTICLES = [
  {
    id: 1,
    text: 'DE DEUS CABRAL JÚNIOR, JOÃO ; DE OLIVEIRA, BRUNO LUCIANO CARNEIRO ALVES ; SIMON, SHARON SANZ ; PASSINHO, JHULE SILVA ; CAPPI, CAROLINA ; BERTOLA, LAISS ; ALVES, CANDIDA HELENA L. ; SIMÕES, VANDA M. F. ; ALVES, GILBERTO SOUSA . Accuracy of the revised Addenbrooke Cognitive Examination (ACE-R) and Mini-Mental (MMSE) in a Quilombola community with low education attainment: results of a cross-sectional study. Frontiers in Dementia, v. 4, p. 1-11, 2026.',
    expectedIssn: '2813-3919',
    expectedJournal: 'FRONTIERS IN DEMENTIA',
  },
  {
    id: 2,
    text: 'LIMA, KASSYA FERNANDA FREIRE ; SANTANA, MARTA SILVA DE ; SANTOS, GIRLANE CAROLINE PEREIRA ; CRUZ, PABLO NASCIMENTO ; ABREU, THAYSA TOES TRINTA ; PASCOAL, LÍVIA MAIA ; BATISTA, ROSÂNGELA FERNANDES LUCENA ; DIAS, ROSILDA SELVA ; OLIVEIRA, BRUNO LUCIANO CARNEIRO ALVES DE . Trends and spatial distribution of pediatric second-dose COVID-19 vaccination coverage: a temporal analysis, Brazil, 2022-2023. EPIDEMIOLOGIA E SERVIÇOS DE SAÚDE, v. 35, p. 1-13, 2026.',
    expectedIssn: '2237-9622',
    expectedJournal: 'EPIDEMIOLOGIA E SERVIÇOS DE SAÚDE',
  },
  {
    id: 3,
    text: 'BARROS, ANDRIO CORRÊA ; RODRIGUES, EVANDICLEUDE FERREIRA DE CARVALHO ; REGO, JULIANA DO NASCIMENTO MORAES ; BARROSO, SUELEN GONÇALVES ; OLIVEIRA, BRUNO LUCIANO CARNEIRO ALVES DE ; PÁSCOAL, LÍVIA MAIA . MUDANÇAS NA PREVALÊNCIA DA COBERTURA DE PLANOS MÉDICOS DE SAÚDE ENTRE ADULTOS NO BRASIL: ANÁLISE COMPARATIVA DA PESQUISA NACIONAL DE SAÚDE (2013 E 2019) CHANGES IN THE PREVALENCE OF HEALTH INSURANCE COVERAGE AMONG ADULTS IN BRAZIL: A COMPARATIVE ANALYSIS OF THE NATIONAL HEALTH SURVEY (2013 AND 2019) CAMBIOS EN LA PREVALENCIA DE LA COBERTURA DE PLANES DE SALUD ENTRE ADULTOS EN BRASIL: ANÁLISIS COMPAR. Revista Ibero-Americana de Humanidades, Ciências e Educação, v. 12, p. 1-16, 2026.',
    expectedIssn: '2675-3375',
    expectedJournal: 'REVISTA IBERO-AMERICANA DE HUMANIDADES, CIÊNCIAS E EDUCAÇÃO',
  },
  {
    id: 4,
    text: 'FONTENELE, ARACELI MOREIRA DE MARTINI ; SANTOS, ALCIONE MIRANDA DOS ; GÓMEZ, LUZ MARINA GÓMEZ ; SILVA, FÁBIO NOGUEIRA DA ; OLIVEIRA, BRUNO LUCIANO CARNEIRO ALVES DE . Associated costs of hospitalizations due to external causes: time series analysis, Brazil, 2000-2023. EPIDEMIOLOGIA E SERVIÇOS DE SAÚDE, v. 35, p. 1-18, 2026.',
    expectedIssn: '2237-9622',
    expectedJournal: 'EPIDEMIOLOGIA E SERVIÇOS DE SAÚDE',
  },
  {
    id: 5,
    text: 'LACERDA, E. P. ; LIMA, S. F. ; OLIVEIRA, B. L. C. A. . Saúde da criança quilombola como desafio para os Objetivos de Desenvolvimento Sustentável: revisão de escopo. REBEN - REVISTA BRASILEIRA DE ENFERMAGEM, v. 77, p. 1-11, 2025.',
    expectedIssn: '0034-7167',
    expectedJournal: 'REBEN - REVISTA BRASILEIRA DE ENFERMAGEM',
  },
  {
    id: 6,
    text: 'SILVA, DENISE MONTENEGRO DA ; CAVALCANTE, YANKA ALCÂNTARA ; OLIVEIRA, BRUNO LUCIANO CARNEIRO ALVES DE ; LOPES, MARCOS VENÍCIOS DE OLIVEIRA ; FERNANDES, ANA FÁTIMA CARVALHO ; PINHEIRO, ANA KARINA BEZERRA ; AQUINO, PRISCILA DE SOUZA . Social health determinants associated with mammography performance according to the 2013 and 2019 National Health Survey. Ciência & Saúde Coletiva, v. 30, p. 1-12, 2025. Citações:3',
    expectedIssn: '1678-4561',
    expectedJournal: 'CIÊNCIA & SAÚDE COLETIVA',
  },
  {
    id: 7,
    text: 'CRUZ, PABLO NASCIMENTO ; FERNANDA FREIRE LIMA, KASSYA ; LIRA FILHO, RIVALDO ; LUCIANO CARNEIRO ALVES DE OLIVEIRA, BRUNO ; SANTOS NETO, MARCELINO ; PEREIRA COSTA RABELO, POLIANA . ATENÇÃO AO PARTO E NASCIMENTO: boas práticas de residentes de enfermagem em uma maternidade nordestina. REVISTA DE CIÊNCIAS MÉDICAS E BIOLÓGICAS, v. 24, p. 171-178, 2025.',
    expectedIssn: '2236-5222',
    expectedJournal: 'REVISTA DE CIÊNCIAS MÉDICAS E BIOLÓGICAS',
  },
  {
    id: 8,
    text: 'LIMA, KÁSSYA FERNANDA FREIRE ; SANTOS, GIRLANE CAROLINE PEREIRA ; SANTANA, MARTA SILVA DE ; CRUZ, PABLO NASCIMENTO ; BARROSO, SUELEN GONÇALVES ; SOARES, FABIANA ALVES ; SANTOS, JARDEL DA SILVA ; MOURA, MERYHELEN COSTA ; BORGES, TEREZA CRISTINA SILVA ; OLIVEIRA, BRUNO LUCIANO CARNEIRO ALVES DE . Infecção pela COVID-19, perfil sociodemográfico e percepções sobre vacinação no Brasil. REVISTA ELETRÔNICA ACERVO EM SAÚDE, v. 25, p. e19764, 2025.',
    expectedIssn: '2178-2091',
    expectedJournal: 'REVISTA ELETRÔNICA ACERVO EM SAÚDE',
  },
  {
    id: 9,
    text: 'MARTINS NETO, C. ; OLIVEIRA, B. L. C. A. . Prevalência e fatores associados à discriminação percebida por adolescentes de uma capital do Nordeste brasileiro. CADERNOS SAÚDE COLETIVA, v. 2, p. 1-13, 2025.',
    expectedIssn: '2358-291X',
    expectedJournal: 'CADERNOS SAÚDE COLETIVA',
  },
  {
    id: 10,
    text: 'MENEZES, M. S. A. ; TEIXEIRA, R. G. S. ; LACERDA, E. P. ; VIOLA, P. C. A. F. ; OLIVEIRA, B. L. C. A. . Padrões alimentares e fatores associados a pessoas idosas quilombolas: análise com Classes Latentes. REVISTA BRASILEIRA DE GERIATRIA E GERONTOLOGIA, v. 1, p. 1-12, 2025.',
    expectedIssn: '1981-2256',
    expectedJournal: 'REVISTA BRASILEIRA DE GERIATRIA E GERONTOLOGIA',
  },
  {
    id: 11,
    text: 'SOARES TEIXEIRA, RENATA GABRIELA ; MOREIRA DA SILVA SOEIRO, VANESSA ; CARNEIRO ALVES DE OLIVEIRA, BRUNO LUCIANO ; CABRAL JUNIOR, JOÃO DE DEUS ; LEITE OLIVEIRA, LUIS FELIPE ; CORDEIRO MARTINS, JULIANA ; SANTANA LIMA, ALICE BIANCA . INFORMAÇÕES DE SAÚDE DE CRIANÇAS DE COMUNIDADES REMANESCENTES QUILOMBOLAS DE BEQUIMÃO - MA. DESAFIOS: REVISTA INTERDISCIPLINAR DA UNIVERSIDADE FEDERAL DO TOCANTINS, v. 12, p. 1-13, 2025.',
    expectedIssn: '2359-3652',
    expectedJournal: 'DESAFIOS: REVISTA INTERDISCIPLINAR DA UNIVERSIDADE FEDERAL DO TOCANTINS',
  },
  {
    id: 12,
    text: 'SIMON, S. S. ; CAPPI, C. ; CABRAL JUNIOR, J. D. ; TEIXEIRA, R. G. S. ; ALVES, G. S. ; OLIVEIRA, B. L. C. A. . The role of social participation in cognitive health in an underserved older population: Evidence from Afrobrazilian-Quilombola Communities. INTERNATIONAL PSYCHOGERIATRICS, v. 1, p. 1-9, 2025. Citações:1',
    expectedIssn: '1041-6102',
    expectedJournal: 'INTERNATIONAL PSYCHOGERIATRICS',
  },
  {
    id: 13,
    text: 'MARINHO, G. L. ; PAZ, E. P. A. ; LUCENA, J. R. M. ; NASCIMENTO, V. F. ; OLIVEIRA, B. L. C. A. ; TAVARES, F. G. . HOSPITALIZAÇÕES DE CRIANÇAS INDÍGENAS POR CAUSAS SENSÍVEIS À ATENÇÃO PRIMÁRIA NOS DISTRITOS SANITÁRIOS ESPECIAIS INDÍGENAS. ENFERMAGEM EM FOCO DO COFEN, v. 1, p. 1-7, 2025.',
    expectedIssn: '2357-707X',
    expectedJournal: 'ENFERMAGEM EM FOCO DO COFEN',
  },
  {
    id: 14,
    text: 'SILVEIRA, GIOVANNA EVELYN LUNA ; FREITAS, BRUNA BARROSO DE ; OLIVEIRA, RAQUEL ALVES DE ; ABREU, VICTÓRYA SUÉLLEN MACIEL ; OLIVEIRA, BRUNO LUCIANO CARNEIRO ALVES DE ; JORGE, HERLA MARIA FURTADO ; PINHEIRO, ANA KARINA BEZERRA ; AQUINO, PRISCILA DE SOUZA . Predictors of inadequacy of prenatal tests of postpartum women: a cross-sectional study. REVISTA BRASILEIRA DE ENFERMAGEM, v. 78, p. 1-8, 2025.',
    expectedIssn: '0034-7167',
    expectedJournal: 'REVISTA BRASILEIRA DE ENFERMAGEM',
  },
  {
    id: 15,
    text: 'DIAS JÚNIOR, JOSÉ DE JESUS ; DOS SANTOS, ALCIONE MIRANDA ; CARNEIRO ALVES DE OLIVEIRA, BRUNO LUCINANO . Tendências do tempo médio de hospitalização de pacientes adultos acometidos pela COVID-19, nordeste do Brasil, 2020-2022. REVISTA ELETRÔNICA ACERVO EM SAÚDE, v. 25, p. e21492-10, 2025.',
    expectedIssn: '2178-2091',
    expectedJournal: 'REVISTA ELETRÔNICA ACERVO EM SAÚDE',
  },
  {
    id: 16,
    text: 'DA CRUZ ANDRADE, THÁTILA LARISSA ; FERREIRA DE CARVALHO RODRIGUES, EVANDICLEUDE ; CARVALHO SILVA, LÍSCIA DIVANA ; CARNEIRO ALVES DE OLIVEIRA, BRUNO LUCIANO ; DE LIMA SARDINHA, ANA HÉLIA ; PORTELA SILVA COUTINHO, NAIR . RODA DE CONVERSA SOBRE EDUCAÇÃO SEXUAL NO CENÁRIO ESCOLAR: RELATO DE EXPERIÊNCIA. INTERFACES CIENTÍFICAS - HUMANAS E SOCIAIS, v. 12, p. 485-496, 2025.',
    expectedIssn: '2316-3801',
    expectedJournal: 'INTERFACES CIENTÍFICAS - HUMANAS E SOCIAIS',
  },
  {
    id: 17,
    text: 'NASCIMENTO CRUZ, PABLO ; LIRA FILHO, RIVALDO ; FERNANDA FREIRE LIMA, KASSYA ; FRAZÃO LINDOSO, RAYLENE ; COSTA SOEIRO, TERESA ; PINHEIRO ARAÚJO, THAYNARA ; BRASIL TORRES, JANETE ; LUCIANO CARNEIRO ALVES DE OLIVEIRA, BRUNO ; SANTOS NETO, MARCELINO ; PEREIRA COSTA RABELO, POLIANA . INTERVENÇÕES NA ASSISTÊNCIA AO PARTO POR RESIDENTES DE ENFERMAGEM DE UMA MATERNIDADE NORDESTINA: ESTUDO TRANSVERSAL. REVISTA ENFERMAGEM ATUAL IN DERME, v. 99, p. e025136-15, 2025.',
    expectedIssn: '2447-2034',
    expectedJournal: 'REVISTA ENFERMAGEM ATUAL IN DERME',
  },
  {
    id: 18,
    text: 'SIMON, SHARON SANZ ; CAPPI, CAROLINA ; JUNIOR, JOÃO DE DEUS CABRAL ; ALVES, GILBERTO SOUSA ; DE OLIVEIRA, BRUNO LUCIANO CARNEIRO ALVES . Social Engagement is associated with better cognition in Quilombola Communities: Insights for Engaging underserved Brazilian Populations in Alzheimer?s Disease Research. Alzheimers & Dementia, v. 20, p. 1-1, 2025.',
    expectedIssn: '1552-5260',
    expectedJournal: 'ALZHEIMERS & DEMENTIA',
  },
];

// Casos ad-hoc reportados pelo usuário (não no CV acima, mas na análise)
const EXTRA = [
  {
    id: 'EX1-SimulationSubtitulo',
    text: 'COLONHESE, MILENA ; LIMA, SARA F. ; NEGRI, ELAINE C. ; GIRÃO, FERNANDA B. ; GIOVANAZZI, ROSIMEIRE S.D. ; PEREIRA JÚNIOR, GERSON A. . Cost Analysis of the OSCE: Scoping Review. Simulation In Healthcare-Journal Of The Society For Simulation In Healthcare, v. 20, p. 1-14, 2026.',
    expectedIssn: '1559-713X',
    expectedJournal: 'SIMULATION IN HEALTHCARE',
  },
  {
    id: 'EX2-AnoComposta',
    text: 'SANTOS, MARCOS MACIEL CANDIDO JUSTINO DOS ; LIMA, SARA FITERMAN ; VIEIRA, CARINE FREITAS GALVÃO ; SLULLITEL, ALEXANDRE ; SANTOS, ELAINE CRISTINA NEGRI ; PEREIRA JÚNIOR, GERSON ALVES . In situ simulation and its different applications in healthcare: an integrative review. REVISTA BRASILEIRA DE EDUCAÇÃO MÉDICA (ONLINE), v. 47, p. 1/ e135, 2023-12, 2023.',
    // Sem expectedIssn específico — apenas valida que extraiu ano 2023 e
    // não capturou "1/ e135, 2023-12" como ISSN inválido
    expectValidYear: 2023,
    expectNoBadIssn: true,
  },
  {
    id: 'EX3-CadernosNutricaoNaoDeveVencer',
    text: 'MOREIRA, JACQUELINE DUTRA NASCIMENTO ; LAMY, ZENI CARVALHO ; ROCHA, HORTÊNSIA COUTINHO DA ; ALBUQUERQUE, YANCA LACERDA ; LIMA, SARA FITERMAN . Desafios da atuação profissional durante a implantação de cuidados paliativos em pediatria: estudo qualitativo. CADERNOS SAÚDE COLETIVA, v. 33, p. 1-11, 2025.',
    expectedIssn: '2358-291X',
    expectedJournal: 'CADERNOS SAÚDE COLETIVA',
    expectNotIssn: '0103-9946', // CADERNOS DE SAÚDE COLETIVA E NUTRIÇÃO — NÃO deve ser selecionado
  },
  {
    id: 'EX4-EnfermagemIntegradaNaoDeveVencer',
    text: 'DINIZ, SHIRLEY PRISCILA MARTINS CHAGAS DINIZ ; MELO PEREIRA, DÉBORA LORENA ; CARDOSO DE AQUINO, DORLENE MARIA ; CARNEIRO ALVES DE OLIVEIRA, BRUNO LUCIANO ; PEREIRA COSTA RABELO, POLIANA ; TAVARES PALMEIRA ROLIM, ISAURA LETICIA . IMPACTO DA COVID-19 NA ASSISTÊNCIA ÀS PESSOAS ACOMETIDAS PELA HANSENÍASE. REVISTA ENFERMAGEM ATUAL IN DERME, v. 97, p. e023078-8, 2023.',
    expectedIssn: '2447-2034',
    expectedJournal: 'REVISTA ENFERMAGEM ATUAL IN DERME',
    expectNotIssn: '1984-7602', // REVISTA ENFERMAGEM INTEGRADA — NÃO deve vencer
  },
];

// --- Runner ---------------------------------------------------------------
let pass = 0, fail = 0;
const failed = [];
const all = [...ARTICLES, ...EXTRA];

for (const c of all) {
  const parsed = parser.parseSingleArticle(c.text);
  const match = parser.matchJournalToISSN(parsed.journal, dbItems);

  const issn = match.issn;
  const confidence = match.confidence;

  const checks = [];
  if (c.expectedIssn !== undefined) {
    checks.push({ label: `issn=${issn}`, ok: issn === c.expectedIssn });
  }
  if (c.expectedJournal) {
    checks.push({
      label: `journal=${parsed.journal}`,
      ok: parser.normalizeString(parsed.journal) === parser.normalizeString(c.expectedJournal),
    });
  }
  if (c.expectNotIssn) {
    checks.push({ label: `not_issn=${c.expectNotIssn}`, ok: issn !== c.expectNotIssn });
  }
  if (c.expectValidYear) {
    checks.push({ label: `year=${parsed.year}`, ok: parsed.year === c.expectValidYear });
  }
  if (c.expectNoBadIssn) {
    // parsed.extractedIssn deve ser null (não capturar "1/ e135" como ISSN)
    checks.push({
      label: `no_bad_issn (extracted=${parsed.extractedIssn})`,
      ok: !parsed.extractedIssn,
    });
  }

  const allOk = checks.every(c => c.ok);
  if (allOk) {
    pass++;
    console.log(`  ✓ #${c.id} — issn=${issn} conf=${confidence} journal="${parsed.journal}"`);
  } else {
    fail++;
    failed.push(c.id);
    console.log(`  ✗ #${c.id} — ${checks.map(c => c.label + (c.ok ? '✓' : '✗')).join(' | ')}`);
    console.log(`    parsed journal: "${parsed.journal}"`);
    console.log(`    parsed journalRaw: "${parsed.journalRaw || ''}"`);
    console.log(`    parsed year: ${parsed.year}, vol: "${parsed.volume}", pages: "${parsed.pages}"`);
    console.log(`    match: issn=${issn} conf=${confidence} score=${match.score?.toFixed(3)}`);
    if (match.candidates && match.candidates.length) {
      console.log(`    candidates:`);
      match.candidates.slice(0, 3).forEach(c => {
        console.log(`      - ${c.issn}  "${c.title}"  score=${(c.score || 0).toFixed(3)}`);
      });
    }
  }
}

console.log(`\n${pass}/${pass + fail} casos OK`);
if (fail > 0) {
  console.log(`FALHARAM: ${JSON.stringify(failed)}`);
  process.exit(1);
} else {
  console.log('Todos os casos de regressão passaram.');
  process.exit(0);
}