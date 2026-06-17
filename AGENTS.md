# AGENTS.md — Qualis CAPES Classifier

## Architecture

Single-page web app (no build step). ES modules loaded directly in the browser via `<script type="module">`.

- **`server.py`** — Python HTTP server. Serves static files + proxies external APIs (Elsevier, SciELO, LILACS, Latindex). Must be running for the app to work (including local dev).
- **`index.html`** — Entry point. Loads `js/app.js` as a module.
- **`js/app.js`** — Orchestrator. Sets up event listeners and delegates to modules.
- **`js/enricher.js`** — Loads `data/journals.json`, fetches live API data, calls the engine.
- **`js/engine.js`** — Pure classification function. Input: journal object → Output: `{ estrato, justification }`. No side effects.
- **`js/state.js`** — Central `appState` object. Persisted to `sessionStorage` under key `qualis_results`.
- **`js/dom.js`** — All DOM element references in one export. Always access DOM through this module.
- **`js/table.js`** — Results table rendering.
- **`js/charts.js`** — Chart.js dashboard, KPIs, insights.
- **`js/ui.js`** — Tabs, modals, toasts, theme toggle, recent searches.
- **`js/utils.js`** — CSV parser/generator, `escapeHTML()` (XSS), `downloadFile()`.
- **`js/lattesParser.js`** — Parses copy-pasted Lattes CV text into structured articles. Uses Jaro-Winkler + hardcoded journal aliases.
- **`js/tests.js`** — Engine unit tests. Auto-run on page load, results logged to browser console.
- **`css/styles.css`** — All styles.
- **`data/`** — Database files and Python compilation scripts.

## Commands

```bash
# Start dev server (required for everything)
python server.py

# Install Python dependencies
pip install -r requirements.txt

# Rebuild journals.json from source data (Excel/CSV files in data/)
python data/compile_database.py

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
Unit tests for `engine.js` run automatically on page load (in `app.js:initUnitTests()`). Verify in browser console. The engine is pure — testable without any DOM or network.

### API proxy caching (server.py)
- **CiteScore**: In-memory session cache only (cleared on server restart)
- **SciELO / LILACS / Latindex**: Disk caches in `data/*_cache.json` with 30-day TTL. These files are gitignored.

### Database compilation (compile_database.py)
A journal is classified as `Enfermagem` area only if ALL of:
1. It's listed under Enfermagem in `classificacao.xlsx`
2. AND it appears in JCR Nursing CSV OR Scopus Nursing sheet OR has nursing keywords in title

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
