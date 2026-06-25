"""
Fetch listas de ISSNs BDENF e RevEnf das APIs publicas.

BDENF: API BVS (fi-admin-api.bvsalud.org) — busca por descriptor:Enfermagem
       (a API BVS nao suporta filtro por indexed_database:BDENF diretamente,
        mas periódicos com descritor "Enfermagem" correspondem ao escopo BDENF)
RevEnf: API SciELO (articlemeta.scielo.org) — colecao rve

Salva:
    data/bdenf_issns.json  — lista de ISSNs normalizados (XXXX-XXXX)
    data/revenf_issns.json — lista de ISSNs normalizados (XXXX-XXXX)

Uso:
    python data/fetch_bdenf_revenf.py
"""

import os
import re
import json
import time
import requests

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
BDENF_OUTPUT = os.path.join(DATA_DIR, "bdenf_issns.json")
REVENF_OUTPUT = os.path.join(DATA_DIR, "revenf_issns.json")

LILACS_API = "https://fi-admin-api.bvsalud.org/api/title/search/"
SCIELO_API = "https://articlemeta.scielo.org/api/v1/journal/"


def normalize_issn(raw):
    """Normaliza ISSN para XXXX-XXXX com validacao do check digit."""
    if not raw:
        return None
    val = re.sub(r'[^0-9Xx]', '', str(raw)).upper()
    if len(val) != 8:
        return None
    if 'X' in val[:7]:
        return None
    weights = [8, 7, 6, 5, 4, 3, 2]
    total = sum(int(val[i]) * weights[i] for i in range(7))
    rem = total % 11
    check = 11 - rem
    if check == 10:
        expected = 'X'
    elif check == 11:
        expected = '0'
    else:
        expected = str(check)
    if val[7] != expected:
        return None
    return f"{val[:4]}-{val[4:]}"


def fetch_bdenf_issns():
    """Busca ISSNs de periódicos de enfermagem via API BVS (descriptor:Enfermagem).

    A API BVS nao suporta filtro direto por indexed_database:BDENF, mas periódicos
    com descritor 'Enfermagem' correspondem ao escopo da area de enfermagem.
    """
    print("\n>>> Buscando ISSNs BDENF (descriptor:Enfermagem) via API BVS...")
    issns = set()
    offset = 0
    limit = 10
    total_found = None

    while True:
        params = {
            'q': 'descriptor:Enfermagem',
            'start': offset
        }
        headers = {'Accept': 'application/json', 'User-Agent': 'Mozilla/5.5'}

        for attempt in range(3):
            try:
                r = requests.get(LILACS_API, params=params, headers=headers, timeout=15)
                if r.status_code == 200:
                    break
                elif r.status_code == 429:
                    wait = min(2 ** attempt * 5, 60)
                    print(f"  [WAIT] 429. Aguardando {wait}s...")
                    time.sleep(wait)
                    continue
                else:
                    print(f"  [ERRO] HTTP {r.status_code}")
                    return issns
            except requests.exceptions.RequestException as e:
                if attempt < 2:
                    time.sleep(2 ** attempt)
                    continue
                print(f"  [ERRO] {e}")
                return issns

        data = r.json()
        dia = data.get('diaServerResponse', [{}])
        resp = dia[0].get('response', {}) if dia else {}
        docs = resp.get('docs', [])
        if total_found is None:
            total_found = resp.get('numFound', 0)
            print(f"  Total encontrado: {total_found} periódicos.")

        for doc in docs:
            issn_list = doc.get('issn', [])
            if isinstance(issn_list, str):
                issn_list = [issn_list]
            for raw in issn_list:
                norm = normalize_issn(raw)
                if norm:
                    issns.add(norm)

        print(f"  Progresso: {offset + len(docs)}/{total_found} | {len(issns)} ISSNs válidos")

        if len(docs) < limit or offset + limit >= total_found:
            break
        offset += limit
        time.sleep(0.15)

    print(f"  [OK] BDENF: {len(issns)} ISSNs únicos.")
    return issns


def fetch_revenf_issns():
    """Busca todos os ISSNs da colecao RevEnf (rve) via API SciELO."""
    print("\n>>> Buscando ISSNs RevEnf via API SciELO...")
    issns = set()

    headers = {'Accept': 'application/json', 'User-Agent': 'Mozilla/5.5'}
    params = {'collection': 'rve'}

    for attempt in range(3):
        try:
            r = requests.get(SCIELO_API, params=params, headers=headers, timeout=15)
            if r.status_code == 200:
                break
            print(f"  [ERRO] HTTP {r.status_code}")
            return issns
        except requests.exceptions.RequestException as e:
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            print(f"  [ERRO] {e}")
            return issns

    data = r.json()
    if not isinstance(data, list):
        print(f"  [AVISO] Resposta inesperada. Tipo: {type(data)}")
        data = []

    print(f"  Total encontrado: {len(data)} periódicos.")

    for journal in data:
        if not isinstance(journal, dict):
            continue
        for field in ['code', 'v935', 'v400']:
            raw = journal.get(field)
            if raw:
                if isinstance(raw, list):
                    for item in raw:
                        val = item.get('_') if isinstance(item, dict) else item
                        norm = normalize_issn(val)
                        if norm:
                            issns.add(norm)
                else:
                    norm = normalize_issn(raw)
                    if norm:
                        issns.add(norm)

    print(f"  [OK] RevEnf: {len(issns)} ISSNs únicos.")
    return issns


def main():
    bdenf = fetch_bdenf_issns()
    revenf = fetch_revenf_issns()

    with open(BDENF_OUTPUT, 'w', encoding='utf-8') as f:
        json.dump(sorted(bdenf), f, indent=2, ensure_ascii=False)
    print(f"\n[OK] BDENF salvo em {BDENF_OUTPUT} ({len(bdenf)} ISSNs)")

    with open(REVENF_OUTPUT, 'w', encoding='utf-8') as f:
        json.dump(sorted(revenf), f, indent=2, ensure_ascii=False)
    print(f"[OK] RevEnf salvo em {REVENF_OUTPUT} ({len(revenf)} ISSNs)")

    overlap = bdenf & revenf
    print(f"\nResumo:")
    print(f"  BDENF:  {len(bdenf)} ISSNs")
    print(f"  RevEnf: {len(revenf)} ISSNs")
    print(f"  Overlap (ambos): {len(overlap)}")
    print(f"\nProximo passo: python data/compile_database.py")


if __name__ == '__main__':
    main()
