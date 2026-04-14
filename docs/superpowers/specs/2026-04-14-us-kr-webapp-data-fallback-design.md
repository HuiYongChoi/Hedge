# US/KR Web App Data Fallback Design

## Summary

This design replaces the app's hard dependency on `FINANCIAL_DATASETS_API_KEY` with a provider-based data access layer that can serve both US and Korean stocks in the existing web application. The primary goal is to keep the current agent and web app interfaces intact while making the backend resilient when Financial Datasets is unavailable.

The recommended implementation keeps the existing `src/tools/api.py` function signatures, adds ticker normalization for mixed US and Korean inputs, uses `yfinance` as the common baseline data source, and layers Korean-specific enrichment from DART and KRX where `yfinance` is incomplete.

## Problem

The current project assumes a Financial Datasets API key is available for:

- historical prices
- financial metrics
- financial statement line items
- insider trades
- company news
- market capitalization and company facts

That creates three practical issues for this deployment:

- the web app fails without a third-party paid or separately provisioned financial data key
- the current setup is tuned for US ticker conventions and does not normalize Korean symbols
- the current default LLM selection points at `OpenAI / gpt-4.1`, which can fail even when a valid Google Gemini key is already available

## Goals

- Run the existing web app on AWS without requiring `FINANCIAL_DATASETS_API_KEY`
- Support US tickers such as `AAPL` and Korean tickers such as `005930` in the same input field
- Preserve the current public backend interfaces used by agents, backtests, and the frontend
- Use existing keys already available to the deployment where practical
- Default the app to a working cloud model provider when a compatible key is already configured

## Non-Goals

- Building a broker-connected live trading system
- Achieving perfect parity with every Financial Datasets field for every market
- Reworking the agent prompts or investing logic beyond what is needed for reliable data access
- Using Kiwoom for this server-side web application path

## Chosen Approach

### 1. Keep the current API surface and replace the internals

The existing functions in `src/tools/api.py` remain the compatibility layer:

- `get_prices`
- `get_financial_metrics`
- `search_line_items`
- `get_insider_trades`
- `get_company_news`
- `get_market_cap`
- helper conversions such as `get_price_data`

These functions will stop assuming a single upstream provider and instead delegate to provider adapters selected at runtime.

### 2. Introduce a provider stack

The data layer will use ordered fallbacks:

- US and KR baseline source: `yfinance`
- KR enrichment source: DART
- KR market metadata source: KRX
- Legacy optional source: Financial Datasets, only if a key is explicitly configured

This keeps the app usable with no Financial Datasets key while preserving compatibility for users who still want to provide one later.

### 3. Normalize user ticker input before lookup

Mixed ticker inputs will be accepted from the existing UI. A ticker resolver will:

- preserve standard US symbols such as `AAPL`
- convert 6-digit Korean stock codes to Yahoo-compatible symbols
- support explicit Yahoo forms such as `005930.KS` and `035720.KQ`
- return a canonical internal symbol plus market metadata used by downstream providers

Initial normalization rules:

- plain 6 digits default to a Korean symbol
- `.KS` means KOSPI
- `.KQ` means KOSDAQ
- any non-numeric ticker without a market suffix is treated as a non-Korean symbol

## Architecture

### Backend flow

1. The web app submits the existing request payload with `tickers`, graph configuration, dates, and model selections.
2. A new ticker normalization layer derives canonical symbols and market hints.
3. `src/tools/api.py` routes each request to provider adapters.
4. Provider adapters return data mapped into the existing Pydantic models in `src/data/models.py`.
5. Agents and backtests continue consuming the same model structures without knowing which upstream source filled the data.

### New backend responsibilities

- `ticker normalization`: resolve US and KR symbol forms into canonical lookup targets
- `data provider adapters`: encapsulate `yfinance`, DART, KRX, and optional Financial Datasets calls
- `field mappers`: translate provider-specific payloads into the existing domain models
- `graceful degradation`: return partial but valid data when a provider lacks a field instead of hard-failing the run

## Data Strategy By Function

### Prices

`get_prices` will use `yfinance` as the default source for both US and KR symbols. It will fetch historical OHLCV data and map it into the existing `Price` model.

Expected behavior:

- mixed market backtests work without a Financial Datasets key
- price caching remains intact
- if a symbol has no price history, return an empty list rather than crashing the graph

