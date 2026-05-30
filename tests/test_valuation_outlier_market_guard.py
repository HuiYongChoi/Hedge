"""Outlier-flagging guard: a model that agrees with the market price must not be
excluded just because the other models cluster at a depressed cyclical level.

Uses MU's real valuation panel (per-share, which is proportional to the equity
values the flagger sees): a deep memory cyclical where DCF/RIM/EVA are all
crushed on normalized earnings, so the leave-one-out median sits ~$227 and the
EV/EBITDA multiple ($971 ~= market) would naively be flagged as a 4.3x "too high"
outlier. The market-proximity guard (+/-35% of market cap) protects it.
"""
from src.agents.valuation import flag_peer_outliers


def _models(market_cap, per_share, weight=0.15):
    # The flagger only needs value/weight/gap. Use per-share figures as values
    # (the ratio vs peer median is identical to using total equity values), and
    # a matching per-share market reference so each gap is exact.
    return {
        name: {
            "value": ps,
            "weight": weight,
            "gap": (ps - market_cap) / market_cap,
        }
        for name, ps in per_share.items()
    }


# MU panel (current price $971): EV/EBITDA lands on the market, the earnings
# models are crushed, EBITDA(normalized) runs a bit hot.
MU = {
    "ebitda_valuation": 1270.04,
    "ev_ebitda": 971.00,
    "owner_earnings": 689.84,
    "residual_income": 227.45,
    "roic_wacc_valuation": 160.71,
    "dcf": 121.74,
}


def test_market_agreeing_model_is_not_flagged():
    models = _models(971.00, MU)
    flag_peer_outliers(models)
    # EV/EBITDA sits exactly on the market (gap -0.0%) -> protected, even though
    # its value is ~4.3x the depressed peer median.
    assert models["ev_ebitda"]["value_to_peer_median"] > 3.0
    assert models["ev_ebitda"]["is_outlier"] is False


def test_depressed_earnings_models_still_flagged():
    models = _models(971.00, MU)
    flag_peer_outliers(models)
    # DCF / EVA are far below both the peer median and the market band -> excluded.
    assert models["dcf"]["is_outlier"] is True
    assert models["roic_wacc_valuation"]["is_outlier"] is True


def test_models_inside_band_are_protected_even_if_divergent():
    # Direct consequence of the +/-35% band the guard uses: EBITDA(normalized) at
    # +30.8% and owner-earnings at -29.0% both sit inside the band, so neither is
    # excluded any more — agreeing (roughly) with the market is a credibility
    # signal, not a defect.
    models = _models(971.00, MU)
    flag_peer_outliers(models)
    assert abs(models["ebitda_valuation"]["gap"]) <= 0.35
    assert models["ebitda_valuation"]["is_outlier"] is False
    assert models["owner_earnings"]["is_outlier"] is False


def test_guard_band_edge_protects_at_exactly_35pct():
    # A model 3x+ above a depressed peer cluster but sitting at +35% of market is
    # protected; the same divergence at +40% (just past the band) is flagged.
    protected = _models(100.0, {"a": 20.0, "b": 20.0, "c": 20.0, "d": 20.0, "hot": 135.0})
    flag_peer_outliers(protected)
    assert protected["hot"]["value_to_peer_median"] > 3.0
    assert protected["hot"]["is_outlier"] is False

    flagged = _models(100.0, {"a": 20.0, "b": 20.0, "c": 20.0, "d": 20.0, "hot": 140.0})
    flag_peer_outliers(flagged)
    assert flagged["hot"]["value_to_peer_median"] > 3.0
    assert flagged["hot"]["is_outlier"] is True


def test_no_flagging_below_min_peers():
    # Fewer than OUTLIER_MIN_PEERS credible models -> never flag anything.
    models = _models(100.0, {"a": 100.0, "b": 1000.0, "c": 50.0})
    flag_peer_outliers(models)
    assert all(v["is_outlier"] is False for v in models.values())
