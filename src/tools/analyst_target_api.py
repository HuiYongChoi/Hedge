"""증권사 컨센서스 목표가 + 현재가 + 브로커 타겟 + 베타/시그마 fetcher (yfinance only)."""
from __future__ import annotations
import logging
import time
import statistics
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Optional

logger = logging.getLogger(__name__)

# In-memory cache: ticker → (timestamp, result)
_CACHE: dict[str, tuple[float, "AnalystTarget"]] = {}
_TTL_SECONDS = 6 * 3600  # 6 hours

GRADE_TO_SIGNAL: dict[str, str] = {
    "strong buy": "BUY", "buy": "BUY", "outperform": "BUY",
    "overweight": "BUY", "add": "BUY", "accumulate": "BUY",
    "positive": "BUY", "top pick": "BUY",
    "hold": "HOLD", "market perform": "HOLD", "equal-weight": "HOLD",
    "in-line": "HOLD", "peer perform": "HOLD", "sector perform": "HOLD",
    "sector weight": "HOLD", "market weight": "HOLD",
    "neutral": "NEUTRAL",
    "underperform": "SELL", "underweight": "SELL", "sell": "SELL",
    "strong sell": "SELL", "reduce": "SELL", "negative": "SELL",
}


@dataclass
class BrokerTarget:
    name: str
    target_price: float
    signal: str               # "BUY" | "HOLD" | "NEUTRAL" | "SELL"
    published_date: str       # ISO yyyy-mm-dd
    days_ago: int


@dataclass
class TargetDistribution:
    buy: int
    hold: int
    neutral: int
    sell: int
    total: int
    average: Optional[float]
    median: Optional[float]
    stdev: Optional[float]


@dataclass
class AnalystTarget:
    consensus: Optional[float]
    high: Optional[float]
    low: Optional[float]
    median: Optional[float]
    analyst_count: Optional[int]
    current_price: Optional[float]   # 현재 주가 (yfinance)
    trailing_pe: Optional[float]     # TTM P/E (yfinance info)
    trailing_eps: Optional[float]    # TTM EPS (yfinance info)
    forward_eps: Optional[float]     # Next-year EPS estimate (yfinance info)
    forward_pe: Optional[float]      # Next-year P/E (yfinance info)
    beta: Optional[float]            # beta (yfinance info)
    sigma_annual: Optional[float]    # annualised σ (historical or derived)
    current_fy_eps: Optional[float] = None  # Current fiscal-year EPS estimate
    brokers: list[BrokerTarget] = field(default_factory=list)
    distribution: Optional[TargetDistribution] = None
    source: str = "stub"


# ──────────────────────────────────────────────────────────────────────────────
# Private helpers
# ──────────────────────────────────────────────────────────────────────────────

def _coerce_pos_float(v) -> Optional[float]:
    """값을 양수 float으로 강제 변환. 실패하면 None 반환."""
    try:
        if v is None:
            return None
        f = float(v)
        return f if f > 0 else None
    except (TypeError, ValueError):
        return None


def _normalize_signal(grade: Optional[str]) -> str:
    """등급 문자열 → BUY / HOLD / NEUTRAL / SELL."""
    if not grade:
        return "NEUTRAL"
    key = grade.strip().lower()
    return GRADE_TO_SIGNAL.get(key, "NEUTRAL")


def _compute_ttm_eps_from_quarterly(ticker_obj) -> Optional[float]:
    """quarterly_income_stmt의 최근 4분기 EPS 합산값."""
    try:
        qis = ticker_obj.quarterly_income_stmt
        if qis is None or qis.empty:
            return None
        for label in ("Diluted EPS", "Basic EPS"):
            if label not in qis.index:
                continue
            values = [_coerce_pos_float(v) for v in qis.loc[label].dropna().head(4)]
            if len(values) == 4 and all(v is not None for v in values):
                total = float(sum(v for v in values if v is not None))
                return total if total > 0 else None
    except Exception:
        pass
    return None


def _fetch_current_fy_eps(ticker_obj) -> Optional[float]:
    """yfinance earnings_estimate의 0y(current fiscal year) avg EPS."""
    try:
        ee = ticker_obj.earnings_estimate
        if ee is None or ee.empty or "0y" not in ee.index:
            return None
        return _coerce_pos_float(ee.loc["0y", "avg"])
    except Exception:
        pass
    return None


