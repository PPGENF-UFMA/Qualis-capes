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


if __name__ == "__main__":
    unittest.main()
