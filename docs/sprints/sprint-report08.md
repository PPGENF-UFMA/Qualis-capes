# Relatório de Sprint: Análise Completa de Currículo Lattes & Resolução de Abreviações

Nesta sprint, desenvolvemos a funcionalidade **"Análise Completa de Currículo"**, permitindo que avaliadores e pesquisadores copiem e colem a seção de artigos completos publicados de um Currículo Lattes e obtenham instantaneamente estatísticas, KPIs consolidados e a classificação detalhada de toda a sua produção científica.

---

## 1. Problema e Motivação

O processo tradicional de classificação de produções científicas exige que o avaliador acesse o Currículo Lattes do pesquisador, examine a seção de artigos, identifique individualmente cada periódico e classifique-o manualmente. 

Embora uma integração direta automatizada por *scraping* seja inviável devido a CAPTCHAs e restrições de acesso na plataforma Lattes, a exportação padrão de currículos do CNPq gera um texto altamente padronizado. A solução por **Copy & Paste** e interpretação textual direta elimina o retrabalho manual com estabilidade total de funcionamento offline.

---

## 2. Abordagem de Desenvolvimento

A arquitetura do parser foi construída sob os seguintes pilares:

1. **Separação de Conceitos (SoC):** Isolação completa de algoritmos sintáticos no novo módulo [**`js/lattesParser.js`**](file:///c:/Dev/Qualis-capes/js/lattesParser.js).
2. **Algoritmo de Segmentação Sintática:** Uso de expressões regulares avançadas que localizam a assinatura de fechamento padrão do Lattes (Ex: `, v. X, p. Y, [ANO]. Citações:Z`) para fatiar o texto corrido em publicações individuais sem depender de numeração sequencial.
3. **Parser de Metadados:** Regex de captura que separa o bloco de autores (quebrando no ponto final após o último ponto-e-vírgula), o título do artigo e a revista científica correspondente.
4. **Resolução Inteligente de Abreviações (Matching em 3 Níveis):**
   * *Correspondência Exata Normalizada:* Elimina acentos, pontuações, preposições e caixa alta para cruzar com a base CAPES local.
   * *Dicionário Estático de Aliases:* Mapeamento interno das abreviações consagradas de Enfermagem (Ex: `ACTA PAUL DE ENFERM` $\rightarrow$ `Acta Paulista de Enfermagem`, `REME` $\rightarrow$ `Revista Mineira de Enfermagem`).
   * *Busca Difusa Otimizada (Jaro-Winkler):* Filtragem heurística preliminar (seleciona apenas revistas que contenham pelo menos um termo principal da busca para poupar CPU) seguida do cálculo de similaridade. Limiar estipulado em $85\%$ de confiança para match automático.

---

## 3. Arquivos Afetados

* **[`js/lattesParser.js`](file:///c:/Dev/Qualis-capes/js/lattesParser.js) (Novo):** Toda a inteligência de processamento de texto, normalização, algoritmo de Jaro-Winkler e dicionário de sinônimos/aliases.
* **[`index.html`](file:///c:/Dev/Qualis-capes/index.html):** Inclusão do botão de aba "Currículo", formulário `#lattes-form` na sidebar, e o cartão informativo `#session-researcher-title` para identificação de contexto do pesquisador analisado.
* **[`css/styles.css`](file:///c:/Dev/Qualis-capes/css/styles.css):** Adaptação do seletor segmentado lateral para comportar confortavelmente as 4 opções (`padding`, `font-size` e `gap` ajustados responsivamente).
* **[`js/dom.js`](file:///c:/Dev/Qualis-capes/js/dom.js):** Referências para os novos inputs e displays.
* **[`js/ui.js`](file:///c:/Dev/Qualis-capes/js/ui.js):** Chaveamento da nova aba de currículo lateral na interface.
* **[`js/app.js`](file:///c:/Dev/Qualis-capes/js/app.js):** Conexão do parser de Lattes com a engine Qualis CAPES no evento de submit do formulário e limpeza de dados.

---

## 4. Resultados da Homologação (Casos de Sucesso)

O subagente de validação visual inseriu um currículo real contendo 8 artigos de alta variabilidade ortográfica com os seguintes resultados obtidos:

1. **`ACTA PAUL DE ENFERM`** (Item 3) e **`Acta Paulista de Enfermagem`** (Item 8) -> Ambos resolvidos corretamente via alias e match exato para **Acta Paulista de Enfermagem** (ISSN `1982-0194`), Qualis **A3**.
2. **`ENFERMAGEM EM FOCO DO COFEN`** (Itens 1 e 7) -> Resolvidos para **Enfermagem em Foco** (ISSN `2357-707X`), Qualis **A5**.
3. **`BMC PUBLIC HEALTH`** (Item 2) -> Resolvido para **BMC Public Health (Online)** (ISSN `1471-2458`), Qualis **A1**.
4. **`Poblacion Y Salud En Mesoamerica`** (Item 5) -> Resolvido por Jaro-Winkler para **Población y Salud en Mesoamérica** (ISSN `1659-0201`), Qualis **A5**.
5. **`REVISTA ELETRONICA ACERVO EM SAUDE`** (Item 6) -> Resolvido para **Revista Eletrônica Acervo Saúde** (ISSN `2178-2091`), Qualis **A8**.
6. **`Extensao em Revista`** (Item 4) -> Resolvido por correspondência aproximada para **Extensão em Revista** (ISSN `2525-5347`), Qualis **A8**.

### Geração de Indicadores
A importação consolidada dos 8 artigos permitiu atualizar instantaneamente os KPIs (Maior JCR: 1.00, Maior CiteScore: 5.90, Indexações de Qualidade: 50%) e os gráficos do Dashboard, mantendo o cabeçalho dinâmico do pesquisador `"Dr. Carlos Leonardo Figueiredo Cunha"`.
