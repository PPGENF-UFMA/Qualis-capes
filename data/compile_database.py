import os
import re
import json
import glob
import logging
import pandas as pd

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

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
        title_idx = None
        
        for idx, h in enumerate(headers):
            if h == 'ISSN':
                issn_idx = idx
            elif h == 'EISSN':
                eissn_idx = idx
            elif 'JIF' in h and 'RANK' not in h:
                jif_idx = idx
            elif h == 'CATEGORY':
                category_idx = idx
            elif h == 'TITLE':
                title_idx = idx
        
        if issn_idx is None or jif_idx is None:
            logger.warning(f"{os.path.basename(filepath)}: colunas ISSN ou JIF nao encontradas.")
            logger.warning(f"         Headers: {headers}")
            return {'issns': set(), 'values': {}, 'is_nursing': False}
        
        issns = set()
        values = {}
        eissn_map = {}
        titles = {}
        nursing_issns = set()
        
        for row in reader:
            if len(row) < max(issn_idx, jif_idx) + 1:
                continue
            
            raw_issn = row[issn_idx] if len(row) > issn_idx else None
            raw_eissn = row[eissn_idx] if eissn_idx is not None and len(row) > eissn_idx else None
            raw_jif = row[jif_idx] if len(row) > jif_idx else None
            raw_title = row[title_idx] if title_idx is not None and len(row) > title_idx else None
            
            # Detectar nursing pelo conteúdo da coluna Category da própria linha
            row_is_nursing = False
            if category_idx is not None and len(row) > category_idx:
                cat = row[category_idx].strip().upper()
                if 'NURSING' in cat:
                    row_is_nursing = True
            
            jcr_val = parse_float(raw_jif)
            title_val = raw_title.strip() if raw_title else None
            
            issn_norm = normalize_issn(raw_issn)
            eissn_norm = normalize_issn(raw_eissn)
            
            for target in [issn_norm, eissn_norm]:
                if target:
                    issns.add(target)
                    if row_is_nursing:
                        nursing_issns.add(target)
                    if jcr_val is not None:
                        if target not in values or jcr_val > values[target]:
                            values[target] = jcr_val
                    if title_val and target not in titles:
                        titles[target] = title_val
            
            if issn_norm and eissn_norm and issn_norm != eissn_norm:
                eissn_map[issn_norm] = eissn_norm
                eissn_map[eissn_norm] = issn_norm
        
        return {
            'issns': issns,
            'nursing_issns': nursing_issns,
            'values': values,
            'is_nursing': len(nursing_issns) > 0,
            'eissn_map': eissn_map,
            'titles': titles
        }

