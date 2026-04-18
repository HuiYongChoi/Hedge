import json
import time
from langchain_core.messages import HumanMessage
from langchain_core.prompts import ChatPromptTemplate

from src.graph.state import AgentState, show_agent_reasoning
from pydantic import BaseModel, Field
from typing_extensions import Literal
from src.utils.progress import progress
from src.utils.llm import call_llm


class PortfolioDecision(BaseModel):
    action: Literal["buy", "sell", "short", "cover", "hold"]
    quantity: int = Field(description="Number of shares to trade")
    confidence: int = Field(description="Confidence 0-100")
    reasoning: str = Field(description="Reasoning for the decision")


class PortfolioManagerOutput(BaseModel):
    decisions: dict[str, PortfolioDecision] = Field(description="Dictionary of ticker to trading decisions")


##### Portfolio Management Agent #####
def portfolio_management_agent(state: AgentState, agent_id: str = "portfolio_manager"):
    """Makes final trading decisions and generates orders for multiple tickers"""

    portfolio = state["data"]["portfolio"]
    analyst_signals = state["data"]["analyst_signals"]
    tickers = state["data"]["tickers"]

    position_limits = {}
    current_prices = {}
    max_shares = {}
    signals_by_ticker = {}
    for ticker in tickers:
        progress.update_status(agent_id, ticker, "Processing analyst signals")

        # Find the corresponding risk manager for this portfolio manager
        if agent_id.startswith("portfolio_manager_"):
            suffix = agent_id.split('_')[-1]
            risk_manager_id = f"risk_management_agent_{suffix}"
        else:
            risk_manager_id = "risk_management_agent"  # Fallback for CLI

        risk_data = analyst_signals.get(risk_manager_id, {}).get(ticker, {})
        position_limits[ticker] = risk_data.get("remaining_position_limit", 0.0)
        current_prices[ticker] = float(risk_data.get("current_price", 0.0))

        # Calculate maximum shares allowed based on position limit and price
        if current_prices[ticker] > 0:
            max_shares[ticker] = int(position_limits[ticker] // current_prices[ticker])
        else:
            max_shares[ticker] = 0

        # Compress analyst signals to {sig, conf}
        ticker_signals = {}
        for agent, signals in analyst_signals.items():
            if not agent.startswith("risk_management_agent") and ticker in signals:
                sig = signals[ticker].get("signal")
                conf = signals[ticker].get("confidence")
                if sig is not None and conf is not None:
                    ticker_signals[agent] = {"sig": sig, "conf": conf}
        signals_by_ticker[ticker] = ticker_signals

    state["data"]["current_prices"] = current_prices

    progress.update_status(agent_id, None, "Generating trading decisions")

    result = generate_trading_decision(
        tickers=tickers,
        signals_by_ticker=signals_by_ticker,
        current_prices=current_prices,
        max_shares=max_shares,
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


def generate_trading_decision(
        tickers: list[str],
        signals_by_ticker: dict[str, dict],
        current_prices: dict[str, float],
        max_shares: dict[str, int],
        portfolio: dict[str, float],
        agent_id: str,
        state: AgentState,
) -> PortfolioManagerOutput:
    """Get decisions from the LLM with deterministic constraints and a minimal prompt."""

    language = state.get("metadata", {}).get("language", "en")

    # Deterministic constraints
    allowed_actions_full = compute_allowed_actions(tickers, current_prices, max_shares, portfolio)

    # Separate tickers into hold-only (no tradable actions) and those that can trade
    hold_only_tickers: list[str] = []
    tickers_for_llm: list[str] = []
    for t in tickers:
        aa = allowed_actions_full.get(t, {"hold": 0})
        if set(aa.keys()) == {"hold"}:
            hold_only_tickers.append(t)
        else:
            tickers_for_llm.append(t)

    # All tickers go to LLM — hold-only tickers get qualitative analysis with hold forced
    all_tickers_for_llm = tickers_for_llm + hold_only_tickers

    # Build compact signals for all tickers
    compact_signals = _compact_signals({t: signals_by_ticker.get(t, {}) for t in all_tickers_for_llm})
    # For allowed actions: hold-only tickers show only {"hold":0}
    compact_allowed = {t: allowed_actions_full[t] for t in all_tickers_for_llm}

    # Composite confidence per ticker (computed deterministically from signals)
    composite_confidence = {
        t: _compute_composite_confidence(signals_by_ticker.get(t, {}))
        for t in all_tickers_for_llm
    }

    if language == 'ko':
        system_msg = (
            "당신은 포트폴리오 매니저입니다.\n"
            "각 종목별로 애널리스트 신호와 허용된 행동(이미 검증된 최대 수량 포함)이 주어집니다.\n"
            "허용된 행동 중 하나를 선택하고 수량은 최대값 이하로 설정하세요.\n"
            "reasoning은 신호들의 핵심 근거를 한국어로 간결하게 작성하세요 (최대 150자).\n"
            "현금이나 마진 계산은 하지 마세요. JSON만 반환하세요."
        )
    else:
        system_msg = (
            "You are a portfolio manager.\n"
            "Inputs per ticker: analyst signals and allowed actions with max qty (already validated).\n"
            "Pick one allowed action per ticker and a quantity ≤ the max.\n"
            "Keep reasoning concise and grounded in the signals (max 150 chars). No cash or margin math. Return JSON only."
        )

    template = ChatPromptTemplate.from_messages(
        [
            ("system", system_msg),
            (
                "human",
                "Signals:\n{signals}\n\n"
                "Allowed:\n{allowed}\n\n"
                "Composite confidence per ticker (use as baseline, adjust based on signal quality):\n{confidence}\n\n"
                "Format:\n"
                "{{\n"
                '  "decisions": {{\n'
                '    "TICKER": {{"action":"...","quantity":int,"confidence":int,"reasoning":"..."}}\n'
                "  }}\n"
                "}}"
            ),
        ]
    )

    prompt_data = {
        "signals": json.dumps(compact_signals, separators=(",", ":"), ensure_ascii=False),
        "allowed": json.dumps(compact_allowed, separators=(",", ":"), ensure_ascii=False),
        "confidence": json.dumps(composite_confidence, separators=(",", ":"), ensure_ascii=False),
    }
    prompt = template.invoke(prompt_data)

    # Default factory fills all tickers as hold if the LLM fails
    def create_default_portfolio_output():
        decisions = {}
        for t in all_tickers_for_llm:
            conf = composite_confidence.get(t, 0)
            msg = "모델 응답 실패로 관망합니다." if language == 'ko' else "Model error, defaulting to hold."
            decisions[t] = PortfolioDecision(action="hold", quantity=0, confidence=conf, reasoning=msg)
        return PortfolioManagerOutput(decisions=decisions)

    llm_out = call_llm(
        prompt=prompt,
        pydantic_model=PortfolioManagerOutput,
        agent_name=agent_id,
        state=state,
        default_factory=create_default_portfolio_output,
    )

    return PortfolioManagerOutput(decisions=llm_out.decisions)
