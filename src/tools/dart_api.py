"""
DART (전자공시시스템) 기반 한국 상장사 재무데이터 수집 모듈.

OpenDartReader를 사용해 공시된 재무제표를 파싱하고,
에이전트가 소비하는 LineItem / FinancialMetrics 형식으로 변환한다.

우선순위: DART(공식 공시) > yfinance > pykrx
"""
from __future__ import annotations

import logging
import os
import re
import datetime
from functools import lru_cache
from typing import Optional

from src.utils.data_standardizer import derive_financial_fields

logger = logging.getLogger(__name__)

DART_API_KEY = os.environ.get("DART_API_KEY", "514cd3e14517d866beb2f548754bb57863abc166")

# ─── DART 계정명 → LineItem 필드 매핑 ─────────────────────────────────────────
# 각 필드별로 여러 계정명 후보를 우선순위 순으로 나열한다.
# 기업마다 계정명이 조금씩 다를 수 있어 첫 번째 매칭 값을 사용한다.

IS_ACCOUNT_MAP: dict[str, list[str]] = {
    "revenue": [
        "매출액", "영업수익", "수익(매출액)", "매출", "수익",
    ],
    "gross_profit": [
        "매출총이익", "매출총손익", "매출총이익(손실)",
    ],
    "operating_income": [
        "영업이익", "영업이익(손실)", "영업손익",
    ],
    "operating_expense": [
        "판매비와관리비", "판매비및관리비", "판매비", "일반관리비", "영업비용",
    ],
    "ebit": [
        "법인세비용차감전순이익(손실)", "법인세비용차감전순이익",
        "법인세차감전순이익", "세전이익",
    ],
    "net_income": [
        # 지배기업 귀속 우선
        "지배기업의 소유주에게 귀속되는 당기순이익(손실)",
        "지배기업소유주귀속당기순이익",
        "당기순이익(손실)", "당기순이익", "당기순손익",
    ],
    "interest_expense": [
        "이자비용", "금융비용",
    ],
    "research_and_development": [
        "연구개발비", "경상연구개발비", "연구비", "개발비",
    ],
    "depreciation_and_amortization": [
        "감가상각비", "감가상각 및 무형자산상각", "감가상각및상각비", "무형자산상각비",
    ],
    "earnings_per_share": [
        "기본주당이익(손실)", "기본주당순이익(손실)",
        "기본주당이익", "희석주당이익(손실)",
    ],
}

BS_ACCOUNT_MAP: dict[str, list[str]] = {
    "total_assets": ["자산총계"],
    "current_assets": ["유동자산"],
    "current_liabilities": ["유동부채"],
    "total_liabilities": ["부채총계"],
    "shareholders_equity": [
        "지배기업 소유주지분",
        "자본총계",
        "지배기업소유주지분",
    ],
    "cash_and_equivalents": ["현금및현금성자산", "현금및현금성 자산"],
    "inventory": ["재고자산"],
    "total_debt": ["차입금합계", "총차입금", "차입금 총계"],
    "short_term_debt": ["단기차입금", "유동성장기차입금", "유동성사채", "유동성장기부채"],
    "long_term_debt": ["장기차입금", "비유동차입금", "사채", "비유동사채", "장기차입부채"],
    "retained_earnings": ["이익잉여금"],
    "goodwill": ["영업권"],
    "intangible_assets": ["무형자산"],
    "goodwill_and_intangible_assets": ["영업권 및 무형자산", "영업권및무형자산"],
}

CF_ACCOUNT_MAP: dict[str, list[str]] = {
    "operating_cash_flow": [
        "영업활동현금흐름", "영업활동으로인한현금흐름",
        "영업활동으로 인한 현금흐름",
    ],
    "capital_expenditure": [
        "유형자산의 취득", "유형자산취득",
        "유형자산의 구입", "유형자산 취득",
    ],
    "dividends_and_other_cash_distributions": [
        "배당금의 지급", "배당금지급", "현금배당",
    ],
    "issuance_or_purchase_of_equity_shares": [
        "자기주식의 취득", "자기주식취득",
    ],
    "stock_based_compensation": [
        "주식보상비용",
    ],
    "depreciation_and_amortization": [
        "감가상각비", "감가상각및상각비", "유무형자산상각비",
    ],
}

