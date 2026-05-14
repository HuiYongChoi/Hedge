from src.utils.agent_data_quality import (
    insufficient, partial, ok, aggregate_scores,
    sanitize_for_llm, coverage_caps_signal, DATA_INSUFFICIENT,
)


def test_insufficient_returns_none_score():
    r = insufficient(4, "no data")
    assert r["score"] is None
    assert r["max_score"] == 4
    assert r["data_quality"] == "insufficient"


def test_aggregate_skips_none_scores():
    comps = [
        insufficient(4, "x"),
        ok(2, 3, "y"),
        ok(1, 1, "z"),
    ]
    agg = aggregate_scores(comps)
    assert agg["total_score"] == 3
    assert agg["effective_max"] == 4
    assert agg["raw_max"] == 8
    assert agg["coverage"] == 0.5
    assert agg["normalized_pct"] == 0.75


def test_sanitize_replaces_none_with_token():
    src = {"a": {"score": None, "details": "..."}, "b": {"score": 5}}
    out = sanitize_for_llm(src)
    assert out["a"]["score"] == DATA_INSUFFICIENT
    assert out["b"]["score"] == 5
    assert src["a"]["score"] is None  # no mutation


def test_coverage_low_forces_neutral():
    s, c = coverage_caps_signal(0.2, "bearish", 80.0)
    assert s == "neutral"
    assert c == 40.0


def test_coverage_mid_caps_confidence():
    s, c = coverage_caps_signal(0.5, "bearish", 80.0)
    assert s == "bearish"
    assert c == 60.0


def test_coverage_high_passes_through():
    s, c = coverage_caps_signal(0.9, "bearish", 80.0)
    assert s == "bearish"
    assert c == 80.0
