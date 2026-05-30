from types import SimpleNamespace

from src.data.models import FinancialMetrics, LineItem


def _forward_metrics(**overrides):
    base = {
        "canonical_forward_pe": 5.2,
        "forward_pe": 5.2,
        "forward_eps_ttm": 372_361.0,
        "canonical_forward_eps": 372_361.0,
        "forward_eps_fy0": 295_507.0,
        "forward_pe_fy0": 6.6,
        "confidence": "medium",
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _target(**overrides):
    base = {
        "consensus": 2_243_600.0,
        "high": 4_000_000.0,
        "low": 1_630_000.0,
        "median": 2_100_000.0,
        "analyst_count": 20,
        "current_price": 1_940_000.0,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def test_rerating_thesis_rewards_forward_eps_inflection_and_broker_bridge():
    from src.agents.semiconductor_rerating import build_semiconductor_rerating_thesis

    metrics = FinancialMetrics(
        ticker="000660.KS",
        report_period="2026-03-31",
        period="ttm",
        currency="KRW",
        market_cap=1_377_118_583_783_424.0,
        price_to_earnings_ratio=29.6,
        price_to_book_ratio=3.5,
        book_value_per_share=557_471.0,
        revenue_growth=0.46,
        earnings_growth=0.80,
        earnings_per_share_growth=0.95,
        free_cash_flow_growth=0.86,
        operating_margin=0.44,
        gross_margin=0.58,
        return_on_invested_capital=0.45,
        debt_to_equity=0.35,
        interest_coverage=18.0,
        outstanding_shares=710_000_000.0,
    )
    line_items = [
        LineItem(
            ticker="000660.KS",
            report_period="2026-03-31",
            period="ttm",
            currency="KRW",
            revenue=90_000_000_000_000.0,
            capital_expenditure=-24_000_000_000_000.0,
            free_cash_flow=25_000_000_000_000.0,
            operating_income=40_000_000_000_000.0,
            outstanding_shares=710_000_000.0,
        )
    ]
    pbr_band = {
        "fair_price_p50": 1_372_169.0,
        "fair_price_p75": 1_760_000.0,
        "fair_price_p90": 2_096_204.0,
        "current_price": 1_940_000.0,
        "current_pbr": 3.5,
        "percentiles": {"p10": 1.9, "p50": 2.4, "p75": 3.1, "p90": 3.7},
        "position_label": "upper_band",
        "rerating_note": "HBM/구조적 성장 — 상단 밴드 +25% 확장 고려",
    }

    thesis = build_semiconductor_rerating_thesis(
        ticker="000660.KS",
        company_name="SK하이닉스",
        metrics=metrics,
        line_items=line_items,
        forward_metrics=_forward_metrics(),
        analyst_target=_target(),
        pbr_band=pbr_band,
    )

    assert thesis["applicable"] is True
    assert thesis["signal"] == "bullish"
    assert thesis["rerating_probability"] >= 0.60
    assert thesis["expected_price"] > thesis["current_price"]
    assert thesis["expected_return"] > 0
    assert thesis["axis_scores"]["forward_earnings_inflection"] >= 0.80
    assert thesis["forward_interpretation"] == "earnings_expansion"
    assert "선행 PER" in thesis["summary"]
    assert "이익 확장" in thesis["summary"]
    assert "valuation_analyst" in thesis["recommended_agent_mix"]
    assert "growth_analyst" in thesis["recommended_agent_mix"]
    assert "stanley_druckenmiller" in thesis["recommended_agent_mix"]


def test_rerating_thesis_penalizes_forward_pe_above_ttm_and_weak_targets():
    from src.agents.semiconductor_rerating import build_semiconductor_rerating_thesis

    metrics = FinancialMetrics(
        ticker="MU",
        report_period="2026-03-31",
        period="ttm",
        currency="USD",
        market_cap=100_000_000_000.0,
        price_to_earnings_ratio=12.0,
        price_to_book_ratio=4.5,
        book_value_per_share=30.0,
        revenue_growth=0.02,
        earnings_growth=-0.10,
        free_cash_flow_growth=-0.20,
        operating_margin=0.05,
        return_on_invested_capital=0.04,
        debt_to_equity=1.2,
        interest_coverage=2.0,
        outstanding_shares=1_000_000_000.0,
    )

    thesis = build_semiconductor_rerating_thesis(
        ticker="MU",
        company_name="Micron Technology, Inc.",
        metrics=metrics,
        line_items=[],
        forward_metrics=_forward_metrics(canonical_forward_pe=18.0, forward_pe=18.0, forward_eps_ttm=5.5),
        analyst_target=_target(consensus=95.0, high=110.0, current_price=100.0, analyst_count=6),
        pbr_band={"fair_price_p50": 80.0, "fair_price_p90": 120.0, "current_price": 100.0, "current_pbr": 4.5},
    )

    assert thesis["applicable"] is True
    assert thesis["forward_interpretation"] == "earnings_contraction_or_pressure"
    assert thesis["rerating_probability"] < 0.50
    assert thesis["signal"] in {"neutral", "bearish"}


def test_semiconductor_rerating_agent_registered_and_emits_decision_grade_context(monkeypatch):
    import src.agents.semiconductor_rerating as rerating
    from src.utils.analysts import ANALYST_CONFIG

    metrics = [
        FinancialMetrics(
            ticker="000660.KS",
            report_period="2026-03-31",
            period="ttm",
            currency="KRW",
            market_cap=1_377_118_583_783_424.0,
            price_to_earnings_ratio=29.6,
            price_to_book_ratio=3.5,
            book_value_per_share=557_471.0,
            revenue_growth=0.46,
            earnings_growth=0.80,
            earnings_per_share_growth=0.95,
            free_cash_flow_growth=0.86,
            operating_margin=0.44,
            return_on_invested_capital=0.45,
            debt_to_equity=0.35,
            interest_coverage=18.0,
            outstanding_shares=710_000_000.0,
        )
    ]

    monkeypatch.setattr(rerating, "get_financial_metrics", lambda **_: metrics)
    monkeypatch.setattr(rerating, "search_line_items", lambda **_: [])
    monkeypatch.setattr(rerating, "get_cached_forward_metrics", lambda *_args, **_kwargs: _forward_metrics())
    monkeypatch.setattr(rerating, "fetch_analyst_target", lambda _ticker: _target())
    monkeypatch.setattr(rerating, "calculate_pbr_band", lambda **_: {
        "fair_price_p50": 1_372_169.0,
        "fair_price_p75": 1_760_000.0,
        "fair_price_p90": 2_096_204.0,
        "current_price": 1_940_000.0,
        "current_pbr": 3.5,
        "percentiles": {"p50": 2.4, "p75": 3.1, "p90": 3.7},
        "position_label": "upper_band",
    })

    assert "semiconductor_rerating_analyst" in ANALYST_CONFIG

    state = {
        "messages": [],
        "data": {
            "tickers": ["000660.KS"],
            "end_date": "2026-05-29",
            "analyst_signals": {},
        },
        "metadata": {"show_reasoning": False},
    }
    result = rerating.semiconductor_rerating_analyst_agent(state)
    signal = result["data"]["analyst_signals"]["semiconductor_rerating_analyst_agent"]["000660.KS"]

    assert signal["signal"] == "bullish"
    assert signal["confidence"] >= 60
    assert signal["rerating_analysis"]["expected_return"] > 0
    assert signal["scenario_analysis"]["broker_consensus_price"] == 2_243_600.0
    assert "recommended_agent_mix" in signal


def test_portfolio_manager_compacts_semiconductor_rerating_context():
    from src.agents.portfolio_manager import _build_decision_context

    signals_by_ticker = {
        "000660.KS": {
            "semiconductor_rerating_analyst_agent": {
                "sig": "bullish",
                "conf": 72,
                "raw": {
                    "signal": "bullish",
                    "confidence": 72,
                    "rerating_analysis": {"expected_return": 0.19, "rerating_probability": 0.68},
                    "scenario_analysis": {"expected_price": 2_300_000.0},
                    "recommended_agent_mix": ["valuation_analyst", "growth_analyst"],
                },
            }
        }
    }

    context = _build_decision_context(
        tickers=["000660.KS"],
        signals_by_ticker=signals_by_ticker,
        current_prices={"000660.KS": 1_940_000.0},
        max_shares={"000660.KS": 0},
        allowed_actions={"000660.KS": {"hold": 0}},
        risk_by_ticker={"000660.KS": {}},
        include_trade_constraints=False,
    )

    evidence = context["000660.KS"]["analyst_evidence"]["semiconductor_rerating_analyst_agent"]
    assert evidence["rerating_analysis"]["expected_return"] == 0.19
    assert evidence["scenario_analysis"]["expected_price"] == 2_300_000.0
    assert evidence["recommended_agent_mix"] == ["valuation_analyst", "growth_analyst"]
