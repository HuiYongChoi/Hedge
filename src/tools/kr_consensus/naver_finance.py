"""Naver Finance consensus EPS provider for Korean stocks.

Fetches the '기업실적분석' (Financial Summary) table from
https://finance.naver.com/item/main.naver?code={6-digit code}
and extracts next-quarter EPS estimates.

Columns marked '(E)' are consensus estimates; unmarked columns are actuals.
When only annual estimates are available, falls back to annualized_split.
"""
from __future__ import annotations

import logging
import re
import time
from datetime import date, datetime

from src.data.models_forward import AnnualEPSEstimate, QuarterlyEPS
from src.tools.kr_consensus.annualized_split import (
    next_quarter_end,
    split_annual_to_next_quarter,
)

logger = logging.getLogger(__name__)

_NAVER_BASE = "https://finance.naver.com/item/main.naver"
_REQUEST_DELAY = 1.0
_USER_AGENT = "ai-hedge-fund/0.x research bot (+https://github.com)"


class NaverConsensusProvider:
    name = "NaverFinance"

    def fetch_quarterly_eps_estimates(
        self,
        ticker: str,
        as_of_date: date,
        num_quarters: int = 4,
    ) -> list[QuarterlyEPS]:
        """Return next-quarter EPS estimates from Naver Finance for a Korean ticker."""
        code = _to_six_digit(ticker)
        if not code:
            return []

        html = _fetch_html(f"{_NAVER_BASE}?code={code}")
        if html is None:
            return []

        try:
            return _parse_consensus_estimates(html, as_of_date, num_quarters)
        except Exception as exc:
            logger.warning("NaverConsensusProvider parse failed for %s: %s", ticker, exc)
            return []

    def fetch_annual_eps_estimates(
        self,
        ticker: str,
        as_of_date: date,
        num_years: int = 2,
    ) -> list[AnnualEPSEstimate]:
        """Return annual EPS estimates from Naver Finance 기업실적분석 table."""
        code = _to_six_digit(ticker)
        if not code:
            return []
        html = _fetch_html(f"{_NAVER_BASE}?code={code}")
        if html is None:
            return []
        try:
            return _parse_annual_estimates(html, as_of_date, num_years)
        except Exception as exc:
            logger.warning("NaverConsensusProvider annual parse failed for %s: %s", ticker, exc)
            return []


def _to_six_digit(ticker: str) -> str | None:
    """'000660.KS' → '000660', bare '000660' passes through."""
    code = ticker.split(".")[0]
    return code if re.fullmatch(r"\d{6}", code) else None


def _fetch_html(url: str) -> str | None:
    try:
        import requests

        time.sleep(_REQUEST_DELAY)
        resp = requests.get(
            url,
            headers={"User-Agent": _USER_AGENT},
            timeout=10,
        )
        if resp.status_code != 200:
            logger.warning("NaverFinance HTTP %s for %s", resp.status_code, url)
            return None
        resp.encoding = resp.apparent_encoding or "euc-kr"
        return resp.text
    except Exception as exc:
        logger.warning("NaverFinance fetch failed for %s: %s", url, exc)
        return None


