# Main Guide And Persistence Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the main landing guide, keep API key controls hidden from the frontend, and persist analysis/report results so navigation and refreshes do not erase them.

**Architecture:** Keep the current settings surface limited to Models, Theme, and Language. Use frontend source-level tests to lock visible UI requirements, reuse the existing `hedge_fund_flows.data` field for Flow runtime state, and add a small backend-backed Stock Analysis run store for non-Flow analysis results. The main page guide becomes the no-active-tab experience and explains the current data pipeline, scoring, portfolio manager, and persistence behavior.

**Tech Stack:** React, TypeScript, Vite, FastAPI, SQLAlchemy, SQLite, pytest static regression tests.

---

### Task 1: Regression Tests For Restored UI Contract

**Files:**
- Create: `tests/test_main_guide_persistence_static.py`

- [ ] **Step 1: Add static regression tests**

Add source-level tests that assert the main guide copy, hidden API key UI policy, Stock Analysis run persistence hooks, and Flow runtime restoration hooks.

- [ ] **Step 2: Run tests to verify RED**

Run: `python3 -m pytest tests/test_main_guide_persistence_static.py -q`

Expected: tests fail before implementation because the restored main guide, Stock Analysis run service usage, and Flow runtime restore are not implemented yet.

---

### Task 2: Main Page Guide Restoration

**Files:**
- Modify: `app/frontend/src/components/tabs/tab-content.tsx`

- [ ] **Step 1: Replace the tiny empty-state copy with a full main guide**

Implement a no-active-tab view that explains:
- data collection and standardization
- US/KR source routing
- agent scoring and confidence
- portfolio manager synthesis
- DB persistence
- settings policy

- [ ] **Step 2: Run the main guide static test**

Run: `python3 -m pytest tests/test_main_guide_persistence_static.py::test_main_page_explains_current_workflow_and_scoring -q`

Expected: PASS.

---

### Task 3: Frontend API Key UI Hiding Cleanup

**Files:**
- Modify: `app/frontend/src/components/settings/index.ts`
- Keep: `app/frontend/src/components/settings/settings.tsx`
- Keep backend API key loading route and service for backend use.

- [ ] **Step 1: Remove the unused frontend export**

Remove `export { ApiKeysSettings } from './api-keys';` from the settings index so the hidden API key page cannot be casually reintroduced through settings imports.

- [ ] **Step 2: Run hidden API UI static test**

Run: `python3 -m pytest tests/test_main_guide_persistence_static.py::test_settings_surface_keeps_api_keys_hidden -q`

Expected: PASS.

---

### Task 4: Stock Analysis Database Persistence

**Files:**
- Modify: `app/backend/database/models.py`
- Modify: `app/backend/models/schemas.py`
- Create: `app/backend/repositories/stock_analysis_run_repository.py`
- Create: `app/backend/routes/stock_analysis_runs.py`
- Modify: `app/backend/routes/__init__.py`
- Create: `app/frontend/src/services/stock-analysis-run-service.ts`
- Modify: `app/frontend/src/components/tabs/stock-search-tab.tsx`

- [ ] **Step 1: Add backend storage model and route**

Create a `stock_analysis_runs` table model and CRUD route with:
- `POST /stock-analysis-runs/`
- `GET /stock-analysis-runs/latest`
- `GET /stock-analysis-runs/{run_id}`

Store request data, result data, UI state, language, ticker, status, and errors.

- [ ] **Step 2: Add frontend service**

Create `stockAnalysisRunService` with `saveLatestRun`, `getLatestRun`, and `getRun`.

- [ ] **Step 3: Serialize and restore Stock Analysis state**

Add `serializeStockAnalysisState` and `restoreStockAnalysisState` to preserve:
- ticker input
- start/end dates
- selected model
- selected agents
- agent results
- complete result
- expanded cards
- selected detail report
- errors

- [ ] **Step 4: Save after meaningful transitions**

Persist on run start, progress updates, complete event, error event, and local input changes with a debounce.

- [ ] **Step 5: Run Stock Analysis persistence static test**

Run: `python3 -m pytest tests/test_main_guide_persistence_static.py::test_stock_analysis_has_database_backed_saved_runs -q`

Expected: PASS.

---

### Task 5: Flow Runtime Result Restoration

**Files:**
- Modify: `app/frontend/src/components/tabs/flow-tab-content.tsx`
- Modify: `app/frontend/src/hooks/use-enhanced-flow-actions.ts`
- Modify: `app/frontend/src/components/Flow.tsx`

- [ ] **Step 1: Restore `nodeContextData` when a Flow is loaded**

Use `importNodeContextData(flowId, flow.data.nodeContextData)` after the base Flow graph state loads.

- [ ] **Step 2: Auto-save runtime state after node context changes**

Trigger complete-state save after SSE result updates so viewed reports survive refresh/navigation.

- [ ] **Step 3: Run Flow restoration static test**

Run: `python3 -m pytest tests/test_main_guide_persistence_static.py::test_flow_runtime_context_is_restored_from_database -q`

Expected: PASS.

---

### Task 6: Data Pipeline And Build Verification

**Files:**
- Inspect: `src/tools/api.py`
- Inspect: `src/tools/dart_api.py`
- Inspect: `src/data/models.py`
- Inspect: `src/utils/llm.py`
- Inspect: `src/agents/*.py`

- [ ] **Step 1: Run existing data pipeline static tests**

Run: `python3 -m pytest tests/test_data_pipeline_standardizer_static.py tests/test_korean_output_requirement_static.py -q`

Expected: PASS or report exact failures and fix only regressions.

- [ ] **Step 2: Run all static regression tests touched by this work**

Run: `python3 -m pytest tests/test_main_guide_persistence_static.py tests/test_stock_search_final_decision_ui_static.py tests/test_cross_check_detail_view_static.py tests/test_data_pipeline_standardizer_static.py tests/test_korean_output_requirement_static.py -q`

Expected: PASS.

- [ ] **Step 3: Run frontend build**

Run: `npm run build -- --base=/hedge/` from `app/frontend`.

Expected: PASS. If repository-wide pre-existing TypeScript issues block `tsc`, run and report `npx vite build --base=/hedge/` as the deploy artifact gate, then separately list typecheck blockers.

---

### Task 7: Commit And Deployment

**Files:**
- Stage all intended files only.

- [ ] **Step 1: Review diff**

Run: `git diff --check` and `git status --short`.

- [ ] **Step 2: Commit**

Run:

```bash
git add <changed-files>
git commit -m "feat: restore main guide and persist analysis results"
```

- [ ] **Step 3: Deploy**

Use the repository's existing server deployment path. Confirm the built `/hedge/` frontend and FastAPI backend are refreshed.

- [ ] **Step 4: Report**

Report the commit hash, deployment target, verification commands, and any known residual risks.
