# Qualis CAPES Classifier

<div align="center">

**Classificação automatizada de periódicos científicos segundo as diretrizes da CAPES**

*Programa de Pós-Graduação em Enfermagem (PPGENF) — Universidade Federal do Maranhão (UFMA)*

![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.137+-009688?logo=fastapi&logoColor=white)
![License](https://img.shields.io/badge/Licença-Uso_Institucional-lightgrey)
![Status](https://img.shields.io/badge/Status-Produção-brightgreen)

</div>

---

## Sobre

O **Qualis CAPES Classifier** é uma ferramenta web que automatiza a triagem, enriquecimento de dados e classificação de periódicos científicos conforme as regras da avaliação quadrienal da CAPES, com foco na área de **Enfermagem** e suporte a **Outras Áreas**.

O processo manual — que envolve consultar Sucupira, JCR, Scopus, SciELO, LILACS, BDENF, CUIDEN, Latindex, entre outros — é substituído por uma pipeline automatizada que coleta métricas, cruza indexadores e aplica a **regra do melhor caso** para atribuir o estrato correto (A1 a A8 ou NC).

### Funcionalidades

-  **Classificação individual** — insira um ISSN e receba estrato, justificativa e todos os dados do periódico
-  **Classificação em lote** — envie até 500 ISSNs de uma vez (via CSV ou digitação)
-  **Importação do Currículo Lattes** — cole o texto do Lattes e obtenha a classificação de todas as publicações
-  **Importação via ORCID** — busca automática de produções pela API pública do ORCID
-  **Dashboard analítico** — gráficos de distribuição por estrato, KPIs de produção, insights
-  **Busca por nome** — encontre periódicos na base local e em bases externas (LILACS/BVS)
-  **Exportação CSV** — exporte resultados para uso em planilhas
-  **Matching inteligente** — algoritmo de similaridade para resolver variações de nomes de periódicos
-  **Tema escuro/claro** — interface responsiva com design moderno

---

## Arquitetura

```
Navegador (SPA)          Nginx (SSL)          FastAPI (Python)
  HTML + JS puro    →    Proxy Reverso    →    API REST + Static
  Sem build step         Porta 443             Porta 8080
                                                    │
                                          ┌─────────┴──────────┐
                                          │  journals.json     │
                                          │  (~40k periódicos) │
                                          │  Caches em disco   │
                                          │  APIs externas     │
                                          └────────────────────┘
```

**Stack:**

| Camada | Tecnologia |
|:---|:---|
| Frontend | HTML5, Vanilla JS (ES Modules), CSS puro |
| Backend | Python 3.10+, FastAPI, Uvicorn |
| Dados | JSON estático (`journals.json`), caches em disco |
| APIs | Elsevier (CiteScore), SciELO, LILACS, Latindex, ORCID, CrossRef |

> Sem banco de dados relacional. Sem Node.js. Sem build step. Sem dependências de frontend.

---

## Início Rápido (Desenvolvimento)

### Pré-requisitos

- **Python 3.10+** instalado ([python.org](https://www.python.org/downloads/))
- **Git** instalado

### Instalação

```bash
# 1. Clone o repositório
git clone https://github.com/matheus2049alves/Qualis-capes.git
cd Qualis-capes

# 2. Crie e ative o ambiente virtual
python -m venv venv
source venv/bin/activate        # Linux/macOS
# .\venv\Scripts\Activate.ps1   # Windows PowerShell

# 3. Instale as dependências
pip install -r requirements.txt

# 4. Configure as variáveis de ambiente
cp .env.example .env
# Edite .env com sua ELSEVIER_API_KEY (opcional, mas recomendada)
```

### Executar

```bash
# Linux/macOS
python -m uvicorn api.main:app --port 8080 --reload

# Windows (via script PowerShell)
.\server.ps1 start
```

Acesse **http://localhost:8080** no navegador.

### Verificar instalação

```bash
curl http://localhost:8080/api/health
# {"status":"healthy","db_loaded":true,"db_size":...}
```

---

## Variáveis de Ambiente

Copie `.env.example` para `.env` e ajuste:

| Variável | Obrigatória | Descrição |
|:---|:---|:---|
| `ELSEVIER_API_KEY` | Não* | Chave da API Elsevier para CiteScore. Gratuita em [dev.elsevier.com](https://dev.elsevier.com/apikey/manage). |
| `ENVIRONMENT` | Não | `production` desabilita Swagger UI (`/docs`). Padrão: `development`. |
| `CORS_ORIGINS` | Não | Origens CORS permitidas (separadas por vírgula). |
| `TRUSTED_PROXIES` | Não | IPs de proxies confiáveis para rate limiting. |

*\*Sem a chave Elsevier, a classificação ainda funciona via JCR local e indexadores.*

---

## Estrutura do Projeto

```
Qualis-capes/
├── api/                    # Backend Python (FastAPI)
│   ├── main.py             # App FastAPI, rotas, rate limiting
│   ├── engine.py           # Motor de classificação CAPES (puro)
│   ├── enricher.py         # Enriquecimento de dados e matching
│   ├── cache.py            # Cache em disco + Circuit Breakers
│   ├── models.py           # Schemas Pydantic
│   └── orcid_client.py     # Integração ORCID
├── js/                     # Frontend (Vanilla JS ES Modules)
├── css/                    # Estilos (Vanilla CSS)
├── data/                   # Base de periódicos e scripts de compilação
│   ├── journals.json       # Base principal (~9 MB)
│   └── compile_database.py # Compilador (Excel/CSV → JSON)
├── docs/                   # Documentação técnica
├── index.html              # Entry point
├── server.ps1              # Gerenciador do servidor (Windows)
├── requirements.txt        # Dependências Python
└── .env.example            # Template de configuração
```

---

## Deploy em Produção

### Manual Completo de Implantação

Para deploy em ambiente institucional, consulte o **Manual de Implantação, Operação e Transferência Técnica**:

> **[`docs/MANUAL_IMPLANTACAO_TI_UFMA.md`](docs/MANUAL_IMPLANTACAO_TI_UFMA.md)**

O manual cobre:

- ✅ Requisitos de infraestrutura (servidor, rede, firewall)
- ✅ Deploy com **systemd** (Linux) e **NSSM** (Windows Server)
- ✅ Deploy com **Docker** (Dockerfile + docker-compose.yml)
- ✅ Configuração do **Nginx** como proxy reverso
- ✅ Certificado **SSL/TLS** (Let's Encrypt ou CA institucional)
- ✅ Health check e verificação pós-deploy
- ✅ Manutenção operacional, logs e auditoria
- ✅ Backup e recuperação
- ✅ Procedimento de atualização de código e dados CAPES
- ✅ Segurança (rate limiting, CORS, XSS, hardening)
- ✅ Troubleshooting completo
- ✅ Tabelas de classificação CAPES (Enfermagem + Outras Áreas)

---

## Regras de Classificação CAPES

O motor aplica as tabelas oficiais da CAPES. A lógica avalia **todos** os critérios e retorna o **maior estrato possível** (regra do melhor caso):

<details>
<summary><strong>Enfermagem</strong></summary>

| Estrato | Critério |
|:---|:---|
| A1 | JCR ≥ 1.8 **ou** CiteScore ≥ 2.9 |
| A2 | JCR 1.1–1.7 **ou** CiteScore 1.8–2.8 |
| A3 | JCR 0.6–1.0 **ou** CiteScore 0.7–1.7 **ou** MEDLINE |
| A4 | JCR 0.1–0.5 **ou** CiteScore 0.1–0.6 **ou** SciELO **ou** RevEnf |
| A5 | LILACS **ou** BDENF |
| A6 | CUIDEN ≥ 1.5 |
| A7 | CINAHL **ou** CUIDEN 0.1–1.4 |
| A8 | Latindex |
| NC | Nenhum critério atendido |

</details>

<details>
<summary><strong>Outras Áreas</strong></summary>

| Estrato | Critério |
|:---|:---|
| A1 | JCR ≥ 5.0 **ou** CiteScore ≥ 5.0 |
| A2 | JCR 4.0–4.9 **ou** CiteScore 4.0–4.9 |
| A3 | JCR 3.0–3.9 **ou** CiteScore 3.0–3.9 |
| A4 | JCR 2.0–2.9 **ou** CiteScore 2.0–2.9 |
| A5 | JCR 1.0–1.9 **ou** CiteScore 0.1–1.9 **ou** MEDLINE |
| A6 | JCR 0.1–0.9 **ou** SciELO |
| A7 | LILACS |
| A8 | Latindex |
| NC | Nenhum critério atendido |

</details>

---

## API

Base URL: `/api/v1`

| Método | Endpoint | Descrição |
|:---|:---|:---|
| `GET` | `/health` | Health check |
| `GET` | `/v1/status` | Status completo do sistema |
| `GET` | `/v1/classify/{issn}` | Classificar periódico por ISSN |
| `POST` | `/v1/classify/batch` | Classificar lote de ISSNs |
| `GET` | `/v1/search?q=termo` | Buscar periódicos por nome |
| `POST` | `/v1/match/lattes` | Importar e classificar texto do Lattes |
| `POST` | `/v1/orcid/analyze` | Analisar produção via ORCID |
| `GET` | `/v1/db-summary` | Listar base de periódicos |

Documentação interativa (Swagger) disponível em `/docs` no modo desenvolvimento.

---

## Atualização da Base de Dados

Quando houver novos dados da CAPES (avaliação quadrienal, novos JCR/Scopus):

```bash
# 1. Coloque os novos arquivos em data/
# 2. Recompile a base
python data/compile_database.py

# 3. Opcionalmente, atualize CiteScores
python data/fetch_citescore.py --apply

# 4. Reinicie o servidor
sudo systemctl restart qualis-backend
```

---

## Testes

```bash
pytest api/test_engine.py -v
```

---

## Licença

Uso institucional — PPGENF / UFMA.
