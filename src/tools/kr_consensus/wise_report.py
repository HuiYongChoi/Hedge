"""WiseReport (FnGuide) consensus EPS provider for Korean stocks.

Fetches the quarterly consensus table from
https://comp.fnguide.com/SVO2/asp/SVD_Main.asp?gicode=A{6-digit code}

FnGuide's free portal exposes consensus EPS for future quarters in a table
labeled '투자의견 및 목표주가' or '실적 추정'. Columns with '(E)' suffix
are estimates.
"""
from __future__ import annotations

import logging
import re
import time
from datetime import date

from src.data.models_forward import QuarterlyEPS

logger = logging.getLogger(__name__)

_FNGUIDE_BASE = "https://comp.fnguide.com/SVO2/asp/SVD_Main.asp"
_REQUEST_DELAY = 1.0
_USER_AGENT = "ai-hedge-fund/0.x research bot (+https://github.com)"


class WiseReportProvider:
    name = "WiseReport"

    def fetch_quarterly_eps_estimates(
        self,
        ticker: str,
        as_of_date: date,
        num_quarters: int = 4,
    ) -> list[QuarterlyEPS]:
        code = _to_six_digit(ticker)
        if not code:
            return []

        html = _fetch_html(f"{_FNGUIDE_BASE}?gicode=A{code}&pGB=1&cID=&MenuYn=Y&ReportGB=D&NewMenuID=101&stkGb=701")
        if html is None:
            return []

        try:
            return _parse_estimates(html, as_of_date, num_quarters)
        except Exception as exc:
            logger.warning("WiseReportProvider parse failed for %s: %s", ticker, exc)
            return []


def _to_six_digit(ticker: str) -> str | None:
    code = ticker.split(".")[0]
    return code if re.fullmatch(r"\d{6}", code) else None


def _fetch_html(url: str) -> str | None:
    try:
        import requests

        time.sleep(_REQUEST_DELAY)
        resp = requests.get(
            url,
            headers={"User-Agent": _USER_AGENT},
            timeout=12,
        )
        if resp.status_code != 200:
            logger.warning("WiseReport HTTP %s for %s", resp.status_code, url)
            return None
        resp.encoding = resp.apparent_encoding or "utf-8"
        return resp.text
    except Exception as exc:
        logger.warning("WiseReport fetch failed for %s: %s", url, exc)
        return None


def _parse_estimates(html: str, as_of_date: date, num_quarters: int) -> list[QuarterlyEPS]:
    """Parse FnGuide quarterly EPS estimates.

    FnGuide pages have a section 'divSummary' or 'divConsensus' with tables
    that include rows labeled 'EPS' or '주당순이익(원)'.
    Column headers follow the same YYYY.MM(E) pattern as Naver Finance.
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")

    # FnGuide uses section IDs like 'ReportH1' or table classes
    # Try multiple candidate sections
    candidates = [
        soup.find("div", id="ReportH1"),
        soup.find("div", id="divQuarter"),
        soup.find("div", class_="um_table"),
        soup.find("div", {"id": re.compile(r"(?i)consensus|quarter|summary")}),
        soup,
    ]

    eps_labels = {"eps", "주당순이익", "기본eps", "희석eps", "eps(원)", "주당순이익(원)"}
    results: list[QuarterlyEPS] = []

    for container in candidates:
        if container is None:
            continue
        for table in container.find_all("table"):
            rows = table.find_all("tr")
            if not rows:
                continue

            # Build column header map — skip first cell ("구분" row-label column)
            all_header_cells = rows[0].find_all(["th", "td"])
            headers: list[tuple[date | None, bool]] = []
            for cell in all_header_cells[1:]:
                col_date, is_est = _parse_column_header(cell.get_text(strip=True))
                headers.append((col_date, is_est))

            if not headers or all(h[0] is None for h in headers):
                continue

            for row in rows[1:]:
                cells = row.find_all(["th", "td"])
                if not cells:
                    continue
                label = cells[0].get_text(strip=True).lower().replace(" ", "").replace("(원)", "")
                if not any(lbl in label for lbl in eps_labels):
                    continue

                for i, cell in enumerate(cells[1:]):  # 0-indexed, matches headers
                    if i >= len(headers):
                        break
                    col_date, is_est = headers[i]
                    if col_date is None or not is_est or col_date <= as_of_date:
                        continue
                    eps = _parse_number(cell.get_text(strip=True))
                    if eps is None:
                        continue
                    results.append(
                        QuarterlyEPS(
                            period=_period_label(col_date),
                            fiscal_period_end=col_date,
                            eps=eps,
                            source="consensus",
                            provider="WiseReport",
                            as_of=as_of_date,
                        )
                    )

            if results:
                results.sort(key=lambda q: q.fiscal_period_end)
                return results[:num_quarters]

    return []


def _parse_column_header(text: str) -> tuple[date | None, bool]:
    is_estimate = "(E)" in text or "(e)" in text
    cleaned = re.sub(r"\(E\)", "", text, flags=re.IGNORECASE).strip()
    m = re.match(r"(\d{4})[./\-](\d{2})", cleaned)
    if m:
        year, month = int(m.group(1)), int(m.group(2))
        try:
            day = 31 if month in (3, 12) else 30
            return date(year, month, day), is_estimate
        except ValueError:
            pass
    return None, False


def _parse_number(text: str) -> float | None:
    cleaned = text.replace(",", "").replace(" ", "").strip()
    if cleaned in ("", "-", "－", "N/A"):
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _period_label(d: date) -> str:
    q = ((d.month - 1) // 3) + 1
    return f"{d.year}Q{q}"
