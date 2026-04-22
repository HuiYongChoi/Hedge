from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
import asyncio

from app.backend.database import get_db
from app.backend.models.schemas import (
    ErrorResponse, HedgeFundRequest, BacktestRequest, BacktestDayResult,
    BacktestPerformanceMetrics, FetchMetricsRequest, FetchMetricsResponse,
)
from app.backend.models.events import StartEvent, ProgressUpdateEvent, ErrorEvent, CompleteEvent
from app.backend.services.graph import create_graph, parse_hedge_fund_response, run_graph_async
from app.backend.services.portfolio import create_portfolio
from app.backend.services.backtest_service import BacktestService
from app.backend.services.api_key_service import ApiKeyService
from src.utils.progress import progress
from src.utils.analysts import get_agents_list
from src.tools.api import get_financial_metrics, get_market_cap, get_prices, search_line_items

router = APIRouter(prefix="/hedge-fund")

# Union of all line_items fields requested by any of the 18 agents.
# Used by /fetch-metrics to batch-fetch everything in one call.
COMMON_LINE_ITEMS_UNION = [
    # Revenue & Profitability
    "revenue",
    "gross_profit",
    "gross_margin",
    "operating_income",
    "operating_margin",
    "net_income",
    "earnings_per_share",
    "operating_expense",
    # Cash Flow
    "free_cash_flow",
    "operating_cash_flow",
    "capital_expenditure",
    "depreciation_and_amortization",
    # Balance Sheet
    "total_assets",
    "total_liabilities",
    "shareholders_equity",
    "cash_and_equivalents",
    "current_assets",
    "current_liabilities",
    "total_debt",
    "short_term_debt",
    "long_term_debt",
    "goodwill",
    "intangible_assets",
    # Leverage / Capital Allocation
    "debt_to_equity",
    "return_on_invested_capital",
    "book_value_per_share",
    "free_cash_flow_per_share",
    "interest_coverage",
    "outstanding_shares",
    "dividends_and_other_cash_distributions",
    "issuance_or_purchase_of_equity_shares",
    # R&D (Cathie Wood)
    "research_and_development",
    # Interest
    "interest_expense",
    "ebit",
    "ebitda",
]

