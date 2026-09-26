"""성장주에 맞는 '지금 싼가' 신호 찾기 — 과거 시점 데이터로 신호별 예측력을 잰다.

질문: 매수 후보의 괴리(DCF·오너어닝 적정가 ÷ 시가총액 − 1)는 기술·성장주에서 이후 수익을 맞히는가?
맞히지 못한다면, 그 자리에 쓸 만한 신호가 있는가?

방법
  · 종목: 스캔 시점의 S&P 500 전체(위키백과 GICS 섹터). 현재 구성 종목이라 생존 편향이 있다.
  · 검증일: 2016~최근 매년 4월 15일(한·미 연간 보고서 제출 뒤) 중 12개월 수익률이 나온 날 — 한 국면에
    치우치지 않도록 과거 검증(5년)보다 길게 본다.
  · 재무: SEC companyfacts 중 검증일 전에 제출된 연간 값만(point_in_time.sec_financials_as_of).
  · 결과: 검증일 뒤 12개월 수익률 − 같은 기간 SPY 수익률(초과수익률).
  · 신호(모두 검증일에 알 수 있는 값)
      simple_gap      현재 과거 검증과 같은 간이 괴리(DCF·오너어닝)
      fcf_yield       잉여현금흐름 ÷ 시가총액
      growth_gap      실제 매출 성장률(3년 연평균) − 주가가 전제하는 성장률(역산 DCF)
      ps_cheapness    자기 과거 5년 주가매출비율(PSR) 분포에서 지금이 얼마나 낮은가(1 = 가장 쌈)
  · 그룹: growth(3년 매출 연평균 ≥ 15%), tech(GICS IT·커뮤니케이션), other(나머지)
  · 지표: 해마다 종목 간 순위상관(스피어만 IC)을 내고 평균·양수인 해 수, 상위 1/3 − 하위 1/3 초과수익률.

실행(서버, 저장소 루트에서): python scripts/research/growth_signal_study.py rows.jsonl
분석만 다시:                python scripts/research/growth_signal_study.py rows.jsonl --analyze
"""

from __future__ import annotations

import json
import math
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path
from statistics import mean
from typing import Optional

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

#: 역산 DCF 가정 — 할인율 10%(스캐너 DCF 기본값), 5년 성장 뒤 5년에 걸쳐 영구성장 2.5%로 수렴.
DISCOUNT = 0.10
TERMINAL = 0.025
TECH_SECTORS = {"Information Technology", "Communication Services"}
GROWTH_CAGR = 0.15


STUDY_FIRST_YEAR = 2016


def study_dates(today: date) -> list[date]:
    days = [date(y, 4, 15) for y in range(STUDY_FIRST_YEAR, today.year + 1)]
    return [d for d in days if d + timedelta(days=365) <= today]


def dcf_value(fcf: float, g: float, r: float = DISCOUNT, terminal: float = TERMINAL) -> float:
    """5년 g 성장 → 5년 선형으로 terminal 까지 감속 → 영구가치."""
    value, cash = 0.0, fcf
    for year in range(1, 11):
        rate = g if year <= 5 else g + (terminal - g) * (year - 5) / 5
        cash *= 1 + rate
        value += cash / (1 + r) ** year
    return value + cash * (1 + terminal) / (r - terminal) / (1 + r) ** 10


def implied_growth(fcf: Optional[float], market_cap: Optional[float]) -> Optional[float]:
    """지금 시가총액을 정당화하는 5년 성장률(역산 DCF). 잉여현금흐름이 없거나 범위를 벗어나면 None."""
    if not fcf or fcf <= 0 or not market_cap or market_cap <= 0:
        return None
    lo, hi = -0.30, 0.80
    if dcf_value(fcf, lo) > market_cap or dcf_value(fcf, hi) < market_cap:
        return None
    for _ in range(60):
        mid = (lo + hi) / 2
        if dcf_value(fcf, mid) < market_cap:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def _annual_series(facts: list, cutoff: str) -> dict:
    from src.screener.point_in_time import annual_flow_values

    return annual_flow_values(facts, cutoff)


