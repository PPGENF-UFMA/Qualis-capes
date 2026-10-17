# Relatório de Sprint: Indicador de Atualização da Base Alinhado ao Ciclo Anual do JCR

Nesta sprint (Sprint 15), corrigimos o **indicador de frescor da base de dados** exibido na sidebar do **Classificador Qualis CAPES**. O alerta anterior usava limiares fixos em dias corridos (90/180 dias) que não correspondiam ao ciclo real de atualização das fontes — que é **anual** (JCR, classificação CAPES) — gerando avisos de "verificar atualização" mesmo quando nenhuma fonte nova havia sido publicada. O novo cálculo ancora o alerta ao **ano da edição JCR** embarcada na base, disparando o aviso somente quando uma nova edição de fato existe.

---

## 1. Problemas e Motivação

1.  **Falso positivo de desatualização:** O indicador marcava a base como "⚠ Verificar atualização" após 90 dias e "⚠ Desatualizado!" após 180 dias, contando dias corridos. Como as fontes primárias (JCR, avaliação quadrienal CAPES) só mudam aproximadamente uma vez por ano, o alerta disparava com frequência sem que houvesse qualquer dado novo a incorporar.
2.  **Aviso não acionável:** A mensagem genérica "Verificar atualização" não informava *o que* verificar. O pessoal de TI responsável pelo deploy não tinha um gatilho claro de ação (ex.: "a nova edição do JCR saiu").
3.  **Metadado de edição já disponível e subutilizado:** A base (`journals.json`) já carrega o campo `jcr_year` no `_meta` (atualmente `"2025"`), exposto ao frontend via `/api/v1/status`. Esse dado permite ancorar o alerta no ciclo real das fontes em vez de dias corridos.
4.  **Necessidade de comunicação de cadência:** Era preciso deixar documentado, para o time de TI, que a recompilação é um processo **anual** e não deve ser feita apenas por decurso de prazo.

---

## 2. Soluções e Mudanças Realizadas

### A. Ancoragem do Alerta no Ano da Edição JCR
*   Em [js/app.js](file:///c:/DEV/Qualis-capes/js/app.js), o bloco que formata a data de compilação (`#db-compiled-at`) passou a interpretar `database_meta.jcr_year` e a calcular os limites de alerta a partir do **ciclo de publicação do JCR**:
    *   A edição JCR `N` é publicada por volta de **junho do ano `N+1`** (ex.: JCR 2025 publicado em jun/2026).
    *   **Verde:** enquanto a próxima edição ainda não é esperada.
    *   **Amarelo:** a partir de **1º de julho do ano `N+2`** — `⚠ Nova edição JCR {N+1} disponível — verificar atualização`.
    *   **Vermelho:** a partir de **1º de janeiro do ano `N+3`** — `⚠ Base desatualizada — edição JCR {N+1} não incorporada`.
*   A mensagem agora é **acionável**: nomeia a edição pendente de incorporação.

### B. Fallback para Bases sem Metadado de Edição
*   Para bases antigas que não possuam `jcr_year` (ou com valor inválido), o código mantém um guarda-chuva de segurança por dias corridos, **relaxado para o ciclo anual**: aviso após **365 dias** e erro após **545 dias** — eliminando os antigos limiares de 90/180 dias.

### C. Cache-Busting do Frontend
*   Em [index.html](file:///c:/DEV/Qualis-capes/index.html), a versão do parâmetro de cache do módulo principal foi atualizada (`js/app.js?v=20261016-freshness`), garantindo que os navegadores entreguem o JavaScript novo imediatamente após o deploy realizado pelo TI (sem isso, o `app.js` antigo continuaria vindo do cache).

### D. Documentação da Cadência de Recompilação
*   Em [docs/MANUAL_IMPLANTACAO_TI_UFMA.md](file:///c:/DEV/Qualis-capes/docs/MANUAL_IMPLANTACAO_TI_UFMA.md), a seção **4.2 "Quando Recompilar o Banco de Dados"** recebeu uma nota explicando que o indicador da interface acompanha o ciclo anual do JCR e que a recompilação é **anual**, não baseada em decurso de prazo.

---

## 3. Arquivos Modificados no Repositório

*   [js/app.js](file:///c:/DEV/Qualis-capes/js/app.js) — Nova lógica de cálculo do status de frescor da base (ancorada em `jcr_year`, com fallback em dias corridos 365/545) e mensagens de aviso acionáveis.
*   [index.html](file:///c:/DEV/Qualis-capes/index.html) — Atualização do parâmetro de cache-busting do módulo `js/app.js` (`?v=20261016-freshness`).
*   [docs/MANUAL_IMPLANTACAO_TI_UFMA.md](file:///c:/DEV/Qualis-capes/docs/MANUAL_IMPLANTACAO_TI_UFMA.md) — Nota na seção 4.2 sobre o indicador de atualização e a cadência anual de recompilação.
*   [docs/sprints/sprint-report15.md](file:///c:/DEV/Qualis-capes/docs/sprints/sprint-report15.md) — Documentação técnica completa da sprint.

---

## 4. Resultados da Homologação

1.  **Estados do Indicador Validados:** Com a resposta de `/api/v1/status` simulada, foram confirmados os quatro cenários:
    *   **Verde** — `jcr_year = 2025`, base compilada em 15/09/2026 → sem aviso (`status-item success`).
    *   **Amarelo** — `jcr_year = 2024` (hoje ≥ jul/2026) → `⚠ Nova edição JCR 2025 disponível — verificar atualização` (`status-item warning`).
    *   **Vermelho** — `jcr_year = 2022` (hoje ≥ jan/2025) → `⚠ Base desatualizada — edição JCR 2023 não incorporada` (`status-item error`).
    *   **Fallback** — base sem `jcr_year` e com mais de 545 dias → `⚠ Base desatualizada!` (`status-item error`).
2.  **Estado Real de Produção:** Com a base compilada em 15/09/2026 (`jcr_year = 2025`), o indicador exibe **verde** e "Fontes: JCR 2025 · CUIDEN 2022", como esperado.
3.  **Interface Preservada:** Zero erros ou avisos no console do navegador durante a validação.
