"""증권사 컨센서스 목표가 + 현재가 + 브로커 타겟 + 베타/시그마 fetcher (FMP + yfinance)."""
from __future__ import annotations
import logging
import time
import statistics
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Optional
import requests

logger = logging.getLogger(__name__)

_FMP_BASE = "https://financialmodelingprep.com/stable"
_FMP_KEY = "WnoeVdSBlKezrKNExH7jtXfEWXg8YrtE"

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
    current_price: Optional[float]   # 현재 주가 (yfinance fallback)
    trailing_pe: Optional[float]     # TTM P/E (yfinance info)
    trailing_eps: Optional[float]    # TTM EPS (yfinance info)
    forward_eps: Optional[float]     # Next-year EPS estimate (yfinance info)
    forward_pe: Optional[float]      # Next-year P/E (yfinance info)
    beta: Optional[float]            # beta (yfinance info)
    sigma_annual: Optional[float]    # annualised σ (historical or derived)
    brokers: list[BrokerTarget] = field(default_factory=list)
    distribution: Optional[TargetDistribution] = None
    source: str = "stub"


# ──────────────────────────────────────────────────────────────────────────────
# Private helpers
# ──────────────────────────────────────────────────────────────────────────────

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


def _normalize_signal(grade: Optional[str]) -> str:
    """FMP 등급 문자열 → BUY / HOLD / NEUTRAL / SELL."""
    if not grade:
        return "NEUTRAL"
    key = grade.strip().lower()
    return GRADE_TO_SIGNAL.get(key, "NEUTRAL")


def _parse_date(date_str: Optional[str]) -> Optional[date]:
    """'2026-05-01T...' 또는 '2026-05-01' → date."""
    if not date_str:
        return None
    try:
        return datetime.fromisoformat(date_str[:10]).date()
    except Exception:
        return None


def _fetch_brokers_fmp(ticker: str) -> list[BrokerTarget]:
    """FMP /price-target → per-broker 최신 타겟 목록 (최대 20개 사)."""
    brokers: list[BrokerTarget] = []
    today = date.today()

    try:
        r = requests.get(
            f"{_FMP_BASE}/price-target",
            params={"symbol": ticker, "apikey": _FMP_KEY, "limit": 100},
            timeout=8,
        )
        if not r.ok:
            return brokers
        items = r.json()
        if not isinstance(items, list):
            return brokers

        # 회사별 가장 최근 entry 선택
        latest: dict[str, dict] = {}
        for item in items:
            company = (item.get("gradingCompany") or item.get("analystName") or "").strip()
            if not company:
                continue
            pub_date = _parse_date(item.get("publishedDate"))
            if company not in latest:
                latest[company] = item
            else:
                existing_date = _parse_date(latest[company].get("publishedDate"))
                if pub_date and existing_date and pub_date > existing_date:
                    latest[company] = item

        for company, item in latest.items():
            price_target = item.get("priceTarget") or item.get("adjPriceTarget")
            if not price_target:
                continue
            try:
                price_target = float(price_target)
            except (TypeError, ValueError):
                continue

            # signal: newGrade 우선, 없으면 rating
            grade = item.get("newGrade") or item.get("rating") or ""
            signal = _normalize_signal(grade)

            pub_date = _parse_date(item.get("publishedDate"))
            pub_date_str = pub_date.isoformat() if pub_date else ""
            days_ago = (today - pub_date).days if pub_date else 0

            brokers.append(BrokerTarget(
                name=company,
                target_price=price_target,
                signal=signal,
                published_date=pub_date_str,
                days_ago=days_ago,
            ))

    except Exception as e:
        logger.debug("FMP broker fetch failed for %s: %s", ticker, e)

    # 최신순 정렬 후 최대 20개
    brokers.sort(key=lambda b: b.days_ago)
    return brokers[:20]


