# US/KR Web App Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AWS-hosted web app run US and Korean stock analyses without requiring `FINANCIAL_DATASETS_API_KEY`, while defaulting to a working LLM provider when stored keys already exist.

**Architecture:** Keep `src/tools/api.py` as the compatibility layer, but move market-specific behavior into focused helper modules for ticker resolution, `yfinance` access, and Korean enrichment. Resolve backend model defaults at request time from stored keys, then make the frontend settings and node defaults reflect the same behavior.

**Tech Stack:** Python 3.11, FastAPI, Pydantic, SQLAlchemy, Poetry, pytest, React 18, TypeScript, Vite, yfinance, requests

---

## File Structure

- Modify: `pyproject.toml`
  Add `yfinance` as a declared dependency so local and server Poetry environments match the runtime behavior we already rely on.

- Modify: `.env.example`
  Document `DART_API_KEY` and `KRX_API_KEY` as optional enrichment keys and mark `FINANCIAL_DATASETS_API_KEY` as optional.

- Create: `src/tools/market/tickers.py`
  Normalize user ticker input into canonical lookup candidates for US and Korean stocks.

- Create: `src/tools/market/yfinance_client.py`
  Fetch and map prices, statement data, metrics, market cap, news, and best-effort insider data from `yfinance`.

- Create: `src/tools/market/korean_market_client.py`
  Provide optional DART and KRX enrichment helpers for Korean statements, disclosures, and company metadata.

- Modify: `src/tools/api.py:63-366`
  Replace the single-provider Financial Datasets assumption with fallback-aware compatibility functions.

- Create: `app/backend/services/default_model_service.py`
  Resolve `(model_name, model_provider)` from the stored API key set.

- Modify: `app/backend/models/schemas.py:60-97`
  Remove hard-coded OpenAI defaults so runtime resolution can choose a working provider.

- Modify: `app/backend/routes/hedge_fund.py:26-206`
  Hydrate API keys, resolve default model/provider, and pass explicit resolved values into single-run and backtest flows.

- Modify: `app/backend/services/backtest_service.py:24-57`
  Keep the service constructor aligned with the new resolved-default flow.

- Modify: `app/frontend/src/components/settings/api-keys.tsx:16-310`
  Add optional Korean market keys and clarify that Financial Datasets is no longer mandatory.

- Modify: `app/frontend/src/data/models.ts:1-41`
  Choose the default cloud model from active stored keys instead of always returning `gpt-4.1`.

- Modify: `app/frontend/src/nodes/components/stock-analyzer-node.tsx:48-268`
  Update ticker guidance to mention Korean examples.

- Modify: `app/frontend/src/nodes/components/portfolio-start-node.tsx:198-254`
  Keep ticker entry behavior aligned with mixed-market input examples.

- Modify: `app/frontend/src/nodes/components/portfolio-manager-node.tsx:53-87`
  Preserve auto-selected defaults when a working provider exists.

- Create: `tests/test_ticker_utils.py`
  Lock down ticker normalization behavior for US, KOSPI, and KOSDAQ input forms.

- Create: `tests/test_market_data_fallback.py`
  Verify `src.tools.api` returns mapped domain models from patched `yfinance` and Korean enrichment helpers.

- Create: `tests/test_default_model_service.py`
  Verify default LLM selection prefers Gemini when a Google key exists and otherwise falls back to other active providers.

- Modify: `README.md`
  Replace “required Financial Datasets key” language with optional-enrichment guidance and mixed ticker examples.

### Task 1: Add Mixed-Market Ticker Resolution

**Files:**
- Modify: `pyproject.toml`
- Modify: `.env.example`
- Create: `src/tools/market/tickers.py`
- Test: `tests/test_ticker_utils.py`

- [ ] **Step 1: Write the failing ticker resolution tests**

```python
from src.tools.market.tickers import ResolvedTicker, resolve_ticker


def test_resolve_ticker_preserves_us_symbols():
    resolved = resolve_ticker("AAPL")
    assert resolved.canonical == "AAPL"
    assert resolved.market == "US"
    assert resolved.yahoo_candidates == ("AAPL",)


def test_resolve_ticker_expands_plain_korean_code_to_both_markets():
    resolved = resolve_ticker("005930")
    assert resolved.canonical == "005930"
    assert resolved.market == "KR"
    assert resolved.yahoo_candidates == ("005930.KS", "005930.KQ")


def test_resolve_ticker_preserves_explicit_kosdaq_suffix():
    resolved = resolve_ticker("035720.KQ")
    assert resolved.canonical == "035720"
    assert resolved.market == "KOSDAQ"
    assert resolved.yahoo_candidates == ("035720.KQ",)
```

