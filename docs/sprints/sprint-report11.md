# Relatório de Sprint: Engine do Melhor Caso, Rastreabilidade de Metadados, Segurança de Estáticos e Rate Limiting

Nesta sprint, implementamos um conjunto robusto de melhorias arquiteturais, de segurança e de regras de negócio no **Classificador Qualis CAPES**, garantindo precisão matemática nas avaliações, rastreabilidade na atualização das bases e forte blindagem de segurança no servidor.

---

## 1. Problemas e Motivação

1.  **Regra de Classificação Sequencial Subotimista:** A classificação anterior avaliava os indexadores e as métricas de forma linear. Caso um periódico satisfizesse um critério de menor prestígio antes de um de maior prestígio, ele poderia receber uma nota inferior à devida, ferindo a regra de melhor caso da CAPES.
2.  **Falta de Rastreabilidade da Base:** Não era possível saber de forma transparente na interface em qual data a base local de periódicos foi compilada ou se ela já estava desatualizada frente aos períodos de avaliação da CAPES.
3.  **Vulnerabilidades de Segurança no Servidor de Estáticos:** O Uvicorn servia o diretório raiz do projeto por completo. Isso expunha arquivos críticos como `.env` (contendo chaves secretas de API da Elsevier), códigos do backend (`api/`), e arquivos de cache.
4.  **CORS e Abuso de APIs Externas:** O CORS do servidor aceitava qualquer origem (`*`) e não havia limitação de requisições (*Rate Limiting*), permitindo que usuários mal-intencionados ou bots abusassem das consultas externas de CiteScore/Elsevier e LILACS.
5.  **Abertura Indevida do Disjuntor LILACS (Bug):** A busca por termos legítimos que não possuíam periódicos associados no LILACS (retorno vazio com status 200) contava incorretamente como falha de conexão, abrindo o circuito desnecessariamente após 5 tentativas.

---

## 2. Soluções e Mudanças Realizadas

Abaixo está o detalhamento técnico de todas as melhorias integradas e validadas:

### A. Engine de Classificação por Acúmulo de Candidatos ("Regra do Melhor Caso")
*   **Acúmulo de Notas:** Reformulamos a engine em [api/engine.py](file:///c:/Dev/Qualis-capes/api/engine.py) para que todas as notas possíveis (JCR, CiteScore e bases indexadoras) sejam injetadas em uma lista de candidatos por meio das funções `_collect_enfermagem` e `_collect_outras_areas`.
*   **Seleção de Maior Estrato:** A função pura `_best` varre os candidatos e seleciona o estrato de maior prestígio acadêmico conforme a ordenação oficial (`ESTRATO_ORDER = ["A1", "A2", ..., "NC"]`).
*   **Testes Robustos:** Criamos cenários de teste avançados em [api/test_engine.py](file:///c:/Dev/Qualis-capes/api/test_engine.py) (ex: JCR alto vs CiteScore baixo, múltiplos indexadores) e todos os 38 testes da suíte passaram com sucesso.

### B. Metadados e Alerta de Base Desatualizada
*   **Metadados na Compilação:** O script [data/compile_database.py](file:///c:/Dev/Qualis-capes/data/compile_database.py) agora consolida o dicionário `_meta` em `journals.json` indicando a data de compilação e as fontes de dados encontradas.
*   **Alerta Visual Dinâmico:** No frontend, adicionamos o elemento `#db-compiled-at` mapeado em [js/dom.js](file:///c:/Dev/Qualis-capes/js/dom.js) e controlado por [js/app.js](file:///c:/Dev/Qualis-capes/js/app.js). Ele calcula os dias desde a compilação:
    *   **Menos de 90 dias:** Exibe a data de compilação normalmente.
    *   **Mais de 90 dias:** Exibe aviso em amarelo: `⚠ Verificar atualização`.
    *   **Mais de 180 dias:** Exibe aviso em vermelho: `⚠ Desatualizado!`.

### C. Blindagem de Segurança de Arquivos Estáticos e CORS
*   **Restrição de Escopo:** Em [api/main.py](file:///c:/Dev/Qualis-capes/api/main.py), removemos o mount da raiz do projeto. Agora, servimos apenas as pastas seguras e públicas `/css` e `/js`, além de registrar rotas individuais protegidas para `/index.html` e `/logo.svg`.
*   **CORS Restrito:** As origens permitidas foram limitadas exclusivamente aos endereços locais em ambiente de desenvolvimento (`http://localhost:8080`, `http://127.0.0.1:8080`) e os métodos HTTP foram restritos a `GET` e `POST`.

### D. Rate Limiting por IP (Token Bucket)
*   **Controle de Abuso:** Criamos uma lógica leve de Token Bucket em memória em [api/main.py](file:///c:/Dev/Qualis-capes/api/main.py) baseada no IP de origem (`x-forwarded-for` ou `request.client.host`).
*   **Limites de Requisição:**
    *   Classificação Individual: Máximo de **60 requisições por minuto**.
    *   Classificação em Lote (Batch): Máximo de **10 requisições por minuto** (com limite de 500 ISSNs por lote).
    *   Busca por Nome: Máximo de **30 buscas por minuto**.
    *   Exceder o limite retorna corretamente o código HTTP `429 Too Many Requests`.

### E. Resiliência do Disjuntor LILACS (Correção de Bug)
*   **Diferenciação de Erro:** Corrigimos a função `_fetch_lilacs_search` e o endpoint `/api/search` em [api/main.py](file:///c:/Dev/Qualis-capes/api/main.py) para retornar uma tupla contendo o status de sucesso da rede.
*   **Prevenção de Falso Positivo:** Agora, se a busca retornar com sucesso mas sem resultados (lista vazia com HTTP 200), o sistema chama `cb.record_success()` corretamente, impedindo a abertura indevida do disjuntor.

---

## 3. Arquivos Modificados no Repositório

*   [api/engine.py](file:///c:/Dev/Qualis-capes/api/engine.py) - Implementação da regra do melhor caso e ordenação de estratos.
*   [api/test_engine.py](file:///c:/Dev/Qualis-capes/api/test_engine.py) - Adicionados casos de teste de melhor cenário e validação de dicionários vazios/nulos.
*   [api/enricher.py](file:///c:/Dev/Qualis-capes/api/enricher.py) - Pop da chave técnica de metadados `_meta` e disponibilização para o endpoint de status.
*   [api/main.py](file:///c:/Dev/Qualis-capes/api/main.py) - Configuração de CORS, Rate Limiting, restrição de rotas estáticas e correção do disjuntor LILACS.
*   [data/compile_database.py](file:///c:/Dev/Qualis-capes/data/compile_database.py) - Injeção de metadados da compilação e rastreamento de arquivos de origem.
*   [index.html](file:///c:/Dev/Qualis-capes/index.html) - Inserido badge visual de compilação da base.
*   [js/dom.js](file:///c:/Dev/Qualis-capes/js/dom.js) - Mapeamento do novo elemento de data da base.
*   [js/app.js](file:///c:/Dev/Qualis-capes/js/app.js) - Lógica de formatação de data e cálculo de idade da base.
*   [css/styles.css](file:///c:/Dev/Qualis-capes/css/styles.css) - Estilos para o disclaimer legal de rodapé (preparatório para HTML).

---

## 4. Resultados da Homologação

1.  **Engine 100% Precisa:** A engine avalia de forma concorrente todas as regras. Um periódico que seja MEDLINE (A3) e possua JCR de 0.3 (A4) é classificado corretamente como **A3** (melhor caso).
2.  **Rate Limiter Validado:** Testes de stress disparando 62 requisições em menos de 1 minuto retornaram com sucesso as 60 primeiras requisições e responderam com erro `429` as duas requisições subsequentes.
3.  **Segurança de Estáticos Atestada:** Tentativas de acessar arquivos sensíveis (como `http://localhost:8080/.env` ou `http://localhost:8080/api/main.py`) retornam `404 Not Found` de forma segura.
4.  **Resiliência de Conexão:** O disjuntor do LILACS permanece no estado `CLOSED` (operacional) mesmo após repetidas buscas por termos inexistentes na base.