def _fetch_yfinance_data(ticker: str) -> dict:
    """yfinance로 현재가 + 기본 펀더멘털(PE/EPS/beta) fetch."""
    out: dict = {}
    try:
        import yfinance as yf
        t = yf.Ticker(ticker)

        # 현재가: fast_info (빠르고 안정적)
        price = getattr(t.fast_info, "last_price", None)
        if price and float(price) > 0:
            out["current_price"] = float(price)

        # 펀더멘털: info dict
        info = t.info or {}
        mapping = [
            ("trailingPE",  "trailing_pe"),
            ("forwardPE",   "forward_pe"),
            ("trailingEps", "trailing_eps"),
            ("forwardEps",  "forward_eps"),
            ("beta",        "beta"),
        ]
        for src_key, dst_key in mapping:
            val = info.get(src_key)
            if val is not None and isinstance(val, (int, float)) and float(val) > 0:
                out[dst_key] = float(val)

        if "trailing_eps" not in out:
            fallback = _compute_ttm_eps_from_quarterly(t)
            if fallback is not None and fallback > 0:
                out["trailing_eps"] = fallback
                if "current_price" in out and "trailing_pe" not in out:
                    out["trailing_pe"] = out["current_price"] / fallback
    except Exception as e:
        logger.debug("yfinance data fetch failed for %s: %s", ticker, e)
    return out


def _fetch_beta_sigma_yf(ticker: str) -> tuple[Optional[float], Optional[float]]:
    """beta + annualised σ from yfinance 1-year history."""
    try:
        import yfinance as yf
        t = yf.Ticker(ticker)
        info = t.info or {}
        beta_raw = info.get("beta")
        beta = float(beta_raw) if beta_raw and isinstance(beta_raw, (int, float)) and float(beta_raw) > 0 else None

        try:
            hist = t.history(period="1y")["Close"]
            if len(hist) > 50:
                daily_ret = hist.pct_change().dropna()
                sigma_annual = float(daily_ret.std() * (252 ** 0.5))
            else:
                sigma_annual = (beta or 1.0) * 0.14
        except Exception:
            sigma_annual = (beta or 1.0) * 0.14

        return beta, sigma_annual
    except Exception as e:
        logger.debug("yfinance beta/sigma fetch failed for %s: %s", ticker, e)
        return None, None


def _fetch_yfinance_analyst(ticker: str) -> dict:
    """yfinance에서 analyst targets + recommendations + per-broker upgrades."""
    out: dict = {
        "consensus": None, "high": None, "low": None, "median": None,
        "analyst_count": None,
        "current_fy_eps": None,
        "brokers": [],
        "rec_summary_row": None,  # {strongBuy, buy, hold, sell, strongSell}
    }
    try:
        import yfinance as yf
        t = yf.Ticker(ticker)

        # ── analyst_price_targets ──
        try:
            apt = t.analyst_price_targets or {}
            out["consensus"] = _coerce_pos_float(apt.get("mean"))
            out["high"]      = _coerce_pos_float(apt.get("high"))
            out["low"]       = _coerce_pos_float(apt.get("low"))
            out["median"]    = _coerce_pos_float(apt.get("median"))
        except Exception:
            pass

        out["current_fy_eps"] = _fetch_current_fy_eps(t)

        # ── recommendations_summary (최신 행) ──
        try:
            rs = t.recommendations_summary
            if rs is not None and len(rs) > 0:
                row = rs.iloc[0].to_dict()
                out["rec_summary_row"] = {
                    "strongBuy":  int(row.get("strongBuy", 0) or 0),
                    "buy":        int(row.get("buy", 0) or 0),
                    "hold":       int(row.get("hold", 0) or 0),
                    "sell":       int(row.get("sell", 0) or 0),
                    "strongSell": int(row.get("strongSell", 0) or 0),
                }
                total = sum(out["rec_summary_row"].values())
                if total > 0:
                    out["analyst_count"] = total
        except Exception:
            pass

        # ── upgrades_downgrades → per-broker latest target ──
        try:
            ud = t.upgrades_downgrades
            if ud is not None and len(ud) > 0:
                # Firm별 최신만 유지
                seen: dict[str, dict] = {}
                for grade_dt, row in ud.iterrows():
                    firm = str(row.get("Firm", "") or "").strip()
                    if not firm:
                        continue
                    price = _coerce_pos_float(row.get("currentPriceTarget"))
                    if price is None:
                        continue
                    rec_grade = str(row.get("ToGrade", "") or "").strip()
                    if firm not in seen or grade_dt > seen[firm]["dt"]:
                        seen[firm] = {
                            "name": firm,
                            "target_price": price,
                            "signal": _normalize_signal(rec_grade),
                            "dt": grade_dt,
                        }

                today = date.today()
                brokers: list[BrokerTarget] = []
                for v in seen.values():
                    pub = v["dt"].date() if hasattr(v["dt"], "date") else None
                    days_ago = (today - pub).days if pub else 0
                    brokers.append(BrokerTarget(
                        name=v["name"],
                        target_price=v["target_price"],
                        signal=v["signal"],
                        published_date=pub.isoformat() if pub else "",
                        days_ago=days_ago,
                    ))
                brokers.sort(key=lambda b: b.days_ago)
                out["brokers"] = brokers[:20]
        except Exception:
            pass

    except Exception as e:
        logger.debug("yfinance analyst fetch failed for %s: %s", ticker, e)
    return out


