# Manual de Implantação, Operação e Transferência Técnica

## Sistema de Classificação Automatizada Qualis CAPES (PPGENF / UFMA)

**Destinatário:** Equipe de Tecnologia da Informação — STI / UFMA
**Projeto:** Qualis CAPES Classifier — Programa de Pós-Graduação em Enfermagem (PPGENF)
**Versão do Documento:** 2.1.0
**Data:** Setembro / 2026
**Repositório:** `https://github.com/PPGENF-UFMA/Qualis-capes`

---

## Sumário

1. [Visão Geral e Arquitetura](#1-visão-geral-e-arquitetura)
2. [Requisitos de Infraestrutura](#2-requisitos-de-infraestrutura)
3. [Instalação e Configuração](#3-instalação-e-configuração)
4. [Banco de Dados de Periódicos](#4-banco-de-dados-de-periódicos)
5. [Deploy em Produção — Linux (Recomendado)](#5-deploy-em-produção--linux-recomendado)
6. [Deploy em Produção — Windows Server](#6-deploy-em-produção--windows-server)
7. [Deploy com Docker (Alternativa)](#7-deploy-com-docker-alternativa)
8. [Configuração do Proxy Reverso (Nginx)](#8-configuração-do-proxy-reverso-nginx)
9. [Certificado SSL/TLS (HTTPS)](#9-certificado-ssltls-https)
10. [Verificação Pós-Deploy (Health Check)](#10-verificação-pós-deploy-health-check)
11. [Estrutura de Arquivos e Código](#11-estrutura-de-arquivos-e-código)
12. [Manutenção Operacional](#12-manutenção-operacional)
13. [Backup e Recuperação](#13-backup-e-recuperação)
14. [Atualização do Sistema](#14-atualização-do-sistema)
15. [Segurança](#15-segurança)
16. [Referência Rápida da API](#16-referência-rápida-da-api)
17. [Solução de Problemas (Troubleshooting)](#17-solução-de-problemas-troubleshooting)
18. [Contato e Suporte](#18-contato-e-suporte)

---

## 1. Visão Geral e Arquitetura

### 1.1 O que é o Sistema

O **Qualis CAPES Classifier** é uma aplicação web que automatiza a classificação de periódicos científicos e artigos segundo os critérios da avaliação quadrienal da CAPES, com foco na área de **Enfermagem** e suporte a **Outras Áreas**.

**Funcionalidades principais:**

- Classificação individual e em lote de periódicos por ISSN (estratos A1 a A8 ou NC)
- Busca de periódicos por nome na base local e bases externas (LILACS)
- Importação e classificação automática de Currículo Lattes (colar texto)
- Importação de produções via ORCID ID
- Dashboard com gráficos e KPIs de produção acadêmica
- Exportação de resultados em CSV
- Matching inteligente de nomes de periódicos com correção colaborativa

### 1.2 Arquitetura da Solução

```
┌────────────────────────────────────────────────────────┐
│                   Cliente / Navegador                   │
│          SPA (HTML5 + Vanilla JS ES Modules)           │
│          Sem build step, sem Node.js, sem npm           │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTPS (JSON REST API)
┌──────────────────────────▼─────────────────────────────┐
│              Nginx / Reverse Proxy (porta 443)         │
│              SSL termination + Gzip + Cache            │
└──────────────────────────┬─────────────────────────────┘
                           │ http://127.0.0.1:8080
┌──────────────────────────▼─────────────────────────────┐
│              FastAPI Backend (Python 3.10+)             │
│                                                        │
│  api/main.py ───── Roteamento, Rate Limiting, CORS     │
│  api/engine.py ─── Motor de Regras CAPES (puro)        │
│  api/enricher.py ─ Enriquecedor, Matching, Parsing     │
│  api/cache.py ──── Cache JSON em disco + Circuit Break  │
│  api/orcid_client  Integração ORCID Public API         │
│  api/models.py ─── Validação Pydantic                  │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│  Base Local: data/journals.json (~13,8 MB, 57k revistas) │
│  Caches:  scielo_cache / lilacs_cache / latindex_cache  │
│  APIs Externas: Elsevier, SciELO, LILACS, Latindex,    │
│                 ORCID, CrossRef                         │
└────────────────────────────────────────────────────────┘
```

**Pontos-chave da arquitetura:**

- **Sem banco de dados relacional** — a base de periódicos é um arquivo JSON estático (`data/journals.json`) compilado offline
- **Sem Node.js / npm / webpack** — o frontend é HTML + JS puro servido como arquivos estáticos pelo FastAPI
- **Sem estado persistente** — classificações são calculadas sob demanda; resultados ficam no `sessionStorage` do navegador
- **APIs externas são opcionais** — o sistema funciona 100% offline com a base local; APIs enriquecem dados quando disponíveis

---

## 2. Requisitos de Infraestrutura

### 2.1 Especificações do Servidor

| Recurso | Mínimo | Recomendado |
|:---|:---|:---|
| **SO** | Ubuntu 22.04 LTS / Debian 12 / RHEL 9 / Windows Server 2019+ | **Ubuntu 22.04 LTS Server (64-bit)** |
| **CPU** | 1 vCPU (2.0 GHz) | 2 vCPUs |
| **RAM** | 2 GB | 4 GB |
| **Disco** | 5 GB SSD | 20 GB SSD |
| **Python** | 3.10+ | **3.11 ou 3.12** |
| **Rede** | Porta 80 e 443 abertas | 443 com certificado SSL/TLS |

### 2.2 Dependências de Software

| Software | Finalidade | Obrigatório? |
|:---|:---|:---|
| **Python 3.10+** | Runtime do backend FastAPI | ✅ Sim |
| **pip** | Gerenciador de pacotes Python | ✅ Sim |
| **git** | Clonagem e atualização do repositório | ✅ Sim |
| **Nginx** | Proxy reverso, SSL termination, servir assets | ✅ Recomendado |
| **certbot** | Geração de certificados Let's Encrypt | ⚠️ Recomendado |
| **systemd** | Gerenciamento de serviço (Linux) | ⚠️ Recomendado |
| **Docker + Docker Compose** | Deploy containerizado (alternativa) | ❌ Opcional |

### 2.3 Dependências Python (requirements.txt)

```
# API Server
fastapi>=0.137.0
uvicorn[standard]>=0.49.0
httpx>=0.28.0
pydantic>=2.13.0
python-dotenv>=1.0.0

# Compilação do banco de dados
pandas>=2.0.0
openpyxl>=3.1.0

# Fetch de CiteScore via API Elsevier
requests>=2.31.0

# Scraping (Latindex fallback)
beautifulsoup4>=4.12.0

# Testes
pytest>=7.4.0
```

### 2.4 Conectividade de Rede (APIs Externas)

O servidor precisa acessar os seguintes endpoints **de saída** (outbound). Se a UFMA utilizar firewall de saída, libere os domínios abaixo:

| API | Domínio | Porta | Finalidade |
|:---|:---|:---|:---|
| **Elsevier** | `api.elsevier.com` | 443 | CiteScore (fator de impacto) |
| **SciELO** | `search.scielo.org` | 443 | Verificar indexação SciELO |
| **LILACS/BVS** | `fi-admin-api.bvsalud.org`, `lilacs.bvsalud.org` | 443 | Verificar indexação LILACS/BDENF |
| **Latindex** | `www.latindex.org` | 443 | Verificar indexação Latindex |
| **ORCID** | `pub.orcid.org`, `orcid.org` | 443 | Importar produção via ORCID |
| **CrossRef** | `api.crossref.org` | 443 | Resolver DOIs e ISSNs |

> **Nota:** Todas as APIs externas são **opcionais e resilientes**. O sistema possui Circuit Breakers que desativam automaticamente consultas quando uma API está fora do ar, sem afetar as demais funcionalidades.

---

## 3. Instalação e Configuração

### 3.1 Obtenção do Código-Fonte

```bash
# Clone o repositório no diretório de aplicações
cd /var/www
git clone https://github.com/PPGENF-UFMA/Qualis-capes.git qualis-capes
cd qualis-capes
```

### 3.2 Ambiente Virtual Python

**Obrigatório:** sempre use um ambiente virtual isolado.

```bash
# Linux
python3 -m venv venv
source venv/bin/activate

# Windows PowerShell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

### 3.3 Instalação das Dependências

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

### 3.4 Configuração de Variáveis de Ambiente

Crie o arquivo `.env` na raiz do projeto:

```bash
cp .env.example .env
```

Edite o `.env` com as configurações de produção:

```env
# ═══════════════════════════════════════════════════════════════
# ARQUIVO .env — Configuração de Produção
# ═══════════════════════════════════════════════════════════════

# ─── Elsevier API (CiteScore) ──────────────────────────────────
# Chave gratuita: https://dev.elsevier.com/apikey/manage
# Sem esta chave o CiteScore não será consultado (o sistema
# continua funcionando com JCR da base local e indexadores).
ELSEVIER_API_KEY=sua_chave_aqui

# ─── Ambiente ──────────────────────────────────────────────────
# "production" → desabilita /docs e /redoc (Swagger UI)
# "development" → mantém documentação interativa ativa
ENVIRONMENT=production

# ─── CORS ──────────────────────────────────────────────────────
# Origens permitidas separadas por vírgula.
# Ajuste para os domínios oficiais em que o sistema será acessado.
CORS_ORIGINS=https://qualis.ppgenf.ufma.br,https://qualis.ufma.br

# ─── Proxy Reverso ────────────────────────────────────────────
# IPs do proxy reverso que envia X-Forwarded-For confiável.
# Necessário para o rate limiting funcionar corretamente.
TRUSTED_PROXIES=127.0.0.1
```

#### Detalhamento de cada variável

| Variável | Obrigatória | Descrição |
|:---|:---|:---|
| `ELSEVIER_API_KEY` | Não (recomendada) | Chave da API Serial Title da Elsevier para consultar CiteScore. Gratuita para uso acadêmico. Sem ela, a classificação ainda funciona via JCR local e indexadores. |
| `ENVIRONMENT` | Não | Quando `production`, desabilita as rotas `/docs` e `/redoc` (Swagger). |
| `CORS_ORIGINS` | Não | Lista de origens permitidas para requisições cross-origin. Ajustar para os domínios em que a aplicação será servida. |
| `TRUSTED_PROXIES` | Não | IPs dos proxies reversos confiáveis (Nginx). Necessário para que o rate limiting use o IP real do cliente via `X-Forwarded-For`. |

### 3.5 Validação da Instalação (Teste Local)

Antes de configurar o serviço em produção, valide que tudo funciona:

```bash
# Ative o venv
source venv/bin/activate  # Linux
# .\venv\Scripts\Activate.ps1  # Windows

# Inicie o servidor em modo desenvolvimento
python -m uvicorn api.main:app --host 127.0.0.1 --port 8080

# Em outro terminal, teste o health check:
curl http://127.0.0.1:8080/api/health
# Resposta esperada: {"status":"healthy","db_loaded":true,"db_size":...}

# Teste a classificação de um ISSN:
curl http://127.0.0.1:8080/api/v1/classify/0104-1169
# Resposta esperada: JSON com estrato, justificativa, indexadores, etc.
```

Se ambos os testes retornarem JSON válido, a instalação está correta. Pressione `Ctrl+C` para parar o servidor de teste.

---

## 4. Banco de Dados de Periódicos

### 4.1 Visão Geral

O sistema utiliza uma base unificada de periódicos em `data/journals.json` (~13,8 MB, 57.731 periódicos cadastrados e 38.631 com Fator de Impacto JCR 2025 da Clarivate Analytics). Este arquivo é **pré-compilado** e já está incluído no repositório — não é necessário compilar na primeira instalação.

**Fontes de dados que alimentam o `journals.json`:**

| Fonte | Arquivo | Descrição |
|:---|:---|:---|
| Qualis Sucupira | `data/classificacao.xlsx` | Lista oficial da CAPES com ISSNs e áreas |
| JCR Completo (Clarivate) | `data/jcr_all_2025.csv` | Base oficial JCR 2025 completa (22.643 periódicos) |
| JCR Categorias | `data/jcr_*.csv` | Fatores de impacto JCR por categorias específicas |
| Scopus (Elsevier) | `data/journals_scopus.xlsx` | Base Scopus com CiteScores |
| CUIDEN | `data/cuiden_citacion_2022.csv` | Índices CUIDEN da área de Enfermagem |
| BDENF | `data/bdenf_issns.json` | ISSNs indexados na BDENF |
| RevEnf | `data/revenf_issns.json` | ISSNs indexados na RevEnf |

### 4.2 Quando Recompilar o Banco de Dados

Recompile **somente** quando houver:

1. **Atualização da avaliação quadrienal** — novos dados da CAPES/Sucupira
2. **Novos dados do JCR** — novos CSVs exportados do Web of Science
3. **Novos dados do Scopus** — nova planilha Scopus
4. **Correções nos dados** — ISSNs incorretos, áreas reclassificadas

### 4.3 Procedimento de Compilação

```bash
# Ative o venv
source venv/bin/activate

# Importante no Windows: definir encoding
# $env:PYTHONIOENCODING = 'utf-8'   # PowerShell
# set PYTHONIOENCODING=utf-8         # CMD

# Executar compilação
python data/compile_database.py
```

O script irá:
1. Ler `classificacao.xlsx` (planilha Sucupira oficial)
2. Auto-detectar todos os `jcr_*.csv` no diretório `data/`
3. Ler `journals_scopus.xlsx` para CiteScores
4. Cruzar com `cuiden_citacion_2022.csv`, `bdenf_issns.json`, `revenf_issns.json`
5. Gerar novo `data/journals.json` com metadados de compilação

### 4.4 Atualização de CiteScore (API Elsevier)

Para sincronizar CiteScores atualizados (requer `ELSEVIER_API_KEY` configurada):

```bash
# Buscar CiteScores e aplicar direto no journals.json
python data/fetch_citescore.py --apply

# Verificar estatísticas do cache
python data/fetch_citescore.py --stats
```

> **Nota:** O CiteScore também é consultado em tempo real durante a classificação individual. O `fetch_citescore.py --apply` é útil para fazer um pré-carregamento em massa.

---

## 5. Deploy em Produção — Linux (Recomendado)

### 5.1 Criar Usuário de Serviço

```bash
# Criar usuário sem shell de login para segurança
sudo useradd --system --no-create-home --shell /usr/sbin/nologin qualis
sudo chown -R qualis:qualis /var/www/qualis-capes
```

### 5.2 Criar Serviço systemd

Crie o arquivo `/etc/systemd/system/qualis-backend.service`:

```ini
[Unit]
Description=Qualis CAPES Classifier — Backend FastAPI
Documentation=https://github.com/PPGENF-UFMA/Qualis-capes
After=network.target
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=exec
User=qualis
Group=qualis
WorkingDirectory=/var/www/qualis-capes

# Caminho absoluto do Python do venv
ExecStart=/var/www/qualis-capes/venv/bin/python -m uvicorn api.main:app \
    --host 127.0.0.1 \
    --port 8080 \
    --workers 4 \
    --log-level info \
    --access-log

# Carregar variáveis de ambiente do .env
EnvironmentFile=/var/www/qualis-capes/.env

# Restart automático em caso de falha
Restart=on-failure
RestartSec=5

# Limites de recursos (previne runaway processes)
MemoryMax=1G
CPUQuota=80%

# Segurança (hardening)
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=/var/www/qualis-capes/data
ProtectHome=yes
PrivateTmp=yes

# Logs vão para o journald
StandardOutput=journal
StandardError=journal
SyslogIdentifier=qualis-backend

[Install]
WantedBy=multi-user.target
```

### 5.3 Ativar e Iniciar o Serviço

```bash
# Recarregar configurações do systemd
sudo systemctl daemon-reload

# Habilitar inicio automático no boot
sudo systemctl enable qualis-backend

# Iniciar o serviço
sudo systemctl start qualis-backend

# Verificar o status
sudo systemctl status qualis-backend
```

Saída esperada:

```
● qualis-backend.service - Qualis CAPES Classifier — Backend FastAPI
     Loaded: loaded (/etc/systemd/system/qualis-backend.service; enabled)
     Active: active (running) since ...
     ...
```

### 5.4 Comandos Operacionais (Linux)

```bash
# Status do serviço
sudo systemctl status qualis-backend

# Parar o serviço
sudo systemctl stop qualis-backend

# Reiniciar (útil após atualização de código)
sudo systemctl restart qualis-backend

# Logs em tempo real
sudo journalctl -u qualis-backend -f

# Logs das últimas 24h filtrados por erros
sudo journalctl -u qualis-backend -p err --since "24 hours ago"

# Logs de auditoria (classificações, buscas, matching)
sudo journalctl -u qualis-backend | grep "AUDIT"
```

---

## 6. Deploy em Produção — Windows Server

> **Recomendação:** Linux é o ambiente preferível para produção. Use Windows Server apenas se for o único disponível na infraestrutura da UFMA.

### 6.1 Usando o Script PowerShell (server.ps1)

O repositório inclui um script PowerShell para gerenciamento:

```powershell
# Iniciar o servidor em background
.\server.ps1 start

# Verificar status
.\server.ps1 status

# Parar
.\server.ps1 stop

# Reiniciar
.\server.ps1 restart
```

### 6.2 Usando o Agendador de Tarefas (Produção)

Para garantir que o servidor inicie automaticamente após reinicializações do Windows:

1. Abra o **Agendador de Tarefas** (`taskschd.msc`)
2. Crie uma nova tarefa:
   - **Nome:** `Qualis CAPES Backend`
   - **Executar com os mais altos privilégios:** Não (por segurança)
   - **Disparador:** "Na inicialização do sistema" (com atraso de 30 segundos)
   - **Ação:** Iniciar programa
     - **Programa:** `C:\caminho\qualis-capes\venv\Scripts\python.exe`
     - **Argumentos:** `-m uvicorn api.main:app --host 127.0.0.1 --port 8080 --workers 2`
     - **Iniciar em:** `C:\caminho\qualis-capes`
   - **Configurações:**
     - Marcar "Se a tarefa falhar, reiniciar a cada 1 minuto"
     - Limite de 5 reinicializações

### 6.3 Usando NSSM (Non-Sucking Service Manager) — Alternativa Recomendada

Para um serviço Windows nativo mais robusto, use o [NSSM](https://nssm.cc/):

```powershell
# Instalar NSSM (colocar nssm.exe no PATH)
nssm install QualisCapes "C:\caminho\qualis-capes\venv\Scripts\python.exe" "-m uvicorn api.main:app --host 127.0.0.1 --port 8080 --workers 2"
nssm set QualisCapes AppDirectory "C:\caminho\qualis-capes"
nssm set QualisCapes AppEnvironmentExtra "ELSEVIER_API_KEY=sua_chave" "ENVIRONMENT=production"

# Iniciar o serviço
nssm start QualisCapes

# Gerenciar
nssm status QualisCapes
nssm stop QualisCapes
nssm restart QualisCapes
```

---

## 7. Deploy com Docker (Alternativa)

Para ambientes que preferem containerização, crie os seguintes arquivos na raiz do projeto:

### 7.1 Dockerfile

```dockerfile
FROM python:3.12-slim

# Metadados
LABEL maintainer="PPGENF/UFMA"
LABEL description="Qualis CAPES Classifier"

# Diretório de trabalho
WORKDIR /app

# Copiar dependências primeiro (cache de camadas Docker)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código da aplicação
COPY api/ ./api/
COPY js/ ./js/
COPY css/ ./css/
COPY data/journals.json ./data/journals.json
COPY data/aliases.json ./data/aliases.json
COPY data/bdenf_issns.json ./data/bdenf_issns.json
COPY data/revenf_issns.json ./data/revenf_issns.json
COPY data/cuiden_citacion_2022.csv ./data/cuiden_citacion_2022.csv
COPY index.html .
COPY logo.svg .

# Criar diretório para caches (gravável)
RUN mkdir -p /app/data && chmod 777 /app/data

# Porta exposta
EXPOSE 8080

# Variáveis de ambiente padrão
ENV ENVIRONMENT=production
ENV PYTHONUNBUFFERED=1

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/api/health')"

# Comando de inicialização
CMD ["python", "-m", "uvicorn", "api.main:app", \
     "--host", "0.0.0.0", "--port", "8080", "--workers", "4"]
```

### 7.2 docker-compose.yml

```yaml
services:
  qualis-backend:
    build: .
    container_name: qualis-capes
    restart: unless-stopped
    ports:
      - "8080:8080"
    env_file:
      - .env
    volumes:
      # Persistir caches entre restarts
      - qualis-cache:/app/data
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: "1.5"

volumes:
  qualis-cache:
```

### 7.3 Comandos Docker

```bash
# Build e start
docker compose up -d --build

# Status
docker compose ps

# Logs
docker compose logs -f qualis-backend

# Parar
docker compose down

# Rebuild após atualização
git pull
docker compose up -d --build
```

---

## 8. Configuração do Proxy Reverso (Nginx)

### 8.1 Instalar Nginx

```bash
# Ubuntu/Debian
sudo apt update && sudo apt install nginx -y

# RHEL/CentOS
sudo dnf install nginx -y
```

### 8.2 Configuração do Virtual Host

Crie o arquivo `/etc/nginx/sites-available/qualis-ufma`:

```nginx
# ═══════════════════════════════════════════════════════════════
# Nginx — Qualis CAPES Classifier (UFMA)
# ═══════════════════════════════════════════════════════════════

# Redirect HTTP → HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name qualis.ppgenf.ufma.br;

    # ACME challenge para Let's Encrypt
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# HTTPS principal
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name qualis.ppgenf.ufma.br;

    # ─── Certificados SSL ──────────────────────────────────
    # Let's Encrypt (gerenciado pelo certbot)
    ssl_certificate     /etc/letsencrypt/live/qualis.ppgenf.ufma.br/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/qualis.ppgenf.ufma.br/privkey.pem;

    # OU certificado institucional da UFMA (CA própria):
    # ssl_certificate     /etc/ssl/certs/qualis_ufma.crt;
    # ssl_certificate_key /etc/ssl/private/qualis_ufma.key;

    # ─── Hardening SSL ─────────────────────────────────────
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # ─── Headers de Segurança ──────────────────────────────
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # ─── Limites ───────────────────────────────────────────
    client_max_body_size 25M;

    # ─── Compressão Gzip ───────────────────────────────────
    gzip on;
    gzip_vary on;
    gzip_min_length 1000;
    gzip_proxied any;
    gzip_types
        text/plain
        text/css
        application/json
        application/javascript
        text/xml
        image/svg+xml;

    # ─── Rate Limiting (camada adicional no Nginx) ─────────
    # Definir fora deste bloco server, no nginx.conf:
    #   limit_req_zone $binary_remote_addr zone=api:10m rate=30r/m;
    location /api/ {
        # limit_req zone=api burst=10 nodelay;
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 10s;
        proxy_read_timeout 120s;
    }

    # ─── Assets estáticos (cache agressivo) ────────────────
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ~* \.(css|js|svg|png|ico|woff2?)$ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
}
```

### 8.3 Ativar Configuração

```bash
# Criar link simbólico
sudo ln -s /etc/nginx/sites-available/qualis-ufma /etc/nginx/sites-enabled/

# Testar configuração (SEMPRE antes de recarregar!)
sudo nginx -t

# Recarregar Nginx
sudo systemctl reload nginx
```

---

## 9. Certificado SSL/TLS (HTTPS)

### Opção A: Let's Encrypt (Gratuito e Automatizado)

```bash
# Instalar certbot
sudo apt install certbot python3-certbot-nginx -y

# Gerar certificado (o certbot configura o Nginx automaticamente)
sudo certbot --nginx -d qualis.ppgenf.ufma.br

# Verificar renovação automática
sudo certbot renew --dry-run
```

O certbot configura um timer no systemd para renovar o certificado automaticamente a cada 60-90 dias.

### Opção B: Certificado Institucional (CA da UFMA / RNP)

Se a UFMA utiliza certificados emitidos pela ICPEdu/RNP ou CA própria:

1. Copie o certificado e chave para `/etc/ssl/`:
   ```bash
   sudo cp qualis_ufma.crt /etc/ssl/certs/
   sudo cp qualis_ufma.key /etc/ssl/private/
   sudo chmod 600 /etc/ssl/private/qualis_ufma.key
   ```
2. Ajuste os caminhos no bloco `server` do Nginx (veja seção 8.2).

---

## 10. Verificação Pós-Deploy (Health Check)

Após concluir o deploy, execute os seguintes testes na ordem:

### 10.1 Checklist de Verificação

```bash
# 1. Backend está rodando?
sudo systemctl status qualis-backend
# Esperado: Active: active (running)

# 2. API Health Check (via backend direto)
curl -s http://127.0.0.1:8080/api/health | python3 -m json.tool
# Esperado: {"status": "healthy", "db_loaded": true, "db_size": <número>}

# 3. Status completo da API
curl -s http://127.0.0.1:8080/api/v1/status | python3 -m json.tool
# Verificar: version, database_size, elsevier_api_key, circuits

# 4. Classificação de teste
curl -s http://127.0.0.1:8080/api/v1/classify/0104-1169 | python3 -m json.tool
# Esperado: ISSN da Revista Latino-Americana de Enfermagem

# 5. Busca de teste
curl -s "http://127.0.0.1:8080/api/v1/search?q=enfermagem" | python3 -m json.tool
# Esperado: Lista de periódicos contendo "enfermagem" no título

# 6. Nginx respondendo via HTTPS?
curl -s https://qualis.ppgenf.ufma.br/api/health | python3 -m json.tool
# Esperado: Mesmo resultado do item 2

# 7. Página web carrega?
curl -s -o /dev/null -w "%{http_code}" https://qualis.ppgenf.ufma.br/
# Esperado: 200
```

### 10.2 Teste no Navegador

1. Acesse `https://qualis.ppgenf.ufma.br/`
2. Na aba "Classificar ISSN", digite `0104-1169` e clique em Classificar
3. Verifique se aparece o resultado com estrato, justificativa e dados do periódico
4. Na aba "Dashboard", verifique se os gráficos renderizam corretamente

---

## 11. Estrutura de Arquivos e Código

```
qualis-capes/
│
├── api/                          # Backend Python (FastAPI)
│   ├── __init__.py               # Marca o diretório como pacote Python
│   ├── main.py                   # App FastAPI: rotas REST, rate limiting, CORS,
│   │                             #   serving de estáticos (index.html, assets, css, js)
│   ├── engine.py                 # Motor de regras CAPES (função pura classify_journal)
│   │                             #   Enfermagem: A1-A8 baseado em JCR/CiteScore/indexadores
│   │                             #   Outras Áreas: A1-A8 com thresholds diferentes
│   ├── enricher.py               # Enriquecedor de dados: carrega journals.json,
│   │                             #   consulta APIs externas (SciELO, LILACS, Latindex,
│   │                             #   Elsevier, OpenAlex), matching inteligente
│   ├── cache.py                  # Cache JSON em disco com TTL de 30 dias,
│   │                             #   Circuit Breakers para APIs externas
│   ├── models.py                 # Schemas Pydantic para validação de request/response
│   ├── orcid_client.py           # Cliente da API pública ORCID + resolução CrossRef
│   └── test_engine.py            # Testes unitários do motor de classificação
│
├── assets/                       # Identidade Visual e Chancelas Institucionais
│   ├── ppgenf_clean.png          # Brasão do Programa de Pós-Graduação em Enfermagem
│   ├── ufma_clean.png            # Brasão oficial da Universidade Federal do Maranhão
│   ├── ufma_solo_clean.png       # Brasão UFMA versão compacta
│   ├── favicon.ico               # Favicon multi-resolução
│   ├── favicon-32x32.png         # Favicon PNG 32x32
│   ├── favicon.svg               # Favicon vetorial SVG
│   └── apple-touch-icon.png      # Ícone para dispositivos móveis Apple
│
├── js/                           # Frontend — Vanilla JS (ES Modules)
│   ├── app.js                    # Orquestrador: event listeners, inicialização
│   ├── enricher.js               # Cliente HTTP da API backend
│   ├── dom.js                    # Referências centralizadas a elementos do DOM
│   ├── state.js                  # Estado da aplicação (sessionStorage)
│   ├── table.js                  # Renderização da tabela de resultados
│   ├── charts.js                 # Dashboard com Chart.js (KPIs, gráficos)
│   ├── ui.js                     # Abas, modais, tema (dark/light), toasts
│   ├── lattesParser.js           # Parser de texto do Currículo Lattes
│   ├── compare.js                # Comparador de periódicos
│   ├── utils.js                  # CSV parser/gen, escapeHTML, download
│   └── aliases.json              # Aliases hardcoded de nomes de periódicos
│
├── css/
│   └── styles.css                # Design system completo (dark/light themes)
│
├── data/                         # Dados e scripts de compilação
│   ├── journals.json             # ⭐ Base principal (~13,8 MB, 57.731 periódicos, 38k JCRs)
│   ├── jcr_all_2025.csv          # Base completa oficial JCR 2025 (22.643 periódicos)
│   ├── compile_database.py       # Script de compilação (Excel/CSV → JSON)
│   ├── fetch_all_jcr.py          # Script de automação para download do JCR
│   ├── fetch_citescore.py        # Fetch de CiteScore via API Elsevier
│   ├── fetch_bdenf_revenf.py     # Fetch de ISSNs BDENF/RevEnf
│   ├── classificacao.xlsx        # Planilha Sucupira oficial
│   ├── journals_scopus.xlsx      # Planilha Scopus com CiteScores
│   ├── jcr_*.csv                 # CSVs exportados do JCR/Web of Science
│   ├── cuiden_citacion_2022.csv  # Índices CUIDEN
│   ├── bdenf_issns.json          # ISSNs indexados na BDENF
│   ├── revenf_issns.json         # ISSNs indexados na RevEnf
│   ├── aliases.json              # Aliases globais de periódicos
│   ├── *_cache.json              # Caches de APIs externas (auto-gerados)
│   └── user_aliases.json         # Aliases aprendidos pelos usuários (auto-gerado)
│
├── docs/                         # Documentação técnica
├── tests/                        # Testes automatizados
│
├── index.html                    # Entry point da aplicação web (marca CPI)
├── favicon.ico                   # Favicon raiz da aplicação
├── logo.svg                      # Logo oficial CPI (vetorial)
├── server.ps1                    # Script PowerShell para gerenciar o servidor (Windows)
├── requirements.txt              # Dependências Python
├── .env.example                  # Template de variáveis de ambiente
├── .editorconfig                 # Configuração de formatação (2 espaços JS, 4 Python)
└── .gitignore                    # Arquivos ignorados pelo Git
```

### Arquivos que NÃO fazem parte do Git (runtime)

| Arquivo | Descrição | Gerado por |
|:---|:---|:---|
| `.env` | Variáveis de ambiente com chaves | Criado manualmente (seção 3.4) |
| `data/scielo_cache.json` | Cache SciELO (TTL 30 dias) | Consultas automáticas |
| `data/lilacs_cache.json` | Cache LILACS (TTL 30 dias) | Consultas automáticas |
| `data/latindex_cache.json` | Cache Latindex (TTL 30 dias) | Consultas automáticas |
| `data/citescore_cache.json` | Cache CiteScore | Consultas automáticas |
| `data/user_aliases.json` | Aliases aprendidos por correção de matching | Feedback dos usuários |
| `data/runtime_discoveries.json` | Periódicos descobertos em consultas | Automático |
| `.server_pid` | PID do servidor (Windows) | `server.ps1` |

---

## 12. Manutenção Operacional

### 12.1 Rotina de Monitoramento

| Frequência | Ação | Comando |
|:---|:---|:---|
| **Diária** | Verificar se o serviço está rodando | `systemctl status qualis-backend` |
| **Diária** | Revisar logs de erro | `journalctl -u qualis-backend -p err --since "24h ago"` |
| **Semanal** | Verificar Circuit Breakers | `curl http://127.0.0.1:8080/api/v1/status` |
| **Mensal** | Verificar validade do SSL | `certbot certificates` |
| **Semestral** | Atualizar dados Qualis (se houver novos) | Ver seção 4.3 |
| **Anual** | Atualizar dependências Python | `pip install --upgrade -r requirements.txt` |

### 12.2 Logs e Auditoria

O sistema gera dois tipos de log:

**1. Log de aplicação** (erros, warnings, info):
```bash
sudo journalctl -u qualis-backend -f
```

**2. Log de auditoria** (todas as ações de classificação):
```bash
# Formato: timestamp|AUDIT|ação|ip=...|issn=...|estrato=...|area=...
sudo journalctl -u qualis-backend | grep "AUDIT"

# Exemplos de linhas de auditoria:
# 2026-08-03|AUDIT|classify|ip=192.168.1.10|issn=0104-1169|estrato=A1|area=Enfermagem
# 2026-08-03|AUDIT|search|ip=192.168.1.10|q=enfermagem|results=42
# 2026-08-03|AUDIT|match_lattes|ip=192.168.1.10|segments=25|articles=20|high=18
```

### 12.3 Cache de APIs Externas

Os caches são armazenados como arquivos JSON no diretório `data/`:

| Cache | TTL | Localização |
|:---|:---|:---|
| SciELO | 30 dias | `data/scielo_cache.json` |
| LILACS | 30 dias | `data/lilacs_cache.json` |
| Latindex | 30 dias | `data/latindex_cache.json` |
| CiteScore | Sessão (memória) + disco | `data/citescore_cache.json` |

**Limpar cache manualmente** (forçar reconsulta):

```bash
# Limpar um cache específico
rm data/scielo_cache.json

# Limpar todos os caches
rm data/*_cache.json

# Reiniciar o serviço para recarregar
sudo systemctl restart qualis-backend
```

### 12.4 Circuit Breakers

O sistema possui proteção automática contra APIs externas fora do ar:

- **Threshold:** 5 falhas em 60 segundos → circuito abre
- **Cooldown:** 120 segundos (com backoff exponencial)
- **Half-open:** Após o cooldown, uma requisição de teste é enviada

Verificar estado dos circuitos:

```bash
curl -s http://127.0.0.1:8080/api/v1/status | python3 -m json.tool
# Procurar na resposta o campo "circuits"
# Todos devem estar "CLOSED" em operação normal
```

---

## 13. Backup e Recuperação

### 13.1 O que Fazer Backup

| Item | Criticidade | Frequência |
|:---|:---|:---|
| `data/journals.json` | **ALTA** — base principal | Após cada recompilação |
| `.env` | **ALTA** — contém chave API | Após cada alteração |
| `data/user_aliases.json` | MÉDIA — aliases aprendidos | Mensal |
| `data/*_cache.json` | BAIXA — regenerados automaticamente | Não necessário |

### 13.2 Script de Backup

```bash
#!/bin/bash
# backup_qualis.sh — Executar via crontab diariamente
BACKUP_DIR="/var/backups/qualis-capes"
DATE=$(date +%Y%m%d)
mkdir -p "$BACKUP_DIR"

cd /var/www/qualis-capes
tar -czf "$BACKUP_DIR/qualis_data_$DATE.tar.gz" \
    data/journals.json \
    data/aliases.json \
    data/bdenf_issns.json \
    data/revenf_issns.json \
    data/user_aliases.json \
    .env

# Manter apenas os últimos 30 backups
ls -1t "$BACKUP_DIR"/qualis_data_*.tar.gz | tail -n +31 | xargs -r rm
echo "Backup concluído: $BACKUP_DIR/qualis_data_$DATE.tar.gz"
```

Adicionar ao crontab:

```bash
sudo crontab -e
# Adicionar:
0 3 * * * /var/www/qualis-capes/backup_qualis.sh >> /var/log/qualis-backup.log 2>&1
```

### 13.3 Recuperação

```bash
# Restaurar de um backup
cd /var/www/qualis-capes
tar -xzf /var/backups/qualis-capes/qualis_data_20260803.tar.gz

# Reiniciar serviço
sudo systemctl restart qualis-backend
```

---

## 14. Atualização do Sistema

### 14.1 Atualização de Código (via Git)

```bash
cd /var/www/qualis-capes

# Parar serviço
sudo systemctl stop qualis-backend

# Atualizar código
git pull origin master

# Atualizar dependências Python
source venv/bin/activate
pip install --upgrade -r requirements.txt

# Reiniciar serviço
sudo systemctl start qualis-backend

# Verificar saúde
curl -s http://127.0.0.1:8080/api/health
```

### 14.2 Atualização de Dados (Novo Quadriênio CAPES)

Quando a CAPES publicar uma nova avaliação:

1. Obter os novos arquivos (planilhas JCR, Scopus, Sucupira)
2. Colocar no diretório `data/`
3. Executar a recompilação:

```bash
source venv/bin/activate
python data/compile_database.py
```

4. Opcionalmente, atualizar CiteScores:

```bash
python data/fetch_citescore.py --apply
```

5. Reiniciar o serviço:

```bash
sudo systemctl restart qualis-backend
```

### 14.3 Procedimento Específico de Atualização — Versão 2.1.0 (Setembro / 2026)

> [!IMPORTANT]
> A equipe do STI / UFMA que já possui a versão inicial implantada deve seguir o roteiro abaixo para aplicar os 3 commits de atualização mais recentes (`88be449`, `661d7ed` e `0e687ba`).

#### O que mudou nesta versão:
1. **Identidade Visual Oficial (CPI):** Transição de marca para **CPI (Classificador de Produção Intelectual)**, inclusão de nova pasta estática `assets/` contendo os brasões oficiais do **PPGENF** e da **UFMA** no cabeçalho e rodapé, além de conjunto completo de favicons.
2. **Correção de Indexação SciELO e RevEnf:** Resolução dinâmica de e-ISSNs para p-ISSNs via fallback transparente, corrigindo a classificação de periódicos como *REME* (A4) e *Saúde em Debate* (A6).
3. **Expansão Completa da Base JCR 2025:** Incorporação da base oficial completa da Clarivate Analytics (`data/jcr_all_2025.csv` com 22.643 periódicos), elevando a cobertura de Fatores de Impacto de ~2.000 para **38.631 periódicos com JCR no banco compilado**.

#### Roteiro de Atualização em Produção (Linux / systemd):

```bash
# 1. Acessar o diretório da aplicação
cd /var/www/qualis-capes

# 2. Puxar as atualizações da branch master
git pull origin master

# 3. Atualizar dependências no ambiente virtual (se houver novidades)
source venv/bin/activate
pip install -r requirements.txt

# 4. Limpar caches de API anteriores para forçar uso da base enriquecida
rm -f data/*_cache.json

# 5. Reiniciar o serviço backend
sudo systemctl restart qualis-backend

# 6. Recarregar o Nginx (caso tenha regra de cache estático)
sudo systemctl reload nginx
```

*(Se a infraestrutura da UFMA utilizar contêineres Docker, execute simplesmente: `git pull origin master && docker compose down && docker compose up -d --build`).*

#### Validação Pós-Atualização (Health Check pelo STI):

Execute os comandos de teste abaixo no terminal do servidor:

```bash
# Teste 1: Verificar se a base expandida foi carregada com sucesso
curl -s http://127.0.0.1:8080/api/v1/status | python3 -c "import sys, json; d=json.load(sys.stdin); print('Status:', d.get('status'), '| Base:', d.get('database_size'), 'periódicos')"
# Resposta esperada: Status: ok | Base: 39933 periódicos (57.731 identificadores mapeados)

# Teste 2: Testar se o JCR 2025 de um periódico internacional está ativo
curl -s http://127.0.0.1:8080/api/v1/classify/0140-6736 | python3 -c "import sys, json; d=json.load(sys.stdin); print('The Lancet JCR:', d.get('jcr'), '| Estrato:', d.get('classification', {}).get('estrato'))"
# Resposta esperada: The Lancet JCR: 109.0 | Estrato: A1

# Teste 3: Testar a resolução de e-ISSN e indexação RevEnf
curl -s http://127.0.0.1:8080/api/v1/classify/2316-9389 | python3 -c "import sys, json; d=json.load(sys.stdin); print('REME Estrato:', d.get('classification', {}).get('estrato'), '| Indexadores:', d.get('indexers'))"
# Resposta esperada: REME Estrato: A4 | Indexadores: ['RIC/CUIDEN', 'RevEnf', 'BDENF', 'LATINDEX']

# Teste 4: No navegador, acerte a URL pública (https://qualis.ppgenf.ufma.br)
# - Verifique no topo da página o novo logotipo CPI e os brasões da UFMA e PPGENF.
```

#### Plano de Rollback (Contingência):
Caso a equipe do STI precise retornar à versão anterior por qualquer motivo imprevisto:
```bash
cd /var/www/qualis-capes
git checkout 76bb52a
sudo systemctl restart qualis-backend
```

---

## 15. Segurança

### 15.1 Checklist de Segurança

| Item | Status | Descrição |
|:---|:---|:---|
| ✅ | **Chaves fora do código** | API keys em `.env`, nunca no repositório |
| ✅ | **`.env` no .gitignore** | Arquivo de segredos ignorado pelo Git |
| ✅ | **Rate Limiting** | 60 req/min por IP (classificação), 30 req/min (busca), 10 req/min (lote) |
| ✅ | **CORS restrito** | Apenas origens listadas em `CORS_ORIGINS` |
| ✅ | **XSS prevention** | Todo conteúdo dinâmico passa por `escapeHTML()` |
| ✅ | **Static files isolados** | FastAPI serve apenas `index.html`, `logo.svg`, `/css/`, `/js/` — nunca `data/`, `.env`, `api/` |
| ✅ | **Trusted Proxies** | Rate limiting só confia em `X-Forwarded-For` de IPs listados em `TRUSTED_PROXIES` |
| ✅ | **Input validation** | Todos os endpoints validados via Pydantic |
| ✅ | **Audit log** | Toda classificação/busca é logada com IP |
| ⚠️ | **HTTPS** | Configurar via Nginx (seções 8 e 9) |
| ⚠️ | **Usuário sem privilégios** | Rodar serviço como `qualis` (não `root`) |

### 15.2 O que o Servidor NÃO Expõe

O FastAPI serve **apenas** os seguintes caminhos estáticos:

- `/index.html` — Página principal da aplicação
- `/logo.svg` — Logotipo oficial CPI (vetorial)
- `/favicon.ico` — Favicon principal da aplicação
- `/assets/*` — Brasões institucionais (UFMA, PPGENF) e favicons em múltiplas resoluções
- `/css/*` — Folhas de estilo
- `/js/*` — Scripts JavaScript
- `/api/*` — Endpoints REST

**NÃO são acessíveis via HTTP:**

- `data/journals.json` (base de dados)
- `data/*.csv`, `data/*.xlsx` (fontes de dados)
- `.env` (chaves de API)
- `api/*.py` (código-fonte)
- `__pycache__/`

### 15.3 Rate Limiting

A API possui rate limiting embutido (in-memory token bucket):

| Endpoint | Limite | Janela |
|:---|:---|:---|
| `GET /api/v1/classify/{issn}` | 60 requisições | 1 minuto |
| `POST /api/v1/classify/batch` | 10 requisições | 1 minuto |
| `GET /api/v1/search` | 30 requisições | 1 minuto |
| `POST /api/v1/match/batch` | 60 requisições | 1 minuto |
| `POST /api/v1/orcid/analyze` | 12 requisições | 1 minuto |

Quando excedido, retorna HTTP 429 com mensagem de erro.

---

## 16. Referência Rápida da API

Base URL: `https://qualis.ppgenf.ufma.br/api/v1`

| Método | Endpoint | Descrição |
|:---|:---|:---|
| `GET` | `/health` | Health check (status da base) |
| `GET` | `/v1/status` | Status completo (versão, circuits, base) |
| `GET` | `/v1/classify/{issn}` | Classificar um periódico por ISSN |
| `POST` | `/v1/classify/batch` | Classificar vários ISSNs (`{"issns": [...]}`) |
| `GET` | `/v1/search?q=termo` | Buscar periódicos por nome |
| `POST` | `/v1/search/batch` | Buscar vários nomes (`{"queries": [...]}`) |
| `POST` | `/v1/match/batch` | Matching inteligente de nomes |
| `POST` | `/v1/match/lattes` | Importar e classificar texto do Lattes |
| `GET` | `/v1/db-summary` | Listar periódicos da base (paginado) |
| `POST` | `/v1/orcid/analyze` | Analisar produção via ORCID ID |
| `POST` | `/v1/alias` | Salvar alias de periódico |
| `POST` | `/v1/match/feedback` | Feedback de correção de matching |
| `GET` | `/v1/stats/matching` | Estatísticas de matching |

> **Documentação interativa (Swagger):** Disponível em `/docs` apenas quando `ENVIRONMENT != production`.

---

## 17. Solução de Problemas (Troubleshooting)

### 17.1 Problemas Comuns

---

**❌ Serviço não inicia / Erro "Address already in use"**

```bash
# Verificar quem está usando a porta 8080
sudo lsof -i :8080           # Linux
netstat -ano | findstr 8080   # Windows

# Matar o processo
sudo fuser -k 8080/tcp       # Linux
```

---

**❌ Erro 500 ao classificar — "ELSEVIER_API_KEY ausente"**

O CiteScore não será consultado, mas a classificação ainda funciona via JCR e indexadores.

**Solução:**
1. Verificar se `.env` contém `ELSEVIER_API_KEY` válida
2. Obter chave gratuita em https://dev.elsevier.com/apikey/manage
3. Reiniciar: `sudo systemctl restart qualis-backend`

---

**❌ Base de dados vazia (db_size = 0)**

```bash
# Verificar se journals.json existe e tem conteúdo
ls -la /var/www/qualis-capes/data/journals.json
# Esperado: ~9 MB

# Se o arquivo estiver faltando, recompilar:
source venv/bin/activate
python data/compile_database.py
```

---

**❌ Encoding error no Windows (compile_database.py)**

```powershell
# Definir UTF-8 antes de executar
$env:PYTHONIOENCODING = 'utf-8'
python data/compile_database.py
```

---

**❌ Circuit Breakers abertos (API externa fora do ar)**

```bash
# Verificar estado dos circuits
curl -s http://127.0.0.1:8080/api/v1/status | python3 -m json.tool
# Se algum circuit estiver "OPEN", aguardar o cooldown ou reiniciar o serviço
```

Os Circuit Breakers se recuperam automaticamente. Se persistir:
1. Verificar conectividade com a API externa (`curl https://api.elsevier.com`)
2. Verificar se não há firewall bloqueando saída na porta 443
3. Reiniciar serviço como último recurso

---

**❌ Rate limit excedido (HTTP 429)**

Resposta: `"Limite de requisições excedido. Tente novamente em 1 minuto."`

Isso é esperado quando um mesmo IP faz muitas requisições em sequência rápida. Aguardar 1 minuto e tentar novamente. Se necessário ajustar limites, editar os valores em `api/main.py`.

---

**❌ CORS bloqueado no navegador**

Verificar se `CORS_ORIGINS` no `.env` contém o domínio exato (com protocolo):

```env
# Correto:
CORS_ORIGINS=https://qualis.ppgenf.ufma.br

# Incorreto (sem https, domínio errado):
CORS_ORIGINS=qualis.ppgenf.ufma.br
```

Reiniciar após alterar: `sudo systemctl restart qualis-backend`

---

**❌ Nginx retorna 502 Bad Gateway**

O backend não está rodando ou não está na porta esperada:

```bash
# 1. Verificar backend
sudo systemctl status qualis-backend

# 2. Verificar porta
curl http://127.0.0.1:8080/api/health

# 3. Se o backend caiu, verificar logs
sudo journalctl -u qualis-backend -n 50

# 4. Reiniciar
sudo systemctl restart qualis-backend
```

---

### 17.2 Testes Automatizados

```bash
# Executar testes do motor de classificação
source venv/bin/activate
pytest api/test_engine.py -v
```

---

## 18. Contato e Suporte

| Canal | Informação |
|:---|:---|
| **Desenvolvimento / Manutenção** | Equipe de Pesquisa PPGENF / UFMA |
| **Repositório do Código** | https://github.com/PPGENF-UFMA/Qualis-capes |
| **Suporte Institucional** | Programa de Pós-Graduação em Enfermagem (PPGENF / UFMA) |

---

## Apêndice A: Resumo de Comandos Rápidos

```bash
# ═══════════════════════════════════════════════════════════════
# COMANDOS RÁPIDOS — Operação do Dia a Dia
# ═══════════════════════════════════════════════════════════════

# ─── Serviço ───────────────────────────────────────────────────
sudo systemctl start qualis-backend      # Iniciar
sudo systemctl stop qualis-backend       # Parar
sudo systemctl restart qualis-backend    # Reiniciar
sudo systemctl status qualis-backend     # Status

# ─── Logs ──────────────────────────────────────────────────────
sudo journalctl -u qualis-backend -f                     # Tempo real
sudo journalctl -u qualis-backend -p err --since "24h ago"  # Só erros
sudo journalctl -u qualis-backend | grep "AUDIT"         # Auditoria

# ─── Health Check ──────────────────────────────────────────────
curl -s http://127.0.0.1:8080/api/health | python3 -m json.tool
curl -s http://127.0.0.1:8080/api/v1/status | python3 -m json.tool

# ─── Atualização ───────────────────────────────────────────────
cd /var/www/qualis-capes
sudo systemctl stop qualis-backend
git pull origin main
source venv/bin/activate
pip install --upgrade -r requirements.txt
sudo systemctl start qualis-backend

# ─── Recompilação do Banco de Dados ───────────────────────────
source venv/bin/activate
python data/compile_database.py
python data/fetch_citescore.py --apply   # Opcional
sudo systemctl restart qualis-backend

# ─── Backup ────────────────────────────────────────────────────
tar -czf qualis_backup_$(date +%Y%m%d).tar.gz \
    data/journals.json data/aliases.json data/user_aliases.json .env

# ─── Nginx ─────────────────────────────────────────────────────
sudo nginx -t                            # Testar config
sudo systemctl reload nginx              # Aplicar mudanças
sudo certbot certificates                # Verificar SSL
```

---

## Apêndice B: Regras de Classificação CAPES

### Enfermagem

| Estrato | Critério |
|:---|:---|
| **A1** | JCR ≥ 1.8 **OU** CiteScore ≥ 2.9 |
| **A2** | JCR 1.1–1.7 **OU** CiteScore 1.8–2.8 |
| **A3** | JCR 0.6–1.0 **OU** CiteScore 0.7–1.7 **OU** MEDLINE |
| **A4** | JCR 0.1–0.5 **OU** CiteScore 0.1–0.6 **OU** SciELO **OU** RevEnf |
| **A5** | LILACS **OU** BDENF |
| **A6** | CUIDEN com índice ≥ 1.5 |
| **A7** | CINAHL **OU** CUIDEN com índice 0.1–1.4 |
| **A8** | Latindex |
| **NC** | Nenhum critério atendido |

### Outras Áreas

| Estrato | Critério |
|:---|:---|
| **A1** | JCR ≥ 5.0 **OU** CiteScore ≥ 5.0 |
| **A2** | JCR 4.0–4.9 **OU** CiteScore 4.0–4.9 |
| **A3** | JCR 3.0–3.9 **OU** CiteScore 3.0–3.9 |
| **A4** | JCR 2.0–2.9 **OU** CiteScore 2.0–2.9 |
| **A5** | JCR 1.0–1.9 **OU** CiteScore 0.1–1.9 **OU** MEDLINE |
| **A6** | JCR 0.1–0.9 **OU** SciELO |
| **A7** | LILACS |
| **A8** | Latindex |
| **NC** | Nenhum critério atendido |

> **Regra Fundamental:** O sistema avalia **TODOS** os critérios e atribui o **maior estrato possível** ("regra do melhor caso").
