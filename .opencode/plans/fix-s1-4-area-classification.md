# Plano: Corrigir S1-4 — Cruzamento Ampliado para Classificação de Área

## Problema

A mudança S1-4 (confiança total no Sucupira) classificou 2.691 periódicos como Enfermagem, incluindo interdisciplinares como Peer Review (1541-1389, 48 áreas). A planilha do Sucupira não tem "Área Mãe" — apenas "Área de Avaliação", que lista todas as áreas onde o periódico pode ser avaliado.

## Solução

Reverter para cruzamento ampliado: **Sucupira Enfermagem E (JCR Nursing OU Scopus Nursing OU CUIDEN OU BDENF OU RevEnf OU keywords)**.

## Arquivos

| Arquivo | Ação |
|---|---|
| `data/compile_database.py` | Modificar: reverter confiança total, adicionar BDENF/RevEnf ao cruzamento |
| `data/fetch_bdenf_revenf.py` | Criar: script para baixar listas BDENF (API BVS) e RevEnf (API SciELO) |
| `data/bdenf_issns.json` | Gerado pelo script |
| `data/revenf_issns.json` | Gerado pelo script |

## Passos

### 1. Reverter compile_database.py

**Linha ~237**: Adicionar carregamento de `bdenf_issns` e `revenf_issns` de arquivos locais.

**Linha ~345**: Reverter a heurística de confiança total para cruzamento ampliado:
```python
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
```

### 2. Criar fetch_bdenf_revenf.py

- BDENF: paginação na API BVS `https://fi-admin-api.bvsalud.org/api/title/search/?q=indexed_database:BDENF`
- RevEnf: API SciELO `https://articlemeta.scielo.org/api/v1/journal/?collection=rve`
- Salvar como JSON lists de ISSNs normalizados

### 3. Executar

```powershell
python data/fetch_bdenf_revenf.py
python data/compile_database.py
```

### 4. Verificar

- Peer Review (1541-1389) → Outras Áreas
- RLAE (1518-8345) → Enfermagem
- REBEn (0034-7167) → Enfermagem
- Número de Enfermagem entre 1.605 e 3.896
