import unittest
from .engine import classify_journal


class TestQualisEngine(unittest.TestCase):

    # === CENÁRIOS DE ENFERMAGEM ===

    def test_enfermagem_a1_jcr(self):
        journal = {"area": "Enfermagem", "jcr": 1.8, "citeScore": None, "indexers": []}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A1")

    def test_enfermagem_a1_citescore(self):
        journal = {"area": "Enfermagem", "jcr": None, "citeScore": 2.9, "indexers": []}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A1")

    def test_enfermagem_a2_jcr(self):
        journal = {"area": "Enfermagem", "jcr": 1.5, "citeScore": None, "indexers": []}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A2")

    def test_enfermagem_a2_citescore(self):
        journal = {"area": "Enfermagem", "jcr": None, "citeScore": 2.2, "indexers": []}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A2")

    def test_enfermagem_a3_jcr(self):
        journal = {"area": "Enfermagem", "jcr": 0.8, "citeScore": None, "indexers": []}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A3")

    def test_enfermagem_a3_citescore(self):
        journal = {"area": "Enfermagem", "jcr": None, "citeScore": 1.2, "indexers": []}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A3")

    def test_enfermagem_a3_medline(self):
        journal = {"area": "Enfermagem", "jcr": None, "citeScore": None, "indexers": ["MEDLINE"]}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A3")

    def test_enfermagem_a4_jcr(self):
        journal = {"area": "Enfermagem", "jcr": 0.3, "citeScore": None, "indexers": []}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A4")

    def test_enfermagem_a4_citescore(self):
        journal = {"area": "Enfermagem", "jcr": None, "citeScore": 0.4, "indexers": []}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A4")

    def test_enfermagem_a4_scielo(self):
        journal = {"area": "Enfermagem", "jcr": None, "citeScore": None, "indexers": ["SCIELO"]}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A4")

    def test_enfermagem_a4_revenf(self):
        journal = {"area": "Enfermagem", "jcr": None, "citeScore": None, "indexers": ["RevEnf"]}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A4")

    def test_enfermagem_a5_lilacs(self):
        journal = {"area": "Enfermagem", "jcr": None, "citeScore": None, "indexers": ["LILACS"]}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A5")

    def test_enfermagem_a5_bdenf(self):
        journal = {"area": "Enfermagem", "jcr": None, "citeScore": None, "indexers": ["BDENF"]}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A5")

    def test_enfermagem_a6_cuiden(self):
        journal = {"area": "Enfermagem", "jcr": None, "citeScore": None, "indexers": ["RIC/CUIDEN"], "metrics": {"cuiden": 1.5}}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A6")

    def test_enfermagem_a7_cuiden_low(self):
        journal = {"area": "Enfermagem", "jcr": None, "citeScore": None, "indexers": ["RIC/CUIDEN"], "metrics": {"cuiden": 1.4}}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A7")

    def test_enfermagem_a7_cinahl(self):
        journal = {"area": "Enfermagem", "jcr": None, "citeScore": None, "indexers": ["CINAHL"]}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A7")

    def test_enfermagem_a8_latindex(self):
        journal = {"area": "Enfermagem", "jcr": None, "citeScore": None, "indexers": ["Latindex"]}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A8")

    def test_enfermagem_nc(self):
        journal = {"area": "Enfermagem", "jcr": None, "citeScore": None, "indexers": []}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "NC")

    # === CENÁRIOS DE OUTRAS ÁREAS ===

    def test_outras_a1_jcr(self):
        journal = {"area": "Outras Áreas", "jcr": 5.2, "citeScore": None, "indexers": []}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A1")

    def test_outras_a1_citescore(self):
        journal = {"area": "Outras Áreas", "jcr": None, "citeScore": 5.0, "indexers": []}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A1")

    def test_outras_a2_jcr(self):
        journal = {"area": "Outras Áreas", "jcr": 4.5, "citeScore": None, "indexers": []}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A2")

    def test_outras_a3_jcr(self):
        journal = {"area": "Outras Áreas", "jcr": 3.2, "citeScore": None, "indexers": []}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A3")

    def test_outras_a4_jcr(self):
        journal = {"area": "Outras Áreas", "jcr": 2.0, "citeScore": None, "indexers": []}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A4")

    def test_outras_a5_jcr(self):
        journal = {"area": "Outras Áreas", "jcr": 1.1, "citeScore": None, "indexers": []}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A5")

    def test_outras_a5_medline(self):
        journal = {"area": "Outras Áreas", "jcr": None, "citeScore": None, "indexers": ["MEDLINE"]}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A5")

    def test_outras_a6_jcr(self):
        journal = {"area": "Outras Áreas", "jcr": 0.5, "citeScore": None, "indexers": []}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A6")

    def test_outras_a6_scielo(self):
        journal = {"area": "Outras Áreas", "jcr": None, "citeScore": None, "indexers": ["SCIELO"]}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A6")

    def test_outras_a7_lilacs(self):
        journal = {"area": "Outras Áreas", "jcr": None, "citeScore": None, "indexers": ["LILACS"]}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A7")

    def test_outras_a8_latindex(self):
        journal = {"area": "Outras Áreas", "jcr": None, "citeScore": None, "indexers": ["Latindex"]}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A8")

    def test_outras_nc(self):
        journal = {"area": "Outras Áreas", "jcr": None, "citeScore": None, "indexers": []}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "NC")

    # === CENÁRIOS RC-8: REGRA DO MELHOR CASO (JCR vs CiteScore) ===

    def test_rc8_enfermagem_citescore_melhor_que_jcr(self):
        """Bug RC-8: JCR=0.7 (A3) mas CiteScore=2.5 (A2) → deve retornar A2."""
        journal = {"area": "Enfermagem", "jcr": 0.7, "citeScore": 2.5, "indexers": []}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A2")
        self.assertIn("CiteScore", result["justification"])

    def test_rc8_enfermagem_jcr_melhor_que_citescore(self):
        """JCR=1.9 (A1) e CiteScore=2.0 (A2) → deve retornar A1."""
        journal = {"area": "Enfermagem", "jcr": 1.9, "citeScore": 2.0, "indexers": []}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A1")
        self.assertIn("JCR", result["justification"])

    def test_rc8_outras_citescore_melhor_que_jcr(self):
        """Outras: JCR=2.5 (A4) mas CiteScore=5.0 (A1) → deve retornar A1."""
        journal = {"area": "Outras Áreas", "jcr": 2.5, "citeScore": 5.0, "indexers": []}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A1")
        self.assertIn("CiteScore", result["justification"])

    def test_rc8_enfermagem_indexer_melhor_que_metricas(self):
        """Enfermagem: JCR=0.3 (A4), CiteScore=0.4 (A4), MEDLINE (A3) → A3."""
        journal = {"area": "Enfermagem", "jcr": 0.3, "citeScore": 0.4, "indexers": ["MEDLINE"]}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A3")

    def test_rc8_enfermagem_multiple_indexers_melhor(self):
        """Enfermagem: LILACS (A5), SCIELO (A4) → deve retornar A4."""
        journal = {"area": "Enfermagem", "jcr": None, "citeScore": None, "indexers": ["LILACS", "SCIELO"]}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A4")

    def test_rc8_enfermagem_cuiden_high_plus_latindex(self):
        """Enfermagem: CUIDEN=2.0 (A6), LATINDEX (A8) → deve retornar A6."""
        journal = {"area": "Enfermagem", "jcr": None, "citeScore": None,
                   "indexers": ["RIC/CUIDEN", "LATINDEX"], "metrics": {"cuiden": 2.0}}
        result = classify_journal(journal)
        self.assertEqual(result["estrato"], "A6")

    def test_none_journal(self):
        result = classify_journal(None)
        self.assertEqual(result["estrato"], "NC")

    def test_empty_journal(self):
        result = classify_journal({})
        self.assertEqual(result["estrato"], "NC")


if __name__ == "__main__":
    unittest.main()