- [ ] **Step 2: Run the ticker test to verify it fails**

Run: `poetry run pytest tests/test_ticker_utils.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'src.tools.market'`

- [ ] **Step 3: Write the minimal ticker resolver and declare dependencies**

```toml
[tool.poetry.dependencies]
yfinance = "^0.2.54"
```

```bash
# .env.example
# Optional Korean enrichment sources
DART_API_KEY=your-dart-api-key
KRX_API_KEY=your-krx-api-key
```

```python
from dataclasses import dataclass


@dataclass(frozen=True)
class ResolvedTicker:
    raw_input: str
    canonical: str
    market: str
    yahoo_candidates: tuple[str, ...]


def resolve_ticker(raw: str) -> ResolvedTicker:
    token = str(raw or "").strip().upper()
    digits = "".join(ch for ch in token if ch.isdigit())

    if token.endswith(".KS"):
        return ResolvedTicker(raw_input=raw, canonical=token[:-3], market="KOSPI", yahoo_candidates=(token,))
    if token.endswith(".KQ"):
        return ResolvedTicker(raw_input=raw, canonical=token[:-3], market="KOSDAQ", yahoo_candidates=(token,))
    if len(digits) == 6 and digits == token:
        return ResolvedTicker(raw_input=raw, canonical=token, market="KR", yahoo_candidates=(f"{token}.KS", f"{token}.KQ"))
    return ResolvedTicker(raw_input=raw, canonical=token, market="US", yahoo_candidates=(token,))
```

- [ ] **Step 4: Run the ticker test to verify it passes**

Run: `poetry run pytest tests/test_ticker_utils.py -v`
Expected: PASS with `3 passed`

- [ ] **Step 5: Commit the ticker resolver baseline**

```bash
git add pyproject.toml .env.example src/tools/market/tickers.py tests/test_ticker_utils.py
git commit -m "feat: add mixed-market ticker resolution"
```

### Task 2: Route Price Data Through yfinance

**Files:**
- Create: `src/tools/market/yfinance_client.py`
- Modify: `src/tools/api.py:63-96,351-366`
- Test: `tests/test_market_data_fallback.py`

- [ ] **Step 1: Write the failing price fallback test**

```python
from datetime import datetime
from unittest.mock import Mock, patch

import pandas as pd

from src.tools.api import get_prices


@patch("src.tools.api._cache")
@patch("src.tools.market.yfinance_client.yf.Ticker")
def test_get_prices_uses_yfinance_for_korean_symbols(mock_ticker, mock_cache):
    mock_cache.get_prices.return_value = None

    history = pd.DataFrame(
        [
            {"Open": 70000.0, "Close": 71000.0, "High": 71500.0, "Low": 69800.0, "Volume": 123456},
        ],
        index=pd.to_datetime([datetime(2024, 1, 2)]),
    )

    ticker_instance = Mock()
    ticker_instance.history.return_value = history
    mock_ticker.return_value = ticker_instance

    prices = get_prices("005930", "2024-01-01", "2024-01-03")

    assert [price.close for price in prices] == [71000.0]
    mock_ticker.assert_called_once_with("005930.KS")
    mock_cache.set_prices.assert_called_once()
```

- [ ] **Step 2: Run the price fallback test to verify it fails**

Run: `poetry run pytest tests/test_market_data_fallback.py::test_get_prices_uses_yfinance_for_korean_symbols -v`
Expected: FAIL because `src.tools.api.get_prices()` still calls `api.financialdatasets.ai`

- [ ] **Step 3: Implement the yfinance price client and wire `get_prices()` to it**

```python
import yfinance as yf
import pandas as pd

from src.tools.market.tickers import resolve_ticker


def fetch_price_history(ticker: str, start_date: str, end_date: str) -> list[dict]:
    resolved = resolve_ticker(ticker)
    for symbol in resolved.yahoo_candidates:
        history = yf.Ticker(symbol).history(
            start=start_date,
            end=end_date,
            auto_adjust=False,
            actions=False,
            repair=True,
        )
        if not history.empty:
            frame = history.reset_index()
            return [
                {
                    "time": pd.Timestamp(row["Date"]).isoformat(),
                    "open": float(row["Open"]),
                    "close": float(row["Close"]),
                    "high": float(row["High"]),
                    "low": float(row["Low"]),
                    "volume": int(row["Volume"]),
                }
                for _, row in frame.iterrows()
            ]
    return []
```

