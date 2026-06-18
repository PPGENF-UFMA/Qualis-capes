import os
import re
import json
import glob
import pandas as pd

def process_jcr_csv(filepath):
    """
    Processa um arquivo CSV do JCR (Web of Science) usando csv.reader nativo.
    pd.read_csv tem bug de quoting com a primeira linha de metadados destes CSVs.
    Retorna:
      - issns: set de ISSNs encontrados
      - values: dict {issn: jcr_value}
      - is_nursing: bool indicando se a categoria é NURSING
    """
    import csv
    
    with open(filepath, 'r', encoding='utf-8-sig') as f:
        reader = csv.reader(f)
        
        # Pular linha 0 (metadata) e linha 1 (blank)
        next(reader)
        next(reader)
        
        # Linha 2 = cabeçalho
        raw_headers = next(reader)
        headers = []
        for h in raw_headers:
            h_clean = h.strip().upper()
            # Evitar colunas duplicadas (trailing comma pode criar coluna extra vazia)
            if h_clean and h_clean not in headers:
                headers.append(h_clean)
            elif h_clean:
                headers.append(h_clean + '_2')
        
        # Detectar índices das colunas por nome
        issn_idx = None
        eissn_idx = None
        jif_idx = None
        category_idx = None
        
        for idx, h in enumerate(headers):
            if h == 'ISSN':
                issn_idx = idx
            elif h == 'EISSN':
                eissn_idx = idx
            elif 'JIF' in h and 'RANK' not in h:
                jif_idx = idx
            elif h == 'CATEGORY':
                category_idx = idx
        
        if issn_idx is None or jif_idx is None:
            print(f"  [AVISO] {os.path.basename(filepath)}: colunas ISSN ou JIF nao encontradas.")
            print(f"         Headers: {headers}")
            return {'issns': set(), 'values': {}, 'is_nursing': False}
        
        issns = set()
        values = {}
        is_nursing = False
        
        for row in reader:
            if len(row) < max(issn_idx, jif_idx) + 1:
                continue
            
            raw_issn = row[issn_idx] if len(row) > issn_idx else None
            raw_eissn = row[eissn_idx] if eissn_idx is not None and len(row) > eissn_idx else None
            raw_jif = row[jif_idx] if len(row) > jif_idx else None
            
            # Detectar nursing pelo conteúdo da coluna Category
            if category_idx is not None and len(row) > category_idx:
                cat = row[category_idx].strip().upper()
                if 'NURSING' in cat:
                    is_nursing = True
            
            jcr_val = parse_float(raw_jif)
            
            issn_norm = normalize_issn(raw_issn)
            eissn_norm = normalize_issn(raw_eissn)
            
            for target in [issn_norm, eissn_norm]:
                if target:
                    issns.add(target)
                    if jcr_val is not None:
                        if target not in values or jcr_val > values[target]:
                            values[target] = jcr_val
        
        return {'issns': issns, 'values': values, 'is_nursing': is_nursing}

