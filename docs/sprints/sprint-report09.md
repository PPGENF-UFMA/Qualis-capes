# Relatório de Sprint: Expansão Analítica & Otimização do Dashboard de Produção Científica

Nesta sprint, expandimos o módulo analítico do classificador Qualis CAPES da aba **"Estatísticas & Dashboard"**, trazendo uma visão robusta e de alto valor prático para os avaliadores do PPGENF na análise do Currículo Lattes e de listas de artigos em lote.

---

## 1. Problema e Motivação

O dashboard anterior mostrava métricas isoladas que não refletiam fielmente a qualidade global e a trajetória de produção do docente analisado. Indicadores como "Maior JCR" representavam apenas um valor pontual (geralmente gerado por um único artigo isolado de alto impacto) ao invés de qualificar toda a produção do currículo. 

Além disso, os avaliadores de programas de pós-graduação necessitam de gráficos temporais para mapear:
1. **Volumetria de produção anual:** crescimento ou estabilização da produção.
2. **Evolução de qualidade:** melhora ou deterioração dos estratos de publicação do pesquisador ao longo do tempo.
3. **Distribuição de concentração:** em quais revistas o pesquisador publica de forma reincidente.
4. **Insights textuais rápidos:** um diagnóstico resumido do perfil do currículo sem exigir esforço cognitivo na leitura de gráficos.

---

## 2. Requisitos e Regras de Negócio Implementadas

### A. Reestruturação de KPIs (kpi-container)
Substituímos os cards originais por 5 indicadores analíticos organizados em um grid auto-responsivo que se adapta de 1 a 5 colunas dependendo da largura do dispositivo:
1. **Total de Artigos:** Volume total de artigos importados/processados.
2. **Produção Qualificada (A1 + A2):** Quantidade absoluta e percentual relativo das publicações nos estratos de excelência A1 e A2 (ex: `1 (13%)` com subtítulo `13% do total (A1 + A2)`).
3. **Qualidade do Currículo (Score Qualis):** Nota ponderada de 0 a 100 baseada nos pesos padrão da CAPES, além da indicação do **Estrato Médio** correspondente por mapeamento reverso.
4. **Não Classificados (NC):** Total de itens que caíram no estrato NC (importante para identificar se há abreviações ou revistas não indexadas na base local).
5. **Cobertura Internacional:** Percentual de artigos indexados em bases globais (*Scopus, WoS/JCR ou Medline*).

### B. Pesos de Classificação CAPES (Score Qualis)
Para calcular o Score de Qualidade do Currículo, aplicamos os seguintes pesos estipulados para a área de Enfermagem:

| Estrato CAPES | Peso (Pontuação) |
|:---:|:---:|
| **A1** | 100 |
| **A2** | 85 |
| **A3** | 70 |
| **A4** | 55 |
| **A5** | 40 |
| **A6** | 25 |
| **A7** | 10 |
| **A8** | 5 |
| **NC** | 0 |

*   **Score CAPES Médio:** Média aritmética dos pesos de todos os artigos analisados.
*   **Estrato Médio:** Mapeamento inverso do score médio obtido para o estrato CAPES que possuir o peso mais próximo (por cálculo de diferença absoluta mínima).

---

## 3. Arquitetura e Componentes Modificados

1. **[`index.html`](file:///c:/Dev/Qualis-capes/index.html):** 
   - Reestruturou o contêiner `.kpi-container` com as tags de IDs necessárias.
   - Criou a segunda linha de gráficos `#publications-year-chart` e `#qualis-evolution-chart` na grade analítica.
   - Inseriu a terceira linha com a tabela de periódicos (`#top-journals-table-body`) e a lista flexível de insights do currículo (`#curriculum-insights-list`).
2. **[`css/styles.css`](file:///c:/Dev/Qualis-capes/css/styles.css):**
   - Alterou a exibição do `.kpi-container` para usar a regra `grid-template-columns: repeat(auto-fit, minmax(200px, 1fr))` garantindo alinhamento e simetria perfeita em qualquer tamanho de janela.
3. **[`js/dom.js`](file:///c:/Dev/Qualis-capes/js/dom.js):**
   - Adicionou todas as novas referências para a tabela, canvas de gráficos, contêiner de insights e cards de KPIs.
4. **[`js/app.js`](file:///c:/Dev/Qualis-capes/js/app.js):**
   - Propagou o ano de publicação extraído pelo parser Lattes no objeto classificado (`classified.year = article.year`), servindo de insumo temporal para os agrupamentos de estatísticas.
5. **[`js/charts.js`](file:///c:/Dev/Qualis-capes/js/charts.js):**
   - Redesenhado completamente para consolidar o motor analítico do dashboard: calcula médias ponderadas, reúne as volumetrias por ano, identifica e limpa títulos de periódicos repetidos, cria instâncias dinâmicas do Chart.js e reinicializa os ícones Lucide dentro da lista de insights.

---

## 4. Resultados da Homologação (Estudo de Caso)

Para homologar a implementação de forma integrada, o subagente de validação visual inseriu no sistema o Currículo Lattes correspondente ao **Dr. Carlos Leonardo Figueiredo Cunha**, contendo 8 artigos publicados de alta variabilidade e indexação.

### Métricas Obtidas
*   **Artigos Identificados:** 8
*   **Produção Qualificada (A1+A2):** 1 artigo (13% da produção total) - correspondente à revista *BMC Public Health*.
*   **Qualidade do Currículo (Score CAPES):** **46 / 100**
*   **Estrato Médio Equivalente:** **A5** (o peso correspondente é 40, sendo o mais próximo do score 46).
*   **Não Classificados:** 0 (todas as revistas foram identificadas).
*   **Cobertura Internacional:** 38% (3 de 8 artigos indexados em Scopus/WoS/Medline).

### Tabela de Periódicos mais Frequentes
*   **ACTA PAUL DE ENFERM:** 2 publicações
*   **ENFERMAGEM EM FOCO:** 2 publicações
*   **REVISTA ELETRÔNICA ACERVO SAÚDE:** 1 publicação
*   **POBLACIÓN Y SALUD EN MESOAMÉRICA:** 1 publicação
*   **EXTENSÃO EM REVISTA:** 1 publicação

### Insights Gerados na Tela
1.  **Perfil de Publicações:** 13% da produção está classificada em A1 ou A2.
2.  **Inserção Internacional:** 38% dos periódicos possuem indexação em bases internacionais de referência.
3.  **Dados Coerentes:** 100% dos periódicos analisados estão classificados no Qualis CAPES (nenhum NC).
4.  **Score do Currículo:** Nota 46/100 (Estrato Médio equivalente a A5). Perfil com produção em desenvolvimento científico (Regular).

Todos os gráficos e painéis de dados carregaram e atualizaram de forma instantânea sem qualquer erro de execução no console, e as capturas de tela foram registradas na pasta de artefatos da sprint.