# reprt_code 매핑 (보고서 종류)
REPRT_ANNUAL = "11011"  # 사업보고서
REPRT_H1 = "11014"      # 반기보고서
REPRT_Q3 = "11013"      # 3분기보고서
REPRT_Q1 = "11012"      # 1분기보고서


# ─── 내부 유틸리티 ────────────────────────────────────────────────────────────

_dart_instance = None


def _get_dart() -> object:
    """OpenDartReader 싱글톤 반환."""
    global _dart_instance
    if _dart_instance is None:
        try:
            import OpenDartReader
            _dart_instance = OpenDartReader(DART_API_KEY)
        except Exception as e:
            logger.warning("OpenDartReader 초기화 실패: %s", e)
            return None
    return _dart_instance


# 종목코드 → DART corp_code 변환 캐시 (프로세스 내 메모리 캐시)
_corp_code_cache: dict[str, str] = {}


def _get_corp_code(stock_code: str) -> Optional[str]:
    """6자리 종목코드로 DART corp_code(8자리)를 조회한다."""
    if stock_code in _corp_code_cache:
        return _corp_code_cache[stock_code]
    dart = _get_dart()
    if dart is None:
        return None
    try:
        info = dart.company(stock_code)
        if info and isinstance(info, dict) and info.get("status") == "000":
            corp_code = info["corp_code"]
            _corp_code_cache[stock_code] = corp_code
            return corp_code
    except Exception as e:
        logger.debug("DART corp_code 조회 실패 [%s]: %s", stock_code, e)
    return None


def _parse_amount(val) -> Optional[float]:
    """DART 금액 문자열(예: '6,566,976,000,000')을 float으로 변환한다."""
    if val is None:
        return None
    try:
        s = str(val).replace(",", "").replace(" ", "").strip()
        if not s or s in ("", "-", "－"):
            return None
        return float(s)
    except (ValueError, TypeError):
        return None


def _find_account(df, account_candidates: list[str]) -> Optional[float]:
    """
    DataFrame에서 후보 계정명 리스트 중 첫 번째 매칭 계정의 thstrm_amount를 반환한다.
    괄호 등 공백이 다를 수 있어 정규화 비교도 수행한다.
    """
    if df is None or df.empty:
        return None
    # 계정명 정규화 함수
    def normalize(s: str) -> str:
        return re.sub(r"[\s\(\)\[\]]", "", s)

    df_norm = df["account_nm"].apply(normalize)
    for cand in account_candidates:
        cand_norm = normalize(cand)
        mask = df_norm == cand_norm
        if mask.any():
            val = df.loc[mask, "thstrm_amount"].iloc[0]
            return _parse_amount(val)
    return None


def _find_prev_account(df, account_candidates: list[str]) -> Optional[float]:
    """전기(frmtrm_amount) 값을 반환한다."""
    if df is None or df.empty:
        return None
    def normalize(s: str) -> str:
        return re.sub(r"[\s\(\)\[\]]", "", s)
    df_norm = df["account_nm"].apply(normalize)
    for cand in account_candidates:
        cand_norm = normalize(cand)
        mask = df_norm == cand_norm
        if mask.any():
            val = df.loc[mask, "frmtrm_amount"].iloc[0]
            return _parse_amount(val)
    return None


# ─── 재무제표 파싱 ─────────────────────────────────────────────────────────────

def _fetch_dart_fs(corp_code: str, year: int, reprt_code: str = REPRT_ANNUAL) -> Optional[object]:
    """DART 연결재무제표(CFS) → 별도재무제표(OFS) 순으로 조회한다."""
    dart = _get_dart()
    if dart is None:
        return None
    try:
        # 연결 우선
        df = dart.finstate_all(corp_code, year, reprt_code=reprt_code, fs_div="CFS")
        if df is not None and not df.empty:
            return df
        # 연결 없으면 별도
        df = dart.finstate_all(corp_code, year, reprt_code=reprt_code, fs_div="OFS")
        if df is not None and not df.empty:
            return df
    except Exception as e:
        logger.debug("DART finstate_all 조회 실패 [%s/%s/%s]: %s", corp_code, year, reprt_code, e)
    return None