def _parse_consensus_estimates(
    html: str,
    as_of_date: date,
    num_quarters: int,
) -> list[QuarterlyEPS]:
    """Parse the 기업실적분석 quarterly table and return future-quarter estimates."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")

    # Naver Finance 'section cop_analysis' contains the Financial Summary table
    section = soup.find("div", class_="section cop_analysis")
    if section is None:
        # Fallback: try any table with cop_analysis-like content
        section = soup.find("div", id="content")

    tables = section.find_all("table") if section else soup.find_all("table")
    estimates: list[QuarterlyEPS] = []

    for table in tables:
        result = _parse_table(table, as_of_date)
        estimates.extend(result)
        if estimates:
            break

    # Return future quarters only, sorted, limited
    future = [q for q in estimates if q.fiscal_period_end > as_of_date]
    future.sort(key=lambda q: q.fiscal_period_end)
    return future[:num_quarters]


def _parse_table(table, as_of_date: date) -> list[QuarterlyEPS]:
    """Extract EPS estimates from a single HTML table.

    Expected header row:   구분 | 2025.03 | 2025.06(E) | 2025.09(E) | ...
    Expected EPS row:      EPS(원) | 17,854 | 20,000 | 25,000 | ...
    """
    from bs4 import BeautifulSoup, Tag

    rows = table.find_all("tr")
    if not rows:
        return []

    # --- Parse header row: skip the first cell (row-label column "구분") ---
    header_row = rows[0]
    all_header_cells = header_row.find_all(["th", "td"])
    headers: list[tuple[date | None, bool]] = []  # 0-indexed, aligns with cells[1:]

    for th in all_header_cells[1:]:  # skip "구분" column
        text = th.get_text(strip=True)
        col_date, is_est = _parse_column_header(text)
        headers.append((col_date, is_est))

    if not headers or all(h[0] is None for h in headers):
        return []

    # --- Scan rows for EPS ---
    eps_row_labels = {"eps", "eps(원)", "주당순이익", "기본eps", "희석eps"}
    results: list[QuarterlyEPS] = []

    for row in rows[1:]:
        cells = row.find_all(["th", "td"])
        if not cells:
            continue

        label_text = cells[0].get_text(strip=True).lower().replace(" ", "")
        if not any(label in label_text for label in eps_row_labels):
            continue

        for i, cell in enumerate(cells[1:]):  # 0-indexed, matches headers
            if i >= len(headers):
                break
            col_date, is_est = headers[i]
            if col_date is None or not is_est:
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
                    provider="NaverFinance",
                    as_of=as_of_date,
                )
            )

    return results


def _parse_column_header(text: str) -> tuple[date | None, bool]:
    """Parse '2025.06(E)' → (date(2025,6,30), True), '2025.03' → (date(2025,3,31), False)."""
    is_estimate = "(E)" in text or "(e)" in text or "E)" in text
    cleaned = text.replace("(E)", "").replace("(e)", "").strip()

    # Try YYYY.MM format (Naver Finance standard)
    m = re.match(r"(\d{4})\.(\d{2})", cleaned)
    if m:
        year, month = int(m.group(1)), int(m.group(2))
        try:
            day = 31 if month in (3, 12) else 30
            return date(year, month, day), is_estimate
        except ValueError:
            pass

    # Try YYYY/MM or YYYY-MM
    m = re.match(r"(\d{4})[/\-](\d{2})", cleaned)
    if m:
        year, month = int(m.group(1)), int(m.group(2))
        try:
            day = 31 if month in (3, 12) else 30
            return date(year, month, day), is_estimate
        except ValueError:
            pass

    return None, False


def _parse_number(text: str) -> float | None:
    """Parse Korean-formatted number: '17,854' → 17854.0, '-' → None."""
    cleaned = text.replace(",", "").replace(" ", "").strip()
    if cleaned in ("", "-", "－", "N/A", "n/a"):
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _period_label(d: date) -> str:
    q = ((d.month - 1) // 3) + 1
    return f"{d.year}Q{q}"


def _parse_annual_estimates(
    html: str,
    as_of_date: date,
    num_years: int,
) -> list[AnnualEPSEstimate]:
    """Parse annual (full-year) EPS estimates from the 기업실적분석 table.

    Naver Finance shows annual columns as YYYY.12(E) for December-fiscal companies.
    We treat any (E)-marked column whose month == 12 as an annual estimate.
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    section = soup.find("div", class_="section cop_analysis") or soup.find("div", id="content")
    tables = section.find_all("table") if section else soup.find_all("table")
    results: list[AnnualEPSEstimate] = []

    eps_row_labels = {"eps", "eps(원)", "주당순이익", "기본eps", "희석eps"}

    for table in tables:
        rows = table.find_all("tr")
        if not rows:
            continue
        header_row = rows[0]
        all_header_cells = header_row.find_all(["th", "td"])
        headers: list[tuple[date | None, bool]] = []
        for th in all_header_cells[1:]:
            col_date, is_est = _parse_column_header(th.get_text(strip=True))
            headers.append((col_date, is_est))

        found_eps = False
        for row in rows[1:]:
            cells = row.find_all(["th", "td"])
            if not cells:
                continue
            label_text = cells[0].get_text(strip=True).lower().replace(" ", "")
            if not any(label in label_text for label in eps_row_labels):
                continue
            found_eps = True
            for i, cell in enumerate(cells[1:]):
                if i >= len(headers):
                    break
                col_date, is_est = headers[i]
                if col_date is None or not is_est or col_date <= as_of_date:
                    continue
                # Only keep December-ending columns (annual reports)
                if col_date.month != 12:
                    continue
                eps = _parse_number(cell.get_text(strip=True))
                if eps is None:
                    continue
                results.append(
                    AnnualEPSEstimate(
                        fiscal_year=col_date.year,
                        fiscal_year_end=col_date,
                        eps=eps,
                        source="consensus",
                        provider="NaverFinance",
                        as_of=as_of_date,
                        confidence="medium",
                    )
                )
        if found_eps and results:
            break

    results.sort(key=lambda e: e.fiscal_year_end)
    return results[:num_years]