@router.post(
    path="/fetch-metrics",
    response_model=FetchMetricsResponse,
    responses={
        200: {"description": "Raw financial metrics and line items for the given ticker"},
        400: {"model": ErrorResponse, "description": "Invalid request parameters"},
        500: {"model": ErrorResponse, "description": "Internal server error"},
    },
)
async def fetch_metrics(request_data: FetchMetricsRequest, db: Session = Depends(get_db)):
    """Fetch raw financial data for a ticker WITHOUT running any agents.

    Returned data is intended for the Data Sandbox UI so users can review
    and override values before triggering a full agent run.
    """
    try:
        # Hydrate API keys from database if not provided
        api_keys = request_data.api_keys
        if not api_keys:
            api_key_service = ApiKeyService(db)
            api_keys = api_key_service.get_api_keys_dict()

        fin_api_key = api_keys.get("FINANCIAL_DATASETS_API_KEY") if api_keys else None

        ticker = request_data.ticker.upper().strip()
        end_date = request_data.end_date
        period = request_data.period
        limit = request_data.limit

        # All data-fetching calls are blocking (sync HTTP).  Wrapping each in
        # run_in_threadpool offloads them to a thread so the async event loop
        # stays free for other requests while the API calls are in flight.

        # 1. FinancialMetrics — get_financial_metrics now enriches internally
        #    (fills income-statement nulls, re-derives P/E, P/B, P/S).
        cache_key = f"{ticker}_{period}_{end_date}_{limit}"
        metrics_list = await run_in_threadpool(
            get_financial_metrics, ticker, end_date, period, limit, fin_api_key
        )
        metrics_dict = metrics_list[0].model_dump() if metrics_list else None

        # 2. Market cap (cached after first call)
        market_cap = await run_in_threadpool(
            get_market_cap, ticker, end_date, fin_api_key
        )

        # 3. Prices
        from datetime import datetime, timedelta
        start_date = request_data.start_date or (
            datetime.strptime(end_date, "%Y-%m-%d") - timedelta(days=90)
        ).strftime("%Y-%m-%d")
        prices_list = await run_in_threadpool(
            get_prices, ticker, start_date, end_date, fin_api_key
        )
        prices_dicts = [p.model_dump() for p in prices_list]

        # 4. Line items — full agents' union for the Data Sandbox display
        line_items_list = await run_in_threadpool(
            search_line_items, ticker, COMMON_LINE_ITEMS_UNION, end_date, period, limit, fin_api_key
        )
        line_items_dicts = [li.model_dump() for li in line_items_list]

        return FetchMetricsResponse(
            ticker=ticker,
            metrics=metrics_dict,
            market_cap=market_cap,
            prices=prices_dicts,
            line_items=line_items_dicts,
            cache_key=cache_key,
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch metrics: {str(e)}")


@router.post(
    path="/run",
    responses={
        200: {"description": "Successful response with streaming updates"},
        400: {"model": ErrorResponse, "description": "Invalid request parameters"},
        500: {"model": ErrorResponse, "description": "Internal server error"},
    },
)
async def run(request_data: HedgeFundRequest, request: Request, db: Session = Depends(get_db)):
    try:
        # Hydrate API keys from database if not provided
        if not request_data.api_keys:
            api_key_service = ApiKeyService(db)
            request_data.api_keys = api_key_service.get_api_keys_dict()

        # Create the portfolio
        portfolio = create_portfolio(request_data.initial_cash, request_data.margin_requirement, request_data.tickers, request_data.portfolio_positions)

        # Inject metric overrides into cache before graph execution
        if request_data.metric_overrides:
            from src.data.cache import get_cache as _get_cache
            _run_cache = _get_cache()
            from datetime import datetime as _dt
            _end_date = request_data.end_date or _dt.now().strftime("%Y-%m-%d")
            for _ticker, _overrides in request_data.metric_overrides.items():
                _tkr = _ticker.upper()

                # Financial metrics: merge user overrides, re-derive all valuation ratios,
                # then write to every cached key that starts with this ticker prefix so
                # agents calling get_financial_metrics with any period/limit see the overrides.
                if "metrics" in _overrides:
                    _raw = _overrides["metrics"]
                    _clean = {k: v for k, v in _raw.items() if v is not None and v != ""}
                    if _clean:
                        from src.utils.data_standardizer import enrich_metrics_from_line_items as _enrich
                        _metrics_key = f"{_tkr}_ttm_{_end_date}_10"
                        _existing = _run_cache.get_financial_metrics(_metrics_key)
                        _base = dict(_existing[0]) if _existing else {}
                        _base.update(_clean)
                        _base.setdefault("report_period", _end_date)
                        # Reset derived ratios and re-enrich with the updated base data
                        _li_source = _run_cache._line_items_cache.get(_tkr) or []
                        _base = _enrich(_base, _li_source, _base.get("market_cap"))
                        # Write to every existing key for this ticker (period/limit variants)
                        _updated_any = False
                        for _k in list(_run_cache._financial_metrics_cache.keys()):
                            if _k.startswith(f"{_tkr}_"):
                                _run_cache._financial_metrics_cache[_k] = [_base]
                                _updated_any = True
                        if not _updated_any:
                            _run_cache._financial_metrics_cache[_metrics_key] = [_base]

                # Line items: force-set so search_line_items cache-check picks it up
                if "line_items" in _overrides:
                    _li_data = _overrides["line_items"]
                    if _li_data:
                        # Filter out rows where all override values are None/""
                        _li_clean = [
                            {k: v for k, v in row.items() if v is not None and v != ""}
                            for row in _li_data
                        ]
                        _li_clean = [row for row in _li_clean if row]
                        if _li_clean:
                            _run_cache._line_items_cache[_tkr] = _li_clean

        # Construct agent graph using the React Flow graph structure
        graph = create_graph(
            graph_nodes=request_data.graph_nodes,
            graph_edges=request_data.graph_edges
        )
        graph = graph.compile()

        # Log a test progress update for debugging
        progress.update_status("system", None, "Preparing hedge fund run")

        # Convert model_provider to string if it's an enum
        model_provider = request_data.model_provider
        if hasattr(model_provider, "value"):
            model_provider = model_provider.value

        # Function to detect client disconnection
        async def wait_for_disconnect():
            """Wait for client disconnect and return True when it happens"""
            try:
                while True:
                    message = await request.receive()
                    if message["type"] == "http.disconnect":
                        return True
            except Exception:
                return True

        # Set up streaming response
        async def event_generator():
            # Queue for progress updates
            progress_queue = asyncio.Queue()
            run_task = None
            disconnect_task = None

            # Simple handler to add updates to the queue
            def progress_handler(agent_name, ticker, status, analysis, timestamp):
                event = ProgressUpdateEvent(agent=agent_name, ticker=ticker, status=status, timestamp=timestamp, analysis=analysis)
                progress_queue.put_nowait(event)

            # Register our handler with the progress tracker
            progress.register_handler(progress_handler)

            try:
                # Start the graph execution in a background task
                run_task = asyncio.create_task(
                    run_graph_async(
                        graph=graph,
                        portfolio=portfolio,
                        tickers=request_data.tickers,
                        start_date=request_data.start_date,
                        end_date=request_data.end_date,
                        model_name=request_data.model_name,
                        model_provider=model_provider,
                        request=request_data,  # Pass the full request for agent-specific model access
                        language=request_data.language or 'en',
                    )
                )
                
                # Start the disconnect detection task
                disconnect_task = asyncio.create_task(wait_for_disconnect())
                
                # Send initial message
                yield StartEvent().to_sse()

                # Stream progress updates until run_task completes or client disconnects
                while not run_task.done():
                    # Check if client disconnected
                    if disconnect_task.done():
                        print("Client disconnected, cancelling hedge fund execution")
                        run_task.cancel()
                        try:
                            await run_task
                        except asyncio.CancelledError:
                            pass
                        return

                    # Either get a progress update or wait a bit
                    try:
                        event = await asyncio.wait_for(progress_queue.get(), timeout=1.0)
                        yield event.to_sse()
                    except asyncio.TimeoutError:
                        # Just continue the loop
                        pass

                # Get the final result
                try:
                    result = await run_task
                except asyncio.CancelledError:
                    print("Task was cancelled")
                    return
                except Exception as e:
                    err_msg = str(e)
                    # 429 quota errors → graceful error event (not a crash)
                    if "429" in err_msg or "quota" in err_msg.lower() or "rate" in err_msg.lower():
                        yield ErrorEvent(message=f"API quota exceeded: {err_msg}. Try again later or switch to a different model.").to_sse()
                    else:
                        yield ErrorEvent(message=f"Analysis failed: {err_msg}").to_sse()
                    return

                if not result or not result.get("messages"):
                    yield ErrorEvent(message="Failed to generate hedge fund decisions").to_sse()
                    return

                # Send the final result
                final_data = CompleteEvent(
                    data={
                        "decisions": parse_hedge_fund_response(result.get("messages", [])[-1].content),
                        "analyst_signals": result.get("data", {}).get("analyst_signals", {}),
                        "current_prices": result.get("data", {}).get("current_prices", {}),
                    }
                )
                yield final_data.to_sse()

            except asyncio.CancelledError:
                print("Event generator cancelled")
                return
            finally:
                # Clean up injected sandbox overrides so they don't bleed into subsequent runs
                if request_data.metric_overrides:
                    from src.data.cache import get_cache as _get_cache
                    _cleanup_cache = _get_cache()
                    for _ticker in request_data.metric_overrides:
                        _tkr_clean = _ticker.upper()
                        _cleanup_cache._line_items_cache.pop(_tkr_clean, None)
                        # Also remove injected financial_metrics keys (all period/limit variants)
                        for _ck in list(_cleanup_cache._financial_metrics_cache.keys()):
                            if _ck.startswith(f"{_tkr_clean}_"):
                                _cleanup_cache._financial_metrics_cache.pop(_ck, None)
                # Clean up
                progress.unregister_handler(progress_handler)
                if run_task and not run_task.done():
                    run_task.cancel()
                    try:
                        await run_task
                    except asyncio.CancelledError:
                        pass
                if disconnect_task and not disconnect_task.done():
                    disconnect_task.cancel()

        # Return a streaming response
        return StreamingResponse(event_generator(), media_type="text/event-stream")

    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"An error occurred while processing the request: {str(e)}")

