"""Regressão Fase 1 — backend matching engine (api/enricher.py).

Testa o pipeline de matching na ordem em que o cliente usa, mas chamando
diretamente `enricher.match_journal` (sem HTTP).
Os 22 casos são os mesmos de test_parser.js (incluindo os 4 extras que
representavam bugs originais reportados pelo usuário).

Executa:  pytest tests/test_matching.py -v
"""
import os
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from api import enricher


@pytest.fixture(scope="module", autouse=True)
def _db_loaded():
    """Garante que journals.json + aliases + índice IDF estão carregados."""
    enricher.load_database()
    # Asserts estruturais — se faltar algo, falha cedo (não erro misterioso)
    assert enricher._journals_db is not None and len(enricher._journals_db) > 1000, "Base não carregou"
    assert len(enricher._title_index) > 0, "Índice invertido vazio"
    assert len(enricher._idf_weights) > 0, "IDF vazio"
    assert len(enricher._server_aliases) > 100, "Aliases server-side ausentes"


# ─── Casos do Currículo (18 artigos) ────────────────────────────────
CV_ARTICLES = [
    (
        "DE DEUS CABRAL JÚNIOR, JOÃO ; DE OLIVEIRA, BRUNO LUCIANO CARNEIRO ALVES ; SIMON, SHARON SANZ ; "
        "PASSINHO, JHULE SILVA ; CAPPI, CAROLINA ; BERTOLA, LAISS ; ALVES, CANDIDA HELENA L. ; "
        "SIMÕES, VANDA M. F. ; ALVES, GILBERTO SOUSA . Accuracy of the revised Addenbrooke Cognitive "
        "Examination (ACE-R) and Mini-Mental (MMSE) in a Quilombola community with low education "
        "attainment: results of a cross-sectional study. Frontiers in Dementia, v. 4, p. 1-11, 2026.",
        "2813-3919", "Frontiers in Dementia",
    ),
    (
        "LIMA, KASSYA FERNANDA FREIRE ; SANTANA, MARTA SILVA DE ; SANTOS, GIRLANE CAROLINE PEREIRA ; "
        "CRUZ, PABLO NASCIMENTO ; ABREU, THAYSA GOES TRINTA ; PASCOAL, LÍVIA MAIA ; "
        "BATISTA, ROSÂNGELA FERNANDES LUCENA ; DIAS, ROSILDA SELVA ; OLIVEIRA, BRUNO LUCIANO CARNEIRO "
        "ALVES DE . Trends and spatial distribution of pediatric second-dose COVID-19 vaccination "
        "coverage: a temporal analysis, Brazil, 2022-2023. EPIDEMIOLOGIA E SERVIÇOS DE SAÚDE, v. 35, "
        "p. 1-13, 2026.",
        "2237-9622", "EPIDEMIOLOGIA E SERVIÇOS DE SAÚDE",
    ),
    (
        "BARROS, ANDRIO CORRÊA ; RODRIGUES, EVANDICLEUDE FERREIRA DE CARVALHO ; REGO, JULIANA DO "
        "NASCIMENTO MORAES ; BARROSO, SUELEN GONÇALVES ; OLIVEIRA, BRUNO LUCIANO CARNEIRO ALVES DE ; "
        "PÁSCOAL, LÍVIA MAIA . MUDANÇAS NA PREVALÊNCIA DA COBERTURA DE PLANOS MÉDICOS DE SAÚDE ENTRE "
        "ADULTOS NO BRASIL: ANÁLISE COMPARATIVA DA PESQUISA NACIONAL DE SAÚDE (2013 E 2019) CHANGES "
        "IN THE PREVALENCE OF HEALTH INSURANCE COVERAGE AMONG ADULTS IN BRAZIL: A COMPARATIVE ANALYSIS "
        "OF THE NATIONAL HEALTH SURVEY (2013 AND 2019) CAMBIOS EN LA PREVALENCIA DE LA COBERTURA DE "
        "PLANES DE SALUD ENTRE ADULTOS EN BRASIL: ANÁLISIS COMPAR. Revista Ibero-Americana de "
        "Humanidades, Ciências e Educação, v. 12, p. 1-16, 2026.",
        "2675-3375", "Revista Ibero-Americana de Humanidades, Ciências e Educação",
    ),
    (
        "FONTENELE, ARACELI MOREIRA DE MARTINI ; SANTOS, ALCIONE MIRANDA DOS ; GÓMEZ, LUZ MARINA "
        "GÓMEZ ; SILVA, FÁBIO NOGUEIRA DA ; OLIVEIRA, BRUNO LUCIANO CARNEIRO ALVES DE . Associated "
        "costs of hospitalizations due to external causes: time series analysis, Brazil, 2000-2023. "
        "EPIDEMIOLOGIA E SERVIÇOS DE SAÚDE, v. 35, p. 1-18, 2026.",
        "2237-9622", "EPIDEMIOLOGIA E SERVIÇOS DE SAÚDE",
    ),
    (
        "LACERDA, E. P. ; LIMA, S. F. ; OLIVEIRA, B. L. C. A. . Saúde da criança quilombola como "
        "desafio para os Objetivos de Desenvolvimento Sustentável: revisão de escopo. REBEN - "
        "REVISTA BRASILEIRA DE ENFERMAGEM, v. 77, p. 1-11, 2025.",
        "0034-7167", "REBEN - REVISTA BRASILEIRA DE ENFERMAGEM",
    ),
    (
        "SILVA, DENISE MONTENEGRO DA ; CAVALCANTE, YANKA ALCÂNTARA ; OLIVEIRA, BRUNO LUCIANO CARNEIRO "
        "ALVES DE ; LOPES, MARCOS VENÍCIOS DE OLIVEIRA ; FERNANDES, ANA FÁTIMA CARVALHO ; "
        "PINHEIRO, ANA KARINA BEZERRA ; AQUINO, PRISCILA DE SOUZA . Social health determinants "
        "associated with mammography performance according to the 2013 and 2019 National Health "
        "Survey. Ciência & Saúde Coletiva, v. 30, p. 1-12, 2025. Citações:3",
        "1678-4561", "Ciência & Saúde Coletiva",
    ),
    (
        "CRUZ, PABLO NASCIMENTO ; FERNANDA FREIRE LIMA, KASSYA ; LIRA FILHO, RIVALDO ; LUCIANO "
        "CARNEIRO ALVES DE OLIVEIRA, BRUNO ; SANTOS NETO, MARCELINO ; PEREIRA COSTA RABELO, POLIANA "
        ". ATENÇÃO AO PARTO E NASCIMENTO: boas práticas de residentes de enfermagem em uma "
        "maternidade nordestina. REVISTA DE CIÊNCIAS MÉDICAS E BIOLÓGICAS, v. 24, p. 171-178, "
        "2025.",
        "2236-5222", "REVISTA DE CIÊNCIAS MÉDICAS E BIOLÓGICAS",
    ),
    (
        "LIMA, KÁSSYA FERNANDA FREIRE ; SANTOS, GIRLANE CAROLINE PEREIRA ; SANTANA, MARTA SILVA DE "
        "; CRUZ, PABLO NASCIMENTO ; BARROSO, SUELEN GONÇALVES ; SOARES, FABIANA ALVES ; "
        "SANTOS, JARDEL DA SILVA ; MOURA, MERYHELEN COSTA ; BORGES, TEREZA CRISTINA SILVA ; "
        "OLIVEIRA, BRUNO LUCIANO CARNEIRO ALVES DE . Infecção pela COVID-19, perfil "
        "sociodemográfico e percepções sobre vacinação no Brasil. REVISTA ELETRÔNICA ACERVO EM "
        "SAÚDE, v. 25, p. e19764, 2025.",
        "2178-2091", "REVISTA ELETRÔNICA ACERVO EM SAÚDE",
    ),
    (
        "MARTINS NETO, C. ; OLIVEIRA, B. L. C. A. . Prevalência e fatores associados à discriminação "
        "percebida por adolescentes de uma capital do Nordeste brasileiro. CADERNOS SAÚDE COLETIVA, "
        "v. 2, p. 1-13, 2025.",
        "2358-291X", "CADERNOS SAÚDE COLETIVA",
    ),
    (
        "MENEZES, M. S. A. ; TEIXEIRA, R. G. S. ; LACERDA, E. P. ; VIOLA, P. C. A. F. ; "
        "OLIVEIRA, B. L. C. A. . Padrões alimentares e fatores associados a pessoas idosas "
        "quilombolas: análise com Classes Latentes. REVISTA BRASILEIRA DE GERIATRIA E GERONTOLOGIA, "
        "v. 1, p. 1-12, 2025.",
        "1981-2256", "REVISTA BRASILEIRA DE GERIATRIA E GERONTOLOGIA",
    ),
    (
        "SOARES TEIXEIRA, RENATA GABRIELA ; MOREIRA DA SILVA SOEIRO, VANESSA ; CARNEIRO ALVES DE "
        "OLIVEIRA, BRUNO LUCIANO ; CABRAL JUNIOR, JOÃO DE DEUS ; LEITE OLIVEIRA, LUIS FELIPE ; "
        "CORDEIRO MARTINS, JULIANA ; SANTANA LIMA, ALICE BIANCA . INFORMAÇÕES DE SAÚDE DE CRIANÇAS "
        "DE COMUNIDADES REMANESCENTES QUILOMBOLAS DE BEQUIMÃO - MA. DESAFIOS: REVISTA "
        "INTERDISCIPLINAR DA UNIVERSIDADE FEDERAL DO TOCANTINS, v. 12, p. 1-13, 2025.",
        "2359-3652", "DESAFIOS: REVISTA INTERDISCIPLINAR DA UNIVERSIDADE FEDERAL DO TOCANTINS",
    ),
    (
        "SIMON, S. S. ; CAPPI, C. ; CABRAL JUNIOR, J. D. ; TEIXEIRA, R. G. S. ; ALVES, G. S. ; "
        "OLIVEIRA, B. L. C. A. . The role of social participation in cognitive health in an "
        "underserved older population: Evidence from Afrobrazilian-Quilombola Communities. "
        "INTERNATIONAL PSYCHOGERIATRICS, v. 1, p. 1-9, 2025. Citações:1",
        "1041-6102", "INTERNATIONAL PSYCHOGERIATRICS",
    ),
    (
        "MARINHO, G. L. ; PAZ, E. P. A. ; LUCENA, J. R. M. ; NASCIMENTO, V. F. ; OLIVEIRA, B. L. C. "
        "A. ; TAVARES, F. G. . HOSPITALIZAÇÕES DE CRIANÇAS INDÍGENAS POR CAUSAS SENSÍVEIS À ATENÇÃO "
        "PRIMÁRIA NOS DISTRITOS SANITÁRIOS ESPECIAIS INDÍGENAS. ENFERMAGEM EM FOCO DO COFEN, "
        "v. 1, p. 1-7, 2025.",
        "2357-707x", "ENFERMAGEM EM FOCO DO COFEN",
    ),
    (
        "SILVEIRA, GIOVANNA EVELYN LUNA ; FREITAS, BRUNA BARROSO DE ; OLIVEIRA, RAQUEL ALVES DE ; "
        "ABREU, VICTÓRYA SUÉLLEN MACIEL ; OLIVEIRA, BRUNO LUCIANO CARNEIRO ALVES DE ; "
        "JORGE, HERLA MARIA FURTADO ; PINHEIRO, ANA KARINA BEZERRA ; AQUINO, PRISCILA DE SOUZA . "
        "Predictors of inadequacy of prenatal tests of postpartum women: a cross-sectional study. "
        "REVISTA BRASILEIRA DE ENFERMAGEM, v. 78, p. 1-8, 2025.",
        "0034-7167", "REVISTA BRASILEIRA DE ENFERMAGEM",
    ),
    (
        "DIAS JÚNIOR, JOSÉ DE JESUS ; DOS SANTOS, ALCIONE MIRANDA ; CARNEIRO ALVES DE OLIVEIRA, "
        "BRUNO LUCINANO . Tendências do tempo médio de hospitalização de pacientes adultos "
        "acometidos pela COVID-19, nordeste do Brasil, 2020-2022. REVISTA ELETRÔNICA ACERVO EM "
        "SAÚDE, v. 25, p. e21492-10, 2025.",
        "2178-2091", "REVISTA ELETRÔNICA ACERVO EM SAÚDE",
    ),
    (
        "DA CRUZ ANDRADE, THÁTILA LARISSA ; FERREIRA DE CARVALHO RODRIGUES, EVANDICLEUDE ; "
        "CARVALHO SILVA, LÍSCIA DIVANA ; CARNEIRO ALVES DE OLIVEIRA, BRUNO LUCIANO ; "
        "DE LIMA SARDINHA, ANA HÉLIA ; PORTELA SILVA COUTINHO, NAIR . RODA DE CONVERSA SOBRE "
        "EDUCAÇÃO SEXUAL NO CENÁRIO ESCOLAR: RELATO DE EXPERIÊNCIA. INTERFACES CIENTÍFICAS - "
        "HUMANAS E SOCIAIS, v. 12, p. 485-496, 2025.",
        "2316-3801", "INTERFACES CIENTÍFICAS - HUMANAS E SOCIAIS",
    ),
    (
        "NASCIMENTO CRUZ, PABLO ; LIRA FILHO, RIVALDO ; FERNANDA FREIRE LIMA, KASSYA ; "
        "FRAZÃO LINDOSO, RAYLENE ; COSTA SOEIRO, TERESA ; PINHEIRO ARAÚJO, THAYNARA ; "
        "BRASIL TORRES, JANETE ; LUCIANO CARNEIRO ALVES DE OLIVEIRA, BRUNO ; "
        "SANTOS NETO, MARCELINO ; PEREIRA COSTA RABELO, POLIANA . INTERVENÇÕES NA ASSISTÊNCIA AO "
        "PARTO POR RESIDENTES DE ENFERMAGEM DE UMA MATERNIDADE NORDESTINA: ESTUDO TRANSVERSAL. "
        "REVISTA ENFERMAGEM ATUAL IN DERME, v. 99, p. e025136-15, 2025.",
        "2447-2034", "REVISTA ENFERMAGEM ATUAL IN DERME",
    ),
    (
        "SIMON, SHARON SANZ ; CAPPI, CAROLINA ; JUNIOR, JOÃO DE DEUS CABRAL ; ALVES, GILBERTO "
        "SOUSA ; DE OLIVEIRA, BRUNO LUCIANO CARNEIRO ALVES . Social Engagement is associated with "
        "better cognition in Quilombola Communities: Insights for Engaging underserved Brazilian "
        "Populations in Alzheimer?s Disease Research. Alzheimers & Dementia, v. 20, p. 1-1, 2025.",
        "1552-5260", "Alzheimers & Dementia",
    ),
]


