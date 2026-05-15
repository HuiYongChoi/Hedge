"""증권사 컨센서스 목표가 + 현재가 + 브로커 타겟 + 베타/시그마 fetcher (yfinance only)."""
from __future__ import annotations
import logging
import time
import statistics
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Optional
import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# In-memory cache: ticker → (timestamp, result)
_CACHE: dict[str, tuple[float, "AnalystTarget"]] = {}
_TTL_SECONDS = 6 * 3600  # 6 hours
_FNGUIDE_CONSENSUS_URL = "https://wcomp.fnguide.com/CompanyInfo/Consensus"
_NAVER_ITEM_URL = "https://finance.naver.com/item/main.naver"

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
    currency: str = "USD"
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


def _parse_num(v) -> Optional[float]:
    """콤마/공백이 섞인 숫자 문자열을 float으로 변환."""
    try:
        if v is None:
            return None
        cleaned = str(v).replace(",", "").replace("%", "").strip()
        if cleaned in {"", "-", "N/A", "nan"}:
            return None
        f = float(cleaned)
        return f if f > 0 else None
    except (TypeError, ValueError):
        return None


def _is_korean_ticker(ticker: str) -> bool:
    """KRX 숫자 티커 또는 Yahoo의 .KS/.KQ 접미사를 한국 종목으로 판정."""
    t = ticker.strip().upper()
    code = t.split(".")[0]
    return (t.endswith(".KS") or t.endswith(".KQ") or (code.isdigit() and len(code) == 6))


def _is_japanese_ticker(ticker: str) -> bool:
    """TSE 4자리 숫자 코드 또는 Yahoo의 .T 접미사를 일본 종목으로 판정."""
    t = ticker.strip().upper()
    code = t.split(".")[0]
    return (t.endswith(".T") or (code.isdigit() and len(code) == 4))


def _yahoo_japan_symbol(ticker: str) -> str:
    """일본 종목을 Yahoo가 받아들이는 'NNNN.T' 형식으로 정규화.
    이미 .T가 있으면 그대로, 4자리 숫자면 .T 부착."""
    t = ticker.strip().upper()
    if t.endswith(".T"):
        return t
    code = t.split(".")[0]
    if code.isdigit() and len(code) == 4:
        return f"{code}.T"
    return t


def _krx_code(ticker: str) -> str:
    return ticker.strip().upper().split(".")[0]


def _normalize_signal(grade: Optional[str]) -> str:
    """등급 문자열 → BUY / HOLD / NEUTRAL / SELL."""
    if not grade:
        return "NEUTRAL"
    key = grade.strip().lower()
    return GRADE_TO_SIGNAL.get(key, "NEUTRAL")


def _normalize_fnguide_signal(value: Optional[str]) -> str:
    """FnGuide numeric rating: 5/4=BUY, 3=HOLD, 1/2=SELL."""
    n = _parse_num(value)
    if n is None:
        return "NEUTRAL"
    if n >= 3.5:
        return "BUY"
    if n >= 2.5:
        return "HOLD"
    return "SELL"


def _days_ago_from_yyyymmdd(value: str) -> int:
    try:
        published = datetime.strptime(value.strip(), "%Y/%m/%d").date()
        return max(0, (date.today() - published).days)
    except Exception:
        return 0


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

        # 통화 추출 (info.currency가 가장 신뢰할 수 있음)
        cur = info.get("currency")
        if cur and isinstance(cur, str):
            out["currency"] = cur.upper()

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


def _fetch_fnguide_consensus(ticker: str) -> dict:
    """FnGuide에서 한국 종목의 증권사별 목표가/투자의견 + 요약 PER를 fetch."""
    out: dict = {
        "consensus": None,
        "high": None,
        "low": None,
        "median": None,
        "analyst_count": None,
        "trailing_pe": None,
        "forward_pe": None,
        "brokers": [],
    }
    if not _is_korean_ticker(ticker):
        return out

    code = _krx_code(ticker)
    try:
        response = requests.get(
            _FNGUIDE_CONSENSUS_URL,
            params={"cmp_cd": code},
            timeout=8,
            headers={"User-Agent": "Mozilla/5.0"},
        )
        if not response.ok:
            return out
        soup = BeautifulSoup(response.text, "html.parser")

        text_lines = [line.strip() for line in soup.get_text("\n").splitlines() if line.strip()]
        for idx, line in enumerate(text_lines):
            if line == "PER" and idx + 1 < len(text_lines):
                out["trailing_pe"] = out["trailing_pe"] or _parse_num(text_lines[idx + 1])
            elif line == "PER(Fwd.12M)" and idx + 1 < len(text_lines):
                out["forward_pe"] = out["forward_pe"] or _parse_num(text_lines[idx + 1])

        brokers: list[BrokerTarget] = []
        consensus = None
        for table in soup.find_all("table"):
            rows = [
                [cell.get_text(" ", strip=True) for cell in tr.find_all(["th", "td"])]
                for tr in table.find_all("tr")
            ]
            if not any(row and row[0] == "Consensus" for row in rows):
                continue

            for row in rows:
                if len(row) < 3:
                    continue
                name = row[0].strip()
                if not name or name in {"추정기관", "적정주가"}:
                    continue
                if name == "Consensus":
                    consensus = _parse_num(row[2])
                    continue

                published_date = row[1].strip() if len(row) > 1 else ""
                target_price = _parse_num(row[2])
                if target_price is None:
                    continue
                rating = row[5] if len(row) > 5 else None
                brokers.append(BrokerTarget(
                    name=name,
                    target_price=target_price,
                    signal=_normalize_fnguide_signal(rating),
                    published_date=published_date.replace("/", "-"),
                    days_ago=_days_ago_from_yyyymmdd(published_date),
                ))
            break

        brokers.sort(key=lambda b: (b.days_ago, b.name))
        prices = [b.target_price for b in brokers]
        if prices:
            out["brokers"] = brokers[:20]
            out["high"] = max(prices)
            out["low"] = min(prices)
            out["median"] = float(statistics.median(prices))
            out["analyst_count"] = len(brokers)
            out["consensus"] = consensus or float(statistics.mean(prices))
        elif consensus:
            out["consensus"] = consensus
    except Exception as e:
        logger.debug("FnGuide consensus fetch failed for %s: %s", ticker, e)
    return out


