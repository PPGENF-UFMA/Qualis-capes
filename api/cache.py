import json
import os
import re
from datetime import datetime

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ISSN_PATTERN = re.compile(r"^\d{4}-\d{3}[\dXx]$")

SCI_ELO_CACHE_PATH = os.path.join(PROJECT_ROOT, "data", "scielo_cache.json")
LILACS_CACHE_PATH = os.path.join(PROJECT_ROOT, "data", "lilacs_cache.json")
LATINDEX_CACHE_PATH = os.path.join(PROJECT_ROOT, "data", "latindex_cache.json")
DISCOVERIES_PATH = os.path.join(PROJECT_ROOT, "data", "runtime_discoveries.json")


def validate_issn(issn: str) -> bool:
    return bool(issn and ISSN_PATTERN.match(issn))


def load_json_cache(path: str) -> dict:
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[AVISO] Erro ao carregar cache do arquivo {path}: {e}")
    return {}


def save_json_cache(path: str, data: dict):
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[ERRO] Falha ao salvar cache no arquivo {path}: {e}")


def check_cache_validity(cache_dict: dict, key: str) -> dict | None:
    entry = cache_dict.get(key)
    if not entry:
        return None
    updated_at_str = entry.get("updated_at")
    if not updated_at_str:
        return None
    try:
        updated_at = datetime.strptime(updated_at_str, "%Y-%m-%d")
        delta = datetime.now() - updated_at
        if delta.days < 30:
            return entry
    except ValueError:
        pass
    return None


_session_cache: dict[str, dict] = {}

_scielo_cache: dict = load_json_cache(SCI_ELO_CACHE_PATH)
_lilacs_cache: dict = load_json_cache(LILACS_CACHE_PATH)
_latindex_cache: dict = load_json_cache(LATINDEX_CACHE_PATH)

_discoveries_cache: dict = load_json_cache(DISCOVERIES_PATH)


def get_session_cache() -> dict:
    return _session_cache


def get_scielo_cache() -> dict:
    return _scielo_cache


def get_lilacs_cache() -> dict:
    return _lilacs_cache


def get_latindex_cache() -> dict:
    return _latindex_cache


def save_scielo_cache(cache: dict):
    _scielo_cache.update(cache)
    save_json_cache(SCI_ELO_CACHE_PATH, _scielo_cache)


def save_lilacs_cache(cache: dict):
    _lilacs_cache.update(cache)
    save_json_cache(LILACS_CACHE_PATH, _lilacs_cache)


def save_latindex_cache(cache: dict):
    _latindex_cache.update(cache)
    save_json_cache(LATINDEX_CACHE_PATH, _latindex_cache)


# ─── Descobertas de Runtime ────────────────────────────────────────

def get_discoveries() -> dict:
    return _discoveries_cache


def save_discovery(issn: str, record: dict):
    _discoveries_cache[issn] = record
    save_json_cache(DISCOVERIES_PATH, _discoveries_cache)
