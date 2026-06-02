"""증권사 컨센서스 목표가 + 현재가 + 브로커 타겟 + 베타/시그마 fetcher (yfinance only)."""
from __future__ import annotations
import logging
import time
import statistics
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Optional
import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# In-memory cache: ticker → (timestamp, result)
_CACHE: dict[str, tuple[float, "AnalystTarget"]] = {}
_TTL_SECONDS = 6 * 3600  # 6 hours
_FNGUIDE_CONSENSUS_URL = "https://wcomp.fnguide.com/CompanyInfo/Consensus"
_NAVER_ITEM_URL = "https://finance.naver.com/item/main.naver"
_NAVER_REALTIME_URL = "https://polling.finance.naver.com/api/realtime/domestic/stock/{code}"
# 시간외 단일가가 직전 정규장 종가에서 얼마나 오래된 것까지 표시할지 (이보다 오래되면 staleness로 숨김)
_OVERTIME_FRESH_HOURS = 14

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
    market_session: Optional[str] = None         # yfinance marketState (PRE/REGULAR/POST/CLOSED ...)
    extended_price: Optional[float] = None        # 프리/애프터장 시세 (표시 전용, 분석 계산엔 미사용)
    extended_change_percent: Optional[float] = None  # 정규장 종가 대비 % (예: 4.07 = +4.07%)
    extended_session: Optional[str] = None        # "pre" | "post" (해당 시간외 세션일 때만)
    forward_ev: Optional[dict] = None             # 선행 EV/EBITDA·EV/EBIT 근사 (미국 전용, 표시 전용)
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


# ── Yahoo Finance Japan 증권사별 분석가 데이터 ─────────────────────────────────

_YAHOO_JP_ANALYST_URL = "https://finance.yahoo.co.jp/quote/{symbol}/analyst-info"

YAHOO_JP_RATING_MAP: dict[str, str] = {
    # 일본어
    "買い": "BUY", "強気": "BUY", "オーバーウエート": "BUY", "オーバーウェイト": "BUY",
    "中立": "HOLD", "ホールド": "HOLD", "ニュートラル": "HOLD",
    "売り": "SELL", "弱気": "SELL", "アンダーウエート": "SELL", "アンダーウェイト": "SELL",
    # 영어 (소문자로 매핑, 비교 시 lower() 사용)
    "buy": "BUY", "outperform": "BUY", "overweight": "BUY",
    "hold": "HOLD", "neutral": "HOLD", "market perform": "HOLD",
    "sell": "SELL", "underperform": "SELL", "underweight": "SELL",
}


def _normalize_yahoo_jp_signal(value: Optional[str]) -> str:
    """Yahoo Finance Japan 투자판단 문자열 → BUY / HOLD / SELL."""
    if not value:
        return "NEUTRAL"
    v = value.strip()
    # 일본어 그대로 시도
    if v in YAHOO_JP_RATING_MAP:
        return YAHOO_JP_RATING_MAP[v]
    # 소문자로 재시도
    return YAHOO_JP_RATING_MAP.get(v.lower(), "NEUTRAL")


def _days_ago_from_jp_date(value: str) -> int:
    """'2026/05/13', '2026年5月13日', '2026-05-13' 형식 → days_ago."""
    s = value.strip()
    for fmt in ("%Y/%m/%d", "%Y年%m月%d日", "%Y-%m-%d", "%Y年%-m月%-d日"):
        try:
            published = datetime.strptime(s, fmt).date()
            return max(0, (date.today() - published).days)
        except Exception:
            continue
    return 0


