# Relatório de Sprint: Confiabilidade de Comprovação Externa, Resolução Canônica de PIDs, Metadados de Ano e Refinamento Visual

Nesta sprint (Sprint 12), consolidamos a **confiabilidade e auditoria externa** das classificações do **Classificador Qualis CAPES**, solucionando discrepâncias de resolução de links em portais científicos oficiais (SciELO, Rev@Enf, CUIDEN), adicionando o campo temporal de **Ano de Publicação** na tabela detalhada para análise curricular e aplicando refinamentos de design para uma interface mais limpa e elegante.

---

## 1. Problemas e Motivação

1.  **Divergência de Links SciELO em Análises de Currículo (ORCID/Lattes):** Ao clicar nos badges de validação do SciELO para artigos vindos de currículos de pesquisadores (ex: ORCID `0000-0003-3027-2763`), a query de busca era montada com o título completo e composto do artigo em vez do nome da revista (ex: `ta:("Título do Artigo (Nome da Revista)")`), resultando em busca sem retorno (0 artigos) no portal oficial `search.scielo.org`.
2.  **Atualização da Base de Validação CUIDEN / RIC:** Os links de comprovação do índice CUIDEN precisavam apontar diretamente para a página oficial do último ranking publicado pela Fundación Index com os dados consolidados.
3.  **Erro 404 na Comprovação da Rev@Enf (BVS / SciELO Enfermagem):** Ao auditar periódicos da coleção Rev@Enf (como a *REBEn - Revista Brasileira de Enfermagem*, e-ISSN `1984-0446` no ORCID `0000-0001-8053-7972`), o portal oficial da BVS Rev@Enf retornava erro 404 por indexar os títulos apenas pelo PID histórico/canônico (`0034-7167`), e não pelo e-ISSN secundário.
4.  **Ausência do Campo de Data/Ano na Tabela Detalhada:** Na visualização de produções de docentes e pesquisadores (via ORCID ou Lattes), a tabela detalhada exibia os periódicos e métricas sem o ano de publicação, privando os avaliadores de contexto cronológico imediato.
5.  **Poluição Visual e Peso Tipográfico nas Métricas:** O cabeçalho da tabela continha instruções textuais redundantes (`(clique para validar)`), e os valores numéricos de JCR e CiteScore estavam em negrito forte (`font-weight: 600`), sobrecarregando a leitura visual da tabela.

---

## 2. Soluções e Mudanças Realizadas

