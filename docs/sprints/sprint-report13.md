# Relatório de Sprint: Integração do Índice H (Scopus & OpenAlex), Resolução em Cascata por DOI e Métricas de Impacto no ORCID

Nesta sprint (Sprint 13), implementamos a exibição das métricas de impacto do pesquisador (**Índice H e Citações**) na consulta por **ORCID** no **Classificador Qualis CAPES**. Integramos simultaneamente a base proprietária **Scopus (Elsevier)** e a base aberta global **OpenAlex**, desenvolvemos um algoritmo de **resolução em cascata por DOI e autoria** para contornar limitações da API da Elsevier em contas sem ORCID vinculado, e criamos componentes visuais dedicados no cabeçalho e no painel analítico.

---

## 1. Problemas e Motivação

1.  **Demanda por Métricas de Impacto Global do Pesquisador:** A ferramenta classificava com excelência os artigos nos estratos Qualis, JCR e CiteScore, porém comissões de pós-graduação e avaliadores da CAPES frequentemente demandam a visualização imediata do Índice H ($h$-index) e do volume de citações do docente para análise integrada de produtividade e impacto.
2.  **Inviabilidade de APIs Fechadas como Web of Science (WoS):** A consulta ao Índice H da Web of Science exige planos pagos corporativos (Clarivate WoS Starter/Expanded API) sem camada comunitária gratuita viável para o escopo da aplicação. Em contrapartida, a Scopus disponibiliza API de autor com chave institucional e a OpenAlex fornece uma API aberta, gratuita e rica em indicadores cienciométricos.
3.  **Falha de Localização Direta na API Scopus (Erro 400):** Ao consultar a API de Autores da Elsevier via parâmetro direto `?orcid={orcid}`, a API retornava `400 INVALID_INPUT` para pesquisadores que não realizaram manualmente o vínculo de sua conta ORCID no portal da Elsevier. Esse comportamento ocorria com docentes do programa (ex: Prof. Bruno Luciano `0000-0001-8053-7972` e Prof. Carlos Cunha `0000-0002-1891-4201`), que possuem perfil ativo e dezenas de publicações na Scopus, mas tinham o campo de ORCID nulo na base da Elsevier, fazendo com que apenas o OpenAlex aparecesse na interface.
4.  **Gravação de Resultados Nulos no Cache Local:** Tentativas prévias sem o mecanismo de descoberta persistiam `scopus: null` no cache em disco com TTL de 30 dias, bloqueando tentativas subsequentes de resolução.

---

## 2. Soluções e Mudanças Realizadas