def _compute_distribution(
    brokers: list[BrokerTarget],
    consensus: Optional[float] = None,
    fmp_consensus_data: Optional[dict] = None,
) -> Optional[TargetDistribution]:
    """브로커 목록 → BUY/HOLD/NEUTRAL/SELL 카운트 + avg/median/stdev."""
    if not brokers and not fmp_consensus_data:
        return None

    # FMP grades-consensus 데이터 우선 활용
    if fmp_consensus_data:
        buy = int(fmp_consensus_data.get("strongBuy", 0) or 0) + int(fmp_consensus_data.get("buy", 0) or 0)
        hold = int(fmp_consensus_data.get("hold", 0) or 0)
        neutral = 0  # FMP grades-consensus does not separate neutral
        sell = int(fmp_consensus_data.get("sell", 0) or 0) + int(fmp_consensus_data.get("strongSell", 0) or 0)
        total = buy + hold + neutral + sell
        if total == 0 and brokers:
            # fall through to broker-derived distribution
            pass
        else:
            prices = [b.target_price for b in brokers] if brokers else []
            avg = float(statistics.mean(prices)) if prices else consensus
            med = float(statistics.median(prices)) if len(prices) >= 2 else None
            std = float(statistics.stdev(prices)) if len(prices) >= 2 else None
            return TargetDistribution(
                buy=buy, hold=hold, neutral=neutral, sell=sell,
                total=total,
                average=avg, median=med, stdev=std,
            )

    # broker 목록에서 집계
    counts: dict[str, int] = {"BUY": 0, "HOLD": 0, "NEUTRAL": 0, "SELL": 0}
    prices: list[float] = []
    for b in brokers:
        sig = b.signal if b.signal in counts else "NEUTRAL"
        counts[sig] += 1
        prices.append(b.target_price)

    total = sum(counts.values())
    if total == 0:
        return None

    avg = float(statistics.mean(prices)) if prices else None
    med = float(statistics.median(prices)) if len(prices) >= 2 else None
    std = float(statistics.stdev(prices)) if len(prices) >= 2 else None
    return TargetDistribution(
        buy=counts["BUY"], hold=counts["HOLD"],
        neutral=counts["NEUTRAL"], sell=counts["SELL"],
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

    # 1) FMP consensus + summary
    consensus_data: dict = {}
    summary_data: dict = {}
    grades_consensus_data: dict = {}
    try:
        r_consensus = requests.get(
            f"{_FMP_BASE}/price-target-consensus",
            params={"symbol": ticker, "apikey": _FMP_KEY},
            timeout=8,
        )
        r_summary = requests.get(
            f"{_FMP_BASE}/price-target-summary",
            params={"symbol": ticker, "apikey": _FMP_KEY},
            timeout=8,
        )
        r_grades = requests.get(
            f"{_FMP_BASE}/grades-consensus",
            params={"symbol": ticker, "apikey": _FMP_KEY},
            timeout=8,
        )
        consensus_data = r_consensus.json()[0] if r_consensus.ok and r_consensus.json() else {}
        summary_data = r_summary.json()[0] if r_summary.ok and r_summary.json() else {}
        gc = r_grades.json() if r_grades.ok else []
        grades_consensus_data = gc[0] if isinstance(gc, list) and gc else (gc if isinstance(gc, dict) else {})
    except Exception as e:
        logger.debug("FMP consensus/summary/grades fetch failed for %s: %s", ticker, e)

    # 2) FMP per-broker targets
    brokers = _fetch_brokers_fmp(ticker)

    # 3) yfinance: current price + fundamentals + beta
    yf_data = _fetch_yfinance_data(ticker)

    # 4) beta/sigma (yfinance history is more accurate)
    beta_yf, sigma_yf = _fetch_beta_sigma_yf(ticker)
    # prefer history-derived beta over info.beta if available
    beta_final = beta_yf or yf_data.get("beta")
    sigma_final = sigma_yf

    # 5) distribution
    consensus_val = consensus_data.get("targetConsensus")
    distribution = _compute_distribution(brokers, consensus_val, grades_consensus_data or None)

    result = AnalystTarget(
        consensus=consensus_val,
        high=consensus_data.get("targetHigh"),
        low=consensus_data.get("targetLow"),
        median=consensus_data.get("targetMedian"),
        analyst_count=summary_data.get("lastQuarter") or summary_data.get("lastMonth"),
        current_price=yf_data.get("current_price"),
        trailing_pe=yf_data.get("trailing_pe"),
        trailing_eps=yf_data.get("trailing_eps"),
        forward_eps=yf_data.get("forward_eps"),
        forward_pe=yf_data.get("forward_pe"),
        beta=beta_final,
        sigma_annual=sigma_final,
        brokers=brokers,
        distribution=distribution,
        source="FMP" if (consensus_data or brokers) else "stub",
    )

    _CACHE[ticker] = (now, result)
    return result
