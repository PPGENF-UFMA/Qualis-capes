import json
import os
import re
import time
import threading
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ISSN_PATTERN = re.compile(r"^\d{4}-\d{3}[\dXx]$")

SCI_ELO_CACHE_PATH = os.path.join(PROJECT_ROOT, "data", "scielo_cache.json")
LILACS_CACHE_PATH = os.path.join(PROJECT_ROOT, "data", "lilacs_cache.json")
LATINDEX_CACHE_PATH = os.path.join(PROJECT_ROOT, "data", "latindex_cache.json")
DISCOVERIES_PATH = os.path.join(PROJECT_ROOT, "data", "runtime_discoveries.json")
CITESCORE_CACHE_PATH = os.path.join(PROJECT_ROOT, "data", "citescore_cache.json")

_cache_lock = threading.RLock()


def validate_issn(issn: str) -> bool:
    return bool(issn and ISSN_PATTERN.match(issn))


def load_json_cache(path: str) -> dict:
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Erro ao carregar cache do arquivo {path}: {e}")
    return {}


def save_json_cache(path: str, data: dict):
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp_path = f"{path}.tmp"
        with _cache_lock:
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            os.replace(tmp_path, path)
    except Exception as e:
        logger.error(f"Falha ao salvar cache no arquivo {path}: {e}")


def check_cache_validity(cache_dict: dict, key: str, ttl_days: int = 30) -> dict | None:
    entry = cache_dict.get(key)
    if not entry:
        return None
    # Falha de rede/servidor nunca é evidência negativa sobre indexação.
    # Entradas antigas com status=error são ignoradas e reconsultadas.
    if entry.get("status") == "error":
        return None
    updated_at_str = entry.get("updated_at")
    if not updated_at_str:
        return None
    try:
        updated_at = datetime.strptime(updated_at_str, "%Y-%m-%d")
        delta = datetime.now() - updated_at
        if delta.days < ttl_days:
            return entry
    except ValueError:
        pass
    return None


_scielo_cache: dict = load_json_cache(SCI_ELO_CACHE_PATH)
_lilacs_cache: dict = load_json_cache(LILACS_CACHE_PATH)
_latindex_cache: dict = load_json_cache(LATINDEX_CACHE_PATH)
_citescore_cache: dict = load_json_cache(CITESCORE_CACHE_PATH)

_discoveries_cache: dict = load_json_cache(DISCOVERIES_PATH)


def get_scielo_cache() -> dict:
    return _scielo_cache


def get_lilacs_cache() -> dict:
    return _lilacs_cache


def get_latindex_cache() -> dict:
    return _latindex_cache


def get_citescore_cache() -> dict:
    return _citescore_cache


def save_scielo_cache(cache: dict):
    with _cache_lock:
        _scielo_cache.update(cache)
        save_json_cache(SCI_ELO_CACHE_PATH, _scielo_cache)


def save_lilacs_cache(cache: dict):
    with _cache_lock:
        _lilacs_cache.update(cache)
        save_json_cache(LILACS_CACHE_PATH, _lilacs_cache)


def save_latindex_cache(cache: dict):
    with _cache_lock:
        _latindex_cache.update(cache)
        save_json_cache(LATINDEX_CACHE_PATH, _latindex_cache)


def save_citescore_cache(cache: dict):
    with _cache_lock:
        _citescore_cache.update(cache)
        save_json_cache(CITESCORE_CACHE_PATH, _citescore_cache)


# ─── Descobertas de Runtime ────────────────────────────────────────

def get_discoveries() -> dict:
    return _discoveries_cache


def save_discovery(issn: str, record: dict):
    with _cache_lock:
        record["discovered_at"] = datetime.now().strftime("%Y-%m-%d")
        _discoveries_cache[issn] = record
        save_json_cache(DISCOVERIES_PATH, _discoveries_cache)


# ─── Circuit Breaker ──────────────────────────────────────────────

class CircuitBreaker:
    def __init__(self, name: str, failure_threshold: int = 5,
                 window_seconds: int = 60, cooldown_seconds: int = 120):
        self.name = name
        self.state = "CLOSED"
        self.failures: list[float] = []
        self.opened_at: float | None = None
        self.threshold = failure_threshold
        self.window = window_seconds
        self.cooldown_base = cooldown_seconds
        self._consecutive_opens = 0
        self._half_open_probe_in_flight = False

    def _get_cooldown(self) -> int:
        """Cooldown com backoff exponencial: base -> base*2 -> base*4 -> base*8 (máx 600s)."""
        factor = min(self._consecutive_opens, 3)
        return min(self.cooldown_base * (2 ** factor), 600)

    def _clean_old_failures(self):
        now = time.time()
        self.failures = [t for t in self.failures if now - t < self.window]

    def allow_request(self) -> bool:
        self._clean_old_failures()
        if self.state == "CLOSED":
            return True
        if self.state == "OPEN":
            if self.opened_at is not None and (time.time() - self.opened_at) >= self._get_cooldown():
                self.state = "HALF_OPEN"
                self._half_open_probe_in_flight = True
                logger.info(f"Circuit breaker '{self.name}' half-open: probe liberado.")
                return True
            return False
        if self.state == "HALF_OPEN":
            if self._half_open_probe_in_flight:
                return False
            self._half_open_probe_in_flight = True
            return True
        return False

    def record_success(self):
        if self.state == "HALF_OPEN":
            self.state = "CLOSED"
            self._consecutive_opens = 0
            logger.info(f"Circuit breaker '{self.name}' fechou (half-open → closed)")
        self.failures = []
        self._half_open_probe_in_flight = False

    def record_failure(self):
        now = time.time()
        self.failures.append(now)
        self._clean_old_failures()
        self._half_open_probe_in_flight = False
        if self.state == "HALF_OPEN":
            self.state = "OPEN"
            self.opened_at = now
            self._consecutive_opens += 1
            logger.warning(f"Circuit breaker '{self.name}' reabriu após half-open (cooldown: {self._get_cooldown()}s)")
        elif self.state == "CLOSED" and len(self.failures) >= self.threshold:
            self.state = "OPEN"
            self.opened_at = now
            self._consecutive_opens += 1
            logger.warning(f"Circuit breaker '{self.name}' abriu (threshold {self.threshold} atingido, cooldown: {self._get_cooldown()}s)")

    def get_status(self) -> dict:
        remaining = 0
        if self.state == "OPEN" and self.opened_at is not None:
            remaining = max(0, int(self._get_cooldown() - (time.time() - self.opened_at)))
        return {
            "state": self.state,
            "failure_count": len([t for t in self.failures if time.time() - t < self.window]),
            "cooldown_remaining": remaining,
        }


circuit_scielo = CircuitBreaker("scielo", failure_threshold=5, window_seconds=60, cooldown_seconds=120)
circuit_lilacs = CircuitBreaker("lilacs", failure_threshold=5, window_seconds=60, cooldown_seconds=120)
circuit_latindex = CircuitBreaker("latindex", failure_threshold=10, window_seconds=120, cooldown_seconds=300)
circuit_elsevier = CircuitBreaker("elsevier", failure_threshold=3, window_seconds=60, cooldown_seconds=180)


def get_all_circuit_statuses() -> dict:
    return {
        "scielo": circuit_scielo.get_status(),
        "lilacs": circuit_lilacs.get_status(),
        "latindex": circuit_latindex.get_status(),
        "elsevier": circuit_elsevier.get_status(),
    }