# ─── Casos extras (4 bugs originais) ────────────────────────────────
EXTRA_CASES = [
    {
        "id": "EX1-SimulationSubtitulo",
        "text": (
            "COLONHESE, MILENA ; LIMA, SARA F. ; NEGRI, ELAINE C. ; GIRÃO, FERNANDA B. ; "
            "GIOVANAZZI, ROSIMEIRE S.D. ; PEREIRA JÚNIOR, GERSON A. . Cost Analysis of the OSCE: "
            "Scoping Review. Simulation In Healthcare-Journal Of The Society For Simulation In "
            "Healthcare, v. 20, p. 1-14, 2026."
        ),
        "expected_issn": "1559-713X",
        "expected_journal": "SIMULATION IN HEALTHCARE",
        "expect_not_issn": None,
    },
    {
        "id": "EX2-AnoComposta",
        "text": (
            "SANTOS, MARCOS MACIEL CANDIDO JUSTINO DOS ; LIMA, SARA FITERMAN ; VIEIRA, CARINE "
            "FREITAS GALVÃO ; SLULLITEL, ALEXANDRE ; SANTOS, ELAINE CRISTINA NEGRI ; PEREIRA "
            "JÚNIOR, GERSON ALVES . In situ simulation and its different applications in "
            "healthcare: an integrative review. REVISTA BRASILEIRA DE EDUCAÇÃO MÉDICA (ONLINE), "
            "v. 47, p. 1/ e135, 2023-12, 2023."
        ),
        # Sem expected_issn específico — valida ano 2023 e não captura "1/ e135" como ISSN
        "expect_valid_year": 2023,
        "expect_no_bad_issn": True,
    },
    {
        "id": "EX3-CadernosNutricaoNaoDeveVencer",
        "text": (
            "MOREIRA, JACQUELINE DUTRA NASCIMENTO ; LAMY, ZENI CARVALHO ; ROCHA, HORTÊNSIA "
            "COUTINHO DA ; ALBUQUERQUE, YANCA LACERDA ; LIMA, SARA FITERMAN . Desafios da atuação "
            "profissional durante a implantação de cuidados paliativos em pediatria: estudo "
            "qualitativo. CADERNOS SAÚDE COLETIVA, v. 33, p. 1-11, 2025."
        ),
        "expected_issn": "2358-291X",
        "expect_not_issn": "0103-9946",  # Não deve ser "Cadernos de Saúde Coletiva E Nutrição"
    },
    {
        "id": "EX4-EnfermagemIntegradaNaoDeveVencer",
        "text": (
            "DINIZ, SHIRLEY PRISCILA MARTINS CHAGAS DINIZ ; MELO PEREIRA, DÉBORA LORENA ; "
            "CARDOSO DE AQUINO, DORLENE MARIA ; CARNEIRO ALVES DE OLIVEIRA, BRUNO LUCIANO ; "
            "PEREIRA COSTA RABELO, POLIANA ; TAVARES PALMEIRA ROLIM, ISAURA LETICIA . IMPACTO DA "
            "COVID-19 NA ASSISTÊNCIA ÀS PESSOAS ACOMETIDAS PELA HANSENÍASE. REVISTA ENFERMAGEM "
            "ATUAL IN DERME, v. 97, p. e023078-8, 2023."
        ),
        "expected_issn": "2447-2034",
        "expect_not_issn": "1984-7602",  # Não deve ser "Revista Enfermagem Integrada"
    },
]


