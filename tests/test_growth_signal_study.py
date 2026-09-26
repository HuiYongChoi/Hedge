"""성장주 신호 검증 스크립트의 계산(scripts/research/growth_signal_study.py)."""

import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "growth_signal_study", Path(__file__).resolve().parents[1] / "scripts/research/growth_signal_study.py"
)
study = importlib.util.module_from_spec(spec)
spec.loader.exec_module(study)


def test_reverse_dcf_recovers_the_growth_it_was_built_with():
    for g in (-0.05, 0.08, 0.25):
        assert study.implied_growth(100.0, study.dcf_value(100.0, g)) == pytest.approx(g, abs=1e-6)
    assert study.implied_growth(-1.0, 1000.0) is None


def test_spearman_and_cagr():
    assert study.spearman(list(range(10)), list(range(10))) == pytest.approx(1.0)
    assert study.spearman(list(range(10)), list(range(10))[::-1]) == pytest.approx(-1.0)
    assert study.revenue_cagr({"2020-12-31": 100.0, "2023-12-31": 172.8}) == pytest.approx(0.2)


def test_study_dates_only_include_years_with_a_full_12_months():
    from datetime import date

    days = study.study_dates(date(2026, 9, 26))
    assert days[0] == date(2016, 4, 15) and days[-1] == date(2025, 4, 15)
