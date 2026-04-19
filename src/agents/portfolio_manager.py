import json
import time
from langchain_core.messages import HumanMessage
from langchain_core.prompts import ChatPromptTemplate

from src.graph.state import AgentState, show_agent_reasoning
from pydantic import BaseModel, Field
from typing import Any
from typing_extensions import Literal
from src.utils.progress import progress
from src.utils.llm import call_llm


class PortfolioDecision(BaseModel):
    action: Literal["buy", "sell", "short", "cover", "hold"]
    quantity: int = Field(
        description=(
            "quantity is a schema-compatibility placeholder for report mode; "
            "backtests may populate it for simulated trades"
        )
    )
    confidence: int = Field(description="Confidence 0-100")
    reasoning: str = Field(description="Reasoning for the decision")


class PortfolioManagerOutput(BaseModel):
    decisions: dict[str, PortfolioDecision] = Field(description="Dictionary of ticker to trading decisions")


##### Portfolio Management Agent #####
def _is_backtest_request(state: AgentState) -> bool:
    request = state.get("metadata", {}).get("request")
    return request.__class__.__name__ == "BacktestRequest"


def portfolio_management_agent(state: AgentState, agent_id: str = "portfolio_manager"):
    """Makes final trading decisions and generates orders for multiple tickers"""

    portfolio = state["data"]["portfolio"]
    analyst_signals = state["data"]["analyst_signals"]
    tickers = state["data"]["tickers"]
    is_backtest_run = _is_backtest_request(state)

    position_limits = {}
    current_prices = {}
    max_shares = {}
    signals_by_ticker = {}
    risk_by_ticker = {}
    for ticker in tickers:
        progress.update_status(agent_id, ticker, "Processing analyst signals")

        # Find the corresponding risk manager for this portfolio manager
        if agent_id.startswith("portfolio_manager_"):
            suffix = agent_id.split('_')[-1]
            risk_manager_id = f"risk_management_agent_{suffix}"
        else:
            risk_manager_id = "risk_management_agent"  # Fallback for CLI

        risk_data = analyst_signals.get(risk_manager_id, {}).get(ticker, {})
        risk_by_ticker[ticker] = risk_data
        position_limits[ticker] = risk_data.get("remaining_position_limit", 0.0)
        current_prices[ticker] = float(risk_data.get("current_price", 0.0))

        # Only the backtest path needs simulated trade sizing.
        if is_backtest_run and current_prices[ticker] > 0:
            max_shares[ticker] = int(position_limits[ticker] // current_prices[ticker])
        else:
            max_shares[ticker] = 0

        # Compress analyst signals to {sig, conf}
        ticker_signals = {}
        for agent, signals in analyst_signals.items():
            if not agent.startswith("risk_management_agent") and ticker in signals:
                agent_signal = signals[ticker]
                sig = agent_signal.get("signal")
                conf = agent_signal.get("confidence")
                if sig is not None and conf is not None:
                    ticker_signals[agent] = {
                        "sig": sig,
                        "conf": conf,
                        "reasoning": agent_signal.get("reasoning"),
                        "raw": agent_signal,
                    }
        signals_by_ticker[ticker] = ticker_signals

    state["data"]["current_prices"] = current_prices

    progress.update_status(agent_id, None, "Generating trading decisions")

    result = generate_trading_decision(
        tickers=tickers,
        signals_by_ticker=signals_by_ticker,
        current_prices=current_prices,
        max_shares=max_shares,
        risk_by_ticker=risk_by_ticker,
        portfolio=portfolio,
        agent_id=agent_id,
        state=state,
    )
    message = HumanMessage(
        content=json.dumps({ticker: decision.model_dump() for ticker, decision in result.decisions.items()}, ensure_ascii=False),
        name=agent_id,
    )

    if state["metadata"]["show_reasoning"]:
        show_agent_reasoning({ticker: decision.model_dump() for ticker, decision in result.decisions.items()},
                             "Portfolio Manager")

    progress.update_status(agent_id, None, "Done")

    return {
        "messages": state["messages"] + [message],
        "data": state["data"],
    }


def compute_allowed_actions(
        tickers: list[str],
        current_prices: dict[str, float],
        max_shares: dict[str, int],
        portfolio: dict[str, float],
) -> dict[str, dict[str, int]]:
    """Compute allowed actions and max quantities for each ticker deterministically."""
    allowed = {}
    cash = float(portfolio.get("cash", 0.0))
    positions = portfolio.get("positions", {}) or {}
    margin_requirement = float(portfolio.get("margin_requirement", 0.5))
    margin_used = float(portfolio.get("margin_used", 0.0))
    equity = float(portfolio.get("equity", cash))

    for ticker in tickers:
        price = float(current_prices.get(ticker, 0.0))
        pos = positions.get(
            ticker,
            {"long": 0, "long_cost_basis": 0.0, "short": 0, "short_cost_basis": 0.0},
        )
        long_shares = int(pos.get("long", 0) or 0)
        short_shares = int(pos.get("short", 0) or 0)
        max_qty = int(max_shares.get(ticker, 0) or 0)

        # Start with zeros
        actions = {"buy": 0, "sell": 0, "short": 0, "cover": 0, "hold": 0}

        # Long side
        if long_shares > 0:
            actions["sell"] = long_shares
        if cash > 0 and price > 0:
            max_buy_cash = int(cash // price)
            max_buy = max(0, min(max_qty, max_buy_cash))
            if max_buy > 0:
                actions["buy"] = max_buy

        # Short side
        if short_shares > 0:
            actions["cover"] = short_shares
        if price > 0 and max_qty > 0:
            if margin_requirement <= 0.0:
                # If margin requirement is zero or unset, only cap by max_qty
                max_short = max_qty
            else:
                available_margin = max(0.0, (equity / margin_requirement) - margin_used)
                max_short_margin = int(available_margin // price)
                max_short = max(0, min(max_qty, max_short_margin))
            if max_short > 0:
                actions["short"] = max_short

        # Hold always valid
        actions["hold"] = 0

        # Prune zero-capacity actions to reduce tokens, keep hold
        pruned = {"hold": 0}
        for k, v in actions.items():
            if k != "hold" and v > 0:
                pruned[k] = v

        allowed[ticker] = pruned

    return allowed


def _compact_signals(signals_by_ticker: dict[str, dict]) -> dict[str, dict]:
    """Keep only {agent: {sig, conf}} and drop empty agents."""
    out = {}
    for t, agents in signals_by_ticker.items():
        if not agents:
            out[t] = {}
            continue
        compact = {}
        for agent, payload in agents.items():
            sig = payload.get("sig") or payload.get("signal")
            conf = payload.get("conf") if "conf" in payload else payload.get("confidence")
            if sig is not None and conf is not None:
                compact[agent] = {"sig": sig, "conf": conf}
        out[t] = compact
    return out


def _compute_composite_confidence(ticker_signals: dict) -> int:
    """Compute composite confidence from analyst signals weighted by direction consensus."""
    if not ticker_signals:
        return 50
    bullish_conf = []
    bearish_conf = []
    for payload in ticker_signals.values():
        sig = payload.get("sig") or payload.get("signal", "")
        conf = payload.get("conf") if "conf" in payload else payload.get("confidence", 50)
        try:
            conf = int(conf)
        except (TypeError, ValueError):
            conf = 50
        if sig in ("bullish", "buy", "long"):
            bullish_conf.append(conf)
        elif sig in ("bearish", "sell", "short"):
            bearish_conf.append(conf)
        # neutral signals are skipped
    total = len(bullish_conf) + len(bearish_conf)
    if total == 0:
        return 50
    # Weighted consensus: majority direction confidence, penalized by disagreement ratio
    bull_avg = sum(bullish_conf) / len(bullish_conf) if bullish_conf else 0
    bear_avg = sum(bearish_conf) / len(bearish_conf) if bearish_conf else 0
    if len(bullish_conf) >= len(bearish_conf):
        consensus_conf = bull_avg
    else:
        consensus_conf = bear_avg
    agreement_ratio = max(len(bullish_conf), len(bearish_conf)) / total
    return max(0, min(100, int(consensus_conf * agreement_ratio)))


def _truncate_text(value: str | None, max_chars: int = 1600) -> str | None:
    if not value or not isinstance(value, str):
        return None
    value = value.strip()
    if len(value) <= max_chars:
        return value
    return value[:max_chars].rstrip() + "..."


def _compact_json_value(value: Any, max_chars: int = 900):
    """Keep structured evidence small enough for the final decision prompt."""
    if value is None:
        return None
    if isinstance(value, str):
        return _truncate_text(value, max_chars)
    try:
        rendered = json.dumps(value, ensure_ascii=False, default=str, separators=(",", ":"))
    except TypeError:
        rendered = str(value)
    if len(rendered) <= max_chars:
        return value
    return rendered[:max_chars].rstrip() + "..."


def _build_decision_context(
    tickers: list[str],
    signals_by_ticker: dict[str, dict],
    current_prices: dict[str, float],
    max_shares: dict[str, int],
    allowed_actions: dict[str, dict[str, int]],
    risk_by_ticker: dict[str, dict],
    include_trade_constraints: bool = True,
) -> dict[str, dict]:
    """Provide the PM with compact analyst evidence instead of signal labels only."""
    context: dict[str, dict] = {}
    for ticker in tickers:
        analyst_evidence = {}
        for agent, payload in signals_by_ticker.get(ticker, {}).items():
            raw = payload.get("raw") or {}
            evidence = {
                "signal": payload.get("sig") or raw.get("signal"),
                "confidence": payload.get("conf") if "conf" in payload else raw.get("confidence"),
            }
            reasoning = _truncate_text(payload.get("reasoning") or raw.get("reasoning"))
            if reasoning:
                evidence["reasoning_excerpt"] = reasoning
            for key in (
                "score",
                "max_score",
                "metrics",
                "earnings_analysis",
                "strength_analysis",
                "valuation_analysis",
                "moat_analysis",
                "predictability_analysis",
                "financial_discipline_analysis",
            ):
                if key in raw:
                    compact_value = _compact_json_value(raw.get(key))
                    if compact_value is not None:
                        evidence[key] = compact_value
            analyst_evidence[agent] = evidence

        risk_data = risk_by_ticker.get(ticker, {}) or {}
        ticker_context = {
            "current_price": current_prices.get(ticker),
            "risk_constraints": {
                "current_price": risk_data.get("current_price"),
                "volatility_metrics": risk_data.get("volatility_metrics"),
                "correlation_metrics": risk_data.get("correlation_metrics"),
                "reasoning": risk_data.get("reasoning"),
            },
            "analyst_evidence": analyst_evidence,
        }
        if include_trade_constraints:
            ticker_context["maximum_trade_size"] = max_shares.get(ticker)
            ticker_context["allowed_actions"] = allowed_actions.get(ticker)
            ticker_context["risk_constraints"]["remaining_position_limit"] = risk_data.get("remaining_position_limit")
        context[ticker] = ticker_context
    return context


def _signal_based_report_action(ticker_signals: dict) -> Literal["buy", "sell", "hold"]:
    bullish = 0
    bearish = 0
    for payload in ticker_signals.values():
        sig = str(payload.get("sig") or payload.get("signal") or "neutral").lower()
        if sig in ("bullish", "buy", "long"):
            bullish += 1
        elif sig in ("bearish", "sell", "short"):
            bearish += 1
    if bullish > bearish:
        return "buy"
    if bearish > bullish:
        return "sell"
    return "hold"


def _normalize_report_action(action: str | None) -> Literal["buy", "sell", "hold"]:
    normalized = str(action or "hold").lower()
    if normalized in ("buy", "long", "cover"):
        return "buy"
    if normalized in ("sell", "short"):
        return "sell"
    return "hold"


def _remove_report_quantity_references(reasoning: Any, language: str) -> str:
    text = str(reasoning or "").strip()
    if not text:
        return _build_signal_based_hold_reasoning({}, language)

    forbidden_lower = (
        "allowed_actions",
        "max_shares",
        "order quantity",
        "trade quantity",
        "maximum trade size",
        "schema-compatibility placeholder",
    )
    forbidden_ko = ("허용 행동", "주문 수량", "거래 수량", "최대 주문", "최대 거래", "수량")
    kept_lines = []
    for line in text.splitlines():
        lower = line.lower()
        if any(token in lower for token in forbidden_lower):
            continue
        if any(token in line for token in forbidden_ko):
            continue
        kept_lines.append(line)

    cleaned = "\n".join(kept_lines).strip()
    if cleaned:
        return cleaned
    return (
        "에이전트 신호와 전처리 정량 근거를 종합한 정성적 투자 판단입니다."
        if language == "ko"
        else "This is a qualitative investment decision based on agent signals and preprocessed evidence."
    )


def _build_signal_based_hold_reasoning(ticker_signals: dict, language: str) -> str:
    """Build a user-facing fallback summary from available analyst signals."""
    bullish = 0
    bearish = 0
    neutral = 0
    for payload in ticker_signals.values():
        sig = str(payload.get("sig") or payload.get("signal") or "neutral").lower()
        if sig in ("bullish", "buy", "long"):
            bullish += 1
        elif sig in ("bearish", "sell", "short"):
            bearish += 1
        else:
            neutral += 1

    if language == "ko":
        if bullish + bearish + neutral == 0:
            return "에이전트 신호가 제한적이어서 추가 확인 전 보수적으로 관망합니다."
        return f"에이전트 신호 기준 강세 {bullish}개, 약세 {bearish}개, 중립 {neutral}개로 보수적 관망 판단입니다."

    if bullish + bearish + neutral == 0:
        return "Agent signal coverage is limited, so the conservative decision is to watch."
    return f"Agent signals show {bullish} bullish, {bearish} bearish, and {neutral} neutral views; conservative decision is watch."


def generate_trading_decision(
        tickers: list[str],
        signals_by_ticker: dict[str, dict],
        current_prices: dict[str, float],
        max_shares: dict[str, int],
        risk_by_ticker: dict[str, dict],
        portfolio: dict[str, float],
        agent_id: str,
        state: AgentState,
) -> PortfolioManagerOutput:
    """Get decisions from the LLM with deterministic constraints and a minimal prompt."""

    language = state.get("metadata", {}).get("language", "en")
    is_backtest_run = _is_backtest_request(state)

    # Deterministic constraints
    allowed_actions_full = compute_allowed_actions(tickers, current_prices, max_shares, portfolio)

    if is_backtest_run:
        # Separate tickers into hold-only and those that can trade in the simulation.
        hold_only_tickers: list[str] = []
        tickers_for_llm: list[str] = []
        for t in tickers:
            aa = allowed_actions_full.get(t, {"hold": 0})
            if set(aa.keys()) == {"hold"}:
                hold_only_tickers.append(t)
            else:
                tickers_for_llm.append(t)
        all_tickers_for_llm = tickers_for_llm + hold_only_tickers
    else:
        # Report mode is not a virtual-cash simulation, so all tickers receive
        # qualitative buy/sell/hold judgments without order sizing constraints.
        all_tickers_for_llm = tickers

    # Build compact signals for all tickers
    compact_signals = _compact_signals({t: signals_by_ticker.get(t, {}) for t in all_tickers_for_llm})
    compact_allowed = {t: allowed_actions_full[t] for t in all_tickers_for_llm}
    decision_context = _build_decision_context(
        tickers=all_tickers_for_llm,
        signals_by_ticker=signals_by_ticker,
        current_prices=current_prices,
        max_shares=max_shares,
        allowed_actions=allowed_actions_full,
        risk_by_ticker=risk_by_ticker,
        include_trade_constraints=is_backtest_run,
    )

    # Composite confidence per ticker (computed deterministically from signals)
    composite_confidence = {
        t: _compute_composite_confidence(signals_by_ticker.get(t, {}))
        for t in all_tickers_for_llm
    }

    if is_backtest_run and language == 'ko':
        system_msg = (
            "당신은 포트폴리오 매니저입니다.\n"
            "각 종목별로 애널리스트 신호와 검증된 거래 상한이 주어집니다.\n"
            "백테스트 시뮬레이션을 위해 허용된 행동 중 하나를 선택하고 거래 크기는 상한 이하로 설정하세요.\n"
            "reasoning은 한국어로 structured, decision-grade reasoning 형태로 작성하세요.\n"
            "반드시 ### 핵심 판단, ### 핵심 근거, ### 리스크와 반대 근거 섹션을 포함하세요.\n"
            "에이전트 신호의 합의/불일치, 신뢰도, 허용 행동 제약을 함께 설명하세요.\n"
            "Decision context의 analyst_evidence와 risk_constraints에 있는 전처리 정량 근거를 활용하세요.\n"
            "Decision context에 정량 근거가 있으면 정량 데이터가 제공되지 않았다고 쓰지 마세요.\n"
            "원문 재무제표 직접 수치가 없는 경우에도 에이전트가 계산한 전처리 지표는 구분해서 인용하세요.\n"
            "현금이나 마진 계산은 하지 마세요. JSON만 반환하세요."
        )
    elif is_backtest_run:
        system_msg = (
            "You are a portfolio manager.\n"
            "Inputs per ticker: analyst signals and allowed actions with an already validated maximum trade size.\n"
            "For the backtest simulation, pick one allowed action per ticker and keep the trade size within that limit.\n"
            "Write structured, decision-grade reasoning in Korean using sections: "
            "### 핵심 판단, ### 핵심 근거, ### 리스크와 반대 근거. "
            "Explain signal consensus/disagreement, confidence, and allowed-action constraints. "
            "Use preprocessed quantitative evidence in Decision context analyst_evidence and risk_constraints. "
            "Do not claim quantitative data was not provided when Decision context contains analyst evidence or risk constraints. "
            "If raw filing figures are absent, distinguish that from agent-computed preprocessed metrics. "
            "No cash or margin math. Return JSON only."
        )
    elif language == 'ko':
        system_msg = (
            "당신은 포트폴리오 매니저입니다.\n"
            "이 화면은 가상 자금이나 주문 체결 시뮬레이션이 아니라, 에이전트 신호를 종합한 최종 투자 판단 리포트입니다.\n"
            "action은 buy, sell, hold 중 하나의 정성적 판단으로만 선택하세요.\n"
            "quantity is a schema-compatibility placeholder; 항상 0으로 반환하세요.\n"
            "reasoning must not mention order quantity, allowed_actions, max_shares, 거래 가능 여부, 현금 부족, 포지션 한도, 주문 크기.\n"
            "reasoning은 한국어로 structured, decision-grade reasoning 형태로 작성하세요.\n"
            "반드시 ### 핵심 판단, ### 핵심 근거, ### 리스크와 반대 근거 섹션을 포함하세요.\n"
            "에이전트 신호의 합의/불일치, 신뢰도, 전처리 정량 근거를 중심으로 설명하세요.\n"
            "Decision context에 정량 근거가 있으면 정량 데이터가 제공되지 않았다고 쓰지 마세요.\n"
            "JSON만 반환하세요."
        )
    else:
        system_msg = (
            "You are a portfolio manager.\n"
            "This screen is a final investment-decision report, not a virtual-cash or order-execution simulation.\n"
            "Choose action as a qualitative buy, sell, or hold decision only.\n"
            "quantity is a schema-compatibility placeholder; always return 0.\n"
            "reasoning must not mention order quantity, allowed_actions, max_shares, trade availability, cash shortage, position limits, or order size.\n"
            "Write structured, decision-grade reasoning in English using sections: "
            "### Core Judgment, ### Key Evidence, ### Risks And Counterarguments. "
            "Explain signal consensus/disagreement, confidence, and preprocessed quantitative evidence. "
            "Do not claim quantitative data was not provided when Decision context contains analyst evidence or risk constraints. "
            "Return JSON only."
        )

    if is_backtest_run:
        human_msg = (
            "Signals:\n{signals}\n\n"
            "Allowed:\n{allowed}\n\n"
            "Decision context (agent evidence excerpts and risk constraints):\n{decision_context}\n\n"
            "Composite confidence per ticker (use as baseline, adjust based on signal quality):\n{confidence}\n\n"
            "Format:\n"
            "{{\n"
            '  "decisions": {{\n'
            '    "TICKER": {{"action":"...","quantity":int,"confidence":int,"reasoning":"..."}}\n'
            "  }}\n"
            "}}"
        )
    else:
        human_msg = (
            "Signals:\n{signals}\n\n"
            "Decision context (agent evidence excerpts and risk context):\n{decision_context}\n\n"
            "Composite confidence per ticker (use as baseline, adjust based on signal quality):\n{confidence}\n\n"
            "Format:\n"
            "{{\n"
            '  "decisions": {{\n'
            '    "TICKER": {{"action":"buy|sell|hold","quantity":0,"confidence":int,"reasoning":"..."}}\n'
            "  }}\n"
            "}}"
        )

    template = ChatPromptTemplate.from_messages([("system", system_msg), ("human", human_msg)])

    prompt_data = {
        "signals": json.dumps(compact_signals, separators=(",", ":"), ensure_ascii=False),
        "allowed": json.dumps(compact_allowed, separators=(",", ":"), ensure_ascii=False),
        "decision_context": json.dumps(decision_context, separators=(",", ":"), ensure_ascii=False, default=str),
        "confidence": json.dumps(composite_confidence, separators=(",", ":"), ensure_ascii=False),
    }
    prompt = template.invoke(prompt_data)

    # Default factory fills all tickers as hold if the LLM fails
    def create_default_portfolio_output():
        decisions = {}
        for t in all_tickers_for_llm:
            conf = composite_confidence.get(t, 0)
            msg = _build_signal_based_hold_reasoning(signals_by_ticker.get(t, {}), language)
            action = "hold" if is_backtest_run else _signal_based_report_action(signals_by_ticker.get(t, {}))
            decisions[t] = PortfolioDecision(action=action, quantity=0, confidence=conf, reasoning=msg)
        return PortfolioManagerOutput(decisions=decisions)

    llm_out = call_llm(
        prompt=prompt,
        pydantic_model=PortfolioManagerOutput,
        agent_name=agent_id,
        state=state,
        default_factory=create_default_portfolio_output,
    )

    if is_backtest_run:
        return PortfolioManagerOutput(decisions=llm_out.decisions)

    report_decisions = {}
    for ticker, decision in llm_out.decisions.items():
        report_decisions[ticker] = PortfolioDecision(
            action=_normalize_report_action(decision.action),
            quantity=0,
            confidence=decision.confidence,
            reasoning=_remove_report_quantity_references(decision.reasoning, language),
        )
    return PortfolioManagerOutput(decisions=report_decisions)
