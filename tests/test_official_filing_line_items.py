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


def test_sec_companyfacts_builds_ttm_fcf_from_cumulative_cash_flow_and_q1_frame():
    facts = {
        "facts": {
            "us-gaap": {
                "NetCashProvidedByUsedInOperatingActivities": {
                    "units": {
                        "USD": [
                            {"end": "2025-05-29", "fy": 2025, "fp": "Q3", "form": "10-Q", "filed": "2025-06-26", "frame": None, "val": 11_795_000_000},
                            {"end": "2025-08-28", "fy": 2025, "fp": "FY", "form": "10-K", "filed": "2025-10-03", "frame": "CY2025", "val": 17_525_000_000},
                            {"end": "2024-11-28", "start": "2024-08-30", "fy": 2026, "fp": "Q1", "form": "10-Q", "filed": "2025-12-18", "frame": "CY2024Q4", "val": 3_244_000_000},
                            {"end": "2025-02-27", "start": "2024-08-30", "fy": 2026, "fp": "Q2", "form": "10-Q", "filed": "2026-03-19", "frame": None, "val": 7_186_000_000},
                            {"end": "2025-05-29", "start": "2024-08-30", "fy": 2026, "fp": "Q3", "form": "10-Q", "filed": "2026-06-25", "frame": None, "val": 11_795_000_000},
                            {"end": "2025-11-27", "start": "2025-08-29", "fy": 2026, "fp": "Q1", "form": "10-Q", "filed": "2025-12-18", "frame": "CY2025Q4", "val": 8_411_000_000},
                            {"end": "2026-02-26", "start": "2025-08-29", "fy": 2026, "fp": "Q2", "form": "10-Q", "filed": "2026-03-19", "frame": None, "val": 20_314_000_000},
                            {"end": "2026-05-28", "start": "2025-08-29", "fy": 2026, "fp": "Q3", "form": "10-Q", "filed": "2026-06-25", "frame": None, "val": 45_702_000_000},
                        ]
                    }
                },
                "PaymentsToAcquirePropertyPlantAndEquipment": {
                    "units": {
                        "USD": [
                            {"end": "2025-05-29", "fy": 2025, "fp": "Q3", "form": "10-Q", "filed": "2025-06-26", "frame": None, "val": 10_199_000_000},
                            {"end": "2025-08-28", "fy": 2025, "fp": "FY", "form": "10-K", "filed": "2025-10-03", "frame": "CY2025", "val": 15_857_000_000},
                            {"end": "2024-11-28", "start": "2024-08-30", "fy": 2026, "fp": "Q1", "form": "10-Q", "filed": "2025-12-18", "frame": "CY2024Q4", "val": 3_206_000_000},
                            {"end": "2025-02-27", "start": "2024-08-30", "fy": 2026, "fp": "Q2", "form": "10-Q", "filed": "2026-03-19", "frame": None, "val": 7_261_000_000},
                            {"end": "2025-05-29", "start": "2024-08-30", "fy": 2026, "fp": "Q3", "form": "10-Q", "filed": "2026-06-25", "frame": None, "val": 10_199_000_000},
                            {"end": "2025-11-27", "start": "2025-08-29", "fy": 2026, "fp": "Q1", "form": "10-Q", "filed": "2025-12-18", "frame": "CY2025Q4", "val": 5_389_000_000},
                            {"end": "2026-02-26", "start": "2025-08-29", "fy": 2026, "fp": "Q2", "form": "10-Q", "filed": "2026-03-19", "frame": None, "val": 11_776_000_000},
                            {"end": "2026-05-28", "start": "2025-08-29", "fy": 2026, "fp": "Q3", "form": "10-Q", "filed": "2026-06-25", "frame": None, "val": 19_602_000_000},
                        ]
                    }
                },
            }
        }
    }

    rows = _extract_sec_line_items_from_companyfacts(
        "MU",
        facts,
        ["operating_cash_flow", "capital_expenditure", "free_cash_flow"],
        "2026-06-25",
        "ttm",
        1,
    )

    assert rows[0].report_period == "2026-05-28"
    assert rows[0].operating_cash_flow == 51_432_000_000
    assert rows[0].capital_expenditure == 25_260_000_000
    assert rows[0].free_cash_flow == 26_172_000_000