def _fetch_yahoo_japan_brokers(ticker: str) -> dict:
    """Yahoo Finance Japan analyst-info 페이지에서 증권사별 목표가 + 투자판단 fetch.
    반환 형식은 _fetch_fnguide_consensus와 호환 (dict with brokers/consensus/high/low/median/analyst_count).
    """
    out: dict = {
        "consensus": None, "high": None, "low": None, "median": None,
        "analyst_count": None,
        "brokers": [],
    }
    if not _is_japanese_ticker(ticker):
        return out

    symbol = _yahoo_japan_symbol(ticker)  # '7203.T'
    url = _YAHOO_JP_ANALYST_URL.format(symbol=symbol)
    try:
        response = requests.get(
            url,
            timeout=8,
            headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                              "AppleWebKit/537.36 (KHTML, like Gecko) "
                              "Chrome/124.0.0.0 Safari/537.36",
                "Accept-Language": "ja,en;q=0.8",
            },
        )
        if not response.ok:
            logger.debug("Yahoo JP analyst-info HTTP %s for %s", response.status_code, symbol)
            return out

        soup = BeautifulSoup(response.text, "html.parser")
        brokers: list[BrokerTarget] = []
        prices: list[float] = []

        # ── 테이블 탐색: 헤더에 '目標株価' 또는 '投資判断' 포함된 표 ──
        for table in soup.find_all("table"):
            header_text = table.get_text(" ", strip=True)
            if "目標株価" not in header_text and "投資判断" not in header_text:
                continue
            rows = table.find_all("tr")
            for tr in rows:
                cells = [c.get_text(" ", strip=True) for c in tr.find_all(["th", "td"])]
                if len(cells) < 3:
                    continue
                name = cells[0].strip()
                # 헤더 행 skip
                if not name or any(kw in name for kw in (
                    "証券会社", "目標株価", "投資判断", "発表日", "機関名", "レーティング"
                )):
                    continue
                # 가격 후보: 콤마/숫자 포함 셀
                price: Optional[float] = None
                rating: Optional[str] = None
                pub: str = ""
                for c in cells[1:]:
                    stripped = c.strip()
                    if price is None:
                        candidate = _parse_num(stripped)
                        if candidate and candidate > 50:  # 日本株 최소 단위
                            price = candidate
                            continue
                    if rating is None and (
                        any(k in stripped for k in YAHOO_JP_RATING_MAP)
                        or stripped.lower() in YAHOO_JP_RATING_MAP
                    ):
                        rating = stripped
                        continue
                    if not pub and ("/" in stripped or "年" in stripped or "-" in stripped):
                        pub = stripped
                if price is None:
                    continue
                brokers.append(BrokerTarget(
                    name=name,
                    target_price=price,
                    signal=_normalize_yahoo_jp_signal(rating),
                    published_date=pub if pub else "",
                    days_ago=_days_ago_from_jp_date(pub) if pub else 0,
                ))
                prices.append(price)
            if brokers:
                break  # 첫 매칭 테이블만 사용

        if prices:
            brokers.sort(key=lambda b: (b.days_ago, b.name))
            out["brokers"] = brokers[:20]
            out["high"] = max(prices)
            out["low"] = min(prices)
            out["median"] = float(statistics.median(prices))
            out["analyst_count"] = len(brokers)
            out["consensus"] = float(statistics.mean(prices))

    except Exception as e:
        logger.debug("Yahoo JP analyst fetch failed for %s: %s", ticker, e)
    return out


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

        # 시간외 시세 (프리장/애프터장). 표시 전용 — 밸류에이션 계산엔 정규장가를 계속 사용.
        session = info.get("marketState")
        if isinstance(session, str) and session:
            out["market_session"] = session
            reg_price = info.get("regularMarketPrice")
            reg_price = float(reg_price) if isinstance(reg_price, (int, float)) and float(reg_price) > 0 else None
            ext_price = None
            ext_pct = None
            ext_label = None
            if session in ("PRE", "PREPRE"):
                ext_label = "pre"
                ext_price = info.get("preMarketPrice")
                ext_pct = info.get("preMarketChangePercent")
            elif session in ("POST", "POSTPOST"):
                ext_label = "post"
                ext_price = info.get("postMarketPrice")
                ext_pct = info.get("postMarketChangePercent")
            ext_price = float(ext_price) if isinstance(ext_price, (int, float)) and float(ext_price) > 0 else None
            if ext_label and ext_price is not None:
                out["extended_session"] = ext_label
                out["extended_price"] = ext_price
                # yfinance % 는 이미 퍼센트 단위(예: 4.07). 없으면 정규장가 대비로 직접 계산.
                if isinstance(ext_pct, (int, float)):
                    out["extended_change_percent"] = float(ext_pct)
                elif reg_price:
                    out["extended_change_percent"] = (ext_price - reg_price) / reg_price * 100.0
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

        brokers.sort(key=lambda b: (b.days_ago, b.name))  # 최신순(작은 days_ago 우선)
        # 가장 오래된 5곳은 제외한다. 오래된 목표가는 현재가·최신 실적과 동떨어져
        # 평균을 끌어내려 왜곡하므로, 최신 의견만 남긴다.
        # (브로커가 충분히 많을 때만 적용 — 커버리지가 얇으면 표본이 과도하게 줄어든다.)
        if len(brokers) > 10:
            brokers = brokers[:-5]
        brokers = brokers[:20]  # 레이아웃상 표시 상한
        prices = [b.target_price for b in brokers]
        if prices:
            # 표시 broker == 집계 표본: 사이드바 평균(consensus)과 패널 평균(distribution.average)이
            # 동일한 최신 broker 집합을 쓰도록 통일한다. FnGuide 공식 Consensus(전체 포함)는 쓰지 않는다.
            out["brokers"] = brokers
            out["high"] = max(prices)
            out["low"] = min(prices)
            out["median"] = float(statistics.median(prices))
            out["analyst_count"] = len(brokers)
            out["consensus"] = float(statistics.mean(prices))
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


