"""해외 종목 보고서에 원화 표기가 끼어들지 않는다.

실측(MCD): 달러 기업가치·시가총액이 "180,643억 원", "167,725억 원" 으로 찍혔다.
원화로 적게 만든 경로는 세 곳이었다 — 에이전트가 모델에 넘기는 해설 문장,
모든 LLM 출력에 도는 서버 후처리, 멍거 에이전트의 금액 표기.
"""

from src.agents.charlie_munger import make_munger_facts_bundle
from src.utils.financial_formatting import normalize_financial_language, report_currency
from src.utils.llm import infer_report_currency


def _state(*tickers: str) -> dict:
    return {"data": {"tickers": list(tickers)}}


def test_currency_is_inferred_from_the_tickers():
    assert infer_report_currency(_state("MCD")) == "NON_KRW"
    assert infer_report_currency(_state("000660.KS")) == "KRW"
    assert infer_report_currency(_state("005930")) == "KRW"
    # 섞여 있으면 어느 글이 어느 종목인지 모른다 — 원화로 단정하지 않는다.
    assert infer_report_currency(_state("MCD", "000660.KS")) == "NON_KRW"
    # 모르면 종전 동작(원화) 그대로.
    assert infer_report_currency(_state()) is None
    assert infer_report_currency(None) is None


def test_foreign_market_cap_is_not_rewritten_in_won():
    text = "시가총액 167,725,000,000 대비 약 8% 저평가"
    with report_currency("NON_KRW"):
        assert normalize_financial_language(text) == text


def test_korean_market_cap_still_reads_in_won():
    with report_currency("KRW"):
        out = normalize_financial_language("시가총액 1,173,000,000,000,000원 수준")
    assert out == "시가총액: 1,173조 원 수준"


def test_won_unit_does_not_swallow_the_following_word():
    """'1,677억 원대비' 로 붙던 것."""
    out = normalize_financial_language("시가총액 167,725,000,000 대비")
    assert out == "시가총액: 1,677억 원 대비"


def test_explicit_dollar_amount_is_left_alone():
    """'1,677억 원달러' 가 됐던 것 — 뒤에 통화가 있으면 원화가 아니다."""
    text = "시가총액 167725000000 달러"
    assert normalize_financial_language(text) == text


def test_munger_amounts_follow_the_report_currency():
    analysis = {
        "money_unit": "달러",
        "valuation_analysis": {
            "normalized_fcf": 7_200_000_000,
            "intrinsic_value_range": {"reasonable": 180_643_000_000},
        },
    }
    facts = make_munger_facts_bundle(analysis)
    assert facts["정규화 FCF"] == "72억 달러"
    assert facts["적정가 추정치"] == "1,806억 달러"


def test_munger_without_currency_keeps_won_and_na():
    facts = make_munger_facts_bundle({"valuation_analysis": {"normalized_fcf": 425_000_000_000}})
    assert facts["정규화 FCF"] == "4,250억 원"
    assert facts["적정가 추정치"] == "N/A"
