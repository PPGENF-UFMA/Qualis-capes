# Sprint 4 Report: UX & Transparência

**Data**: 24/06/2026
**Foco**: Melhorar a clareza e confiabilidade dos resultados gerados pelo sistema, evidenciando as fontes de dados e permitindo drill-down na lógica de decisão de extratos. A meta é prover transparência essencial para o contexto institucional.

## 1. Justificativa com Fonte de Dados (UX-2)
- **Problema**: O sistema afirmava as pontuações e indexadores (ex: "JCR = 1.50") de maneira assertiva, sem especificar de qual API ou arquivo o dado havia sido lido. Isso reduzia a transparência e instigava dúvidas aos comitês.
- **Solução**: O *engine* CAPES interno (`engine.py`) passou a receber um _stamp_ com o nome da respectiva fonte geradora do dado. Exemplos: `— Fonte: API Elsevier` (quando dados de CiteScore vêm via fetch REST em runtime), `— Fonte: API BVS/LILACS`, `— Fonte: API SciELO` ou `— Fonte: Base local` quando extraído estaticamente do JCR em cache.

## 2. Mensagem Orientativa em Casos "NC" (UX-3)
- **Problema**: Artigos diagnosticados sumariamente como Estrato "NC" geravam abandono ou rejeição por parte do usuário, que presumia um falso-negativo imediato do sistema, sem compreender ações corretivas viáveis.
- **Solução**: A renderização da tabela no `table.js` detecta as linhas exclusivas do grupo NC e implanta, subjacente ao *Badge*, uma etiqueta secundária: *Verifique o ISSN impresso vs eletrônico ou busque pelo nome completo. Pode não estar indexado.* 

## 3. Drill-down Analítico da Classificação (UX-4)
- **Problema**: Um periódico com JCR fraco e CiteScore mediano tem sua pontuação definida por "concorrência" lógica do melhor caso ("Best Case Rule"). Na visualização básica, só o critério vencedor era mostrado, ocultando a riqueza da avaliação completa de outras métricas.
- **Solução**:
    - Backend: `engine.py` e o schema `ClassifyResponse` expandidos para carregar secretamente a listagem exaustiva de `all_candidates` (uma lista que aponta cada estrato derivado e suas justificativas concorrentes).
    - Frontend: Inserção de um botão translúcido `<Ver detalhes>`, o qual desperta um modal minimalista demonstrando a árvore de decisão de estratos do artigo específico, consolidando a transparência computacional.

## 4. Geração Progressiva de Quadriênios (UX-7)
- **Problema**: O HTML do Select (`#filter-year`) estava restrito a hardcodes previsíveis (ex: 2021-2024, 2025-2028). Isso tornaria o front-end legacy/obsoleto tão logo a passagem das datas ocorresse.
- **Solução**: Deletados os options rígidos do documento `index.html`. Foi elaborado em `ui.js` a função `initQuadrienios()`, invocada atomicamente na abertura do sistema. Ela mapeia o ano civil (via objeto genérico de Data) e infla o DOM recursivamente de trás para frente a partir de `2013`, garantindo retro-compatibilidade infinita e adoção automática do próximo ciclo `2029-2032`.

*OBS: O item de recriação de "Disclaimer Legal" (UX-6) foi deliberadamente suprimido do escopo de desenvolvimento nesta fase a pedido da coordenação técnica.*
