# Relatório de Sprint: Painel Unificado de Entrada de Periódicos (Sidebar)

Nesta sprint, unificamos os formulários de entrada de dados da barra lateral (Individual, Lote e CSV) em um único painel inteligente para resolver o desequilíbrio visual e criar uma interface mais limpa, equilibrada e integrada.

---

## 1. Problema e Motivação
Anteriormente, a coluna da esquerda da interface (a barra lateral) exibia três caixas (cards) de formulário empilhadas verticalmente. Isso dividia a atenção do usuário com múltiplos títulos redundantes e causava um desequilíbrio estético em relação ao layout limpo da coluna da direita.

A solução adotada foi consolidar todos os inputs em um único painel inteligente com um **Seletor Segmentado (Segmented Control)** de abas sutil no topo.

---

## 2. Abordagem e Arquitetura da Solução

*   **Card Único de Inputs (`.sidebar-input-card`):** Agora, a barra lateral possui apenas um cartão principal de entrada de dados, economizando espaço vertical de forma significativa.
*   **Seletor Segmentado Premium (`.input-selector`):** Um painel deslizante estilo nativo de sistemas operacionais modernos (como iOS/macOS) que alterna entre as opções:
    *   **Individual:** Busca unitária por ISSN ou Nome.
    *   **Lote:** Campo de área de texto para múltiplos ISSNs.
    *   **Planilha:** Dropzone para importação de CSVs.
*   **Retrocompatibilidade Total (Regressão Zero):** Mantivemos os mesmos formulários, classes e seletores originais (`#single-issn-form`, `#batch-issn-form`, `#dropzone` e `#file-input`), mudando apenas o seu encapsulamento estrutural. Isso garantiu que zero lógica interna do motor de classificação no JS fosse alterada.
*   **Transições Suaves:** Os painéis alternam com efeitos de opacidade e subida suave ao clicar.

---

## 3. Arquivos Afetados

*   **[`index.html`](file:///c:/Dev/Qualis-capes/index.html):** Substituição dos cards independentes pelo novo container unificado `.sidebar-input-card` com o menu segmentado e os painéis de formulários.
*   **[`css/styles.css`](file:///c:/Dev/Qualis-capes/css/styles.css):** Adicionado estilização completa do seletor segmentado, com suporte ao tema claro e escuro, sombras suaves e estados ativos com destaque na cor da marca, além das animações de troca de abas.
*   **[`js/app.js`](file:///c:/Dev/Qualis-capes/js/app.js):** 
    *   Mapeamento das referências DOM dos seletores e painéis de inputs.
    *   Implementação da função `switchInputType(type)` para alternar as abas do painel lateral.
    *   Vinculação de eventos de clique nos seletores.
    *   Reset do seletor para a aba "Individual" ao acionar a limpeza geral do painel.

---

## 4. Resultados da Validação

A validação foi feita no navegador através do subagente de testes e confirmou:
1.  **Carregamento Inicial:** A interface carrega e o painel unificado abre por padrão na aba "Individual".
2.  **Alternância de Formulários:** O clique em cada segmento (Lote, Planilha, Individual) oculta os demais e apresenta o formulário ativo instantaneamente com animação suave de subida.
3.  **Processamento de Buscas:** O motor continua funcionando perfeitamente sem erros nas buscas e mantendo o chaveamento automático de resultados na direita.
4.  **Reset:** O botão "Limpar Tudo" redefine o seletor da esquerda de volta para a aba "Individual" e limpa a tabela de resultados.
