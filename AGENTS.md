# AGENTS.md — Qualis CAPES Classifier

## Architecture

Single-page web app (no build step). ES modules loaded directly in the browser via `<script type="module">`.

- **`api/`** — FastAPI backend (Python):
  - `main.py` — FastAPI app, routes (classify, batch, search, status) + static file serving
  - `enricher.py` — Database loading, external API enrichment (SciELO, LILACS, Latindex, Elsevier)
  - `engine.py` — Classification engine: pure function `classifyJournal()` → `{ estrato, justification }`
  - `cache.py` — Session cache (CiteScore) + disk cache with 30-day TTL (SciELO, LILACS, Latindex)
  - `models.py` — Pydantic schemas (request/response validation)
- **`index.html`** — Entry point. Loads `js/app.js` as a module.
- **`js/app.js`** — Orchestrator. Sets up event listeners and delegates to modules.
- **`js/enricher.js`** — Thin client: calls backend API (`/api/classify/{issn}`, `/api/search`, `/api/db-summary`). No more direct API proxy calls or engine logic.
- **`js/state.js`** — Central `appState` object. Persisted to `sessionStorage` under key `qualis_results`.
- **`js/dom.js`** — All DOM element references in one export. Always access DOM through this module.
- **`js/table.js`** — Results table rendering.
- **`js/charts.js`** — Chart.js dashboard, KPIs, insights.
- **`js/ui.js`** — Tabs, modals, toasts, theme toggle, recent searches.
- **`js/utils.js`** — CSV parser/generator, `escapeHTML()` (XSS), `downloadFile()`.
- **`js/lattesParser.js`** — Parses copy-pasted Lattes CV text into structured articles. Uses Jaro-Winkler + hardcoded journal aliases. Runs entirely client-side.
- **`css/styles.css`** — All styles.
- **`data/`** — Database files and Python compilation scripts.

## Commands

### Server (background — não bloqueia o terminal)

Use `server.ps1` para startar/parar o servidor sem travar o terminal:

```powershell
# Start dev server (required for everything) — roda em background
.\server.ps1 start

# Stop server
.\server.ps1 stop

# Restart server
.\server.ps1 restart

# Check status
.\server.ps1 status
```

O servidor roda em background (PowerShell Job). O comando retorna imediatamente.
Alternativa direta (bloqueante, NÃO usar no terminal da IA):
```bash
python -m uvicorn api.main:app --port 8080 --reload
```

### Install Python dependencies

```bash
pip install -r requirements.txt
```

# Rebuild journals.json from source data (Excel/CSV files in data/)
# Auto-detects all jcr_*.csv / JCR_*.csv files (Nursing + health categories)
# Windows tip: set PYTHONIOENCODING=utf-8 if you see encoding errors
$env:PYTHONIOENCODING = 'utf-8'; python data/compile_database.py

# Fetch CiteScore from Elsevier API (needs ELSEVIER_API_KEY in .env)
python data/fetch_citescore.py
python data/fetch_citescore.py --apply    # Apply fetched scores to journals.json
python data/fetch_citescore.py --stats    # Show cache statistics
```

There is no `npm`, no bundler, no `package.json`. The server must run to proxy API calls (CORS avoidance + API key protection).

## Key Conventions

### ISSN format
Always `XXXX-XXXX`. The `normalizeISSN()` function in `enricher.js` handles conversion from raw input.

### DOM access
Always import `dom` from `dom.js`. Never use `document.getElementById()` directly in other modules. Add new element references to `dom.js`.

### XSS safety
All dynamic HTML rendering MUST use `escapeHTML()` from `utils.js` before inserting data into `innerHTML`.

### State persistence
- Classified results: `sessionStorage` key `qualis_results` (survives page reloads, not tab closes)
- Recent searches: `localStorage` key `qualis_recent_searches` (max 4 items)
- Theme preference: `localStorage` key `qualis_theme` (`'light'` or `'dark'`)

### Loading state
During async operations, call `showLoadingState()` / `hideLoadingState()` from `ui.js`. Submit buttons are automatically disabled while loading.

### Tests
Unit tests for `engine.py` should be run with pytest (TODO: create test_engine.py).
The engine is pure — testable without any I/O.

### API proxy caching (api/cache.py)
- **CiteScore**: In-memory session cache only (cleared on server restart)
- **SciELO / LILACS / Latindex**: Disk caches in `data/*_cache.json` with 30-day TTL. These files are gitignored.

### Database compilation (compile_database.py)
- Auto-detects all `jcr_*.csv` and `JCR_*.csv` files in `data/` (not hardcoded to nursing only)
- Uses Python's `csv.reader` (NOT `pd.read_csv`) due to a pandas quoting bug with JCR CSV metadata
- A journal is classified as `Enfermagem` area only if ALL of:
1. It's listed under Enfermagem in `classificacao.xlsx`
2. AND it appears in JCR Nursing CSV OR Scopus Nursing sheet OR CUIDEN CSV OR has nursing keywords in title

Otherwise it's `Outras Áreas`.

### EditorConfig
- 2 spaces for JS/HTML/CSS
- 4 spaces for Python

## Standalone test scripts (Node.js)

`test_parser.js` and `test_replace.js` are debugging scripts for the Lattes parser. Run with `node test_parser.js`. Not part of the web app.

## .gitignore notes

- `.env` (contains API key)
- `data/*_cache.json` (runtime caches)
- `.agents/` and `agents/` (OpenCode skills)
- `__pycache__/`, `node_modules/`
- `.server_pid` (runtime PID file from server.ps1)