def _fetch_naver_overtime(ticker: str) -> dict:
    """네이버 실시간 API에서 한국 종목 시간외 단일가를 가져온다 (표시 전용).

    yfinance는 한국 티커에 pre/post-market 가격을 주지 않으므로 네이버 polling API의
    ``overMarketPriceInfo`` (시간외 단일가)를 사용한다. 변동률은 미국 칩과 동일하게
    당일 정규장 종가 대비로 계산한다. 분석 계산에는 쓰지 않는다.
    """
    if not _is_korean_ticker(ticker):
        return {}
    try:
        response = requests.get(
            _NAVER_REALTIME_URL.format(code=_krx_code(ticker)),
            timeout=8,
            headers={"User-Agent": "Mozilla/5.0"},
        )
        if not response.ok:
            return {}
        datas = response.json().get("datas") or []
        if not datas:
            return {}
        data = datas[0] or {}
        ov = data.get("overMarketPriceInfo") or {}
        over_price = _parse_num(ov.get("overPrice"))
        if not over_price or over_price <= 0:
            return {}

        session_type = ov.get("tradingSessionType")
        if session_type == "BEFORE_MARKET":
            ext_session = "pre"
        elif session_type == "AFTER_MARKET":
            ext_session = "post"
        else:
            return {}

        # 오래된 시간외 단일가(전 거래일 잔존 등)는 숨긴다.
        traded_at = ov.get("localTradedAt")
        if traded_at:
            try:
                traded = datetime.fromisoformat(traded_at)
                if traded.tzinfo is None:
                    traded = traded.replace(tzinfo=timezone.utc)
                if datetime.now(timezone.utc) - traded > timedelta(hours=_OVERTIME_FRESH_HOURS):
                    return {}
            except (ValueError, TypeError):
                pass

        out: dict = {
            "extended_session": ext_session,
            "extended_price": over_price,
            "market_session": "PRE" if ext_session == "pre" else "POST",
        }
        close_price = _parse_num(data.get("closePrice"))
        if close_price and close_price > 0:
            out["extended_change_percent"] = (over_price - close_price) / close_price * 100.0
        return out
    except Exception as e:
        logger.debug("Naver overtime fetch failed for %s: %s", ticker, e)
        return {}


def _historical_annual_margins(ticker_obj) -> tuple[list[float], list[float], Optional[float]]:
    """연간 손익계산서(income_stmt)에서 EBITDA 마진·EBIT 마진 시계열과
    최근연도 EBIT/EBITDA 변환비를 추출한다.

    반환: (ebitda_margins, ebit_margins, latest_ebit_to_ebitda_ratio)
    각 마진은 분수(0.438 = 43.8%). 변환비는 0~1로 clamp.
    """
    ebitda_margins: list[float] = []
    ebit_margins: list[float] = []
    latest_conv: Optional[float] = None
    try:
        fin = ticker_obj.income_stmt
        if fin is None or fin.empty:
            return ebitda_margins, ebit_margins, latest_conv

        rev_row = None
        for label in ("Total Revenue", "TotalRevenue", "Operating Revenue"):
            if label in fin.index:
                rev_row = fin.loc[label]
                break
        if rev_row is None:
            return ebitda_margins, ebit_margins, latest_conv

        ebitda_row = fin.loc["EBITDA"] if "EBITDA" in fin.index else None
        ebit_row = fin.loc["EBIT"] if "EBIT" in fin.index else None

        # 컬럼은 회계연도(최근이 앞). 각 연도 마진 수집.
        for col in fin.columns:
            try:
                rev = float(rev_row.get(col))
            except (TypeError, ValueError):
                continue
            if not rev or rev <= 0:
                continue
            if ebitda_row is not None:
                try:
                    margin = float(ebitda_row.get(col)) / rev
                    if -1.0 < margin < 1.5:
                        ebitda_margins.append(margin)
                except (TypeError, ValueError):
                    pass
            if ebit_row is not None:
                try:
                    margin = float(ebit_row.get(col)) / rev
                    if -1.0 < margin < 1.5:
                        ebit_margins.append(margin)
                except (TypeError, ValueError):
                    pass

        # 최근연도 EBIT/EBITDA 변환비 (둘 다 양수인 가장 최근 연도)
        if ebitda_row is not None and ebit_row is not None:
            for col in fin.columns:
                try:
                    ev_val = float(ebitda_row.get(col))
                    eb_val = float(ebit_row.get(col))
                except (TypeError, ValueError):
                    continue
                if ev_val > 0 and eb_val > 0:
                    latest_conv = max(0.0, min(1.0, eb_val / ev_val))
                    break
    except Exception:
        pass
    return ebitda_margins, ebit_margins, latest_conv


