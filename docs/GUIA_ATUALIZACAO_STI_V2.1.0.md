# Guia Rápido de Atualização — STI / UFMA
## Sistema Classificador de Produção Intelectual (CPI / Qualis CAPES)
**Versão:** 2.1.0 | **Data:** Setembro / 2026  
**Público-alvo:** Equipe de Infraestrutura e Redes — STI / UFMA  
**Repositório:** `https://github.com/PPGENF-UFMA/Qualis-capes` (Branch: `master`)

---

### 1. Resumo das Atualizações (Últimos 3 Commits)

Esta atualização consolida três melhorias fundamentais desenvolvidas para o sistema em produção:

1. **Nova Identidade Visual & Chancelas Oficiais (Commit `88be449`):**
   - Transição da marca para **CPI (Classificador de Produção Intelectual)**.
   - Inclusão da pasta estática `/assets` com os brasões oficiais do **PPGENF** e da **UFMA** (cabeçalho e rodapé), além de conjunto completo de favicons e Apple Touch Icon.
2. **Correção de Indexação SciELO e RevEnf (Commit `661d7ed`):**
   - Resolução dinâmica sob demanda de e-ISSNs para p-ISSNs, corrigindo a classificação de periódicos nacionais (ex: *REME* classificada como A4 pela RevEnf; *Saúde em Debate* como A6 pelo SciELO).
3. **Expansão Completa da Base JCR 2025 (Commit `0e687ba`):**
   - Incorporação de toda a base oficial da Clarivate Analytics (`data/jcr_all_2025.csv` com 22.643 periódicos).
   - O banco compilado local (`journals.json`) saltou de ~2.000 para **38.631 periódicos com Fator de Impacto JCR oficial**, cobrindo 100% das revistas de Saúde, Biológicas, Interdisciplinar e demais áreas.

---

### 2. Procedimento de Atualização no Servidor (Linux / systemd)

Tempo estimado de execução: **menos de 2 minutos**. Sem necessidade de recompilar bases offline (o `journals.json` já vem compilado no Git).

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
rm -f data/*_cache.json

# 5. Reiniciar o serviço backend
sudo systemctl restart qualis-backend

# 6. Recarregar o Nginx (para garantir limpeza de cache estático de logos)
sudo systemctl reload nginx
```

> **Nota para Deploy em Docker (caso aplicável):**  
> Se o servidor estiver rodando via contêineres Docker, execute apenas:
> ```bash
> cd /var/www/qualis-capes
> git pull origin master
> docker compose down
> docker compose up -d --build
> ```

---

### 3. Validação Pós-Atualização (Health Check)

Após o reinício, valide o funcionamento executando os testes abaixo diretamente no servidor:

```bash
# Teste 1: Confirmar se o backend subiu com a base completa (esperado: status ok e 39.933 canônicos / 57.731 identificadores)
curl -s http://127.0.0.1:8080/api/v1/status | python3 -c "import sys, json; d=json.load(sys.stdin); print('Status:', d.get('status'), '| Base:', d.get('database_size'), 'periódicos')"

# Teste 2: Confirmar se o Fator de Impacto 2025 de periódicos internacionais está respondendo
curl -s http://127.0.0.1:8080/api/v1/classify/0140-6736 | python3 -c "import sys, json; d=json.load(sys.stdin); print('The Lancet JCR:', d.get('jcr'), '| Estrato:', d.get('classification', {}).get('estrato'))"
# Saída esperada: The Lancet JCR: 109.0 | Estrato: A1

# Teste 3: Confirmar a resolução do e-ISSN da REME
curl -s http://127.0.0.1:8080/api/v1/classify/2316-9389 | python3 -c "import sys, json; d=json.load(sys.stdin); print('REME Estrato:', d.get('classification', {}).get('estrato'))"
# Saída esperada: REME Estrato: A4

# Teste 4: No navegador, acesse o endereço público:
# https://qualis.ppgenf.ufma.br (ou domínio institucional configurado)
# - Verifique no topo o novo logotipo CPI e os brasões da UFMA e do PPGENF.
```

---

### 4. Plano de Rollback (Contingência)

Caso ocorra qualquer comportamento anômalo imprevisto, o retorno à versão anterior é imediato:

```bash
cd /var/www/qualis-capes
git checkout 76bb52a
sudo systemctl restart qualis-backend
```

---

*Para a documentação completa de infraestrutura, arquitetura de rede, certificados SSL e segurança, consulte o documento integral: [`docs/MANUAL_IMPLANTACAO_TI_UFMA.md`](MANUAL_IMPLANTACAO_TI_UFMA.md).*