def _extract_financials(df) -> dict:
    """파싱된 DART DataFrame에서 필요한 계정값들을 추출한다."""
    if df is None or df.empty:
        return {}

    is_df = df[df["sj_div"].isin(["IS", "CIS"])]
    bs_df = df[df["sj_div"] == "BS"]
    cf_df = df[df["sj_div"] == "CF"]

    result = {}
    currency = df["currency"].iloc[0] if "currency" in df.columns and not df.empty else "KRW"
    result["currency"] = currency

    # Income Statement
    for field, candidates in IS_ACCOUNT_MAP.items():
        val = _find_account(is_df, candidates)
        if val is not None:
            result[field] = val
            result[f"{field}_prev"] = _find_prev_account(is_df, candidates)

    # Balance Sheet
    for field, candidates in BS_ACCOUNT_MAP.items():
        val = _find_account(bs_df, candidates)
        if val is not None:
            result[field] = val

    # Cash Flow
    for field, candidates in CF_ACCOUNT_MAP.items():
        val = _find_account(cf_df, candidates)
        if val is not None:
            result[field] = abs(val) if field in ("capital_expenditure", "dividends_and_other_cash_distributions") else val

    # 파생 지표 계산
    op_cf = result.get("operating_cash_flow")
    capex = result.get("capital_expenditure")
    if op_cf is not None and capex is not None:
        result["free_cash_flow"] = op_cf - capex

    # 부채총계가 없으면 자산-자본으로 근사
    if "total_liabilities" not in result:
        ta = result.get("total_assets")
        eq = result.get("shareholders_equity")
        if ta and eq:
            result["total_liabilities"] = ta - eq

    if "total_debt" not in result:
        debt_parts = [result.get("short_term_debt"), result.get("long_term_debt")]
        if any(part is not None for part in debt_parts):
            result["total_debt"] = sum(part or 0 for part in debt_parts)

    # working_capital
    ca = result.get("current_assets")
    cl = result.get("current_liabilities")
    if ca is not None and cl is not None:
        result["working_capital"] = ca - cl

    # 발행주식수 (EPS로 역산)
    ni = result.get("net_income")
    eps = result.get("earnings_per_share")
    if ni and eps and eps != 0:
        result["outstanding_shares"] = ni / eps

    # book_value_per_share
    eq = result.get("shareholders_equity")
    shares = result.get("outstanding_shares")
    if eq and shares and shares != 0:
        result["book_value_per_share"] = eq / shares

    # gross_profit 없으면 revenue - (매출원가) 근사 (IS에 있을 수 있음)
    if "gross_profit" not in result:
        rev = result.get("revenue")
        cogs_candidates = ["매출원가", "매출에 대한 원가", "영업비용"]
        cogs = _find_account(is_df, cogs_candidates)
        if rev and cogs:
            result["gross_profit"] = rev - cogs

    # operating_income 없으면 gross_profit - 판관비 근사
    if "operating_income" not in result:
        gp = result.get("gross_profit")
        sga_candidates = ["판매비와관리비", "판매비및관리비", "판매비", "일반관리비"]
        sga = _find_account(is_df, sga_candidates)
        if gp and sga:
            result["operating_income"] = gp - sga

    # EBITDA 근사 (영업이익 + 감가상각비)
    if "ebitda" not in result:
        oi = result.get("operating_income")
        dep_candidates = ["유형자산감가상각비", "감가상각비", "감가상각 및 무형자산상각"]
        dep = _find_account(cf_df, dep_candidates) or _find_account(is_df, dep_candidates)
        if dep is None:
            # CF 조정항목에서 감가상각 추출
            dep = _find_account(cf_df, ["감가상각비", "감가상각및상각비", "유무형자산상각비"])
        if oi and dep:
            result["ebitda"] = oi + abs(dep)
            result["depreciation_and_amortization"] = abs(dep)

    return derive_financial_fields(result)


# ─── 공개 인터페이스 ──────────────────────────────────────────────────────────