### Financial metrics

`get_financial_metrics` will compute or infer the currently used `FinancialMetrics` fields from available provider data.

Source priority:

- Financial Datasets if explicitly configured
- `yfinance` fast info, info, and financial statement summaries
- DART and KRX enrichment for Korean gaps

The implementation does not need perfect coverage of every optional field on day one. It does need enough coverage for the current agents to run without exceptions and produce meaningful output for core metrics such as market cap, profitability, leverage, growth, and valuation ratios where available.

### Line items

`search_line_items` is the most important compatibility function because many agents read detailed accounting fields from it. The design is:

- build a line-item mapper that pulls statement rows from `yfinance`
- map known fields into the requested line-item names
- fill Korean gaps from DART statement data where `yfinance` is incomplete
- return only the requested items in the existing `LineItem` model shape

The first implementation targets the currently requested fields already used by agents in this repository, rather than inventing a generic accounting ontology.

### Company news

`get_company_news` will use:

- `yfinance` news for US and KR when available
- DART disclosures converted into news-like records for Korean symbols

The mapped output will still conform to `CompanyNews`.

### Insider trades

`get_insider_trades` should degrade gracefully:

- US: use the best available source exposed through `yfinance` or return an empty list if unavailable
- KR: return an empty list unless a reliable enrichment path is available later

This is acceptable because the existing agent logic already tolerates empty insider-trade results better than total request failure.

### Market cap and company facts

`get_market_cap` and related company fact lookups will prefer:

- `yfinance`
- KRX for Korean market metadata where needed
- optional Financial Datasets if configured

## API Keys And Settings

### Financial data settings

The settings page should no longer imply that `FINANCIAL_DATASETS_API_KEY` is mandatory. Instead:

- keep Financial Datasets as an optional advanced source
- add visible support for `DART_API_KEY`
- add visible support for `KRX_API_KEY`
- continue storing keys through the existing backend key repository

### LLM defaults

The current frontend and backend defaults prefer `OpenAI / gpt-4.1`. The deployment already has a Google Gemini key, so the default selection should become resilient.

Recommended rule:

- if a saved Google key exists, default to `Google / gemini-3-pro-preview`
- otherwise fall back to the first provider with an active compatible key
- only use `OpenAI / gpt-4.1` when an OpenAI-compatible key is actually present

This change must apply both to frontend default selection and backend request defaults so the first run works without manual provider switching.

## Error Handling

- Missing optional fields should produce `None` values, not crashes
- Missing news or insider-trade sources should return empty lists
- Unknown Korean ticker formats should fail with a clear validation message
- Provider errors should be logged with the provider name and ticker so AWS debugging remains practical
- The app should still run even if DART or KRX is not configured, using `yfinance` alone where possible

## Testing And Validation

The implementation is considered successful when the AWS web app can complete these paths:

- single-run analysis for `AAPL`
- single-run analysis for `005930`
- mixed single-run analysis for `AAPL,005930`
- short backtest for `AAPL`
- short backtest for `005930`
- short backtest for `AAPL,005930`

Validation should confirm:

- the app starts without `FINANCIAL_DATASETS_API_KEY`
- the settings page stores and reloads the new keys
- default model selection lands on a working provider
- agent execution does not fail when optional data categories are empty

## Risks

- Korean statement coverage in `yfinance` can be incomplete, so DART mapping quality matters
- Some advanced valuation or sentiment outputs may be less rich than the Financial Datasets path
- `yfinance` field names and availability can vary by symbol and over time, so adapters must be defensive
- Korean insider-trade parity is intentionally incomplete in the first version

## Implementation Boundaries

This should be delivered as one focused project because the required changes all converge on a single outcome: making the current AWS-hosted web app operational for mixed US and KR tickers without a mandatory Financial Datasets dependency.

The work should stay narrowly scoped to:

- data access and mapping
- ticker normalization
- settings and default model behavior
- AWS deployment verification for the web app

## Open Decisions Resolved In This Design

- Korean and US tickers are both in scope for the same web app flow
- plain 6-digit inputs are treated as Korean stock codes
- `yfinance` is the common baseline provider
- DART and KRX are enrichment sources, not primary mandatory dependencies
- Kiwoom is excluded from the server-hosted web app implementation
- Financial Datasets remains optional rather than required