@router.post(
    path="/backtest",
    responses={
        200: {"description": "Successful response with streaming backtest updates"},
        400: {"model": ErrorResponse, "description": "Invalid request parameters"},
        500: {"model": ErrorResponse, "description": "Internal server error"},
    },
)
async def backtest(request_data: BacktestRequest, request: Request, db: Session = Depends(get_db)):
    """Run a continuous backtest over a time period with streaming updates."""
    try:
        # Hydrate API keys from database if not provided
        if not request_data.api_keys:
            api_key_service = ApiKeyService(db)
            request_data.api_keys = api_key_service.get_api_keys_dict()

        # Convert model_provider to string if it's an enum
        model_provider = request_data.model_provider
        if hasattr(model_provider, "value"):
            model_provider = model_provider.value

        # Create the portfolio (same as /run endpoint)
        portfolio = create_portfolio(
            request_data.initial_capital, 
            request_data.margin_requirement, 
            request_data.tickers, 
            request_data.portfolio_positions
        )

        # Construct agent graph using the React Flow graph structure (same as /run endpoint)
        graph = create_graph(graph_nodes=request_data.graph_nodes, graph_edges=request_data.graph_edges)
        graph = graph.compile()

        # Create backtest service with the compiled graph
        backtest_service = BacktestService(
            graph=graph,
            portfolio=portfolio,
            tickers=request_data.tickers,
            start_date=request_data.start_date,
            end_date=request_data.end_date,
            initial_capital=request_data.initial_capital,
            model_name=request_data.model_name,
            model_provider=model_provider,
            request=request_data,  # Pass the full request for agent-specific model access
        )

        # Function to detect client disconnection
        async def wait_for_disconnect():
            """Wait for client disconnect and return True when it happens"""
            try:
                while True:
                    message = await request.receive()
                    if message["type"] == "http.disconnect":
                        return True
            except Exception:
                return True

        # Set up streaming response
        async def event_generator():
            progress_queue = asyncio.Queue()
            backtest_task = None
            disconnect_task = None

            # Global progress handler to capture individual agent updates during backtest
            def progress_handler(agent_name, ticker, status, analysis, timestamp):
                event = ProgressUpdateEvent(agent=agent_name, ticker=ticker, status=status, timestamp=timestamp, analysis=analysis)
                progress_queue.put_nowait(event)

            # Progress callback to handle backtest-specific updates
            def progress_callback(update):
                if update["type"] == "progress":
                    event = ProgressUpdateEvent(
                        agent="backtest",
                        ticker=None,
                        status=f"Processing {update['current_date']} ({update['current_step']}/{update['total_dates']})",
                        timestamp=None,
                        analysis=None
                    )
                    progress_queue.put_nowait(event)
                elif update["type"] == "backtest_result":
                    # Convert day result to a streaming event
                    backtest_result = BacktestDayResult(**update["data"])
                    
                    # Send the full day result data as JSON in the analysis field
                    import json
                    analysis_data = json.dumps(update["data"])
                    
                    event = ProgressUpdateEvent(
                        agent="backtest",
                        ticker=None,
                        status=f"Completed {backtest_result.date} - Portfolio: ${backtest_result.portfolio_value:,.2f}",
                        timestamp=None,
                        analysis=analysis_data
                    )
                    progress_queue.put_nowait(event)

            # Register our handler with the progress tracker to capture agent updates
            progress.register_handler(progress_handler)
            
            try:
                # Start the backtest in a background task
                backtest_task = asyncio.create_task(
                    backtest_service.run_backtest_async(progress_callback=progress_callback)
                )
                
                # Start the disconnect detection task
                disconnect_task = asyncio.create_task(wait_for_disconnect())
                
                # Send initial message
                yield StartEvent().to_sse()

                # Stream progress updates until backtest_task completes or client disconnects
                while not backtest_task.done():
                    # Check if client disconnected
                    if disconnect_task.done():
                        print("Client disconnected, cancelling backtest execution")
                        backtest_task.cancel()
                        try:
                            await backtest_task
                        except asyncio.CancelledError:
                            pass
                        return

                    # Either get a progress update or wait a bit
                    try:
                        event = await asyncio.wait_for(progress_queue.get(), timeout=1.0)
                        yield event.to_sse()
                    except asyncio.TimeoutError:
                        # Just continue the loop
                        pass

                # Get the final result
                try:
                    result = await backtest_task
                except asyncio.CancelledError:
                    print("Backtest task was cancelled")
                    return

                if not result:
                    yield ErrorEvent(message="Failed to complete backtest").to_sse()
                    return

                # Send the final result
                performance_metrics = BacktestPerformanceMetrics(**result["performance_metrics"])
                final_data = CompleteEvent(
                    data={
                        "performance_metrics": performance_metrics.model_dump(),
                        "final_portfolio": result["final_portfolio"],
                        "total_days": len(result["results"]),
                    }
                )
                yield final_data.to_sse()

            except asyncio.CancelledError:
                print("Backtest event generator cancelled")
                return
            finally:
                # Clean up
                progress.unregister_handler(progress_handler)
                if backtest_task and not backtest_task.done():
                    backtest_task.cancel()
                    try:
                        await backtest_task
                    except asyncio.CancelledError:
                        pass
                if disconnect_task and not disconnect_task.done():
                    disconnect_task.cancel()

        # Return a streaming response
        return StreamingResponse(event_generator(), media_type="text/event-stream")

    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"An error occurred while processing the backtest request: {str(e)}")


@router.get(
    path="/agents",
    responses={
        200: {"description": "List of available agents"},
        500: {"model": ErrorResponse, "description": "Internal server error"},
    },
)
async def get_agents():
    """Get the list of available agents."""
    try:
        return {"agents": get_agents_list()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve agents: {str(e)}")

