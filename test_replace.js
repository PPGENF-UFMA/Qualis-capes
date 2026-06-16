const text = `
E DEUS CABRAL JÚNIOR, JOÃO ; DE OLIVEIRA, BRUNO LUCIANO CARNEIRO ALVES ; SIMON, SHARON SANZ ; PASSINHO, JHULE SILVA ; CAPPI, CAROLINA ; BERTOLA, LAISS ; ALVES, CANDIDA HELENA L. ; SIMÕES, VANDA M. F. ; ALVES, GILBERTO SOUSA . Accuracy of the revised Addenbrooke Cognitive Examination (ACE-R) and Mini-Mental (MMSE) in a Quilombola community with low education attainment: results of a cross-sectional study. Frontiers in Dementia, v. 4, p. 1-11, 2026.
 Não classificado, ISSN 2813-3919 


Qualis (ISSN: 2813-3919)2020: undefined Qualis (ISSN: 2813-3919)2024: undefined

2.
LIMA, KASSYA FERNANDA FREIRE ; SANTANA, MARTA SILVA DE ; SANTOS, GIRLANE CAROLINE PEREIRA ; CRUZ, PABLO NASCIMENTO ; ABREU, THAYSA GOES TRINTA ; PASCOAL, LÍVIA MAIA ; BATISTA, ROSÂNGELA FERNANDES LUCENA ; DIAS, ROSILDA SILVA ; OLIVEIRA, BRUNO LUCIANO CARNEIRO ALVES DE . Trends and spatial distribution of pediatric second-dose COVID-19 vaccination coverage: a temporal analysis, Brazil, 2022-2023. EPIDEMIOLOGIA E SERVIÇOS DE SAÚDE, v. 35, p. 1-13, 2026.
 A2, ISSN 2237-9622, fonte Qualis/CAPES (2021-2024)  
`;

let cleanText = text.replace(/.*Qualis\s*\(ISSN:.*\n?/gi, "");
cleanText = cleanText.replace(/.*fonte Qualis\/CAPES.*\n?/gi, "");
cleanText = cleanText.replace(/.*Não classificado,\s*ISSN.*\n?/gi, "");

console.log("AFTER REPLACE:");
console.log(cleanText);

cleanText = cleanText.replace(/\r?\n/g, " ");
cleanText = cleanText.replace(/\s+/g, " ");
console.log("\nAFTER FLATTEN:");
console.log(cleanText);