```python
def get_prices(ticker: str, start_date: str, end_date: str, api_key: str = None) -> list[Price]:
    cache_key = f"{ticker}_{start_date}_{end_date}"
    if cached_data := _cache.get_prices(cache_key):
        return [Price(**price) for price in cached_data]

    rows = fetch_price_history(ticker, start_date, end_date)
    if not rows:
        return []

    prices = [Price(**row) for row in rows]
    _cache.set_prices(cache_key, [price.model_dump() for price in prices])
    return prices
```

- [ ] **Step 4: Run the targeted fallback test and the existing rate-limit tests**

Run: `poetry run pytest tests/test_market_data_fallback.py::test_get_prices_uses_yfinance_for_korean_symbols tests/test_api_rate_limiting.py -v`
Expected: PASS, with the new fallback test green and existing `_make_api_request()` tests still green

- [ ] **Step 5: Commit the price fallback slice**

```bash
git add src/tools/market/yfinance_client.py src/tools/api.py tests/test_market_data_fallback.py
git commit -m "feat: add yfinance price fallback"
```

### Task 3: Map Financial Metrics And Statement Line Items

**Files:**
- Create: `src/tools/market/korean_market_client.py`
- Modify: `src/tools/market/yfinance_client.py`
- Modify: `src/tools/api.py:99-180,315-348`
- Test: `tests/test_market_data_fallback.py`

- [ ] **Step 1: Write failing tests for metrics and line-item mapping**

```python
from unittest.mock import patch

from src.tools.api import get_financial_metrics, search_line_items


@patch("src.tools.market.yfinance_client.fetch_quote_snapshot")
@patch("src.tools.market.yfinance_client.fetch_statement_bundle")
def test_get_financial_metrics_maps_yfinance_snapshot(mock_bundle, mock_quote):
    mock_quote.return_value = {"market_cap": 2000000000, "trailing_pe": 11.5, "price_to_book": 1.2}
    mock_bundle.return_value = [
        {
            "report_period": "2024-01-31",
            "revenue": 1000.0,
            "net_income": 150.0,
            "operating_income": 190.0,
            "free_cash_flow": 120.0,
            "total_debt": 300.0,
            "shareholders_equity": 900.0,
            "outstanding_shares": 100.0,
        }
    ]

    metrics = get_financial_metrics("AAPL", "2024-01-31", period="ttm", limit=1)

    assert metrics[0].market_cap == 2000000000
    assert metrics[0].price_to_earnings_ratio == 11.5
    assert metrics[0].debt_to_equity == 300.0 / 900.0


@patch("src.tools.market.korean_market_client.fetch_dart_line_item_overrides")
@patch("src.tools.market.yfinance_client.fetch_statement_bundle")
def test_search_line_items_returns_requested_fields_only(mock_bundle, mock_dart):
    mock_bundle.return_value = [{"report_period": "2024-12-31", "revenue": 1000.0, "net_income": 120.0}]
    mock_dart.return_value = {"2024-12-31": {}}

    line_items = search_line_items("005930", ["revenue", "net_income"], "2024-12-31", period="annual", limit=1)

    assert line_items[0].revenue == 1000.0
    assert line_items[0].net_income == 120.0
```

- [ ] **Step 2: Run the metrics and line-item tests to verify they fail**

Run: `poetry run pytest tests/test_market_data_fallback.py::test_get_financial_metrics_maps_yfinance_snapshot tests/test_market_data_fallback.py::test_search_line_items_returns_requested_fields_only -v`
Expected: FAIL because `get_financial_metrics()` and `search_line_items()` still only understand Financial Datasets payloads

- [ ] **Step 3: Implement statement mapping helpers and optional Korean enrichment**

