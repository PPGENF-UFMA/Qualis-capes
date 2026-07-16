# Análise Estratégica e Evolução de Produto: Qualis CAPES Classifier

Como Arquiteto de Sistemas e Product Manager, analisei a maturidade atual da aplicação. A fundação (FastAPI + SPA) é excelente por sua leveza e performance, mas a evolução do produto exige a transição de um simples **"Classificador Reativo"** para uma **"Plataforma de Inteligência e Gestão Estratégica"** para pesquisadores e coordenadores de Pós-Graduação (PPGs).

Abaixo, apresento o roadmap de inovações disruptivas e melhorias evolutivas, estruturado estritamente por ordem de impacto.

---

## 🔴 Impacto Crítico (Game Changers / Evolução do Core Business)
*Estas iniciativas transformam a proposta de valor do sistema, tornando-o essencial para a sobrevivência e sucesso de Programas de Pós-Graduação.*

### 1. Dashboard Preditivo de Metas CAPES para Coordenadores (PPGs)
* **Descrição Funcional:** Um módulo analítico onde o coordenador importa (ou vincula) a produção do corpo docente inteiro do programa. O sistema aplica não apenas a regra do Qualis, mas simula a **fórmula da avaliação quadrienal da CAPES**, projetando a nota do programa (ex: 3, 4, 5, 6 ou 7).
* **Valor Agregado:** Resolve a maior dor dos coordenadores: *previsibilidade*. Permite identificar antecipadamente se o programa precisa focar em revistas A1/A2, e quais docentes precisam de suporte para bater as metas de produção para o quadriênio atual.
* **Complexidade Estimada:** **Alta** (Requer modelagem de banco de dados para persistir PPGs/Docentes e motor de cálculo das métricas complexas da CAPES).
* **Impacto:** **Alto / Crítico** (Vira uma ferramenta de venda/adoção institucional pesada, não apenas uso individual).

### 2. Motor de IA para Extração de PDFs e Lattes (Visão Computacional / LLMs)
* **Descrição Funcional:** Em vez de copiar e colar texto (propenso a falhas de encoding), o usuário faz upload de PDFs (currículo Lattes completo ou os próprios artigos em lote). Uma IA (LLMs locais/API) lê os PDFs, estrutura os metadados (Título, Autores, Ano, DOI, ISSN) com precisão cirúrgica e já realiza a classificação em background.
* **Valor Agregado:** Zera o trabalho braçal e elimina problemas de formatação obscura de texto. A experiência do usuário (UX) passa a ser "arrastar um arquivo e receber um relatório completo".
* **Complexidade Estimada:** **Alta** (Integração com pipelines de LLM ou bibliotecas avançadas de extração de PDF, gestão de tokens e processamento assíncrono robusto).
* **Impacto:** **Alto / Crítico** (Posiciona o sistema como "state-of-the-art" (SOTA) perante outras soluções puramente baseadas em web scraping).

---

## 🟠 Impacto Alto (Melhorias robustas de usabilidade e eficiência)
*Iniciativas que reduzem a fricção do usuário atual e aumentam significativamente a precisão dos dados, conectando a plataforma ao ecossistema acadêmico global.*

### 3. Sincronização Direta com APIs Globais (ORCID, Crossref e Scopus ID)
* **Descrição Funcional:** O pesquisador vincula seu ORCID ou Scopus ID. O sistema faz fetch automático de todas as publicações validadas via Crossref (trazendo DOIs perfeitos e ISSNs primários), ignorando a necessidade do currículo Lattes para validação das obras.
* **Valor Agregado:** Resolve a dor da imprecisão dos dados inseridos manualmente no Lattes. Garante que 100% dos dados processados pela engine possuam ISSN/DOI válidos, zerando a taxa de "Não Classificado" por erro de digitação.
* **Complexidade Estimada:** **Média** (As APIs REST de ORCID/Crossref são bem documentadas, bastando mapear os schemas no backend).
* **Impacto:** **Alto** (Automação completa do onboarding do pesquisador).

### 4. Recommender System de "Oportunidades de Publicação"
* **Descrição Funcional:** Um painel onde o usuário insere a área (ex: Enfermagem) e o sistema recomenda em tempo real revistas A1/A2 que tenham (1) alto Qualis, mas (2) taxas de aceitação maiores ou (3) processos de revisão mais rápidos. Alerta também para *Predatory Journals*.
* **Valor Agregado:** O pesquisador deixa de usar a plataforma só no *final* da pesquisa (para contar pontos) e passa a usar no *início* da pesquisa (para decidir estrategicamente para onde enviar o paper).
* **Complexidade Estimada:** **Média/Alta** (Requer mineração de dados complementares como taxas de rejeição e tempo médio de peer-review).
* **Impacto:** **Alto** (Muda o engajamento diário com a plataforma).

---

## 🟡 Impacto Médio/Baixo (Otimizações finas e "nice-to-have")
*Refinamentos que agregam valor perceptível no polimento e gestão do sistema, com baixo esforço relativo.*

### 5. Relatórios Dinâmicos e Exportação Inteligente (DOCX/PDF)
* **Descrição Funcional:** Geração de relatórios com layout profissional, incluindo gráficos da produção (Ex: "40% de sua produção está no estrato A1"). Exportação pronta para anexar em relatórios de bolsas de produtividade (CNPq) ou comissões de avaliação institucional.
* **Valor Agregado:** Poupa horas do pesquisador e coordenador de terem que formatar o CSV cru gerado atualmente no Excel para colocar em apresentações/documentos.
* **Complexidade Estimada:** **Baixa** (Uso de bibliotecas Python de geração de PDF ou manipulação do DOM pelo JS no frontend).
* **Impacto:** **Médio** (Melhoria significativa na "Sensação de Valor" da entrega final).

### 6. Automação de Caches e Alertas de Mudança de Estrato (Cron/Webhooks)
* **Descrição Funcional:** Robôs de background (Cron Jobs) que rodam silenciosamente validando se houve alterações nos indexadores principais (CiteScore/JCR). Se um periódico subir de estrato (ex: A2 -> A1), o sistema notifica os administradores no dashboard.
* **Valor Agregado:** A base de dados vira "viva", reduzindo o risco de os administradores trabalharem com bases desatualizadas.
* **Complexidade Estimada:** **Baixa/Média** (Já temos os scripts em `data/`, basta criar um agendador assíncrono).
* **Impacto:** **Baixo/Médio** (Afeta mais a governança interna do que o usuário final, mas garante qualidade a longo prazo).

---

> [!TIP]
> **Recomendação de Próximo Passo:**
> Sugiro selecionarmos a **Dashboard Preditivo de Metas CAPES** (Impacto Crítico) e a **Sincronização Direta com ORCID/Crossref** (Impacto Alto) como os próximos "Épicos" para desenvolvimento. Elas não exigem o refactoring da arquitetura base (FastAPI e SPA), apenas a construção de novos módulos modulares que consumirão a *engine* que já temos consolidada.