def fetch_dart_line_items(
    ticker: str,
    line_items: list[str],
    end_date: str,
    period: str = "annual",
    limit: int = 5,
) -> list:
    """
    DART 공시 재무제표로부터 LineItem 리스트를 반환한다.

    한국 티커(005930.KS 등)에서 corp_code를 조회하고
    최근 연도부터 limit개 연간 보고서를 파싱해 반환한다.

    Args:
        ticker: 티커 (예: '005930.KS', '086520.KQ')
        line_items: 요청 필드 리스트
        end_date: 기준일 (YYYY-MM-DD)
        period: 'ttm' 또는 'annual' (DART는 실질적으로 연간 단위)
        limit: 반환할 최대 연도 수
    """
    from src.data.models import LineItem

    if not (ticker.endswith(".KS") or ticker.endswith(".KQ")):
        return []

    stock_code = ticker.split(".")[0]
    corp_code = _get_corp_code(stock_code)
    if not corp_code:
        logger.debug("DART corp_code 조회 실패: %s", ticker)
        return []

    # end_date 기준 최근 연도부터 탐색
    end_year = int(end_date[:4])
    results = []

    for offset in range(limit + 1):  # +1: 최근 연도가 공시 전일 수 있음
        year = end_year - offset
        if year < 2010:
            break
        if len(results) >= limit:
            break

        df = _fetch_dart_fs(corp_code, year, REPRT_ANNUAL)
        if df is None:
            continue

        financials = _extract_financials(df)
        if not financials:
            continue

        currency = financials.get("currency", "KRW")
        report_date = f"{year}-12-31"

        # 요청된 필드만 포함
        row = {
            "ticker": ticker,
            "report_period": report_date,
            "period": "annual",
            "currency": currency,
        }
        has_data = False
        for field in line_items:
            if field in financials:
                row[field] = financials[field]
                has_data = True

        if has_data:
            results.append(LineItem(**row))

        # ttm 요청은 가장 최근 연도 1개만 반환
        if period == "ttm":
            break

    return results


