"""SEC 태그를 바꾼 회사도 최신 값을 읽는다(src/tools/api.py _sec_fact_candidates)."""

from src.tools import api


def _fact(start, end, val, filed):
    return {"start": start, "end": end, "val": val, "filed": filed, "form": "10-K", "fy": int(end[:4]), "fp": "FY"}


def test_switched_equity_tag_does_not_leave_stale_value():
    # Broadcom 처럼 2019년까지만 StockholdersEquity, 그 뒤는 NCI 포함 태그로 보고한 경우
    companyfacts = {"facts": {"us-gaap": {
        "StockholdersEquity": {"units": {"USD": [_fact(None, "2019-11-03", 24.9e9, "2019-12-20")]}},
        "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest": {"units": {"USD": [
            _fact(None, "2019-11-03", 25.0e9, "2019-12-20"),
            _fact(None, "2025-11-02", 81.3e9, "2025-12-18"),
        ]}},
    }}}
    facts = api._sec_fact_candidates(companyfacts, "shareholders_equity")
    by_end = {f["end"]: (f["val"], f["_concept"]) for f in facts}
    # 두 태그가 모두 있는 기간은 우선 태그, 우선 태그가 끊긴 뒤는 다음 태그로 채운다.
    assert by_end["2019-11-03"] == (24.9e9, "StockholdersEquity")
    assert by_end["2025-11-02"][0] == 81.3e9
    assert api._sec_latest_instant_value(companyfacts, "shareholders_equity", "2025-11-02") == 81.3e9


def test_single_tag_is_unchanged():
    companyfacts = {"facts": {"us-gaap": {"StockholdersEquity": {"units": {"USD": [
        _fact(None, "2024-12-31", 10.0, "2025-02-01"), _fact(None, "2025-12-31", 12.0, "2026-02-01"),
    ]}}}}}
    assert [f["val"] for f in api._sec_fact_candidates(companyfacts, "shareholders_equity")] == [10.0, 12.0]
