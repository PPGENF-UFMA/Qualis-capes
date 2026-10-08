# Guia Rápido de Atualização — STI / UFMA
## Sistema Classificador de Produção Intelectual (CPI / Qualis CAPES)
**Versão:** 2.1.0 | **Data:** Outubro / 2026  
**Público-alvo:** Equipe de Infraestrutura e Redes — STI / UFMA  
**Repositório:** `https://github.com/PPGENF-UFMA/Qualis-capes` (Branch: `master`)

---

### 1. Resumo das Atualizações Consolidadas (Versão 2.1.0)

Como a equipe de TI ainda não havia aplicado a atualização inicial, este pacote consolida em um único deploy todas as melhorias da **Versão 2.1.0**, englobando base de dados, identidade institucional, confiabilidade de auditoria e nova experiência de usuário:

1. **Nova Identidade Visual & Chancelas Institucionais Oficiais:**
   - Transição da marca para **CPI (Classificador de Produção Intelectual)**.
   - Inclusão da pasta estática `/assets` com os brasões oficiais do **PPGENF** e da **UFMA** (cabeçalho e rodapé), além de conjunto completo de favicons e Apple Touch Icon.

2. **Expansão Integral da Base JCR Oficial 2025:**
   - Incorporação da base oficial completa da Clarivate Analytics (`data/jcr_all_2025.csv` com 22.643 periódicos).
   - O banco compilado local (`journals.json`) saltou de ~2.000 para **38.631 periódicos com Fator de Impacto JCR oficial** (totalizando 39.933 periódicos e 57.731 identificadores mapeados), cobrindo Saúde, Biológicas, Interdisciplinar e demais áreas.

3. **Correção de Resolução de Indexadores Nacionais (SciELO e Rev@Enf):**
   - Resolução dinâmica sob demanda de e-ISSNs para p-ISSNs, corrigindo a classificação de periódicos nacionais (ex: *REME* classificada como A4 pela RevEnf; *Saúde em Debate* como A6 pelo SciELO).
   - Mapeamento canônico de PIDs para a coleção Rev@Enf na BVS, eliminando erros 404 em periódicos indexados por e-ISSN secundário.

4. **Auditoria e Validação Externa nos Badges e Métricas:**
   - Todos os badges de indexadores (SciELO, Rev@Enf, MEDLINE, LILACS, BDENF, LATINDEX) e métricas (JCR, CiteScore, CUIDEN) agora possuem links diretos de comprovação externa nas bases oficiais (Clarivate Master Journal List, Scopus Preview, Portal BVS, NLM Catalog, Fundación Index).
   - Higienização de títulos em consultas ao SciELO, isolando o título do periódico e garantindo busca com 100% de precisão.

5. **Coluna "Ano de Publicação", Ordenação Temporal e Exportação Enriquecida:**
   - Nova coluna dedicada **Ano** na Tabela Detalhada com badges tabulares elegantes para análises curriculares (ORCID, Lattes e planilhas).
   - Nova opção de ordenação **"Ano (mais recente)"** com desempate por relevância acadêmica.
   - Preservação do ano na importação e no download de relatórios em CSV.

6. **Interface Moderna com Estatísticas & Dashboard:**
   - Navegação por abas (`Tabela Detalhada` e `Estatísticas & Dashboard`), gráficos interativos (Chart.js), KPIs com indicador estimado de produção (IPP) e tipografia refinada e suave nas métricas.

---

### 2. Procedimento de Atualização no Servidor (Linux / systemd)

Tempo estimado de execução: **menos de 2 minutos**. Sem necessidade de recompilar bases offline (o `journals.json` já vem compilado e versionado no Git).

Execute no terminal do servidor de produção:

```bash
# 1. Acessar o diretório da aplicação
cd /var/www/qualis-capes

# 2. Puxar os commits mais recentes da branch master
git pull origin master

# 3. Atualizar dependências Python no ambiente virtual
source venv/bin/activate
pip install -r requirements.txt

# 4. Limpar arquivos de cache transitório para carregar os novos metadados
rm -f data/*_cache.json data/runtime_discoveries.json

# 5. Reiniciar o serviço backend
sudo systemctl restart qualis-backend

# 6. Recarregar o Nginx (para garantir limpeza de cache estático de logos e CSS)
sudo systemctl reload nginx
```

> **Nota para Deploy em Docker (caso a infraestrutura utilize contêineres):**  
> Se o servidor estiver rodando via contêineres Docker, execute apenas:
> ```bash
> cd /var/www/qualis-capes
> git pull origin master
> docker compose down
> docker compose up -d --build
> ```

---

### 3. Validação Pós-Atualização (Health Check)

Após o reinício do serviço, valide o funcionamento executando os testes abaixo diretamente no servidor:

```bash
# Teste 1: Confirmar se o backend subiu com a base completa (esperado: status ok e 39.933 periódicos)
curl -s http://127.0.0.1:8080/api/v1/status | python3 -c "import sys, json; d=json.load(sys.stdin); print('Status:', d.get('status'), '| Base:', d.get('database_size'), 'periódicos')"
# Saída esperada: Status: ok | Base: 39933 periódicos

# Teste 2: Confirmar se o Fator de Impacto 2025 de periódicos internacionais está respondendo
curl -s http://127.0.0.1:8080/api/v1/classify/0140-6736 | python3 -c "import sys, json; d=json.load(sys.stdin); print('The Lancet JCR:', d.get('jcr'), '| Estrato:', d.get('classification', {}).get('estrato'))"
# Saída esperada: The Lancet JCR: 109.0 | Estrato: A1

# Teste 3: Confirmar a resolução do e-ISSN da REME e indexação RevEnf
curl -s http://127.0.0.1:8080/api/v1/classify/2316-9389 | python3 -c "import sys, json; d=json.load(sys.stdin); print('REME Estrato:', d.get('classification', {}).get('estrato'), '| Indexadores:', d.get('indexers'))"
# Saída esperada: REME Estrato: A4 | Indexadores: ['RIC/CUIDEN', 'RevEnf', 'BDENF', 'LATINDEX']

# Teste 4: No navegador, acesse o endereço público:
# https://qualis.ppgenf.ufma.br (ou domínio institucional configurado)
# - Verifique no topo o novo logotipo CPI e os brasões da UFMA e do PPGENF.
# - Ao consultar qualquer periódico ou currículo, verifique a nova coluna "Ano" e os links nos badges de indexadores.
```

---

### 4. Plano de Rollback (Contingência)

Caso ocorra qualquer comportamento anômalo imprevisto, o retorno à versão estável anterior (v1.0) é imediato:

```bash
cd /var/www/qualis-capes
git checkout 76bb52a
sudo systemctl restart qualis-backend
sudo systemctl reload nginx
```

---

*Para a documentação completa de infraestrutura, arquitetura de rede, certificados SSL e segurança, consulte o documento integral: [`docs/MANUAL_IMPLANTACAO_TI_UFMA.md`](MANUAL_IMPLANTACAO_TI_UFMA.md).*