def process_cuiden_csv(filepath):
    """
    Processa o arquivo CSV do CUIDEN.
    Retorna:
      - cuiden_data: dict {issn: {"ric": float, "title": str}}
    """
    import csv
    cuiden_data = {}
    if not os.path.exists(filepath):
        logger.warning(f"{os.path.basename(filepath)} nao encontrado.")
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
    val = re.sub(r'[^0-9X]', '', val)
    if len(val) != 8:
        return None
        
    weights = [8, 7, 6, 5, 4, 3, 2]
    total = sum(int(val[i]) * weights[i] for i in range(7))
    rem = total % 11
    check_digit = 11 - rem
    
    if check_digit == 10:
        expected = "X"
    elif check_digit == 11:
        expected = "0"
    else:
        expected = str(check_digit)
        
    if val[7] != expected:
        return None
        
    return f"{val[:4]}-{val[4:]}"

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
    logger.info("Iniciando compilação do banco de dados de periódicos...")
    
    # Conjuntos temporários em memória para identificar periódicos de Enfermagem e Medline
    jcr_nursing_issns = set()
    scopus_nursing_issns = set()
    medline_issns = set()
    
    jcr_values = {}
    jcr_all_issns = set()  # Todos os ISSNs JCR (nursing + outras categorias)
    global_eissn_map = {}
    jcr_titles = {}  # Títulos extraídos do JCR
    
    # Carregar dados do CUIDEN
    cuiden_data = process_cuiden_csv(CUIDEN_PATH)
    logger.info(f"CUIDEN carregado em memória: {len(cuiden_data)} periódicos.")

    # Carregar listas de ISSNs BDENF e RevEnf (geradas por fetch_bdenf_revenf.py)
    bdenf_issns = set()
    revenf_issns = set()
    BDENF_LIST_PATH = os.path.join(DATA_DIR, "bdenf_issns.json")
    REVENF_LIST_PATH = os.path.join(DATA_DIR, "revenf_issns.json")
    if os.path.exists(BDENF_LIST_PATH):
        try:
            with open(BDENF_LIST_PATH, "r", encoding="utf-8") as f:
                bdenf_issns = set(json.load(f))
            logger.info(f"BDENF carregado: {len(bdenf_issns)} ISSNs.")
        except Exception as e:
            logger.warning(f"Erro ao carregar bdenf_issns.json: {e}")
    else:
        logger.info("bdenf_issns.json nao encontrado. Execute: python data/fetch_bdenf_revenf.py")
    if os.path.exists(REVENF_LIST_PATH):
        try:
            with open(REVENF_LIST_PATH, "r", encoding="utf-8") as f:
                revenf_issns = set(json.load(f))
            logger.info(f"RevEnf carregado: {len(revenf_issns)} ISSNs.")
        except Exception as e:
            logger.warning(f"Erro ao carregar revenf_issns.json: {e}")
    else:
        logger.info("revenf_issns.json nao encontrado. Execute: python data/fetch_bdenf_revenf.py")
    
    # --- 1. PROCESSAR TODOS OS CSVs JCR (AUTO-DETECÇÃO) ---
    if JCR_FILES:
        logger.info(f"\n>>> Processando {len(JCR_FILES)} arquivo(s) JCR encontrado(s)...")
    else:
        logger.warning("Nenhum arquivo JCR encontrado em data/ (padrao: jcr_*.csv, JCR_*.csv)")
    
    for jcr_file in JCR_FILES:
        basename = os.path.basename(jcr_file)
        logger.info(f"  Lendo {basename}...")
        try:
            result = process_jcr_csv(jcr_file)
            issn_count = len(result['issns'])
            val_count = sum(1 for v in result['values'].values() if v is not None)
            
            # Atualizar valores JCR globais (manter maior valor por ISSN)
            for issn, val in result['values'].items():
                if val is not None:
                    if issn not in jcr_values or val > jcr_values[issn]:
                        jcr_values[issn] = val
            
            # Armazenar títulos do JCR
            for issn, title in result.get('titles', {}).items():
                if issn not in jcr_titles:
                    jcr_titles[issn] = title
            
            # Adicionar e-issn mapping
            global_eissn_map.update(result.get('eissn_map', {}))
            
            # Nursing → conjunto especial para classificação de área
            nursing_count = len(result.get('nursing_issns', set()))
            jcr_nursing_issns.update(result.get('nursing_issns', set()))
            jcr_all_issns.update(result['issns'])
            if nursing_count > 0:
                logger.info(f"    → {issn_count} ISSNs ({nursing_count} NURSING) | {val_count} com JIF")
            else:
                logger.info(f"    → {issn_count} ISSNs | {val_count} com JIF")
        except Exception as e:
            logger.error(f"    [ERRO] ao processar {basename}: {e}")
    
    logger.info(f"\nJCR consolidado: {len(jcr_nursing_issns)} ISSNs Nursing | {len(jcr_all_issns)} ISSNs outras categorias")
    logger.info(f"  Valores JCR: {len(jcr_values)} ISSNs com JIF")

    # --- 2. PROCESSAR JOURNALS_SCOPUS.XLSX SEGUNDO ---
    scopus_titles = {}  # Títulos extraídos do Scopus
    if os.path.exists(SCOPUS_PATH):
        logger.info(f"Lendo {SCOPUS_PATH} (Scopus Sources)...")
        try:
            df_scopus = pd.read_excel(SCOPUS_PATH, sheet_name='Scopus Sources May 2026')
            scopus_cols = df_scopus.columns.tolist()
            nursing_col = scopus_cols[44] if len(scopus_cols) > 44 else None
            
            for idx, row in df_scopus.iterrows():
                raw_issn = row.get('ISSN')
                raw_eissn = row.get('EISSN')
                issn = normalize_issn(raw_issn)
                eissn = normalize_issn(raw_eissn)
                
                if issn and eissn and issn != eissn:
                    global_eissn_map[issn] = eissn
                    global_eissn_map[eissn] = issn
                
                medline_sourced = str(row.get('Medline-sourced Title? (See additional details under separate tab.)', '')).strip().upper()
                is_medline = medline_sourced in ['YES', 'Y', 'MEDLINE']
                
                is_nursing_scopus = False
                if nursing_col is not None and pd.notna(row.get(nursing_col)):
                    is_nursing_scopus = True
                
                # Extrair título do Scopus
                scopus_title = str(row.get('Source Title', '')).strip()
                if scopus_title:
                    for target_issn in [issn, eissn]:
                        if target_issn and target_issn not in scopus_titles:
                            scopus_titles[target_issn] = scopus_title
                
                for target_issn in [issn, eissn]:
                    if target_issn:
                        if is_nursing_scopus:
                            scopus_nursing_issns.add(target_issn)
                        if is_medline:
                            medline_issns.add(target_issn)
            logger.info(f"Scopus Nursing em memória: {len(scopus_nursing_issns)} ISSNs.")
            logger.info(f"Medline indexados em memória: {len(medline_issns)} ISSNs.")
            logger.info(f"Scopus títulos extraídos: {len(scopus_titles)}")
        except Exception as e:
            logger.error(f"Erro ao processar Scopus: {e}")

    # Dicionário final: { normalized_issn: { title, area, jcr, citeScore, indexers, metrics } }
    journals = {}
    
    # --- 3. PROCESSAR CLASSIFICACAO.XLSX (SUCUPIRA) TERCEIRO ---
    if os.path.exists(CLASSIFICACAO_PATH):
        logger.info(f"Lendo {CLASSIFICACAO_PATH}...")
        try:
            df_class = pd.read_excel(CLASSIFICACAO_PATH)
            logger.info(f"Processando {len(df_class)} registros do Sucupira...")
            
            for idx, row in df_class.iterrows():
                raw_issn = row.get('ISSN')
                issn = normalize_issn(raw_issn)
                if not issn:
                    continue
                
                title = str(row.get('Título', '')).strip()
                area_aval = str(row.get('Área de Avaliação', '')).strip().upper()
                
                # Regra de Área (Enfermagem) — Cruzamento Ampliado:
                # O periódico é Enfermagem se o Sucupira o lista em Enfermagem E
                # há evidência externa confirmando (JCR Nursing, Scopus Nursing,
                # CUIDEN, BDENF, RevEnf, ou palavras-chave no título).
                # A planilha do Sucupira não tem "Área Mãe" — lista o periódico
                # em todas as áreas onde pode ser avaliado, incluindo interdisciplinares.
                is_nursing_candidate = "ENFERMAGEM" in area_aval
                is_real_nursing = False
                if is_nursing_candidate:
                    is_real_nursing = (
                        issn in jcr_nursing_issns or
                        issn in scopus_nursing_issns or
                        issn in cuiden_data or
                        issn in bdenf_issns or
                        issn in revenf_issns or
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
                    if issn in scopus_nursing_issns:
                        journals[issn]["indexers"].append("SCOPUS")
                    if issn in revenf_issns:
                        journals[issn]["indexers"].append("RevEnf")
                    if issn in bdenf_issns:
                        journals[issn]["indexers"].append("BDENF")
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
                    # Atualiza indexador Scopus
                    if issn in scopus_nursing_issns and "SCOPUS" not in journals[issn]["indexers"]:
                        journals[issn]["indexers"].append("SCOPUS")
                    # Atualiza indexador RevEnf
                    if issn in revenf_issns and "RevEnf" not in journals[issn]["indexers"]:
                        journals[issn]["indexers"].append("RevEnf")
                    # Atualiza indexador BDENF
                    if issn in bdenf_issns and "BDENF" not in journals[issn]["indexers"]:
                        journals[issn]["indexers"].append("BDENF")
                    # Atualiza CUIDEN se disponível
                    if issn in cuiden_data:
                        if "RIC/CUIDEN" not in journals[issn]["indexers"]:
                            journals[issn]["indexers"].append("RIC/CUIDEN")
                        journals[issn]["metrics"]["cuiden"] = cuiden_data[issn]["ric"]
                    # Atualiza JCR se disponível
                    if jcr_values.get(issn) is not None:
                        journals[issn]["jcr"] = jcr_values.get(issn)
            
            logger.info(f"Sucupira processado: {len(journals)} periódicos identificados.")
        except Exception as e:
            logger.error(f"Erro ao processar classificacao.xlsx: {e}")
    else:
        logger.warning(f"AVISO: {CLASSIFICACAO_PATH} não encontrado. Ignorando mapeamento de áreas.")

    # --- 4. COMPLEMENTAR COM JCR E SCOPUS QUE PODEM NÃO ESTAR NO SUCUPIRA ---
    # Nursing → Enfermagem
    for issn in jcr_nursing_issns:
        if issn not in journals:
            # Fallback hierárquico: JCR title > Scopus title > Genérico
            title = jcr_titles.get(issn) or scopus_titles.get(issn) or "Periódico do JCR (Enfermagem)"
            journals[issn] = {
                "title": title,
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
            # Fallback hierárquico: JCR title > Scopus title > Genérico
            title = jcr_titles.get(issn) or scopus_titles.get(issn) or "Periódico do JCR"
            journals[issn] = {
                "title": title,
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
            # Fallback hierárquico: Scopus title > JCR title > Genérico
            title = scopus_titles.get(issn) or jcr_titles.get(issn) or "Periódico do Scopus (Enfermagem)"
            journals[issn] = {
                "title": title,
                "area": "Enfermagem",
                "jcr": jcr_values.get(issn),
                "citeScore": None,
                "indexers": ["SCOPUS", "MEDLINE"] if issn in medline_issns else ["SCOPUS"],
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
        logger.info(f"Lendo {CITESCORE_PATH} (CiteScore Metrics)...")
        try:
            df_cs = pd.read_excel(CITESCORE_PATH)
            logger.info(f"Processando {len(df_cs)} registros de CiteScore...")
            
            for idx, row in df_cs.iterrows():
                raw_issn = row.get('ISSN') or row.get('Print ISSN')
                raw_eissn = row.get('EISSN') or row.get('E-ISSN')
                
                issn = normalize_issn(raw_issn)
                eissn = normalize_issn(raw_eissn)
                
                if issn and eissn and issn != eissn:
                    global_eissn_map[issn] = eissn
                    global_eissn_map[eissn] = issn
                
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
            logger.info("CiteScore processado com sucesso.")
        except Exception as e:
            logger.error(f"Erro ao processar citescore.xlsx: {e}")

    # --- 6. PROCESSAR CITESCORE_CACHE.JSON (GERADO PELA API ELSEVIER) ---
    CITESCORE_CACHE_PATH = os.path.join(DATA_DIR, "citescore_cache.json")
    if os.path.exists(CITESCORE_CACHE_PATH):
        logger.info(f"Lendo {CITESCORE_CACHE_PATH} (Cache API Elsevier)...")
        try:
            with open(CITESCORE_CACHE_PATH, "r", encoding="utf-8") as f:
                cs_cache = json.load(f)
            
            applied = 0
            for issn, metrics in cs_cache.items():
                cs_val = metrics.get("citeScore")
                if cs_val is not None and issn in journals:
                    journals[issn]["citeScore"] = cs_val
                    applied += 1
            logger.info(f"CiteScore (API Elsevier): {applied} periódicos atualizados do cache.")
        except Exception as e:
            logger.error(f"Erro ao processar citescore_cache.json: {e}")

    # --- Resumo de títulos resolvidos ---
    jcr_resolved = sum(1 for issn in journals if issn != "_meta" and journals[issn].get("title", "").startswith("Periódico do JCR"))
    scopus_resolved = sum(1 for issn in journals if issn != "_meta" and journals[issn].get("title", "").startswith("Periódico do Scopus"))
    total_generic = jcr_resolved + scopus_resolved
    logger.info(f"Títulos genéricos restantes: {total_generic} (JCR: {jcr_resolved}, Scopus: {scopus_resolved})")

    # --- 7. GRAVAR RESULTADO EM JOURNALS.JSON ---
    # Adicionar metadados de compilação para rastreabilidade
    from datetime import datetime
    journals["_meta"] = {
        "compiled_at": datetime.now().isoformat(),
        "total_journals": len([k for k in journals if k != "_meta"]),
        "jcr_year": "2025",
        "cuiden_edition": "2022",
        "sources": {
            "jcr_files": [os.path.basename(f) for f in sorted(glob.glob(os.path.join(DATA_DIR, "[Jj][Cc][Rr]_*.csv")))],
            "scopus": "journals_scopus.xlsx" if os.path.exists(os.path.join(DATA_DIR, "journals_scopus.xlsx")) else None,
            "classificacao": "classificacao.xlsx" if os.path.exists(os.path.join(DATA_DIR, "classificacao.xlsx")) else None,
            "cuiden": "cuiden_citacion_2022.csv" if os.path.exists(os.path.join(DATA_DIR, "cuiden_citacion_2022.csv")) else None,
        },
        "eissn_index": global_eissn_map
    }

    # Apagar caches
    caches_to_delete = ["scielo_cache.json", "lilacs_cache.json", "latindex_cache.json", "runtime_discoveries.json"]
    for c in caches_to_delete:
        p = os.path.join(DATA_DIR, c)
        if os.path.exists(p):
            try:
                os.remove(p)
                logger.info(f"Cache removido: {c}")
            except Exception as e:
                pass

    logger.info(f"Gravando base consolidada contendo {len(journals) - 1} periódicos...")
    try:
        with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
            json.dump(journals, f, indent=2, ensure_ascii=False)
        logger.info(f"Banco de dados compilado com sucesso e salvo em: {OUTPUT_PATH}")
    except Exception as e:
        logger.error(f"Erro ao gravar arquivo journals.json: {e}")

if __name__ == "__main__":
    compile_database()
