import { parseLattesText, initLattesParser } from './js/lattesParser.js';
import fs from 'fs';

async function main() {
    await initLattesParser();
    
    // Simulate dbItems with at least BMC NURSING
    const dbItems = [
        { issn: '1472-6955', title: 'BMC NURSING', area: 'Enfermagem' },
        { issn: '2675-4304', title: 'REVISTA ENFERMAGEM ATUAL IN DERME', area: 'Enfermagem' },
        { issn: '1472-6920', title: 'BMC Medical Education', area: 'Outras Áreas' },
        { issn: '2175-5361', title: 'Revista de Pesquisa: Cuidado é Fundamental (Online)', area: 'Enfermagem' },
        { issn: '1657-5997', title: 'AQUICHAN (BOGOTÁ)', area: 'Enfermagem' }
    ];
    
    const text = `ONCEIÇÃO, BRENDA SOUSA DA ; JACINTO, ARTHUR FEITOSA ; NEGRI, ELAINE CRISTINA ; LIMA, GLEICIANE KÉLEN ; REBOUÇAS, TATYANE OLIVEIRA ; SOARES, FRANCISCO MAYRON MORAIS . Global nursing competency scale in blood transfusion: development and psychometric validity. BMC NURSING (ONLINE), v. 26, p. 1, 2026.

2.
BORGES, ALEXANDRE RIBEIRO ; DA CONCEIÇÃO, BRENDA SOUSA ; DE ANDRADE, CAMILO HUGO FREITAS ; DE OLIVEIRA, LARA LEITE ; SANTOS QUEIROZ, LUANDA DE SANTANA ; ALBUQUERQUE SAMPAIO, LUIZ FERNANDO DE ; CONCEIÇÃO CRUZ, NAGYLA LAYS ; MORAIS SOARES, FRANCISCO MAYRON . ANÁLISE DO CONCEITO DE TRANSFUSÃO SANGUÍNEA: IMPLICAÇÕES PARA O CUIDAR EM ENFERMAGEMANALYSIS OF THE CONCEPT OF BLOOD TRANSFUSION: IMPLICATIONS FOR NURSING CAREANÁLISIS DEL CONCEPTO DE TRANSFUSIÓN SANGUÍNEA: IMPLICACIONES PARA LA ATENCIÓN DE ENFERMERÍA. REVISTA ENFERMAGEM ATUAL IN DERME, v. 100, p. e026037, 2026.

3.
SOARES, FRANCISCO MAYRON MORAIS; ARAUJO, LUCAS RIBEIRO ; NEGRI, ELAINE CRISTINA ; BRAGA, FRANCISCO LUAN SOUSA ; FONSECA, LUCIANA MARA MONTI . Development and content validity of an educational manual on nursing care in blood transfusion. BMC Medical Education, v. 2026, p. 1, 2026.

4.
VIANA DE SOUSA, KARLOS ADRYAN ; DA CONCEIÇÃO, BRENDA SOUSA ; JACINTO, ARTHUR FEITOSA ; FREITAS JÚNIOR, ISMAEL FORTE ; NEGRI, ELAINE CRISTINA ; FROTA LIMA RODRIGUES, ANA BEATRIZ ; MORAIS SOARES, FRANCISCO MAYRON . Cognitive knowledge of nursing students about surgical site infection: a cross-sectional study / Conhecimento cognitivo entre estudantes de enfermagem sobre infecção de sítio cirúrgico: estudo transversal. Revista de Pesquisa: Cuidado é Fundamental (Online), v. 18, p. 1, 2026.

5.
SOARES, FRANCISCO MAYRON MORAIS; ARAUJO, LUCAS RIBEIRO ; RODRIGUES, ANA BEATRIZ FROTA LIMA ; MAGALHÃES, DAVI SANTOS ; LIMA, GLEICIANE KÉLEN ; NEGRI, ELAINE CRISTINA . Nursing Care for Adult Patients Undergoing Blood Transfusion: A Scoping Review. AQUICHAN (BOGOTÁ), v. 25, p. 1-20, 2025. Citações:2

6.
MARQUES DE OLIVEIRA, CALLIANDRA CRISTINA ; FEITOSA JACINTO, ARTHUR ; PEREIRA BRASILEIRO NEVES, HELLEN ; FROTA LIMA RODRIGUES, ANA BEATRIZ ; ALVES LIMA JUNIOR, FRANCISCO ; Mayron Morais Soares, Francisco . ANÁLISE DE CONCEITO DE REAÇÃO TRANSFUSIONAL PARA A ENFERMAGEM. REVISTA ENFERMAGEM ATUAL IN DERME, v. 99, p. e025072, 2025.
`;
    
    const parsed = parseLattesText(text, dbItems);
    for (const p of parsed) {
        console.log(`Matched ISSN: ${p.matchedIssn} | Journal: ${p.journal}`);
    }
}

main().catch(console.error);
