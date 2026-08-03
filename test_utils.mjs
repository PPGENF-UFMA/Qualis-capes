import assert from 'node:assert/strict';

import { generateCSV, parseCSV, processCSVData } from './js/utils.js';

const quoted = parseCSV('ISSN;Título\r\n0034-7167;"Revista ""Brasileira""\nde Enfermagem"');
assert.equal(quoted.length, 2);
assert.equal(quoted[1][1], 'Revista "Brasileira"\nde Enfermagem');

const headerless = processCSVData(parseCSV('0034-7167;Revista Brasileira de Enfermagem\n1984-0446;Outro artigo'));
assert.equal(headerless.length, 2);
assert.equal(headerless[0].issn, '0034-7167');

const csv = generateCSV([{
  title: 'Teste',
  issn: '0034-7167',
  data_status: 'error',
  area: 'Enfermagem',
  jcr: null,
  citeScore: null,
  indexers: [],
  metrics: {},
  classification: { estrato: 'NC', justification: 'Falha técnica' }
}]);
assert.match(csv, /Status da Consulta/);
assert.match(csv, /ERRO TÉCNICO/);
assert.equal(processCSVData(parseCSV(`# metadados\r\n${csv}`)).length, 1);

console.log('test_utils.mjs: ok');