def _compute_distribution_v5(
    brokers: list[BrokerTarget],
    rec_summary: Optional[dict],
    consensus: Optional[float],
) -> Optional[TargetDistribution]:
    """브로커 목록 + recommendations_summary → BUY/HOLD/NEUTRAL/SELL 카운트 + avg/median/stdev."""
    if not brokers and not rec_summary:
        return None

    if rec_summary:
        buy     = rec_summary["strongBuy"] + rec_summary["buy"]
        hold    = rec_summary["hold"]
        neutral = 0  # yfinance recommendations_summary는 neutral 분리하지 않음
        sell    = rec_summary["sell"] + rec_summary["strongSell"]
    else:
        counts: dict[str, int] = {"BUY": 0, "HOLD": 0, "NEUTRAL": 0, "SELL": 0}
        for b in brokers:
            counts[b.signal if b.signal in counts else "NEUTRAL"] += 1
        buy, hold, neutral, sell = counts["BUY"], counts["HOLD"], counts["NEUTRAL"], counts["SELL"]

    total = buy + hold + neutral + sell
    if total == 0 and not brokers:
        return None

    prices = [b.target_price for b in brokers]
    avg = float(statistics.mean(prices)) if prices else consensus
    med = float(statistics.median(prices)) if len(prices) >= 2 else None
    std = float(statistics.stdev(prices)) if len(prices) >= 2 else None
    return TargetDistribution(
        buy=buy, hold=hold, neutral=neutral, sell=sell,
        total=total,
        average=avg, median=med, stdev=std,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────────────

def fetch_analyst_target(ticker: str) -> AnalystTarget:
    cached = _CACHE.get(ticker)
    now = time.time()
    if cached and now - cached[0] < _TTL_SECONDS:
        return cached[1]

    yf_fund    = _fetch_yfinance_data(ticker)     # current price + PE/EPS/beta
    yf_an      = _fetch_yfinance_analyst(ticker)  # consensus + brokers + dist
    beta_hist, sigma_hist = _fetch_beta_sigma_yf(ticker)

    beta_final  = beta_hist or yf_fund.get("beta")
    sigma_final = sigma_hist

    # Distribution
    distribution = _compute_distribution_v5(
        brokers=yf_an["brokers"],
        rec_summary=yf_an["rec_summary_row"],
        consensus=yf_an["consensus"],
    )

    has_data = (yf_an["consensus"] is not None) or len(yf_an["brokers"]) > 0
    result = AnalystTarget(
        consensus=yf_an["consensus"],
        high=yf_an["high"],
        low=yf_an["low"],
        median=yf_an["median"],
        analyst_count=yf_an["analyst_count"],
        current_price=yf_fund.get("current_price"),
        trailing_pe=yf_fund.get("trailing_pe"),
        trailing_eps=yf_fund.get("trailing_eps"),
        forward_eps=yf_fund.get("forward_eps"),
        forward_pe=yf_fund.get("forward_pe"),
        beta=beta_final,
        sigma_annual=sigma_final,
        current_fy_eps=yf_an.get("current_fy_eps"),
        brokers=yf_an["brokers"],
        distribution=distribution,
        source="yfinance" if has_data else "stub",
    )
    _CACHE[ticker] = (now, result)
    return result