```python
LINE_ITEM_ALIASES = {
    "revenue": ("Total Revenue", "Operating Revenue"),
    "net_income": ("Net Income", "Net Income Common Stockholders"),
    "operating_income": ("Operating Income",),
    "free_cash_flow": ("Free Cash Flow",),
    "total_debt": ("Total Debt",),
    "shareholders_equity": ("Stockholders Equity", "Total Equity Gross Minority Interest"),
    "outstanding_shares": ("Ordinary Shares Number", "Share Issued"),
}


def build_line_item_payload(ticker: str, period: str, report_period: str, requested_items: list[str], statement_data: dict, overrides: dict) -> dict:
    payload = {
        "ticker": ticker,
        "period": period,
        "report_period": report_period,
        "currency": statement_data.get("currency", "USD"),
    }
    for item in requested_items:
        payload[item] = overrides.get(item, statement_data.get(item))
    return payload


def build_financial_metrics_row(ticker: str, report_period: str, period: str, quote: dict, statement_data: dict) -> dict:
    debt = statement_data.get("total_debt")
    equity = statement_data.get("shareholders_equity")
    return {
        "ticker": ticker,
        "report_period": report_period,
        "period": period,
        "currency": quote.get("currency", "USD"),
        "market_cap": quote.get("market_cap"),
        "price_to_earnings_ratio": quote.get("trailing_pe"),
        "price_to_book_ratio": quote.get("price_to_book"),
        "debt_to_equity": (debt / equity) if debt and equity else None,
        "operating_margin": (statement_data["operating_income"] / statement_data["revenue"]) if statement_data.get("operating_income") and statement_data.get("revenue") else None,
        "earnings_per_share": (statement_data["net_income"] / statement_data["outstanding_shares"]) if statement_data.get("net_income") and statement_data.get("outstanding_shares") else None,
        "book_value_per_share": (equity / statement_data["outstanding_shares"]) if equity and statement_data.get("outstanding_shares") else None,
        "free_cash_flow_per_share": (statement_data["free_cash_flow"] / statement_data["outstanding_shares"]) if statement_data.get("free_cash_flow") and statement_data.get("outstanding_shares") else None,
    }
```

```python
def get_financial_metrics(...):
    ...
    quote = fetch_quote_snapshot(ticker)
    statements = fetch_statement_bundle(ticker, period=period, limit=limit, end_date=end_date)
    if not statements:
        return []
    rows = [FinancialMetrics(**build_financial_metrics_row(ticker, row["report_period"], period, quote, row)) for row in statements]
    _cache.set_financial_metrics(cache_key, [row.model_dump() for row in rows])
    return rows


def search_line_items(...):
    statements = fetch_statement_bundle(ticker, period=period, limit=limit, end_date=end_date)
    overrides = fetch_dart_line_item_overrides(ticker, line_items, end_date, period)
    return [
        LineItem(**build_line_item_payload(ticker, period, row["report_period"], line_items, row, overrides.get(row["report_period"], {})))
        for row in statements[:limit]
    ]
```

- [ ] **Step 4: Run the metrics, line-item, cache, and backtesting smoke tests**

Run: `poetry run pytest tests/test_market_data_fallback.py::test_get_financial_metrics_maps_yfinance_snapshot tests/test_market_data_fallback.py::test_search_line_items_returns_requested_fields_only tests/test_cache.py tests/backtesting/test_valuation.py -v`
Expected: PASS with mapped metrics and line items returning valid optional fields instead of raising

- [ ] **Step 5: Commit the statement-mapping slice**

```bash
git add src/tools/market/korean_market_client.py src/tools/market/yfinance_client.py src/tools/api.py tests/test_market_data_fallback.py
git commit -m "feat: add financial metrics and line item fallbacks"
```

### Task 4: Add News, Insider, And Market-Cap Fallbacks

**Files:**
- Modify: `src/tools/market/yfinance_client.py`
- Modify: `src/tools/market/korean_market_client.py`
- Modify: `src/tools/api.py:183-348`
- Test: `tests/test_market_data_fallback.py`

- [ ] **Step 1: Write failing tests for news, insider-trade degradation, and market cap**

```python
from src.tools.api import get_company_news, get_insider_trades, get_market_cap


@patch("src.tools.market.korean_market_client.fetch_dart_disclosures")
@patch("src.tools.market.yfinance_client.fetch_company_news_items")
def test_get_company_news_falls_back_to_dart_for_korean_symbols(mock_news, mock_dart):
    mock_news.return_value = []
    mock_dart.return_value = [
        {"title": "삼성전자 사업보고서", "date": "2024-03-01", "url": "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=1", "source": "DART"}
    ]

    news = get_company_news("005930", "2024-03-31", start_date="2024-01-01", limit=10)

    assert news[0].source == "DART"
    assert news[0].title.startswith("삼성전자")


@patch("src.tools.market.yfinance_client.fetch_insider_trade_items")
def test_get_insider_trades_returns_empty_list_when_unavailable(mock_trades):
    mock_trades.return_value = []
    assert get_insider_trades("005930", "2024-03-31") == []


@patch("src.tools.market.korean_market_client.fetch_krx_quote_snapshot")
@patch("src.tools.market.yfinance_client.fetch_quote_snapshot")
def test_get_market_cap_prefers_krx_for_korean_symbols(mock_quote, mock_krx):
    mock_quote.return_value = {"market_cap": None}
    mock_krx.return_value = {"market_cap": 450000000000000}

    assert get_market_cap("005930", "2024-03-31") == 450000000000000
```

