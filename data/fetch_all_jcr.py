"""
Script automatizado para download completo de todos os periódicos do Clarivate JCR 2025.
Utiliza a sessão institucional ativa (CAPES / UFMA).

Uso:
    python data/fetch_all_jcr.py --cookie "OptanonAlertBoxClosed=...; PSSID=..." --sid "H3-..."
    # Ou configure JCR_COOKIE e JCR_SID no arquivo .env
"""
import argparse
import csv
import json
import os
import sys
import time
import httpx
from dotenv import load_dotenv

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(DATA_DIR)
load_dotenv(os.path.join(PROJECT_ROOT, ".env"))

OUTPUT_CSV = os.path.join(DATA_DIR, "jcr_all_2025.csv")
URL = "https://jcr.clarivate.com/api/jcr3/bwjournal/v1/search-result"


def parse_args():
    parser = argparse.ArgumentParser(description="Download automatizado de todos os periódicos do JCR 2025.")
    parser.add_argument("--cookie", default=os.environ.get("JCR_COOKIE", ""), help="Cookie da sessão do JCR")
    parser.add_argument("--sid", default=os.environ.get("JCR_SID", ""), help="Valor do header x-1p-inc-sid")
    parser.add_argument("--output", default=OUTPUT_CSV, help="Caminho do arquivo CSV de saída")
    return parser.parse_args()


def make_payload(start: int, count: int = 600) -> dict:
    return {
        "journalFilterParameters": {
            "query": "",
            "journals": [],
            "categories": [],
            "publishers": [],
            "countryRegions": [],
            "citationIndexes": ["SCIE", "SSCI", "AHCI", "ESCI"],
            "jcrYear": 2025,
            "categorySchema": "WOS",
            "openAccess": "N",
            "jifQuartiles": [],
            "jifRanges": [],
            "jifNA": False,
            "jifPercentileRanges": [],
            "jciRanges": [],
            "oaRanges": [],
            "issnJ20s": [],
        },
        "retrievalParameters": {
            "start": start,
            "count": count,
            "sortBy": "jif2019",
            "sortOrder": "DESC",
        },
    }


def main():
    args = parse_args()
    cookie = args.cookie.strip()
    sid = args.sid.strip()

    if not cookie:
        print("[ERRO] Cookie da sessão JCR não informado.")
        print("Passe o cookie via argumento --cookie \"...\" ou defina JCR_COOKIE no arquivo .env.")
        sys.exit(1)

    headers = {
        "accept": "application/json, text/plain, */*",
        "accept-language": "pt-BR,pt;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
        "cache-control": "no-cache",
        "content-type": "application/json",
        "origin": "https://jcr.clarivate.com",
        "pragma": "no-cache",
        "priority": "u=1, i",
        "referer": "https://jcr.clarivate.com/jcr/browse-journals",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0",
        "cookie": cookie,
    }
    if sid:
        headers["x-1p-inc-sid"] = sid

    print("=" * 70)
    print("Iniciando download automatizado do Clarivate JCR 2025...")
    print(f"Destino: {args.output}")
    print("=" * 70)

    client = httpx.Client(timeout=35.0, headers=headers)

    # 1. Obter contagem total
    initial_payload = make_payload(start=1, count=1)
    try:
        resp = client.post(URL, json=initial_payload)
        resp.raise_for_status()
        initial_data = resp.json()
        total_count = initial_data.get("totalCount", 22643)
        print(f"Total de periódicos identificados no JCR 2025: {total_count}")
    except Exception as e:
        print(f"[ERRO] Falha ao consultar o total do JCR: {e}")
        sys.exit(1)

    chunk_size = 600
    all_journals = []
    start = 1
    page = 1
    total_pages = (total_count + chunk_size - 1) // chunk_size

    while start <= total_count:
        print(f"[{page}/{total_pages}] Baixando registros {start} a {min(start + chunk_size - 1, total_count)}...", end=" ", flush=True)
        payload = make_payload(start=start, count=chunk_size)

        success = False
        for attempt in range(1, 4):
            try:
                resp = client.post(URL, json=payload)
                if resp.status_code == 200:
                    data = resp.json().get("data", [])
                    all_journals.extend(data)
                    print(f"OK ({len(data)} periódicos)")
                    success = True
                    break
                else:
                    print(f"[Status {resp.status_code}, tentativa {attempt}]", end=" ", flush=True)
                    time.sleep(2 * attempt)
            except Exception as e:
                print(f"[Timeout/Erro: {e}, tentativa {attempt}]", end=" ", flush=True)
                time.sleep(2 * attempt)

        if not success:
            print(f"\n[AVISO] Não foi possível baixar a página {page} após 3 tentativas.")

        start += chunk_size
        page += 1
        time.sleep(1.0)

    print(f"\nDownload concluído! Total coletado: {len(all_journals)} periódicos.")
    print("Gravando arquivo CSV formatado para o compilador...")

    with open(args.output, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            "Journal Data Filtered By:  Selected Editions: SCIE;SSCI;AHCI;ESCI Selected JCR Year: 2025 Selected Category Schema: WOS Selected Open Access: N Indicator: Custom"
        ])
        writer.writerow([])
        writer.writerow([
            "Title",
            "JCR Abbreviation",
            "Publisher",
            "ISSN",
            "eISSN",
            "Category",
            "Edition",
            "2025 JIF",
            "JIF Rank",
        ])

        for item in all_journals:
            title = item.get("journalName") or ""
            abbr = item.get("abbrJournal") or ""
            publisher = item.get("publisher") or ""
            issn = item.get("issn") or "N/A"
            eissn = item.get("eissn") or "N/A"
            categories = item.get("category") or []
            cat_str = "; ".join(categories) if isinstance(categories, list) else str(categories)
            quartiles = item.get("categoryQuartiles") or []
            edition = quartiles[0].get("edition", "SCIE") if quartiles else "SCIE"
            jif_rank = quartiles[0].get("jifRank", "") if quartiles else ""
            jif = item.get("jif2019") or ""

            writer.writerow([
                title,
                abbr,
                publisher,
                issn,
                eissn,
                cat_str,
                edition,
                jif,
                jif_rank,
            ])

    file_size_mb = os.path.getsize(args.output) / (1024 * 1024)
    print(f"Sucesso! Arquivo salvo: {args.output} ({file_size_mb:.2f} MB)")


if __name__ == "__main__":
    main()
