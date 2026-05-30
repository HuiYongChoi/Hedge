from types import SimpleNamespace

from src.agents.stanley_druckenmiller import (
    analyze_growth_and_momentum,
    analyze_risk_reward,
)


def _li(**kw):
    base = {
        "revenue": None,
        "earnings_per_share": None,
        "total_debt": None,
        "shareholders_equity": None,
    }
    base.update(kw)
    return SimpleNamespace(**base)


def _price(close):
    return SimpleNamespace(close=close, time="2026-01-01")


# Real MU annual data (newest -> oldest): a V-shaped memory cycle where both
# endpoints (FY2025 $7.65, FY2022 $7.81) are cyclical peaks but FY2023 was a
# deep loss (-$5.34). The old endpoint-CAGR read this as -0.7% "decline".
MU_LINE_ITEMS = [
    _li(revenue=37_378_000_000.0, earnings_per_share=7.65),
    _li(revenue=25_111_000_000.0, earnings_per_share=0.70),
    _li(revenue=15_540_000_000.0, earnings_per_share=-5.34),
    _li(revenue=30_758_000_000.0, earnings_per_share=7.81),
]


def test_cyclical_recovery_not_read_as_decline():
    result = analyze_growth_and_momentum(MU_LINE_ITEMS, prices=[])
    details = result["details"]
    # Must recognize the YoY rebound, not the misleading flat/negative CAGR.
    assert "recovery (cyclical)" in details
    assert "Strong EPS YoY recovery" in details
    assert "Minimal/negative annualized EPS growth" not in details
    # Revenue (+6.7% CAGR -> moderate) + EPS recovery (strong) should score well.
    assert result["score"] > 4.0


def test_normal_monotonic_eps_still_uses_cagr():
    items = [
        _li(revenue=120.0, earnings_per_share=2.0),
        _li(revenue=110.0, earnings_per_share=1.8),
        _li(revenue=100.0, earnings_per_share=1.5),
    ]
    result = analyze_growth_and_momentum(items, prices=[])
    # No loss year -> keep annualized CAGR wording.
    assert "annualized EPS growth" in result["details"]
    assert "recovery (cyclical)" not in result["details"]


def test_risk_reward_emits_explicit_debt_percentage():
    items = [
        _li(total_debt=15_278_000_000.0, shareholders_equity=54_165_000_000.0),
        _li(total_debt=14_007_000_000.0, shareholders_equity=45_131_000_000.0),
    ]
    prices = [_price(100.0 + i) for i in range(15)]
    result = analyze_risk_reward(items, prices)
    # ~0.28 ratio must surface as a clean "28% of equity", never a fabricated 200%.
    assert "Low debt-to-equity" in result["details"]
    assert "28% of equity" in result["details"]