### A. Resolução Precisa de Títulos e Links Oficiais SciELO
*   **Extração e Limpeza de Títulos:** Criamos as funções utilitárias `getJournalTitle()` e `cleanJournalTitle()` em [js/utils.js](file:///c:/Dev/Qualis-capes/js/utils.js), garantindo a higienização de sufixos de formato (`(Online)`, `- Impresso`) e a separação correta entre o título do artigo e o título do periódico.
*   **Preservação de Metadados Estruturados:** Atualizamos o cliente de extração ORCID em [api/orcid_client.py](file:///c:/Dev/Qualis-capes/api/orcid_client.py) e o orquestrador em [js/app.js](file:///c:/Dev/Qualis-capes/js/app.js) para armazenar explicitamente `articleTitle` e `journalTitle` de forma desmembrada.
*   **Busca Canônica no SciELO:** Em [js/table.js](file:///c:/Dev/Qualis-capes/js/table.js) e [js/utils.js](file:///c:/Dev/Qualis-capes/js/utils.js), a validação monta consultas com a sintaxe exata da base (`ta:("<Nome Limpo do Periódico>")`), com fallback automático para a rota de fascículos seriais `sci_serial&pid=<ISSN>`.

### B. Atualização do Ranking Oficial CUIDEN / RIC
*   **Direcionamento para Comprovação Oficial:** Atualizamos as referências de comprovação do índice CUIDEN em [js/table.js](file:///c:/Dev/Qualis-capes/js/table.js) e [js/utils.js](file:///c:/Dev/Qualis-capes/js/utils.js) para `https://fundacionindex.com/?page_id=1190`, permitindo aos avaliadores acesso direto ao documento do último ranking publicado pela Fundación Index.

### C. Mapeamento Canônico de PIDs para a Rev@Enf (BVS)
*   **Mapa de PIDs Oficiais:** Implementamos em [js/utils.js](file:///c:/Dev/Qualis-capes/js/utils.js) a constante `REVENF_PID_MAP` e o helper `getRevenfPid(issn)`, mapeando e-ISSNs para os PIDs seriais oficiais aceitos pelo servidor da BIREME (ex: `1984-0446` -> `0034-7167` da REBEn).
*   **Geração de Links Resilientes:** Os links de validação apontam diretamente para o acervo oficial `https://www.revenf.bvs.br/scielo.php?script=sci_serial&pid=<PID>&lng=pt&nrm=iso`, eliminando páginas de erro 404.

### D. Coluna "Ano" e Ordenação Temporal na Tabela Detalhada
*   **Coluna na Tabela Detalhada:** Adicionamos a coluna `Ano` entre as colunas **Título / Revista** e **ISSN** em [index.html](file:///c:/Dev/Qualis-capes/index.html) e [js/table.js](file:///c:/Dev/Qualis-capes/js/table.js).
*   **Badge Visual e Fallback:** Itens com ano definido exibem um badge tabular estilizado (`.year-badge`). Itens avulsos sem data exibem o indicador discreto `-` (`.metric-missing`).
*   **Ordenação por Ano:** Implementamos a opção `Ano (mais recente)` no filtro de ordenação `#sort-by` em [index.html](file:///c:/Dev/Qualis-capes/index.html) e [js/state.js](file:///c:/Dev/Qualis-capes/js/state.js), com desempate automático pelo score de relevância Qualis/JCR/CiteScore.
*   **Interoperabilidade em Importações e Exportações:**
    *   O gerador de CSV ([js/utils.js](file:///c:/Dev/Qualis-capes/js/utils.js)) agora inclui a coluna `Ano` na exportação.
    *   O parser de planilhas CSV/XLSX ([js/utils.js](file:///c:/Dev/Qualis-capes/js/utils.js) e [js/app.js](file:///c:/Dev/Qualis-capes/js/app.js)) detecta automaticamente colunas de ano ao importar dados.

### E. Refinamento Visual e Despoluição da Interface
*   **Cabeçalho Limpo:** Removida a anotação `(clique para validar)` da coluna de indexadores em [index.html](file:///c:/Dev/Qualis-capes/index.html), mantendo o título limpo: **`Indexadores Ativos`**.
*   **Tipografia Suave nas Métricas:** Ajustamos as classes `.metric-link` e `.metric-value` em [css/styles.css](file:///c:/Dev/Qualis-capes/css/styles.css) para `font-weight: 400`, eliminando o negrito pesado dos números de JCR e CiteScore e tornando a tabela visualmente mais harmônica e profissional.

---

## 3. Arquivos Modificados no Repositório

*   [api/orcid_client.py](file:///c:/Dev/Qualis-capes/api/orcid_client.py) — Preservação estruturada de `journalTitle` e `articleTitle` na classificação de obras públicas do ORCID.
*   [tests/test_orcid_client.py](file:///c:/Dev/Qualis-capes/tests/test_orcid_client.py) — Testes de integridade de metadados de títulos e anos no cliente ORCID.
*   [index.html](file:///c:/Dev/Qualis-capes/index.html) — Adição da coluna Ano na tabela, opção de ordenação temporal e remoção do texto explicativo no cabeçalho de indexadores.
*   [js/table.js](file:///c:/Dev/Qualis-capes/js/table.js) — Renderização da célula de ano com badge, atualização de colspan de tabela vazia, suporte a skeleton loaders e links canônicos de comprovação.
*   [js/state.js](file:///c:/Dev/Qualis-capes/js/state.js) — Lógica de ordenação por ano decrescente com desempate ponderado por estrato/métricas.
*   [js/utils.js](file:///c:/Dev/Qualis-capes/js/utils.js) — Funções `getJournalTitle`, `cleanJournalTitle`, `REVENF_PID_MAP`, extração de ano em `processCSVData` e inclusão de ano em `generateCSV`.
*   [js/app.js](file:///c:/Dev/Qualis-capes/js/app.js) — Preservação de metadados de ano no fluxo de upload de arquivos CSV/Excel e de correspondência de periódicos.
*   [css/styles.css](file:///c:/Dev/Qualis-capes/css/styles.css) — Estilos para `.year-cell`, `.year-badge`, `.skeleton-bar.year`, e peso tipográfico regular (`font-weight: 400`) para `.metric-link` e `.metric-value`.
*   [docs/sprints/sprint-report12.md](file:///c:/Dev/Qualis-capes/docs/sprints/sprint-report12.md) — Documentação técnica completa da sprint.

---

## 4. Resultados da Homologação

1.  **Auditoria Externa Confiável:** Testes com múltiplos currículos ORCID (`0000-0003-3027-2763`, `0000-0001-8053-7972`) comprovaram que todos os links oficiais (SciELO, BVS/Rev@Enf, MEDLINE, LILACS e CUIDEN) abrem com precisão as páginas de validação correspondentes sem erros 404 ou buscas vazias.
2.  **Visualização Cronológica Clara:** A nova coluna `Ano` exibe com precisão o ano de publicação dos artigos e permite ordenação imediata do mais recente ao mais antigo.
3.  **Suíte de Testes Automatizados:** 
    *   **Backend:** 72/72 testes passando no `pytest`.
    *   **Frontend Lattes:** 22/22 casos de regressão passando no `node test_parser.js`.
4.  **Estética Premium:** Tabela despoluída, tipografia equilibrada e total aderência aos temas escuro e claro.