def _norm_for_compare(s: str) -> str:
    return enricher._normalize_text(s)


@pytest.mark.parametrize("text, expected_issn, expected_journal", CV_ARTICLES, ids=lambda a: a if isinstance(a, str) and len(a) < 20 else "")
def test_match_regression(text, expected_issn, expected_journal):
    """Cada linha do CV deve retornar ISSN esperado com confidence=high."""
    parsed = enricher.parse_single_article(text)
    result = enricher.match_journal(parsed["journal"])

    assert (result["issn"] or "").upper() == expected_issn.upper(), (
        f"Esperado {expected_issn}, obtido {result['issn']} (stage={result['stage']}, "
        f"score={result['score']:.4f}, journal_parsed='{parsed['journal']}')"
    )
    assert _norm_for_compare(parsed["journal"]) == _norm_for_compare(expected_journal), (
        f"Journal parseado diverge: '{parsed['journal']}' vs '{expected_journal}'"
    )
    assert result["confidence"] == "high" or result["stage"] == "issn-extracted", (
        f"Confidence={result['confidence']}, stage={result['stage']} — esperado alta"
    )


def test_extras():
    """4 casos que reproduzem os bugs reportados pelo usuário originalmente."""
    for case in EXTRA_CASES:
        cid = case["id"]
        parsed = enricher.parse_single_article(case["text"])

        if case.get("expected_issn"):
            result = enricher.match_journal(parsed["journal"])
            assert result["issn"] == case["expected_issn"], (
                f"{cid}: esperado {case['expected_issn']}, obtido {result['issn']} (stage={result['stage']})"
            )

        if case.get("expect_not_issn"):
            # Resultado NÃO pode ser o ISSN errado atual (chama match se ainda sem expected_issn)
            result = enricher.match_journal(parsed["journal"])
            assert result["issn"] != case["expect_not_issn"], (
                f"{cid}: obteve exatamente o ISSN errado ({case['expect_not_issn']})"
            )

        if case.get("expect_valid_year"):
            assert parsed["year"] == case["expect_valid_year"], (
                f"{cid}: ano esperado {case['expect_valid_year']}, obtido {parsed['year']}"
            )

        if case.get("expect_no_bad_issn"):
            assert parsed["extractedIssn"] is None, (
                f"{cid}: capturou ISSN inválido do texto: {parsed['extractedIssn']}"
            )


