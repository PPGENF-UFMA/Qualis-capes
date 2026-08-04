# Relatório de Sprint: Layout Adaptativo de Abas (Tabs) para Resultados

Nesta sprint, focamos em otimizar a experiência do usuário (UX) após a exibição de resultados no Classificador Qualis CAPES (Enfermagem), resolvendo o problema de rolagem e visibilidade da tabela de classificação de periódicos detalhada.

---

## 1. Problema e Motivação
Anteriormente, ao efetuar uma pesquisa (seja individual, por lote ou via CSV), a visualização dos resultados detalhados exigia rolagem para baixo, pois os gráficos estatísticos e os painéis de resumo ocupavam o topo da tela principal. Isso criava a falsa impressão de que a busca falhou ou que nenhum resultado foi encontrado.

Para contornar esse comportamento sem apertar o design ou induzir scrolls automáticos abruptos (o que quebra a navegação fluida), projetamos um **Layout Adaptativo de Abas (Tabs)** com **Chaveamento Inteligente (Smart Toggle)**.

---

## 2. Abordagem e Arquitetura da Solução

Implementamos uma estrutura de abas dinâmicas no topo da área principal de resultados dividida em duas visões complementares:
1.  **Tabela Detalhada (`#tab-content-table`):** Focada na visualização da tabela de periódicos classificados, buscas textuais rápidas, filtros de estratos e exportação.
2.  **Estatísticas & Dashboard (`#tab-content-analytics`):** Contém os KPIs de resumo e gráficos de distribuição e indexadores.

### Chaveamento Inteligente de Contexto (Smart Toggle)
A aplicação agora analisa o contexto do input do usuário para escolher a aba ativa:
*   **Consulta Individual (ISSN ou Título):** Foco imediato na resposta. Ativa e exibe automaticamente a aba **Tabela Detalhada**, trazendo o periódico classificado direto para o topo (acima da dobra visual da página).
*   **Consulta em Lote ou Upload de CSV:** Foco na análise estatística. Ativa e exibe automaticamente a aba **Estatísticas & Dashboard**, apresentando o panorama geral e a performance do lote no topo.
*   **Chaveamento Manual:** O usuário pode alternar a qualquer momento entre as abas clicando nos botões de guias premium.

---

## 3. Arquivos Afetados

*   **[`index.html`](file:///c:/Dev/Qualis-capes/index.html):**
    *   Inclusão do container `.tab-navigation` com os botões de controle (`#tab-table` e `#tab-analytics`) contendo ícones vetoriais modernos (Lucide).
    *   Agrupamento dos cards de KPI e dos gráficos em `#tab-content-analytics` (`.tab-pane`).
    *   Agrupamento da tabela e dos botões de exportação e limpeza em `#tab-content-table` (`.tab-pane active`).
*   **[`css/styles.css`](file:///c:/Dev/Qualis-capes/css/styles.css):**
    *   Estilização glassmorphic moderna para as abas nos temas claro e escuro.
    *   Efeito de transição suave de opacidade e deslocamento vertical (`translateY`) para animação dos painéis (`.tab-pane`).
*   **[`js/app.js`](file:///c:/Dev/Qualis-capes/js/app.js):**
    *   Mapeamento de referências DOM para os botões e painéis das abas.
    *   Implementação da função utilitária `switchTab(tabId)`.
    *   Chamadas automatizadas de `switchTab('table')` após resoluções individuais e `switchTab('analytics')` após o processamento em lote ou carregamento de planilha CSV.
    *   Tratamento de redimensionamento (`resize()`) das instâncias Chart.js ao transicionar para a aba oculta para evitar problemas de dimensões corrompidas.
    *   Reset automático da aba ativa para "Tabela Detalhada" ao clicar em "Limpar Tudo".

---

## 4. Resultados da Validação

A validação foi conduzida no navegador usando o roteiro de testes e confirmou:
*   **Busca Individual:** O periódico é classificado e exibido no topo sob a aba "Tabela Detalhada".
*   **Alternância Manual:** A troca manual de abas é fluida e instantânea.
*   **Busca em Lote / CSV:** Gráficos e KPIs renderizam imediatamente atualizados sob a aba "Estatísticas & Dashboard". Os gráficos do Chart.js ajustam seu tamanho dinamicamente ao serem exibidos.
*   **Resolução de Limpeza:** O botão de limpeza remove as abas e o resultado, retornando a tela ao estado de espera ideal (*Empty State*).
