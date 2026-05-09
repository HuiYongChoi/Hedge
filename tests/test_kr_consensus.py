"""Tests for kr_consensus package — all HTTP calls are mocked via fixtures."""
from __future__ import annotations

from datetime import date
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


# ---------------------------------------------------------------------------
# annualized_split
# ---------------------------------------------------------------------------

class TestAnnualizedSplit:
    def test_full_year_no_actuals(self):
        from src.tools.kr_consensus.annualized_split import split_annual_to_next_quarter

        result = split_annual_to_next_quarter(
            annual_eps=100_000,
            realized_quarters_in_year=[],
            as_of=date(2026, 1, 15),
            fiscal_year=2026,
        )
        assert result is not None
        eps, remaining = result
        assert remaining == 4
        assert eps == pytest.approx(25_000)

    def test_one_quarter_realized(self):
        from src.tools.kr_consensus.annualized_split import split_annual_to_next_quarter

        result = split_annual_to_next_quarter(
            annual_eps=100_000,
            realized_quarters_in_year=[30_000],
            as_of=date(2026, 4, 30),
            fiscal_year=2026,
        )
        assert result is not None
        eps, remaining = result
        assert remaining == 3
        assert eps == pytest.approx(70_000 / 3)

    def test_three_quarters_realized_standard_case(self):
        """Design doc example: annual=100_000, realized=70_000, remaining=1 → 30_000."""
        from src.tools.kr_consensus.annualized_split import split_annual_to_next_quarter

        result = split_annual_to_next_quarter(
            annual_eps=100_000,
            realized_quarters_in_year=[20_000, 25_000, 25_000],
            as_of=date(2026, 10, 1),
            fiscal_year=2026,
        )
        assert result is not None
        eps, remaining = result
        assert remaining == 1
        assert eps == pytest.approx(30_000)

    def test_all_quarters_realized_returns_none(self):
        from src.tools.kr_consensus.annualized_split import split_annual_to_next_quarter

        result = split_annual_to_next_quarter(
            annual_eps=100_000,
            realized_quarters_in_year=[25_000, 25_000, 25_000, 25_000],
            as_of=date(2026, 12, 31),
            fiscal_year=2026,
        )
        assert result is None

    def test_next_quarter_end_helper(self):
        from src.tools.kr_consensus.annualized_split import next_quarter_end

        assert next_quarter_end(2026, []) == date(2026, 3, 31)
        assert next_quarter_end(2026, [1]) == date(2026, 6, 30)
        assert next_quarter_end(2026, [1, 2]) == date(2026, 9, 30)
        assert next_quarter_end(2026, [1, 2, 3]) == date(2026, 12, 31)
        assert next_quarter_end(2026, [1, 2, 3, 4]) is None


# ---------------------------------------------------------------------------
# NaverConsensusProvider — uses HTML fixture, no real HTTP
# ---------------------------------------------------------------------------

class TestNaverConsensusProvider:
    def _provider(self):
        from src.tools.kr_consensus.naver_finance import NaverConsensusProvider
        return NaverConsensusProvider()

    def _fixture_html(self) -> str:
        return (FIXTURES / "naver_finance_000660.html").read_text(encoding="utf-8")

    def test_extracts_next_quarter_eps_from_fixture(self, monkeypatch):
        provider = self._provider()
        html = self._fixture_html()

        from src.tools.kr_consensus import naver_finance
        monkeypatch.setattr(naver_finance, "_fetch_html", lambda url: html)

        results = provider.fetch_quarterly_eps_estimates(
            "000660.KS", as_of_date=date(2026, 1, 31), num_quarters=4
        )

        assert len(results) >= 1
        # All returned quarters should be future (after as_of)
        for q in results:
            assert q.fiscal_period_end > date(2026, 1, 31)
        # source should be consensus
        assert all(q.source == "consensus" for q in results)
        assert all(q.provider == "NaverFinance" for q in results)

    def test_first_estimate_is_2026Q1(self, monkeypatch):
        provider = self._provider()
        html = self._fixture_html()

        from src.tools.kr_consensus import naver_finance
        monkeypatch.setattr(naver_finance, "_fetch_html", lambda url: html)

        results = provider.fetch_quarterly_eps_estimates(
            "000660.KS", as_of_date=date(2026, 1, 31), num_quarters=1
        )

        assert len(results) == 1
        q = results[0]
        assert q.fiscal_period_end == date(2026, 3, 31)
        assert q.eps == pytest.approx(12_500)
        assert q.period == "2026Q1"

    def test_returns_empty_on_fetch_failure(self, monkeypatch):
        provider = self._provider()

        from src.tools.kr_consensus import naver_finance
        monkeypatch.setattr(naver_finance, "_fetch_html", lambda url: None)

        results = provider.fetch_quarterly_eps_estimates("000660.KS", as_of_date=date(2026, 1, 31))
        assert results == []

    def test_non_korean_ticker_returns_empty(self, monkeypatch):
        provider = self._provider()
        # AAPL has no 6-digit Korean code
        results = provider.fetch_quarterly_eps_estimates("AAPL", as_of_date=date(2026, 1, 31))
        assert results == []

    def test_does_not_propagate_parse_exceptions(self, monkeypatch):
        provider = self._provider()

        from src.tools.kr_consensus import naver_finance
        monkeypatch.setattr(naver_finance, "_fetch_html", lambda url: "<html><body>garbage</body></html>")

        # Should not raise, just return empty
        results = provider.fetch_quarterly_eps_estimates("000660.KS", as_of_date=date(2026, 1, 31))
        assert isinstance(results, list)


# ---------------------------------------------------------------------------
# WiseReportProvider — uses HTML fixture
# ---------------------------------------------------------------------------

class TestWiseReportProvider:
    def _provider(self):
        from src.tools.kr_consensus.wise_report import WiseReportProvider
        return WiseReportProvider()

    def _fixture_html(self) -> str:
        return (FIXTURES / "comp_fnguide_A000660.html").read_text(encoding="utf-8")

    def test_extracts_estimates_from_fixture(self, monkeypatch):
        provider = self._provider()
        html = self._fixture_html()

        from src.tools.kr_consensus import wise_report
        monkeypatch.setattr(wise_report, "_fetch_html", lambda url: html)

        results = provider.fetch_quarterly_eps_estimates(
            "000660.KS", as_of_date=date(2026, 1, 31), num_quarters=4
        )

        assert len(results) >= 1
        for q in results:
            assert q.fiscal_period_end > date(2026, 1, 31)
            assert q.source == "consensus"

    def test_returns_empty_on_fetch_failure(self, monkeypatch):
        provider = self._provider()

        from src.tools.kr_consensus import wise_report
        monkeypatch.setattr(wise_report, "_fetch_html", lambda url: None)

        results = provider.fetch_quarterly_eps_estimates("000660.KS", as_of_date=date(2026, 1, 31))
        assert results == []


# ---------------------------------------------------------------------------
# HankyungMetaProvider — stub, always returns empty
# ---------------------------------------------------------------------------

class TestHankyungMetaProvider:
    def test_returns_empty(self):
        from src.tools.kr_consensus.hankyung import HankyungMetaProvider

        provider = HankyungMetaProvider()
        results = provider.fetch_quarterly_eps_estimates("000660.KS", as_of_date=date(2026, 1, 31))
        assert results == []

    def test_does_not_raise(self):
        from src.tools.kr_consensus.hankyung import HankyungMetaProvider

        provider = HankyungMetaProvider()
        # Should not raise for any ticker
        assert provider.fetch_quarterly_eps_estimates("AAPL", as_of_date=date(2026, 1, 31)) == []
