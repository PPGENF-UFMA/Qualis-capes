from api import orcid_client


def test_normalize_orcid_accepts_plain_and_url():
    expected = "0000-0002-1825-0097"

    assert orcid_client.normalize_orcid("0000000218250097") == expected
    assert orcid_client.normalize_orcid("https://orcid.org/0000-0002-1825-0097") == expected


def test_normalize_orcid_rejects_bad_checksum():
    assert orcid_client.normalize_orcid("0000-0002-1825-0098") == ""
    assert orcid_client.normalize_orcid("not an orcid") == ""


def test_extract_work_summaries_uses_doi_issn_journal_and_year():
    payload = {
        "group": [
            {
                "work-summary": [
                    {
                        "put-code": 123,
                        "type": "journal-article",
                        "title": {"title": {"value": "Article title"}},
                        "journal-title": {"value": "Journal Name"},
                        "publication-date": {"year": {"value": "2024"}},
                        "external-ids": {
                            "external-id": [
                                {"external-id-type": "doi", "external-id-value": "https://doi.org/10.1234/abc"},
                                {"external-id-type": "issn", "external-id-value": "0034-7167"},
                            ]
                        },
                    }
                ]
            }
        ]
    }

    works = orcid_client._extract_work_summaries(payload)

    assert works == [
        {
            "title": "Article title",
            "journal": "Journal Name",
            "year": 2024,
            "doi": "10.1234/abc",
            "issn": "0034-7167",
            "type": "journal-article",
            "put_code": 123,
            "url": "",
        }
    ]


def test_crossref_date_parts_year_prefers_publication_dates():
    message = {
        "issued": {"date-parts": [[2022]]},
        "published-online": {"date-parts": [[2023, 5, 1]]},
    }

    assert orcid_client._date_parts_year(message) == 2023