- [ ] **Step 2: Run the fallback tests to verify they fail**

Run: `poetry run pytest tests/test_market_data_fallback.py::test_get_company_news_falls_back_to_dart_for_korean_symbols tests/test_market_data_fallback.py::test_get_insider_trades_returns_empty_list_when_unavailable tests/test_market_data_fallback.py::test_get_market_cap_prefers_krx_for_korean_symbols -v`
Expected: FAIL because `src.tools.api` still expects Financial Datasets response envelopes

- [ ] **Step 3: Implement graceful fallbacks for news, insider trades, and market cap**

```python
def get_insider_trades(...):
    cache_key = f"{ticker}_{start_date or 'none'}_{end_date}_{limit}"
    if cached_data := _cache.get_insider_trades(cache_key):
        return [InsiderTrade(**trade) for trade in cached_data]

    trades = fetch_insider_trade_items(ticker, start_date=start_date, end_date=end_date, limit=limit)
    if not trades:
        return []

    mapped = [InsiderTrade(**trade) for trade in trades]
    _cache.set_insider_trades(cache_key, [trade.model_dump() for trade in mapped])
    return mapped


def get_company_news(...):
    ...
    news_items = fetch_company_news_items(ticker, start_date=start_date, end_date=end_date, limit=limit)
    if not news_items and resolve_ticker(ticker).market in {"KR", "KOSPI", "KOSDAQ"}:
        news_items = fetch_dart_disclosures(ticker, start_date=start_date, end_date=end_date, limit=limit)
    ...


def get_market_cap(ticker: str, end_date: str, api_key: str = None) -> float | None:
    quote = fetch_quote_snapshot(ticker)
    market_cap = quote.get("market_cap")
    if market_cap:
        return market_cap

    krx_snapshot = fetch_krx_quote_snapshot(ticker)
    if krx_snapshot:
        return krx_snapshot.get("market_cap")

    financial_metrics = get_financial_metrics(ticker, end_date, api_key=api_key)
    return financial_metrics[0].market_cap if financial_metrics else None
```

- [ ] **Step 4: Run the full market-data regression suite**

Run: `poetry run pytest tests/test_market_data_fallback.py tests/test_api_rate_limiting.py tests/backtesting/test_controller.py -v`
Expected: PASS with Korean disclosure fallbacks, empty insider lists, and market-cap lookup returning safe optional values

- [ ] **Step 5: Commit the remaining market-data behavior**

```bash
git add src/tools/market/yfinance_client.py src/tools/market/korean_market_client.py src/tools/api.py tests/test_market_data_fallback.py
git commit -m "feat: add news and company data fallbacks"
```

### Task 5: Resolve Backend Model Defaults From Stored Keys

**Files:**
- Create: `app/backend/services/default_model_service.py`
- Modify: `app/backend/models/schemas.py:60-97`
- Modify: `app/backend/routes/hedge_fund.py:26-206`
- Modify: `app/backend/services/backtest_service.py:24-57`
- Test: `tests/test_default_model_service.py`

- [ ] **Step 1: Write the failing backend default-model tests**

```python
from src.llm.models import ModelProvider
from app.backend.services.default_model_service import resolve_default_model


def test_resolve_default_model_prefers_google_when_key_exists():
    model_name, provider = resolve_default_model({"GOOGLE_API_KEY": "x", "OPENAI_API_KEY": "y"})
    assert model_name == "gemini-3-pro-preview"
    assert provider == ModelProvider.GOOGLE


def test_resolve_default_model_falls_back_to_openai():
    model_name, provider = resolve_default_model({"OPENAI_API_KEY": "x"})
    assert model_name == "gpt-4.1"
    assert provider == ModelProvider.OPENAI
```

- [ ] **Step 2: Run the backend default-model tests to verify they fail**

