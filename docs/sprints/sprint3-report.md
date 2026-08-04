# Sprint 3 Report: Parser Lattes

**Data**: 23/06/2026
**Foco**: Melhorar a acurácia no pareamento de currículos copiados e colados com os dicionários do Qualis, visando eliminar o excesso de publicações reais retornando com o erro silencioso "NC" (Não Classificado).

## 1. Tratamento de Encoding Corrompido (`LP-3`)
- **Problema**: O ato de copiar e colar do site do Lattes para o navegador acarreta rotineiramente quebra do formato UTF-8 (acentos substituídos por `Ã©`, `Ã£` e control chars `□`). O algoritmo *Fuzzy Match* recebia strings lixo e falhava imediatamente.
- **Solução**: Implementada a função síncrona `fixEncoding(text)` em `js/lattesParser.js` para capturar as anomalias nativas e retornar as strings acentuadas com sucesso e limpar resíduos de formatação (Zero-width e Control chars) antes da segmentação por artigo.

## 2. Separação de Dicionário de Aliases (`F-4`)
- **Problema**: Apenas ~30 apelidos constavam definidos de maneira acoplada ("hardcoded") na base do projeto, o que tornava a manutenção chata e sobrecarregava o interpretador, falhando com dezenas de outras revistas da área de Enfermagem que costumam ser abreviadas sistematicamente.
- **Solução**: Extraída a listagem para um novo banco estático `js/aliases.json`, ampliando as opções (+20 novos dicionários) focadas em saúde, e inserida uma nova chamada assíncrona global de Fetch (`initLattesParser`) acoplada na inicialização principal do sistema.

## 3. Threshold Adaptativo em Fuzzy Matching (`F-3`)
- **Problema**: A função base de semelhança sintática *Jaro-Winkler* aplicava uma exigência cortante linear (`0.85`). Para um título muito curto como "ACTA PAUL", o mínimo de erro (um espaço diferente) destruía o rank. Para títulos de 20 palavras, siglas randômicas geravam falsos positivos por compartilharem tamanho.
- **Solução**: Implementado o *Adaptive Threshold* no `matchJournalToISSN()`. Textos menores que 10 letras cobram estritos 92% de matching (evitando colisões acidentais curtas). Entre 10 e 25 cobram 88%. Acima de 25 caracteres mantemos a complacência original dos 85% para suportar pontuação falha.

## 4. Oclusão Ruidosa de Anais de Congresso (`LP-4 real`)
- **Problema**: Entradas que não são artigos (ex: "Anais do Simpósio...", "Conference Proceedings") caíam no validador Qualis. Por não serem revistas, sujavam a contabilidade final retornando "NC".
- **Solução**: Mapeados os termos e isolada a propriedade `article.type = 'congresso'`. O frontend (em `app.js`) agora não submete os registros de congresso ao servidor Qualis, reduzindo drasticamente o SPAM das tabelas geradas.

## 5. Insight de Feedback do Usuário (`LP-4`)
- **Problema**: O usuário recebia os "NC" de volta misturados aos reais NC (revistas ruins), sem saber que alguns eram apenas falha de correspondência por abreviação desconhecida.
- **Solução**: A UI agora marca com um Alerta amarelo de destaque: **"⚠ Não encontrado na base"** e totaliza um alerta pop-up (`Toast`) explicitando *"X de Y artigos não foram reconhecidos. Verifique a tabela."*, o que instiga a validação manual em vez de presunção de ausência de nota.