def test_alias_lookup_direct():
    """Alias server-side deve resolver antes do match exato pela base."""
    # ALZHEIMERS & DEMENTIA está em aliases.json → 1552-5260
    result = enricher.match_journal("ALZHEIMERS & DEMENTIA")
    assert result["issn"] == "1552-5260"
    assert result["stage"] == "alias"


def test_extraction_literal_issn():
    """ISSN literal no corpo do texto deve ter precedência sobre fuzzy."""
    # Texto do artigo continha "1678-4561" — hoje capturado por parse_single_article.
    text = (
        "SILVA, JOÃO ; COSTA, MARIA . Estudo sobre ISSN literal. "
        "Ciência & Saúde Coletiva (ISSN 1678-4561), v. 30, p. 1-10, 2025."
    )
    parsed = enricher.parse_single_article(text)
    assert parsed["extractedIssn"] == "1678-4561"


def test_subtitulo_simulation_healthcare():
    """Devem retornar apenas 'Simulation in Healthcare', não o hífen-título longo."""
    parsed = enricher.parse_single_article(
        "SIMON, S. . Teste. Simulation In Healthcare-Journal Of The Society For Simulation In "
        "Healthcare, v. 20, p. 1-14, 2026."
    )
    assert parsed["journal"] == "Simulation In Healthcare"
    assert parsed["journalRaw"] == "Simulation In Healthcare-Journal Of The Society For Simulation In Healthcare"


def test_consigo_distinguir_cadernos_saude_coletiva_de_nutricao():
    """Variante problemática: query sem E não deve vencer título com E."""
    result_a = enricher.match_journal("CADERNOS SAÚDE COLETIVA")
    assert result_a["issn"] == "2358-291X"  # correto, não o 0103-9946 com "E NUTRIÇÃO"
    result_b = enricher.match_journal("CADERNOS DE SAÚDE COLETIVA")
    assert result_b["issn"] == "2358-291X"