Run: `poetry run pytest tests/test_default_model_service.py -v`
Expected: FAIL with `ModuleNotFoundError` because `default_model_service.py` does not exist yet

- [ ] **Step 3: Implement runtime default resolution and remove hard-coded request defaults**

```python
from src.llm.models import ModelProvider


DEFAULT_MODEL_PRIORITY = [
    ("GOOGLE_API_KEY", "gemini-3-pro-preview", ModelProvider.GOOGLE),
    ("OPENAI_API_KEY", "gpt-4.1", ModelProvider.OPENAI),
    ("ANTHROPIC_API_KEY", "claude-sonnet-4-6", ModelProvider.ANTHROPIC),
    ("GROQ_API_KEY", "deepseek-chat", ModelProvider.GROQ),
]


def resolve_default_model(api_keys: dict[str, str]) -> tuple[str, ModelProvider]:
    for key_name, model_name, provider in DEFAULT_MODEL_PRIORITY:
        if api_keys.get(key_name):
            return model_name, provider
    return "gpt-4.1", ModelProvider.OPENAI
```

```python
class BaseHedgeFundRequest(BaseModel):
    ...
    model_name: Optional[str] = None
    model_provider: Optional[ModelProvider] = None
```

```python
api_key_service = ApiKeyService(db)
request_data.api_keys = request_data.api_keys or api_key_service.get_api_keys_dict()

if not request_data.model_name or not request_data.model_provider:
    request_data.model_name, request_data.model_provider = resolve_default_model(request_data.api_keys)
```

- [ ] **Step 4: Run the backend tests and one route-level regression**

Run: `poetry run pytest tests/test_default_model_service.py tests/test_api_rate_limiting.py -v`
Expected: PASS with Gemini preferred when `GOOGLE_API_KEY` exists and legacy tests unchanged

- [ ] **Step 5: Commit the backend default-model work**

```bash
git add app/backend/services/default_model_service.py app/backend/models/schemas.py app/backend/routes/hedge_fund.py app/backend/services/backtest_service.py tests/test_default_model_service.py
git commit -m "feat: resolve default models from stored keys"
```

### Task 6: Update Frontend Settings And Auto-Model UX

**Files:**
- Modify: `app/frontend/src/components/settings/api-keys.tsx:16-310`
- Modify: `app/frontend/src/data/models.ts:1-41`
- Modify: `app/frontend/src/nodes/components/stock-analyzer-node.tsx:253-268`
- Modify: `app/frontend/src/nodes/components/portfolio-start-node.tsx:207-254`
- Modify: `app/frontend/src/nodes/components/portfolio-manager-node.tsx:53-87`
- Modify: `README.md`

- [ ] **Step 1: Update the financial-key UI and mixed-ticker help text**

```tsx
const FINANCIAL_API_KEYS: ApiKey[] = [
  {
    key: 'FINANCIAL_DATASETS_API_KEY',
    label: 'Financial Datasets API',
    description: 'Optional premium financial dataset source',
    url: 'https://financialdatasets.ai/',
    placeholder: 'your-financial-datasets-api-key'
  },
  {
    key: 'DART_API_KEY',
    label: 'DART API',
    description: 'Optional Korean corporate filing enrichment',
    url: 'https://opendart.fss.or.kr/',
    placeholder: 'your-dart-api-key'
  },
  {
    key: 'KRX_API_KEY',
    label: 'KRX Open API',
    description: 'Optional Korean market metadata enrichment',
    url: 'https://data.krx.co.kr/',
    placeholder: 'your-krx-api-key'
  }
];
```

```tsx
<TooltipContent side="right">
  You can add multiple tickers using commas (AAPL,NVDA,005930,035720.KQ)
</TooltipContent>
```

- [ ] **Step 2: Make `getDefaultModel()` key-aware**

```tsx
import { apiKeysService } from '@/services/api-keys-api';

const MODEL_PRIORITY: Array<{ provider: string; key: string; modelName: string }> = [
  { provider: 'Google', key: 'GOOGLE_API_KEY', modelName: 'gemini-3-pro-preview' },
  { provider: 'OpenAI', key: 'OPENAI_API_KEY', modelName: 'gpt-4.1' },
  { provider: 'Anthropic', key: 'ANTHROPIC_API_KEY', modelName: 'claude-sonnet-4-6' },
  { provider: 'Groq', key: 'GROQ_API_KEY', modelName: 'deepseek-chat' },
];

export const getDefaultModel = async (): Promise<LanguageModel | null> => {
  const [models, keySummaries] = await Promise.all([getModels(), apiKeysService.getAllApiKeys()]);
  for (const candidate of MODEL_PRIORITY) {
    const hasKey = keySummaries.some(summary => summary.provider === candidate.key && summary.is_active && summary.has_key);
    if (hasKey) {
      const match = models.find(model => model.provider === candidate.provider && model.model_name === candidate.modelName);
      if (match) return match;
    }
  }
  return models[0] || null;
};
```