### A. Algoritmo de Resolução em Cascata Scopus (Fallback Cascade)
Em [api/orcid_client.py](file:///c:/DEV/Qualis-capes/api/orcid_client.py), estruturamos um pipeline de resolução resiliente em 4 etapas:
*   **1. Busca Direta por ORCID:** Tentativa prioritária no endpoint `https://api.elsevier.com/content/author?orcid={orcid}&view=ENHANCED`.
*   **2. Descoberta Cruzada via DOIs (`_discover_scopus_auid_from_dois`):**
    *   Coleta os DOIs dos trabalhos do autor recuperados pelo ORCID.
    *   Consulta cada artigo no Scopus Search (`/content/search/scopus?query=DOI(...)`).
    *   Recupera os coautores do registro através do Abstract Retrieval API (`/content/abstract/scopus_id/...`).
    *   Compara o sobrenome e prenome do docente para identificar com precisão determinística o **Scopus Author ID (`@auid`)**.
*   **3. Fallback por Nome de Autor (`_discover_scopus_auid_from_name`):** Caso os DOIs não estejam indexados, busca no índice de autores por sobrenome e prenome (`authlast(...) and authfirst(...)`).
*   **4. Extração de Métricas Enriquecidas:** Com o `author_id` localizado, obtém $h$-index, contagem de citações, total de documentos indexados e gera o link direto para o perfil oficial no portal Scopus.

### B. Integração com a API Aberta OpenAlex
*   Implementada a função `fetch_openalex_author_metrics` em [api/orcid_client.py](file:///c:/DEV/Qualis-capes/api/orcid_client.py), consumindo `https://api.openalex.org/authors?filter=orcid:{orcid}`.
*   Extrai métricas abertas: $h$-index, $i10$-index (artigos com pelo menos 10 citações), total de citações recebidas e total de trabalhos publicados.
*   Inclui identificação profissional no `User-Agent` com contato institucional para conformidade com a política de cortesia do OpenAlex.

### C. Cache em Disco com Invalidação Seletiva
*   Em [api/cache.py](file:///c:/DEV/Qualis-capes/api/cache.py), implementamos `get_author_metrics_cache()` e `save_author_metrics_cache()`, persistindo os dados em `data/author_metrics_cache.json` com TTL de 30 dias.
*   A validação de cache foi configurada para ignorar entradas em cache cujo campo `scopus` seja nulo quando existirem DOIs e metadados de nome disponíveis para resolução ativa em cascata.

### D. Badges de Impacto no Cabeçalho de Pesquisa (Frontend)
*   **Contêiner Dinâmico:** Adicionado elemento `#researcher-impact-badges` em [index.html](file:///c:/DEV/Qualis-capes/index.html) ao lado do nome do pesquisador consultado.
*   **Renderização Dupla:** Em [js/app.js](file:///c:/DEV/Qualis-capes/js/app.js), a função `renderResearcherImpactBadges(metrics)` renderiza badges individuais para **Scopus** e **OpenAlex**.
*   **Metadados Ricos:** Os badges exibem o valor do H-Index, indicador i10 (no caso do OpenAlex), total de citações formatado em padrão brasileiro (`toLocaleString('pt-BR')`) e links com ícones Lucide direcionando para os perfis públicos.
*   **Estilização Premium:** Em [css/styles.css](file:///c:/DEV/Qualis-capes/css/styles.css), definimos estilos específicos para `.scopus-badge` (tons âmbar/dourado característicos de bases indexadoras) e `.openalex-badge` (tons ciano/azul tecnológicos), com perfeita legibilidade nos modos claro e escuro.

### E. Card de KPI Dedicado no Dashboard Analítico
*   Em [index.html](file:///c:/DEV/Qualis-capes/index.html), incluímos o `#kpi-h-index-card` no painel de KPIs.
*   Em [js/charts.js](file:///c:/DEV/Qualis-capes/js/charts.js), o card é exibido dinamicamente em consultas por ORCID, apresentando o comparativo sintético (ex: `10 / 18`) e o detalhamento das fontes no subtítulo.
*   Em [js/state.js](file:///c:/DEV/Qualis-capes/js/state.js), adicionado suporte à retenção e restauração de `authorImpactMetrics` na sessão (`sessionStorage`).

### F. Testes Automatizados e Resiliência
*   Em [tests/test_orcid_client.py](file:///c:/DEV/Qualis-capes/tests/test_orcid_client.py), criados e validados testes para `fetch_scopus_author_metrics`, `fetch_openalex_author_metrics` e para o algoritmo de priorização de métricas de impacto.

---

## 3. Arquivos Modificados no Repositório

*   [api/cache.py](file:///c:/DEV/Qualis-capes/api/cache.py) — Adição das funções de carregamento e salvamento de cache em disco para métricas de autor (`author_metrics_cache.json`).
*   [api/orcid_client.py](file:///c:/DEV/Qualis-capes/api/orcid_client.py) — Implementação das funções de busca de métricas Scopus e OpenAlex, resolução em cascata por DOIs e autor, e integração no fluxo `analyze_orcid_public`.
*   [tests/test_orcid_client.py](file:///c:/DEV/Qualis-capes/tests/test_orcid_client.py) — Testes de unidade para recuperação de métricas Scopus, OpenAlex e consolidação prioritária.
*   [index.html](file:///c:/DEV/Qualis-capes/index.html) — Inclusão do container `#researcher-impact-badges` no cabeçalho do pesquisador e do `#kpi-h-index-card` na grade de KPIs do dashboard.
*   [js/dom.js](file:///c:/DEV/Qualis-capes/js/dom.js) — Mapeamento centralizado dos novos elementos do DOM relacionados ao Índice H.
*   [js/state.js](file:///c:/DEV/Qualis-capes/js/state.js) — Armazenamento, restauração e limpeza de `authorImpactMetrics` no estado da aplicação.
*   [js/app.js](file:///c:/DEV/Qualis-capes/js/app.js) — Renderização dos badges de impacto do pesquisador, integração no processamento de resultados ORCID e limpeza de estado.
*   [js/charts.js](file:///c:/DEV/Qualis-capes/js/charts.js) — Atualização do card de KPI do Índice H no painel analítico com formatação comparativa das fontes.
*   [css/styles.css](file:///c:/DEV/Qualis-capes/css/styles.css) — Estilização moderna e responsiva para badges de impacto (`.impact-badge`, `.scopus-badge`, `.openalex-badge`) e ícones de link externo.
*   [docs/sprints/sprint-report13.md](file:///c:/DEV/Qualis-capes/docs/sprints/sprint-report13.md) — Documentação técnica completa da sprint.

---

## 4. Resultados da Homologação

1.  **Resolução Homologada dos Docentes do Programa (UFMA PPGENF):**
    *   **Prof. Bruno Luciano Carneiro Alves de Oliveira** (`0000-0001-8053-7972`):
        *   **Scopus:** $h$-index = **10** | 391 citações | 63 documentos indexados (Scopus ID: `57204963463`).
        *   **OpenAlex:** $h$-index = **18** | i10-index = 26 | 941 citações globais | 176 trabalhos.
    *   **Prof. Carlos Leonardo Figueiredo Cunha** (`0000-0002-1891-4201`):
        *   **Scopus:** $h$-index = **7** | 158 citações | 28 documentos indexados (Scopus ID: `47860948000`).
        *   **OpenAlex:** $h$-index = **13** | i10-index = 16 | 568 citações globais | 122 trabalhos.
2.  **Suíte de Testes Automatizados:**
    *   **Backend (Pytest):** 75/75 testes passando (100% de sucesso).
    *   **Frontend Lattes (Node.js):** 22/22 casos de regressão passando sem falhas.
3.  **Auditoria e Transparência:** Cada badge fornece link externo direto com abertura em nova aba para os perfis oficiais, garantindo comprovação imediata para qualquer comissão avaliadora.