def revenue_cagr(revenue_by_end: dict, years: int = 3) -> Optional[float]:
    if not revenue_by_end:
        return None
    last_end = max(revenue_by_end)
    last = revenue_by_end[last_end]
    target = date.fromisoformat(last_end) - timedelta(days=365 * years)
    candidates = [e for e in revenue_by_end if abs((date.fromisoformat(e) - target).days) <= 60]
    if not candidates or not last or last <= 0:
        return None
    first = revenue_by_end[min(candidates, key=lambda e: abs((date.fromisoformat(e) - target).days))]
    if not first or first <= 0:
        return None
    return (last / first) ** (1 / years) - 1


def _as_of_series(facts: list, days: list[date]) -> dict:
    """날짜마다 그날까지 제출된 가장 최근 연간 값(달마다 다시 거르지 않도록 제출일 순으로 한 번에 계산)."""
    from src.screener.point_in_time import annual_flow_values

    filed_dates = sorted({str(f.get("filed") or "")[:10] for f in facts if f.get("filed")})
    out: dict = {}
    snapshot: Optional[float] = None
    k = 0
    for day in sorted(days):
        cutoff = day.isoformat()
        advanced = False
        while k < len(filed_dates) and filed_dates[k] <= cutoff:
            k += 1
            advanced = True
        if advanced or snapshot is None:
            series = annual_flow_values(facts, cutoff)
            snapshot = series[max(series)] if series else None
        out[day] = snapshot
    return out


def ps_cheapness(prices: list, revenue_facts: list, share_facts: list, as_of: date) -> Optional[float]:
    """자기 과거 5년 월말 PSR 분포 가운데 지금 PSR 보다 높았던 달의 비율(1 에 가까울수록 지금이 쌈)."""
    import bisect

    days = [as_of] + [date(as_of.year, as_of.month, 1) - timedelta(days=30 * k) for k in range(1, 61)]
    revenue = _as_of_series(revenue_facts, days)
    shares = _as_of_series(share_facts, days)
    dated = sorted((str(p.time)[:10], p.close) for p in prices if getattr(p, "close", None))
    keys = [d for d, _ in dated]

    def ps_at(day: date) -> Optional[float]:
        idx = bisect.bisect_right(keys, day.isoformat()) - 1
        close = dated[idx][1] if idx >= 0 else None
        r, s = revenue.get(day), shares.get(day)
        if not close or not r or r <= 0 or not s or s <= 0:
            return None
        return close * s / r

    now = ps_at(as_of)
    if now is None:
        return None
    history = [v for v in (ps_at(d) for d in days[1:]) if v is not None]
    if len(history) < 24:
        return None
    return sum(1 for v in history if v > now) / len(history)


def study_ticker(entry: dict, today: date, spy: list) -> list[dict]:
    from src.screener import point_in_time as pit
    from src.screener.track_record import close_on_or_before, forward_return
    from src.tools import api
    from src.tools.api import free_sources_only, get_prices

    ticker = entry["ticker"]
    try:
        facts = api._fetch_sec_companyfacts(ticker)
        if not facts:
            return []
        dates = [d for d in study_dates(today)]
        with free_sources_only():
            prices = get_prices(ticker, (dates[0] - timedelta(days=365 * 5 + 60)).isoformat(), today.isoformat()) or []
        revenue_facts = api._sec_fact_candidates(facts, "revenue")
        share_facts = api._sec_fact_candidates(facts, "outstanding_shares")
    except Exception as exc:
        print(f"skip {ticker}: {exc}", file=sys.stderr)
        return []

    rows = []
    for as_of in dates:
        fin = pit.sec_financials_as_of(facts, as_of, api._sec_fact_candidates)
        close = close_on_or_before(prices, as_of)
        shares = (fin or {}).get("outstanding_shares")
        if not fin or not close or not shares:
            continue
        market_cap = close * shares
        ret = forward_return(prices, as_of, 365)
        bench = forward_return(spy, as_of, 365)
        if ret is None or bench is None:
            continue
        value = pit.simple_intrinsic_value(fin)
        quality = pit.quality_from_financials(fin)
        cagr = revenue_cagr(_annual_series(revenue_facts, as_of.isoformat()))
        g_implied = implied_growth(fin.get("free_cash_flow"), market_cap)
        rows.append({
            "ticker": ticker,
            "sector": entry.get("sector"),
            "as_of": as_of.isoformat(),
            "excess_12m": ret - bench,
            "quality_passed": quality["passed"],
            "revenue_cagr_3y": cagr,
            "simple_gap": value / market_cap - 1 if value else None,
            "fcf_yield": (fin.get("free_cash_flow") or 0) / market_cap if fin.get("free_cash_flow") is not None else None,
            "implied_growth": g_implied,
            "growth_gap": cagr - g_implied if cagr is not None and g_implied is not None else None,
            "ps_cheapness": ps_cheapness(prices, revenue_facts, share_facts, as_of),
        })
    return rows


