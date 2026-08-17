"""경영진 보상 구조(SEC DEF 14A 위임장) 수집.

왜 필요한가
    지금 경영진 평가는 '자본배분 실적'(ROIC·증분효율·지분관리 등)만 본다. 그건
    **결과**다. 결과를 만든 **인센티브**가 빠져 있으면 절반이다 — 보상이 성과에
    연동돼 있는지, 단기 주가에만 걸려 있는지에 따라 앞으로의 행동이 달라진다.

DEF 14A 에서 뽑는 것
    · Summary Compensation Table  — 경영진 실수령 보상
    · Pay Versus Performance      — SEC 가 강제하는 '실제 지급 보상 vs 주주수익률' 대조표
    · CEO Pay Ratio               — CEO 대 중위 직원 보수 배수
    · Say-on-Pay                  — 보상안에 대한 주주 찬성률

한국·일본
    한국에는 위임장 공시 제도가 없다. 대신 사업보고서 'VIII. 임원 및 직원 등에
    관한 사항'의 이사·감사 보수현황 표가 대응되며, 이는
    `dart_filings.extract_kr_compensation` 이 담당한다(items 에 "COMP").
    이 모듈은 미국 DEF 14A 만 다룬다.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from typing import Optional

from src.tools.sec_filings import _ARCHIVE_URL, _SUBMISSIONS_URL, _http_get, get_cik_for_ticker, html_to_text

_CACHE_TTL = 6 * 60 * 60
_cache: dict[str, tuple[float, "ProxyCompensation"]] = {}

#: 뽑을 구간과 그 시작을 알리는 표현. 위임장은 40만 자를 넘어 통째로는 못 쓴다.
_SECTIONS = (
    ("pay_vs_performance", "보상 대비 성과 (Pay Versus Performance)",
     re.compile(r"Pay\s+Versus\s+Performance", re.I)),
    ("summary_compensation", "경영진 보상 요약 (Summary Compensation Table)",
     re.compile(r"Summary\s+Compensation\s+Table", re.I)),
    ("pay_ratio", "CEO 대 직원 보수 배수 (Pay Ratio)",
     re.compile(r"(?:CEO\s+)?Pay\s+Ratio", re.I)),
)

#: 목차 항목이 아니라 본문을 잡기 위한 최소 길이.
_MIN_SECTION_CHARS = 600


@dataclass
class ProxySection:
    key: str
    title: str
    text: str
    char_count: int
    truncated: bool


@dataclass
class ProxyCompensation:
    ticker: str
    company_name: Optional[str] = None
    filing_date: Optional[str] = None
    accession: Optional[str] = None
    source_url: Optional[str] = None
    sections: list[ProxySection] = field(default_factory=list)
    say_on_pay_support: Optional[float] = None   # 주주 찬성률(0~1)
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "ticker": self.ticker,
            "company_name": self.company_name,
            "filing_date": self.filing_date,
            "accession": self.accession,
            "source_url": self.source_url,
            "say_on_pay_support": self.say_on_pay_support,
            "sections": [
                {"key": s.key, "title": s.title, "text": s.text,
                 "char_count": s.char_count, "truncated": s.truncated}
                for s in self.sections
            ],
            "error": self.error,
        }


def extract_sections(text: str, budget: int = 3000) -> list[ProxySection]:
    """보상 관련 구간을 잘라낸다.

    같은 표현이 목차와 본문에 모두 나오므로, 등장 위치 중 뒤쪽(본문)을 우선하되
    충분한 분량이 확보되는 지점을 고른다.
    """
    sections: list[ProxySection] = []
    for key, title, pattern in _SECTIONS:
        best: Optional[str] = None
        for match in pattern.finditer(text):
            chunk = text[match.start():match.start() + budget]
            if len(chunk) < _MIN_SECTION_CHARS:
                continue
            # 목차 줄은 뒤에 페이지 번호와 다음 항목이 바로 붙는다. 본문은 문장이 이어진다.
            if len(re.findall(r"[.!?]", chunk[:400])) < 2:
                continue
            best = chunk
            break
        if best:
            sections.append(ProxySection(
                key=key, title=title,
                text=re.sub(r"\s+", " ", best).strip(),
                char_count=len(best), truncated=True,
            ))
    return sections


def extract_say_on_pay(text: str) -> Optional[float]:
    """보상안 주주 찬성률. '95.3% of the votes cast' 형태를 찾는다."""
    window = None
    match = re.search(r"say[- ]on[- ]pay", text, re.I)
    if match:
        window = text[max(0, match.start() - 1500):match.start() + 2500]
    if not window:
        return None
    vote = re.search(r"(\d{2}(?:\.\d+)?)\s*%\s*(?:of\s+)?(?:the\s+)?votes?\s+cast", window, re.I)
    if not vote:
        vote = re.search(r"approximately\s+(\d{2}(?:\.\d+)?)\s*%", window, re.I)
    if vote:
        try:
            return float(vote.group(1)) / 100
        except ValueError:
            return None
    return None


def fetch_latest_proxy(ticker: str, budget: int = 3000) -> ProxyCompensation:
    """최신 DEF 14A 에서 보상 관련 구간을 가져온다. 실패해도 예외를 던지지 않는다."""
    ticker_key = (ticker or "").strip().upper()
    cache_key = f"{ticker_key}:{budget}"
    cached = _cache.get(cache_key)
    if cached and time.time() - cached[0] < _CACHE_TTL:
        return cached[1]

    result = ProxyCompensation(ticker=ticker_key)
    cik = get_cik_for_ticker(ticker_key)
    if cik is None:
        result.error = "SEC CIK not found (한국·일본은 사업보고서의 임원 보수 항목을 사용)"
        _cache[cache_key] = (time.time(), result)
        return result

    try:
        submissions = json.loads(_http_get(_SUBMISSIONS_URL.format(cik=cik)).decode("utf-8"))
        result.company_name = submissions.get("name")
        recent = submissions.get("filings", {}).get("recent", {})
        forms = recent.get("form", [])
        index = next((i for i, f in enumerate(forms) if f == "DEF 14A"), None)
        if index is None:
            result.error = "No DEF 14A in recent filings"
            _cache[cache_key] = (time.time(), result)
            return result

        accession = recent["accessionNumber"][index]
        doc = recent.get("primaryDocument", [""] * len(forms))[index]
        result.filing_date = recent["filingDate"][index]
        result.accession = accession
        result.source_url = _ARCHIVE_URL.format(
            cik=cik, acc=accession.replace("-", ""), doc=doc,
        )

        text = html_to_text(_http_get(result.source_url).decode("utf-8", errors="ignore"))
        result.sections = extract_sections(text, budget=budget)
        result.say_on_pay_support = extract_say_on_pay(text)
        if not result.sections:
            result.error = "Proxy fetched but no compensation section located"
    except Exception as exc:
        result.error = f"{type(exc).__name__}: {exc}"

    _cache[cache_key] = (time.time(), result)
    return result


def build_compensation_context(proxy: ProxyCompensation) -> str:
    """LLM 프롬프트에 넣을 보상 구조 블록. 근거가 없으면 빈 문자열."""
    if not proxy.sections and proxy.say_on_pay_support is None:
        return ""
    header = (
        f"[MANAGEMENT SAID — 보상 구조(SEC DEF 14A 위임장), "
        f"{proxy.company_name or proxy.ticker}, {proxy.filing_date}]\n"
        f"URL: {proxy.source_url}\n"
        "아래는 회사가 제출한 위임장의 보상 관련 원문이다. 경영진 보상·인센티브를 "
        "언급할 때는 이 안의 내용만 쓰고, 없는 수치는 `제공된 자료에서 확인 불가` 로 표기하라.\n"
    )
    parts = [header]
    if proxy.say_on_pay_support is not None:
        parts.append(f"\n· 보상안 주주 찬성률(Say-on-Pay): {proxy.say_on_pay_support:.1%}")
    for section in proxy.sections:
        parts.append(f"\n--- {section.title} ---\n{section.text}")
    return "\n".join(parts)
