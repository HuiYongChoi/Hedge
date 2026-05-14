# Analyst Report v5 Implementation Report

Date: 2026-05-13
Scope: Implemented the already-specified parts of `docs/ui/analyst_report_v5/DESIGN.md` as a frontend-only Phase 1 pass.

## Summary

The existing 6-panel `AnalystReportDashboard` was replaced with a document-style v5 report shell. The new implementation keeps the existing `stock-search-tab.tsx` integration point and delegates rendering to a new component tree under:

`app/frontend/src/components/reports/analyst-report-v5/`

Backend APIs, agent output schemas, and data fetching were not changed.

## Implemented

1. `analyst-report-dashboard.tsx` now acts as a small wrapper around `ReportLayout`.
2. The v5 folder was created with 13 files matching the planned component split:
   - `types.ts`
   - `helpers.ts`
   - `report-layout.tsx`
   - `report-header-ribbon.tsx`
   - `report-toc-sidebar.tsx`
   - `report-body.tsx`
   - `report-section.tsx`
   - `evidence-item.tsx`
   - `inline-data-chip.tsx`
   - `citation-chip.tsx`
   - `key-numbers-strip.tsx`
   - `target-data-sidebar.tsx`
   - `sensitivity-heatmap.tsx`
3. The report layout now has the intended desktop structure:
   - Left sticky TOC and source panel, hidden below `lg`.
   - Center body with 6 mapped sections.
   - Right sticky target-data sidebar, hidden below `lg`.
4. Header ribbon was implemented:
   - Composite score gauge.
   - Score band.
   - Active agent category/name.
   - Signal verdict badge.
   - Confidence badge.
   - Current price and margin-of-safety pills when data exists.
   - Disabled PDF button.
   - Active "원문 대조" button that opens an internal modal.
   - Existing save callback support.
5. Body rendering was implemented:
   - Six section definitions from the design.
   - Reasoning is split into sections with keyword heuristics.
   - Evidence cards render up to 5 parsed items per section.
   - Tone classification supports bullish, bearish, neutral.
   - Inline data chips highlight currency, percentage, multiple, and large-number tokens.
   - Key number strip extracts up to 4 labeled numbers per evidence item.
   - Citation letters are inferred and rendered as inline chips and source rows.
6. Source tracking was implemented:
   - `buildCitations()` returns `[a]` through `[e]`.
   - US tickers link to SEC and Seeking Alpha transcript URLs.
   - Korean-like tickers link to DART and Naver Finance.
   - Non-linked citations show the existing unavailable-source fallback via alert.
   - Hover state from citation chips highlights the source panel row.
7. Right sidebar was implemented:
   - `extractTargetTiles()` builds up to 7 target tiles.
   - `listOtherAgents()` shows up to 5 other agents sorted by confidence.
   - Clicking another agent switches the active report/body/sidebar.
   - Consensus matrix button is present but disabled.
8. Phase 2 placeholder was added:
   - `SensitivityHeatmap` returns `null` when no matrix exists.
   - It is not wired into the visible layout yet.
9. i18n additions were added to `language-preferences.ts` for Korean and English.
10. `stock-search-tab.tsx` now exports helper functions requested by the design:
    - `isKoreanStock`
    - `getKoreanStockCode`
    - `getResearchLinks`
    - `extractCrossCheckGuide`
    - `buildFallbackCrossCheckGuide`
11. Static tests were added/updated:
    - `tests/test_analyst_report_v5_static.py`
    - `tests/test_stock_search_final_decision_ui_static.py`
    - `tests/test_topbar_polish_static.py` was updated to match the current Flow button behavior, where the button can open/focus/create a Flow and is disabled only while opening.

## Important Limitations

1. Multi-ticker rendering is still constrained by the existing stock-search integration, which renders the first final-decision ticker into `AnalystReportDashboard`.
2. Reasoning-to-section mapping is heuristic. It is good enough for Phase 1 structure, but Opus should refine the content model if richer semantic sectioning is required.
3. Citation inference is heuristic and should be treated as source-tracking assistance, not guaranteed provenance.
4. `renderTextWithDataChips()` is exported to match the design helper list, but actual React rendering is done by `TextWithDataChips` in `inline-data-chip.tsx`.
5. The detail report modal currently uses simple `pre` rendering, not the richer markdown renderer from `stock-search-tab.tsx`.
6. PDF export, consensus matrix, URL query sync, and full WACC sensitivity integration remain out of scope for this pass.
7. No backend or agent output schema was changed.
8. No commit, push, or server deploy was performed in this pass.

## Verification

Commands run from `/Users/huiyong/Desktop/Hedge Fund/ai-hedge-fund`:

```bash
/Users/huiyong/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m pytest tests/ --ignore=tests/backtesting -q
```

Result:

```text
242 passed, 3 warnings in 2.29s
```

Command run from `/Users/huiyong/Desktop/Hedge Fund/ai-hedge-fund/app/frontend`:

```bash
/Users/huiyong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc && /Users/huiyong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vite/bin/vite.js build
```

Result:

```text
✓ built in 5.22s
```

Build warnings observed:

1. Browserslist data is outdated.
2. `/fonts/geist.woff2` and `/fonts/geist-mono.woff2` are left for runtime resolution.
3. Sourcemap original-location warnings for `popover.tsx` and `sheet.tsx`.
4. Large bundle chunk warning remains.

These warnings were pre-existing style/build hygiene issues, not blocking errors.

## Suggested Next Design Work For Opus

1. Decide whether v5 should render all final-decision tickers or keep the current single active ticker model.
2. Replace heuristic sectioning with an explicit normalized report view model if agent output can be shaped upstream.
3. Specify richer markdown rendering for the v5 source-comparison modal.
4. Define exact hover/click behavior for citation chips when source links are unavailable.
5. Decide whether `renderTextWithDataChips()` should truly return React nodes or whether the component-based rendering is acceptable.
6. Define Phase 2 activation conditions for `SensitivityHeatmap`.
7. Decide whether the right sidebar target tiles should derive from the active persona report only or merge valuation/forward metrics from canonical agents.
8. Add visual QA criteria for mobile, since sidebars are currently hidden below `lg`.

## Files Changed By This Pass

Primary implementation:

```text
app/frontend/src/components/reports/analyst-report-dashboard.tsx
app/frontend/src/components/reports/analyst-report-v5/types.ts
app/frontend/src/components/reports/analyst-report-v5/helpers.ts
app/frontend/src/components/reports/analyst-report-v5/report-layout.tsx
app/frontend/src/components/reports/analyst-report-v5/report-header-ribbon.tsx
app/frontend/src/components/reports/analyst-report-v5/report-toc-sidebar.tsx
app/frontend/src/components/reports/analyst-report-v5/report-body.tsx
app/frontend/src/components/reports/analyst-report-v5/report-section.tsx
app/frontend/src/components/reports/analyst-report-v5/evidence-item.tsx
app/frontend/src/components/reports/analyst-report-v5/inline-data-chip.tsx
app/frontend/src/components/reports/analyst-report-v5/citation-chip.tsx
app/frontend/src/components/reports/analyst-report-v5/key-numbers-strip.tsx
app/frontend/src/components/reports/analyst-report-v5/target-data-sidebar.tsx
app/frontend/src/components/reports/analyst-report-v5/sensitivity-heatmap.tsx
app/frontend/src/components/tabs/stock-search-tab.tsx
app/frontend/src/lib/language-preferences.ts
```

Tests:

```text
tests/test_analyst_report_v5_static.py
tests/test_stock_search_final_decision_ui_static.py
tests/test_topbar_polish_static.py
```