def collect(out_path: Path) -> None:
    from src.screener.full_universe import full_universe
    from src.tools.api import free_sources_only, get_prices

    today = date.today()
    universe = [e for e in full_universe("SP500")]
    with free_sources_only():
        spy = get_prices("SPY", "2015-01-01", today.isoformat()) or []
    done = set()
    if out_path.exists():
        done = {json.loads(line)["ticker"] for line in out_path.read_text().splitlines() if line.strip()}
    todo = [e for e in universe if e["ticker"] not in done]
    print(f"universe {len(universe)} todo {len(todo)}", file=sys.stderr, flush=True)
    with out_path.open("a") as out, ThreadPoolExecutor(max_workers=4) as pool:
        for i, rows in enumerate(pool.map(lambda e: study_ticker(e, today, spy), todo), 1):
            for row in rows:
                out.write(json.dumps(row) + "\n")
            out.flush()
            if i % 25 == 0:
                print(f"{i}/{len(todo)}", file=sys.stderr, flush=True)


# ── 분석 ─────────────────────────────────────────────────────────────────────


def _rank(values: list[float]) -> list[float]:
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        for k in range(i, j + 1):
            ranks[order[k]] = (i + j) / 2
        i = j + 1
    return ranks


def spearman(xs: list[float], ys: list[float]) -> Optional[float]:
    if len(xs) < 8:
        return None
    rx, ry = _rank(xs), _rank(ys)
    mx, my = mean(rx), mean(ry)
    cov = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    vx = math.sqrt(sum((a - mx) ** 2 for a in rx))
    vy = math.sqrt(sum((b - my) ** 2 for b in ry))
    return cov / (vx * vy) if vx and vy else None


def group_of(row: dict) -> list[str]:
    groups = ["all"]
    if row.get("revenue_cagr_3y") is not None and row["revenue_cagr_3y"] >= GROWTH_CAGR:
        groups.append("growth")
    groups.append("tech" if row.get("sector") in TECH_SECTORS else "non_tech")
    return groups


SIGNALS = ("simple_gap", "fcf_yield", "growth_gap", "ps_cheapness")


def analyze(rows: list[dict]) -> dict:
    report: dict = {"n_rows": len(rows), "years": sorted({r["as_of"][:4] for r in rows}), "groups": {}}
    for group in ("all", "growth", "tech", "non_tech"):
        members = [r for r in rows if group in group_of(r)]
        per_signal = {}
        for signal in SIGNALS:
            usable = [r for r in members if r.get(signal) is not None]
            yearly = {}
            for year in sorted({r["as_of"][:4] for r in usable}):
                ys = [r for r in usable if r["as_of"][:4] == year]
                ic = spearman([r[signal] for r in ys], [r["excess_12m"] for r in ys])
                if ic is not None:
                    yearly[year] = {"ic": round(ic, 3), "n": len(ys)}
            # 해마다 상위 1/3 과 하위 1/3 평균 초과수익률의 차이
            spreads = []
            for year in yearly:
                ys = sorted((r for r in usable if r["as_of"][:4] == year), key=lambda r: r[signal])
                third = len(ys) // 3
                if third >= 3:
                    spreads.append(mean(r["excess_12m"] for r in ys[-third:]) - mean(r["excess_12m"] for r in ys[:third]))
            ics = [v["ic"] for v in yearly.values()]
            per_signal[signal] = {
                "n": len(usable),
                "mean_ic": round(mean(ics), 3) if ics else None,
                "years_positive": f"{sum(1 for x in ics if x > 0)}/{len(ics)}",
                "top_minus_bottom_third": round(mean(spreads), 3) if spreads else None,
                "yearly": yearly,
            }
        report["groups"][group] = {"rows": len(members), "signals": per_signal}
    return report


def main() -> None:
    out_path = Path(sys.argv[1] if len(sys.argv) > 1 else "growth_signal_rows.jsonl")
    if "--analyze" not in sys.argv:
        collect(out_path)
    rows = [json.loads(line) for line in out_path.read_text().splitlines() if line.strip()]
    print(json.dumps(analyze(rows), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