def process_cuiden_csv(filepath):
    """
    Processa o arquivo CSV do CUIDEN.
    Retorna:
      - cuiden_data: dict {issn: {"ric": float, "title": str}}
    """
    import csv
    cuiden_data = {}
    if not os.path.exists(filepath):
        print(f"  [AVISO] {os.path.basename(filepath)} nao encontrado.")
        return cuiden_data
        
    with open(filepath, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        try:
            # Cabecalho
            headers = next(reader)
        except StopIteration:
            return cuiden_data
            
        # Detectar indices
        issn_idx = None
        ric_idx = None
        revista_idx = None
        
        for idx, h in enumerate(headers):
            h_clean = h.strip().upper()
            if h_clean == 'ISSN':
                issn_idx = idx
            elif h_clean == 'RIC' or h_clean == 'RIC ESTIMADO' or h_clean == 'RIC_ESTIMADO':
                ric_idx = idx
            elif h_clean == 'REVISTA' or h_clean == 'TITLE':
                revista_idx = idx
                
        if issn_idx is None or ric_idx is None:
            # fallback
            issn_idx = 5
            ric_idx = 8
            revista_idx = 7
            
        for row in reader:
            if not row or len(row) <= max(issn_idx, ric_idx):
                continue
            raw_issn = row[issn_idx]
            raw_ric = row[ric_idx]
            raw_title = row[revista_idx] if len(row) > revista_idx else "Periódico CUIDEN"
            
            issn_norm = normalize_issn(raw_issn)
            if issn_norm:
                ric_val = parse_float(raw_ric)
                if ric_val is not None:
                    cuiden_data[issn_norm] = {
                        "ric": ric_val,
                        "title": raw_title.strip()
                    }
    return cuiden_data

# Caminhos dos arquivos
DATA_DIR = os.path.dirname(os.path.abspath(__file__))
CLASSIFICACAO_PATH = os.path.join(DATA_DIR, "classificacao.xlsx")
SCOPUS_PATH = os.path.join(DATA_DIR, "journals_scopus.xlsx")
CUIDEN_PATH = os.path.join(DATA_DIR, "cuiden_citacion_2022.csv")
OUTPUT_PATH = os.path.join(DATA_DIR, "journals.json")

# Auto-detectar todos os CSVs JCR (nursing + outras categorias de saúde)
# set() remove duplicatas (glob case-insensitive no Windows)
JCR_FILES = sorted(set(
    glob.glob(os.path.join(DATA_DIR, "jcr_*.csv")) + 
    glob.glob(os.path.join(DATA_DIR, "JCR_*.csv"))
))

def normalize_issn(issn):
    """
    Normaliza o ISSN para o formato XXXX-XXXX.
    """
    if pd.isna(issn):
        return None
    val = str(issn).strip().upper()
    # Remove qualquer caractere que não seja número ou X
    val = re.sub(r'[^0-9X]', '', val)
    if len(val) == 8:
        return f"{val[:4]}-{val[4:]}"
    return None

def parse_float(val):
    """
    Converte um valor para float de forma segura.
    """
    if pd.isna(val):
        return None
    try:
        # Se for string, substitui vírgula por ponto
        s = str(val).strip().replace(',', '.')
        if s.upper() in ['N/A', 'N/A ', '', 'NONE', 'NULL']:
            return None
        return float(s)
    except ValueError:
        return None

def compile_database():
    print("Iniciando compilação do banco de dados de periódicos...")
    
    # Conjuntos temporários em memória para identificar periódicos de Enfermagem e Medline
    jcr_nursing_issns = set()
    scopus_nursing_issns = set()
    medline_issns = set()
    
    jcr_values = {}
    jcr_all_issns = set()  # Todos os ISSNs JCR (nursing + outras categorias)
    
    # Carregar dados do CUIDEN
    cuiden_data = process_cuiden_csv(CUIDEN_PATH)
    print(f"CUIDEN carregado em memória: {len(cuiden_data)} periódicos.")
    
    # --- 1. PROCESSAR TODOS OS CSVs JCR (AUTO-DETECÇÃO) ---
    if JCR_FILES:
        print(f"\n>>> Processando {len(JCR_FILES)} arquivo(s) JCR encontrado(s)...")
    else:
        print("[AVISO] Nenhum arquivo JCR encontrado em data/ (padrao: jcr_*.csv, JCR_*.csv)")
    
    for jcr_file in JCR_FILES:
        basename = os.path.basename(jcr_file)
        print(f"  Lendo {basename}...")
        try:
            result = process_jcr_csv(jcr_file)
            issn_count = len(result['issns'])
            val_count = sum(1 for v in result['values'].values() if v is not None)
            
            # Atualizar valores JCR globais (manter maior valor por ISSN)
            for issn, val in result['values'].items():
                if val is not None:
                    if issn not in jcr_values or val > jcr_values[issn]:
                        jcr_values[issn] = val
            
            # Nursing → conjunto especial para classificação de área
            if result['is_nursing']:
                jcr_nursing_issns.update(result['issns'])
                print(f"    → {issn_count} ISSNs (NURSING) | {val_count} com JIF")
            else:
                jcr_all_issns.update(result['issns'])
                print(f"    → {issn_count} ISSNs | {val_count} com JIF")
        except Exception as e:
            print(f"    [ERRO] ao processar {basename}: {e}")
    
    print(f"\nJCR consolidado: {len(jcr_nursing_issns)} ISSNs Nursing | {len(jcr_all_issns)} ISSNs outras categorias")
    print(f"  Valores JCR: {len(jcr_values)} ISSNs com JIF")

    # --- 2. PROCESSAR JOURNALS_SCOPUS.XLSX SEGUNDO ---
    if os.path.exists(SCOPUS_PATH):
        print(f"Lendo {SCOPUS_PATH} (Scopus Sources)...")
        try:
            df_scopus = pd.read_excel(SCOPUS_PATH, sheet_name='Scopus Sources May 2026')
            scopus_cols = df_scopus.columns.tolist()
            nursing_col = scopus_cols[44] if len(scopus_cols) > 44 else None
            
            for idx, row in df_scopus.iterrows():
                raw_issn = row.get('ISSN')
                raw_eissn = row.get('EISSN')
                issn = normalize_issn(raw_issn)
                eissn = normalize_issn(raw_eissn)
                
                medline_sourced = str(row.get('Medline-sourced Title? (See additional details under separate tab.)', '')).strip().upper()
                is_medline = medline_sourced in ['YES', 'Y', 'MEDLINE']
                
                is_nursing_scopus = False
                if nursing_col is not None and pd.notna(row.get(nursing_col)):
                    is_nursing_scopus = True
                
                for target_issn in [issn, eissn]:
                    if target_issn:
                        if is_nursing_scopus:
                            scopus_nursing_issns.add(target_issn)
                        if is_medline:
                            medline_issns.add(target_issn)
            print(f"Scopus Nursing em memória: {len(scopus_nursing_issns)} ISSNs.")
            print(f"Medline indexados em memória: {len(medline_issns)} ISSNs.")
        except Exception as e:
            print(f"Erro ao processar Scopus: {e}")

    # Dicionário final: { normalized_issn: { title, area, jcr, citeScore, indexers, metrics } }
    journals = {}
    
    # --- 3. PROCESSAR CLASSIFICACAO.XLSX (SUCUPIRA) TERCEIRO ---
    if os.path.exists(CLASSIFICACAO_PATH):
        print(f"Lendo {CLASSIFICACAO_PATH}...")
        try:
            df_class = pd.read_excel(CLASSIFICACAO_PATH)
            print(f"Processando {len(df_class)} registros do Sucupira...")
            
            for idx, row in df_class.iterrows():
                raw_issn = row.get('ISSN')
                issn = normalize_issn(raw_issn)
                if not issn:
                    continue
                
                title = str(row.get('Título', '')).strip()
                area_aval = str(row.get('Área de Avaliação', '')).strip().upper()
                
                # Regra inteligente de Área Mãe (Enfermagem)
                # O periódico pertence à área de Enfermagem apenas se:
                # - For avaliado em Enfermagem em classificacao.xlsx E:
                #   - Estiver no JCR de Enfermagem OU
                #   - Estiver no Scopus na categoria Nursing OU
                #   - Tiver palavra-chave de Enfermagem no título
                is_nursing_candidate = "ENFERMAGEM" in area_aval
                is_real_nursing = False
                if is_nursing_candidate:
                    is_real_nursing = (
                        issn in jcr_nursing_issns or
                        issn in scopus_nursing_issns or
                        issn in cuiden_data or
                        any(k in title.upper() for k in ["ENFERM", "NURSIN", "CUIDADO", "ENFERMER"])
                    )
                
                if issn not in journals:
                    journals[issn] = {
                        "title": title,
                        "area": "Enfermagem" if is_real_nursing else "Outras Áreas",
                        "jcr": jcr_values.get(issn),
                        "citeScore": None,
                        "indexers": ["MEDLINE"] if issn in medline_issns else [],
                        "metrics": {
                            "cuiden": cuiden_data[issn]["ric"] if issn in cuiden_data else None
                        }
                    }
                    if issn in cuiden_data:
                        journals[issn]["indexers"].append("RIC/CUIDEN")
                else:
                    # Se já existe, promove para Enfermagem se qualificando pelas regras
                    if is_real_nursing:
                        journals[issn]["area"] = "Enfermagem"
                    # Se o título atual estiver vazio ou for genérico, atualiza
                    if title and (not journals[issn]["title"] or len(title) > len(journals[issn]["title"])):
                        journals[issn]["title"] = title
                    # Atualiza indexador Medline
                    if issn in medline_issns and "MEDLINE" not in journals[issn]["indexers"]:
                        journals[issn]["indexers"].append("MEDLINE")
                    # Atualiza CUIDEN se disponível
                    if issn in cuiden_data:
                        if "RIC/CUIDEN" not in journals[issn]["indexers"]:
                            journals[issn]["indexers"].append("RIC/CUIDEN")
                        journals[issn]["metrics"]["cuiden"] = cuiden_data[issn]["ric"]
                    # Atualiza JCR se disponível
                    if jcr_values.get(issn) is not None:
                        journals[issn]["jcr"] = jcr_values.get(issn)
            
            print(f"Sucupira processado: {len(journals)} periódicos identificados.")
        except Exception as e:
            print(f"Erro ao processar classificacao.xlsx: {e}")
    else:
        print(f"AVISO: {CLASSIFICACAO_PATH} não encontrado. Ignorando mapeamento de áreas.")

    # --- 4. COMPLEMENTAR COM JCR E SCOPUS QUE PODEM NÃO ESTAR NO SUCUPIRA ---
    # Nursing → Enfermagem
    for issn in jcr_nursing_issns:
        if issn not in journals:
            journals[issn] = {
                "title": "Periódico do JCR (Enfermagem)",
                "area": "Enfermagem",
                "jcr": jcr_values.get(issn),
                "citeScore": None,
                "indexers": ["MEDLINE"] if issn in medline_issns else [],
                "metrics": {
                    "cuiden": None
                }
            }

    # Outras categorias JCR → Outras Áreas
    for issn in jcr_all_issns:
        if issn not in journals:
            journals[issn] = {
                "title": "Periódico do JCR",
                "area": "Outras Áreas",
                "jcr": jcr_values.get(issn),
                "citeScore": None,
                "indexers": ["MEDLINE"] if issn in medline_issns else [],
                "metrics": {
                    "cuiden": None
                }
            }

    for issn in scopus_nursing_issns:
        if issn not in journals:
            journals[issn] = {
                "title": "Periódico do Scopus (Enfermagem)",
                "area": "Enfermagem",
                "jcr": jcr_values.get(issn),
                "citeScore": None,
                "indexers": ["MEDLINE"] if issn in medline_issns else [],
                "metrics": {
                    "cuiden": None
                }
            }

    # CUIDEN → Enfermagem
    for issn, info in cuiden_data.items():
        if issn not in journals:
            journals[issn] = {
                "title": info["title"] or "Periódico CUIDEN",
                "area": "Enfermagem",
                "jcr": jcr_values.get(issn),
                "citeScore": None,
                "indexers": ["RIC/CUIDEN"],
                "metrics": {
                    "cuiden": info["ric"]
                }
            }
            if issn in medline_issns and "MEDLINE" not in journals[issn]["indexers"]:
                journals[issn]["indexers"].append("MEDLINE")

    # --- 5. PROCESSAR CITESCORE (PLANILHA SEPARADA, SE DISPONÍVEL) ---
    CITESCORE_PATH = os.path.join(DATA_DIR, "citescore.xlsx")
    if os.path.exists(CITESCORE_PATH):
        print(f"Lendo {CITESCORE_PATH} (CiteScore Metrics)...")
        try:
            df_cs = pd.read_excel(CITESCORE_PATH)
            print(f"Processando {len(df_cs)} registros de CiteScore...")
            
            for idx, row in df_cs.iterrows():
                raw_issn = row.get('ISSN') or row.get('Print ISSN')
                raw_eissn = row.get('EISSN') or row.get('E-ISSN')
                
                issn = normalize_issn(raw_issn)
                eissn = normalize_issn(raw_eissn)
                
                cs_val = None
                for cs_col_name in ['CiteScore', 'CiteScore 2024', 'CiteScore 2023', 'Highest CiteScore']:
                    if cs_col_name in df_cs.columns:
                        cs_val = parse_float(row.get(cs_col_name))
                        if cs_val is not None:
                            break
                
                title = str(row.get('Title', row.get('Source Title', ''))).strip()
                
                for target_issn in [issn, eissn]:
                    if not target_issn:
                        continue
                    
                    if target_issn not in journals:
                        journals[target_issn] = {
                            "title": title,
                            "area": "Outras Áreas",
                            "jcr": None,
                            "citeScore": cs_val,
                            "indexers": [],
                            "metrics": {
                                "cuiden": None
                            }
                        }
                    else:
                        if cs_val is not None and journals[target_issn]["citeScore"] is None:
                            journals[target_issn]["citeScore"] = cs_val
                        if title and not journals[target_issn]["title"]:
                            journals[target_issn]["title"] = title
            print("CiteScore processado com sucesso.")
        except Exception as e:
            print(f"Erro ao processar citescore.xlsx: {e}")

    # --- 6. PROCESSAR CITESCORE_CACHE.JSON (GERADO PELA API ELSEVIER) ---
    CITESCORE_CACHE_PATH = os.path.join(DATA_DIR, "citescore_cache.json")
    if os.path.exists(CITESCORE_CACHE_PATH):
        print(f"Lendo {CITESCORE_CACHE_PATH} (Cache API Elsevier)...")
        try:
            with open(CITESCORE_CACHE_PATH, "r", encoding="utf-8") as f:
                cs_cache = json.load(f)
            
            applied = 0
            for issn, metrics in cs_cache.items():
                cs_val = metrics.get("citeScore")
                if cs_val is not None and issn in journals:
                    journals[issn]["citeScore"] = cs_val
                    applied += 1
            print(f"CiteScore (API Elsevier): {applied} periódicos atualizados do cache.")
        except Exception as e:
            print(f"Erro ao processar citescore_cache.json: {e}")

    # --- 7. GRAVAR RESULTADO EM JOURNALS.JSON ---
    print(f"Gravando base consolidada contendo {len(journals)} periódicos...")
    try:
        with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
            json.dump(journals, f, indent=2, ensure_ascii=False)
        print(f"Banco de dados compilado com sucesso e salvo em: {OUTPUT_PATH}")
    except Exception as e:
        print(f"Erro ao gravar arquivo journals.json: {e}")

if __name__ == "__main__":
    compile_database()