def _fetch_forward_ev_multiples(ticker: str) -> Optional[dict]:
    """선행(forward) EV/EBITDA · EV/EBIT 근사치 (미국 종목 전용, 표시 전용 근사).

    무료 소스엔 컨센서스 forward EBITDA가 없어, 컨센서스 forward 매출(현 회계연도 FY1)에
    마진을 곱해 forward EBITDA/EBIT를 추정한다. 두 시나리오를 함께 제공:
      · current    : 현재(TTM) 마진을 그대로 적용
      · normalized : 과거 연간 마진의 중앙값(median)을 적용 (사이클 정규화, 이상치에 강건)
    EV는 yfinance enterpriseValue. EBIT 마진은 신뢰도 낮은 operatingMargins 대신
    'EBITDA 마진 × 최근연도 EBIT/EBITDA 변환비'로 도출(current), normalized는 과거 EBIT 마진 중앙값.
    """
    try:
        import yfinance as yf
        t = yf.Ticker(ticker)
        info = t.info or {}

        ev = _coerce_pos_float(info.get("enterpriseValue"))
        if ev is None:
            return None

        # forward 매출: revenue_estimate 0y(현 회계연도) avg
        fwd_rev = None
        try:
            re_df = t.revenue_estimate
            if re_df is not None and not re_df.empty and "0y" in re_df.index:
                fwd_rev = _coerce_pos_float(re_df.loc["0y", "avg"])
        except Exception:
            pass
        if fwd_rev is None:
            return None

        cur_ebitda_margin = info.get("ebitdaMargins")
        cur_ebitda_margin = (
            float(cur_ebitda_margin)
            if isinstance(cur_ebitda_margin, (int, float)) and 0 < float(cur_ebitda_margin) < 1.5
            else None
        )

        hist_ebitda_margins, hist_ebit_margins, conv = _historical_annual_margins(t)

        # 현재 EBITDA 마진 없으면 과거 중앙값으로 대체
        if cur_ebitda_margin is None and hist_ebitda_margins:
            cur_ebitda_margin = float(statistics.median(hist_ebitda_margins))
        if cur_ebitda_margin is None or cur_ebitda_margin <= 0:
            return None

        norm_ebitda_margin = (
            float(statistics.median(hist_ebitda_margins)) if hist_ebitda_margins else cur_ebitda_margin
        )

        # EBIT 마진:
        #  · current    = 현재 EBITDA 마진 × 최근연도 EBIT/EBITDA 변환비
        #  · normalized = 과거 EBIT 마진 중앙값 (사이클 정규화)
        cur_ebit_margin = cur_ebitda_margin * conv if conv else None
        norm_ebit_margin = (
            float(statistics.median(hist_ebit_margins)) if hist_ebit_margins
            else (norm_ebitda_margin * conv if conv else None)
        )

        def _mult(margin: Optional[float]) -> Optional[float]:
            if margin is None or margin <= 0:
                return None
            denom = fwd_rev * margin
            if denom <= 0:
                return None
            return ev / denom

        result = {
            "enterprise_value": ev,
            "forward_revenue": fwd_rev,
            "ebitda": {
                "current_margin": cur_ebitda_margin,
                "current_multiple": _mult(cur_ebitda_margin),
                "normalized_margin": norm_ebitda_margin,
                "normalized_multiple": _mult(norm_ebitda_margin),
            },
            "ebit": {
                "current_margin": cur_ebit_margin,
                "current_multiple": _mult(cur_ebit_margin),
                "normalized_margin": norm_ebit_margin,
                "normalized_multiple": _mult(norm_ebit_margin),
            },
        }
        # 최소한 EBITDA current 배수가 있어야 의미 있음
        if result["ebitda"]["current_multiple"] is None:
            return None
        return result
    except Exception as e:
        logger.debug("forward EV multiples fetch failed for %s: %s", ticker, e)
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
    # 일본은 yfinance가 broker별 리스트만 비워서 줌 → Yahoo JP analyst-info로 보강
    yjp_an     = _fetch_yahoo_japan_brokers(ticker) if is_jp and not yf_an["brokers"] else {}
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

    # 시간외 시세 (표시 전용 — 분석 계산엔 정규장가를 계속 사용).
    #  · 미국: yfinance marketState + pre/postMarketPrice
    #  · 한국: yfinance가 시간외를 안 주므로 네이버 실시간 API(시간외 단일가) 사용
    #  · 일본: 신뢰 가능한 시간외 소스가 없어 표시하지 않음
    market_session = yf_fund.get("market_session")
    # 선행 EV/EBITDA·EV/EBIT 근사는 미국 종목에서만 (yfinance forward 추정 데이터가 신뢰 가능).
    forward_ev = None
    if is_kr:
        naver_ot = _fetch_naver_overtime(ticker)
        extended_price = naver_ot.get("extended_price")
        extended_change_percent = naver_ot.get("extended_change_percent")
        extended_session = naver_ot.get("extended_session")
        if naver_ot.get("market_session"):
            market_session = naver_ot["market_session"]
    elif is_jp:
        extended_price = None
        extended_change_percent = None
        extended_session = None
    else:
        extended_price = yf_fund.get("extended_price")
        extended_change_percent = yf_fund.get("extended_change_percent")
        extended_session = yf_fund.get("extended_session")
        forward_ev = _fetch_forward_ev_multiples(yf_symbol)
    trailing_pe = fg_an.get("trailing_pe") or yf_fund.get("trailing_pe")
    forward_pe = fg_an.get("forward_pe") or yf_fund.get("forward_pe")
    trailing_eps = yf_fund.get("trailing_eps")
    if current_price and trailing_pe and (trailing_eps is None or is_kr):
        trailing_eps = current_price / trailing_pe
    forward_eps = yf_fund.get("forward_eps")
    if current_price and forward_pe and (forward_eps is None or is_kr):
        forward_eps = current_price / forward_pe

    brokers = fg_an.get("brokers") or yjp_an.get("brokers") or yf_an["brokers"]
    consensus = fg_an.get("consensus") or yf_an["consensus"] or yjp_an.get("consensus")
    high_candidates = [v for v in [fg_an.get("high"), yf_an["high"], yjp_an.get("high")] if v is not None]
    low_candidates  = [v for v in [fg_an.get("low"),  yf_an["low"],  yjp_an.get("low")]  if v is not None]
    high = max(high_candidates) if high_candidates else None
    low  = min(low_candidates)  if low_candidates  else None
    median = fg_an.get("median") or yf_an["median"] or yjp_an.get("median")
    if fg_an.get("brokers"):
        # 한국(FnGuide): 평균에 실제 사용한 증권사 수만 표시한다(가장 오래된 5곳 제외 후).
        # yfinance 투자의견 집계 수(예: 38)와 max로 섞으면 평균 표본을 부풀려 오해를 준다.
        analyst_count = len(brokers)
    else:
        analyst_count = max(
            [v for v in [fg_an.get("analyst_count"), yf_an["analyst_count"], yjp_an.get("analyst_count")] if v is not None],
            default=None,
        )

    # Distribution
    distribution = _compute_distribution_v5(
        brokers=brokers,
        rec_summary=yf_an["rec_summary_row"],
        consensus=consensus,
    )

    has_data = (consensus is not None) or len(brokers) > 0
    if fg_an.get("brokers"):
        source = "fnguide+naver+yfinance" if naver_current_price is not None else "fnguide+yfinance"
    elif yjp_an.get("brokers"):
        source = "yahoo-jp+yfinance"
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
        market_session=market_session,
        extended_price=extended_price,
        extended_change_percent=extended_change_percent,
        extended_session=extended_session,
        forward_ev=forward_ev,
        brokers=brokers,
        distribution=distribution,
        source=source,
    )
    _CACHE[yf_symbol] = (now, result)
    return result