def _fetch_naver_current_price(ticker: str) -> Optional[float]:
    """Naver Finance 현재가 백업. yfinance가 한국 티커 현재가를 못 줄 때 사용."""
    if not _is_korean_ticker(ticker):
        return None
    try:
        response = requests.get(
            _NAVER_ITEM_URL,
            params={"code": _krx_code(ticker)},
            timeout=8,
            headers={"User-Agent": "Mozilla/5.0"},
        )
        if not response.ok:
            return None
        response.encoding = response.encoding or "EUC-KR"
        soup = BeautifulSoup(response.text, "html.parser")
        node = soup.select_one("p.no_today span.blind")
        return _parse_num(node.get_text(strip=True) if node else None)
    except Exception as e:
        logger.debug("Naver current price fetch failed for %s: %s", ticker, e)
        return None


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

def fetch_analyst_target(ticker: str, force_refresh: bool = False) -> AnalystTarget:
    is_kr = _is_korean_ticker(ticker)
    is_jp = _is_japanese_ticker(ticker)

    # Yahoo 기호 정규화 (일본: 7203 → 7203.T)
    if is_jp:
        yf_symbol = _yahoo_japan_symbol(ticker)
    else:
        yf_symbol = ticker.strip().upper()

    # 캐시 키는 정규화된 yf_symbol 기준 (7203과 7203.T 동일 entry)
    cached = _CACHE.get(yf_symbol)
    now = time.time()
    if not force_refresh and cached and now - cached[0] < _TTL_SECONDS:
        return cached[1]

    yf_fund    = _fetch_yfinance_data(yf_symbol)     # current price + PE/EPS/beta
    yf_an      = _fetch_yfinance_analyst(yf_symbol)  # consensus + brokers + dist
    fg_an      = _fetch_fnguide_consensus(ticker) if is_kr else {}
    beta_hist, sigma_hist = _fetch_beta_sigma_yf(yf_symbol)

    beta_final  = beta_hist or yf_fund.get("beta")
    sigma_final = sigma_hist

    # 통화 결정: yfinance info.currency 우선, 없으면 ticker 패턴으로 추론
    currency = yf_fund.get("currency") or ("KRW" if is_kr else "JPY" if is_jp else "USD")

    current_price = yf_fund.get("current_price")
    naver_current_price = None
    if current_price is None and is_kr:
        naver_current_price = _fetch_naver_current_price(ticker)
        current_price = naver_current_price
    trailing_pe = fg_an.get("trailing_pe") or yf_fund.get("trailing_pe")
    forward_pe = fg_an.get("forward_pe") or yf_fund.get("forward_pe")
    trailing_eps = yf_fund.get("trailing_eps")
    if current_price and trailing_pe and (trailing_eps is None or is_kr):
        trailing_eps = current_price / trailing_pe
    forward_eps = yf_fund.get("forward_eps")
    if current_price and forward_pe and (forward_eps is None or is_kr):
        forward_eps = current_price / forward_pe

    brokers = fg_an.get("brokers") or yf_an["brokers"]
    consensus = fg_an.get("consensus") or yf_an["consensus"]
    high_candidates = [v for v in [fg_an.get("high"), yf_an["high"]] if v is not None]
    low_candidates = [v for v in [fg_an.get("low"), yf_an["low"]] if v is not None]
    high = max(high_candidates) if high_candidates else None
    low = min(low_candidates) if low_candidates else None
    median = fg_an.get("median") or yf_an["median"]
    analyst_count = max([v for v in [fg_an.get("analyst_count"), yf_an["analyst_count"]] if v is not None], default=None)

    # Distribution
    distribution = _compute_distribution_v5(
        brokers=brokers,
        rec_summary=yf_an["rec_summary_row"],
        consensus=consensus,
    )

    has_data = (consensus is not None) or len(brokers) > 0
    if fg_an.get("brokers"):
        source = "fnguide+naver+yfinance" if naver_current_price is not None else "fnguide+yfinance"
    else:
        source = "yfinance" if has_data else "stub"
    result = AnalystTarget(
        consensus=consensus,
        high=high,
        low=low,
        median=median,
        analyst_count=analyst_count,
        current_price=current_price,
        trailing_pe=trailing_pe,
        trailing_eps=trailing_eps,
        forward_eps=forward_eps,
        forward_pe=forward_pe,
        beta=beta_final,
        sigma_annual=sigma_final,
        current_fy_eps=yf_an.get("current_fy_eps"),
        currency=currency,
        brokers=brokers,
        distribution=distribution,
        source=source,
    )
    _CACHE[yf_symbol] = (now, result)
    return result
