"""Growth guards on endpoint-CAGR valuation paths, with a visible marker.

Two confirmed defects where a depressed/compressed earnings base lets an
endpoint CAGR explode and quietly distort a valuation read:

  * Peter Lynch PEG: a tiny base year sends growth → huge → PEG ≈ 0 (fake-cheap);
    a near-flat grower sends PEG → runaway noise. Both ends are clamped and the
    clamp is shown inline in the details string ("[guard applied: ...]").
  * Jhunjhunwala intrinsic value: dropping loss years compresses the year-base
    and overstates the CAGR feeding the DCF. The raw CAGR is clamped (tighter
    when loss years were dropped) and the clamp is surfaced as a guard note.
"""
from types import SimpleNamespace

from src.agents.peter_lynch import analyze_lynch_valuation
from src.agents.rakesh_jhunjhunwala import calculate_intrinsic_value


def _li(**kw):
    base = {"net_income": None, "earnings_per_share": None}
    base.update(kw)
    return SimpleNamespace(**base)


# ── Peter Lynch PEG guard ──────────────────────────────────────────────────


def test_lynch_depressed_base_growth_is_capped():
    # EPS 0.10 -> 5.00 over one year is a +4900% base-effect CAGR; without a cap
    # the PEG collapses toward zero and the stock looks artificially cheap.
    items = [_li(net_income=100.0, earnings_per_share=5.0),
             _li(net_income=10.0, earnings_per_share=0.10)]
    res = analyze_lynch_valuation(items, market_cap=1000.0)
    assert "guard applied: growth capped at 35%" in res["details"]
    # PEG now uses the 35% ceiling: pe(10) / 35 ≈ 0.29, not a near-zero artifact.
    assert "PEG ratio: 0.29" in res["details"]


def test_lynch_near_flat_grower_peg_is_capped():
    # ~2%/yr growth with a high P/E blows the raw PEG up to 100; cap it at 50.
    items = [_li(net_income=5.0, earnings_per_share=1.02),
             _li(net_income=5.0, earnings_per_share=1.00)]
    res = analyze_lynch_valuation(items, market_cap=1000.0)
    assert "guard applied: PEG capped at 50" in res["details"]
    assert "PEG ratio: 50.00" in res["details"]


def test_lynch_normal_grower_has_no_guard_marker():
    # +33%/yr, moderate P/E -> PEG well inside both bands, no clamp, no marker.
    items = [_li(net_income=80.0, earnings_per_share=2.0),
             _li(net_income=70.0, earnings_per_share=1.5)]
    res = analyze_lynch_valuation(items, market_cap=1000.0)
    assert "guard applied" not in res["details"]
    assert "PEG ratio:" in res["details"]


# ── Jhunjhunwala intrinsic-value CAGR guard ────────────────────────────────


def test_jhunjhunwala_dropped_loss_year_caps_cagr_tightly():
    # A loss year sits between two profitable ones; dropping it compresses the
    # year-base so the CAGR balloons. With a year dropped, cap tightly at 10%.
    items = [_li(net_income=100.0), _li(net_income=-50.0),
             _li(net_income=10.0), _li(net_income=8.0)]
    value, note = calculate_intrinsic_value(items, market_cap=1000.0)
    assert value and value > 0
    assert note is not None
    assert "loss/blank year(s) dropped" in note
    assert "10%" in note


def test_jhunjhunwala_explosive_cagr_capped_without_drop():
    # All years positive but a tiny base year still explodes the CAGR; with no
    # dropped year the looser 30% ceiling applies.
    items = [_li(net_income=100.0), _li(net_income=50.0), _li(net_income=1.0)]
    value, note = calculate_intrinsic_value(items, market_cap=1000.0)
    assert value and value > 0
    assert note is not None
    assert "30%" in note
    assert "dropped" not in note


def test_jhunjhunwala_normal_cagr_has_no_guard_note():
    # ~9.5%/yr, no loss year -> inside the band, no clamp, no note.
    items = [_li(net_income=120.0), _li(net_income=110.0), _li(net_income=100.0)]
    value, note = calculate_intrinsic_value(items, market_cap=1000.0)
    assert value and value > 0
    assert note is None