def fetch_dart_metrics(ticker: str, end_date: str) -> Optional[dict]:
    """
    DART 재무제표 + yfinance 시장정보를 결합해
    FinancialMetrics 딕셔너리를 반환한다.

    Args:
        ticker: 한국 티커 (예: '005930.KS')
        end_date: 기준일 (YYYY-MM-DD)

    Returns:
        FinancialMetrics 생성에 필요한 dict 또는 None
    """
    if not (ticker.endswith(".KS") or ticker.endswith(".KQ")):
        return None

    stock_code = ticker.split(".")[0]
    corp_code = _get_corp_code(stock_code)
    if not corp_code:
        return None

    end_year = int(end_date[:4])

    # 최근 연도 재무제표 조회
    df = _fetch_dart_fs(corp_code, end_year, REPRT_ANNUAL)
    if df is None:
        df = _fetch_dart_fs(corp_code, end_year - 1, REPRT_ANNUAL)
    if df is None:
        return None

    fin = _extract_financials(df)
    if not fin:
        return None

    # yfinance에서 시장 지표 보완 (PE, PB, 시가총액 등)
    yf_info = {}
    try:
        import yfinance as yf
        t = yf.Ticker(ticker)
        info = t.info or {}
        yf_info = info
    except Exception:
        pass

    report_year = end_year if df is not None else end_year - 1
    report_date = f"{report_year}-12-31"
    currency = fin.get("currency", "KRW")

    # 재무 비율 계산
    revenue = fin.get("revenue")
    gross_profit = fin.get("gross_profit")
    operating_income = fin.get("operating_income")
    net_income = fin.get("net_income")
    total_assets = fin.get("total_assets")
    total_liabilities = fin.get("total_liabilities")
    total_debt = fin.get("total_debt")
    shareholders_equity = fin.get("shareholders_equity")
    current_assets = fin.get("current_assets")
    current_liabilities = fin.get("current_liabilities")
    free_cash_flow = fin.get("free_cash_flow")
    outstanding_shares = fin.get("outstanding_shares")

    def safe_div(a, b):
        try:
            return a / b if (a is not None and b and b != 0) else None
        except Exception:
            return None

    market_cap = yf_info.get("marketCap")
    price = yf_info.get("regularMarketPrice") or yf_info.get("currentPrice")

    gross_margin = safe_div(gross_profit, revenue)
    operating_margin = safe_div(operating_income, revenue)
    net_margin = safe_div(net_income, revenue)
    roe = safe_div(net_income, shareholders_equity)
    roa = safe_div(net_income, total_assets)
    current_ratio = safe_div(current_assets, current_liabilities)
    debt_to_equity = safe_div(total_debt, shareholders_equity)
    liabilities_to_equity = safe_div(total_liabilities, shareholders_equity)
    debt_to_assets = safe_div(total_liabilities, total_assets)

    # 성장률: prev 연도 대비
    revenue_prev = fin.get("revenue_prev")
    net_income_prev = fin.get("net_income_prev")
    revenue_growth = safe_div(revenue - revenue_prev, revenue_prev) if (revenue is not None and revenue_prev not in (None, 0)) else None
    earnings_growth = safe_div(net_income - net_income_prev, abs(net_income_prev)) if (net_income is not None and net_income_prev not in (None, 0)) else None

    # 주당 지표
    eps = fin.get("earnings_per_share") or safe_div(net_income, outstanding_shares)
    bvps = fin.get("book_value_per_share")
    fcf_per_share = safe_div(free_cash_flow, outstanding_shares)

    # 밸류에이션 (시장 데이터)
    pe = yf_info.get("trailingPE") or safe_div(market_cap, net_income)
    pb = yf_info.get("priceToBook") or (safe_div(market_cap, shareholders_equity) if (market_cap and shareholders_equity) else None)
    ps = yf_info.get("priceToSalesTrailing12Months") or safe_div(market_cap, revenue)
    ev = yf_info.get("enterpriseValue")
    ebitda = fin.get("ebitda")
    ev_ebitda = safe_div(ev, ebitda)
    ev_rev = safe_div(ev, revenue)
    fcf_yield = safe_div(free_cash_flow, market_cap)

    return {
        "ticker": ticker,
        "report_period": report_date,
        "period": "ttm",
        "currency": currency,
        "market_cap": market_cap,
        "enterprise_value": ev,
        "price_to_earnings_ratio": pe,
        "price_to_book_ratio": pb,
        "price_to_sales_ratio": ps,
        "enterprise_value_to_ebitda_ratio": ev_ebitda,
        "enterprise_value_to_revenue_ratio": ev_rev,
        "free_cash_flow_yield": fcf_yield,
        "peg_ratio": yf_info.get("pegRatio"),
        "gross_margin": gross_margin,
        "operating_margin": operating_margin,
        "net_margin": net_margin,
        "return_on_equity": roe,
        "return_on_assets": roa,
        "return_on_invested_capital": None,
        "current_ratio": current_ratio,
        "quick_ratio": yf_info.get("quickRatio"),
        "debt_to_equity": debt_to_equity,
        "liabilities_to_equity": liabilities_to_equity,
        "debt_to_assets": debt_to_assets,
        "interest_coverage": None,
        "revenue_growth": revenue_growth,
        "earnings_growth": earnings_growth,
        "book_value_growth": None,
        "payout_ratio": yf_info.get("payoutRatio"),
        "earnings_per_share": eps,
        "book_value_per_share": bvps,
        "free_cash_flow_per_share": fcf_per_share,
        "revenue": revenue,
        "gross_profit": gross_profit,
        "operating_income": operating_income,
        "net_income": net_income,
        "free_cash_flow": free_cash_flow,
        "operating_cash_flow": fin.get("operating_cash_flow"),
        "capital_expenditure": fin.get("capital_expenditure"),
        "depreciation_and_amortization": fin.get("depreciation_and_amortization"),
        "interest_expense": fin.get("interest_expense"),
        "total_debt": total_debt,
        "cash_and_equivalents": fin.get("cash_and_equivalents"),
        "outstanding_shares": outstanding_shares,
        "total_assets": total_assets,
        "total_liabilities": total_liabilities,
        "shareholders_equity": shareholders_equity,
        "current_assets": current_assets,
        "current_liabilities": current_liabilities,
        "research_and_development": fin.get("research_and_development"),
    }
