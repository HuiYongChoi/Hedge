import math

import pytest

pytest.importorskip("pydantic")

from src.tools.api import _extract_sec_line_items_from_companyfacts
from src.utils.data_standardizer import enrich_metrics_from_line_items


def test_sec_companyfacts_prefers_framed_quarter_values_over_ytd_values():
    facts = {
        "facts": {
            "us-gaap": {
                "RevenueFromContractWithCustomerExcludingAssessedTax": {
                    "units": {
                        "USD": [
                            {"end": "2026-05-28", "fy": 2026, "fp": "Q3", "form": "10-Q", "filed": "2026-06-25", "frame": None, "val": 78_959_000_000},
                            {"end": "2026-05-28", "fy": 2026, "fp": "Q3", "form": "10-Q", "filed": "2026-06-25", "frame": "CY2026Q2", "val": 41_456_000_000},
                            {"end": "2026-02-26", "fy": 2026, "fp": "Q2", "form": "10-Q", "filed": "2026-03-19", "frame": "CY2026Q1", "val": 23_860_000_000},
                        ]
                    }
                },
                "OperatingIncomeLoss": {
                    "units": {
                        "USD": [
                            {"end": "2026-05-28", "fy": 2026, "fp": "Q3", "form": "10-Q", "filed": "2026-06-25", "frame": None, "val": 55_589_000_000},
                            {"end": "2026-05-28", "fy": 2026, "fp": "Q3", "form": "10-Q", "filed": "2026-06-25", "frame": "CY2026Q2", "val": 33_318_000_000},
                            {"end": "2026-02-26", "fy": 2026, "fp": "Q2", "form": "10-Q", "filed": "2026-03-19", "frame": "CY2026Q1", "val": 16_135_000_000},
                        ]
                    }
                },
                "NetIncomeLoss": {
                    "units": {
                        "USD": [
                            {"end": "2026-05-28", "fy": 2026, "fp": "Q3", "form": "10-Q", "filed": "2026-06-25", "frame": "CY2026Q2", "val": 28_243_000_000},
                            {"end": "2026-02-26", "fy": 2026, "fp": "Q2", "form": "10-Q", "filed": "2026-03-19", "frame": "CY2026Q1", "val": 13_785_000_000},
                        ]
                    }
                },
            }
        }
    }

    rows = _extract_sec_line_items_from_companyfacts(
        "MU",
        facts,
        ["revenue", "operating_income", "operating_margin", "net_income", "net_margin"],
        "2026-06-25",
        "quarter",
        4,
    )

    assert rows[0].report_period == "2026-05-28"
    assert rows[0].source == "SEC Companyfacts"
    assert rows[0].revenue == 41_456_000_000
    assert rows[0].operating_income == 33_318_000_000
    assert math.isclose(rows[0].operating_margin, 33_318_000_000 / 41_456_000_000)


def test_enrichment_can_prefer_newer_official_line_items_over_stale_metrics():
    stale_metrics = {
        "ticker": "MU",
        "report_period": "2026-02-28",
        "period": "ttm",
        "currency": "USD",
        "source": "Alpha Vantage",
        "revenue": 58_119_000_000,
        "operating_income": 28_133_000_000,
        "operating_margin": 0.676,
    }
    official_line_items = [
        {
            "ticker": "MU",
            "report_period": "2026-05-28",
            "period": "ttm",
            "currency": "USD",
            "source": "SEC Companyfacts",
            "revenue": 75_316_000_000,
            "operating_income": 55_589_000_000,
            "operating_margin": 55_589_000_000 / 75_316_000_000,
        }
    ]

    enriched = enrich_metrics_from_line_items(stale_metrics, official_line_items, prefer_line_items=True)

    assert enriched["source"] == "SEC Companyfacts"
    assert enriched["report_period"] == "2026-05-28"
    assert enriched["revenue"] == 75_316_000_000
    assert math.isclose(enriched["operating_margin"], 55_589_000_000 / 75_316_000_000)
