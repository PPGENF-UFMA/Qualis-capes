# Relatório de Sprint: Refatoração do Sistema de Cores e Contraste UI/UX (Modo Claro & Modo Escuro)

Nesta sprint, refinamos a paleta de cores principal e os componentes de formulários do aplicativo para elevar o contraste visual e a hierarquia nos dois temas (Claro e Escuro). A solução introduziu novas variáveis CSS (tokens) dinâmicas para inputs, eliminou a fusão visual "white-on-white" no Modo Claro e otimizou a elevação e contorno tridimensional no Modo Escuro.

---

## 1. Problemas Identificados & Motivação

1. **Modo Claro — Efeito "White-on-White":** O fundo cinza claríssimo original (`#f8fafc`) e a opacidade dos cartões (`rgba(255, 255, 255, 0.85)`) criavam uma cor final de card extremamente parecida com a da página (`#fafbfd`). Isso fazia com que os cartões e tabelas perdessem a percepção de limites físicos e profundidade, misturando-se com o background.
2. **Modo Claro — Falta de Contraste nos Inputs:** O background fixo dos inputs de formulário era `rgba(0, 0, 0, 0.2)` (translúcido). No tema claro, isso resultava em uma caixa cinza escuro de digitação. Escrever textos escuros sobre esse fundo violava a diretriz WCAG de acessibilidade (contraste de apenas ~2.5:1), dificultando severamente a leitura de termos buscados.
3. **Modo Escuro — Superfícies Sem Definição:** O fundo dos cards (`rgba(17, 24, 39, 0.7)`) combinado com o fundo da página (`#0b0f19`) resultava em um tom escuro demais. Sem uma elevação clara ou borda definida, os limites dos cards eram apagados, deixando a interface excessivamente chapada e de difícil escaneamento estrutural.
4. **Modo Escuro — Inputs "Vazados":** Os inputs no tema escuro ficavam mais escuros que os cards, criando um aspecto "furado" ou vazado sem a delimitação adequada de uma área interativa de formulário.

---

## 2. Solução Adotada & Arquitetura de Tokens

Implementamos uma arquitetura de tokens baseada em CSS Variables que diferencia adequadamente a cor de fundos, bordas, sombras e campos de inputs conforme o tema ativo:

* **Modo Claro Otimizado:**
  * Fundo da página atualizado para `#f1f5f9` (Slate 100).
  * Fundo dos cards configurado para `#ffffff` (branco sólido).
  * Bordas de cards aumentadas para `rgba(15, 23, 42, 0.08)`.
  * Inputs com fundo branco puro (`#ffffff`) e borda cinza nítida (`rgba(15, 23, 42, 0.12)`), elevando o contraste do texto digitado para mais de **10:1** (superando amplamente o critério WCAG de 4.5:1).
* **Modo Escuro Elevado:**
  * Cards configurados para `rgba(20, 27, 45, 0.85)`, que é ligeiramente mais claro e visível em contraste com o fundo `#0b0f19` da página.
  * Bordas dos cards delineadas com um toque translúcido do Indigo da marca (`rgba(99, 102, 241, 0.15)`), criando contornos finos e modernos.
  * Inputs e seletores usando fundo `rgba(15, 23, 42, 0.6)` com borda sutil, mantendo excelente integração e definição.

---

## 3. Arquivos Afetados

* **[`css/styles.css`](file:///c:/Dev/Qualis-capes/css/styles.css):**
  * Atualização dos valores das variáveis globais `:root` (fundo escuro, bordas, novos tokens `--input-bg`, `--input-border`, `--input-focus-border` e `--shadow`).
  * Atualização das variáveis no seletor de tema claro `body.light-theme`.
  * Refatoração das regras dos seletores `.text-input`, `.text-input:focus`, `.select-filter` e `.select-filter:focus` para adotar os novos tokens em substituição a valores estáticos de `rgba(0,0,0,0.2)`.

---

## 4. Resultados da Validação Visual

Os testes de comportamento visual no navegador foram executados com sucesso e comprovaram:
1. **Modo Claro Limpo:** A separação visual dos cartões de busca, histórico e resultados contra o fundo Slate-100 é nítida. O efeito "white-on-white" foi completamente resolvido.
2. **Excelente Contraste de Escrita:** A caixa de texto no modo claro agora aceita digitação sobre fundo branco com leitura clara, confortável e de alto contraste.
3. **Cards Delineados no Escuro:** Os cartões no tema escuro exibem bordas discretamente iluminadas em azul/índigo, com relevância visual clara e excelente distinção do fundo marinho.
4. **Comportamento Dinâmico:** A transição de temas (clique no botão Modo Escuro / Modo Claro) atualiza instantaneamente as cores de fundo dos inputs e cards com transições suaves e sem quebras de layout.