- [ ] **Step 3: Run frontend validation to catch type or build regressions**

Run: `cd app/frontend && npm run build`
Expected: PASS with Vite build output and no TypeScript errors

- [ ] **Step 4: Update the README installation notes**

```md
- `FINANCIAL_DATASETS_API_KEY` is now optional.
- `GOOGLE_API_KEY` is enough for a working default cloud model in this deployment.
- Korean tickers can be entered as `005930` or explicit Yahoo forms such as `035720.KQ`.
```

- [ ] **Step 5: Commit the UI and docs slice**

```bash
git add app/frontend/src/components/settings/api-keys.tsx app/frontend/src/data/models.ts app/frontend/src/nodes/components/stock-analyzer-node.tsx app/frontend/src/nodes/components/portfolio-start-node.tsx app/frontend/src/nodes/components/portfolio-manager-node.tsx README.md
git commit -m "feat: update mixed-market settings and model defaults"
```

### Task 7: Verify End-To-End On AWS

**Files:**
- Modify: none
- Test: AWS deployment at `/home/bitnami/ai-hedge-fund`

- [ ] **Step 1: Sync the completed branch to the server checkout**

Run:

```bash
rsync -az --delete \
  --exclude '.git' \
  /Users/huiyong/Desktop/Hedge\ Fund/ai-hedge-fund/ \
  bitnami@54.116.99.19:/home/bitnami/ai-hedge-fund/
```

Expected: `rsync` completes with no permission errors

- [ ] **Step 2: Install updated dependencies and restart services**

Run:

```bash
ssh -i '/Users/huiyong/Desktop/Vibe Investment/LightsailDefaultKey-ap-northeast-2.pem' bitnami@54.116.99.19 '
  set -e
  cd /home/bitnami/ai-hedge-fund
  ~/.local/bin/poetry install
  cd app/frontend && npm install && cd ../..
  kill $(cat ~/logs/ai-hedge-backend.pid) || true
  kill $(cat ~/logs/ai-hedge-frontend.pid) || true
  nohup ~/.local/bin/poetry run uvicorn app.backend.main:app --host 127.0.0.1 --port 8000 > ~/logs/ai-hedge-backend.log 2>&1 &
  echo $! > ~/logs/ai-hedge-backend.pid
  cd app/frontend
  nohup npm run dev -- --host 127.0.0.1 --port 5173 > ~/logs/ai-hedge-frontend.log 2>&1 &
  echo $! > ~/logs/ai-hedge-frontend.pid
'
```

Expected: both PID files update and both services stay running

- [ ] **Step 3: Verify the API and frontend respond**

Run:

```bash
ssh -i '/Users/huiyong/Desktop/Vibe Investment/LightsailDefaultKey-ap-northeast-2.pem' bitnami@54.116.99.19 '
  curl -I http://127.0.0.1:8000/language-models/ &&
  curl -I http://127.0.0.1:5173
'
```

Expected: both endpoints return `HTTP/1.1 200 OK`

- [ ] **Step 4: Run mixed-market smoke checks**

Run:

```bash
ssh -i '/Users/huiyong/Desktop/Vibe Investment/LightsailDefaultKey-ap-northeast-2.pem' bitnami@54.116.99.19 '
  cd /home/bitnami/ai-hedge-fund
  ~/.local/bin/poetry run pytest tests/test_ticker_utils.py tests/test_market_data_fallback.py tests/test_default_model_service.py -q
'
```

Expected: pytest exits `0`

- [ ] **Step 5: Manually verify three web runs through the tunneled UI**

Run:

```text
1. Single Run: AAPL
2. Single Run: 005930
3. Single Run or short Backtest: AAPL,005930
```

Expected: the web app completes all three flows without requiring `FINANCIAL_DATASETS_API_KEY`, and the logs do not show unhandled exceptions for missing insider or news data
