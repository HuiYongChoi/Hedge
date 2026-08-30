#!/usr/bin/env python3
"""보고서를 실제로 여러 번 만들어 건전성 채점표로 채점한다.

왜 정적 검사만으로는 부족한가
    2026-08-30 사고는 코드가 틀려서가 아니라 모델이 열거형 값을 한국어로
    돌려줬기 때문에 났다. 그런 것은 돌려 봐야만 나온다. 그리고 한 번 잘 나온
    것으로는 아무것도 증명되지 않는다 — 모델 출력은 매번 다르다.

사용:
    python scripts/run_report_health_rounds.py --ticker 000660.KS --rounds 10
    python scripts/run_report_health_rounds.py --ticker 000660.KS --agent aswath_damodaran
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")

from src.main import create_workflow  # noqa: E402
from src.utils.progress import progress  # noqa: E402

#: 실제 웹앱이 SK하이닉스 분석에 쓴 조합(저장된 request_data 기준).
DEFAULT_AGENTS = [
    "semiconductor_rerating_analyst",
    "valuation_analyst",
    "growth_analyst",
    "stanley_druckenmiller",
    "fundamentals_analyst",
    "news_sentiment_analyst",
    "aswath_damodaran",
]


def run_once(ticker: str, agents: list[str], model: str, provider: str, language: str) -> dict:
    """한 번 돌려서 저장 포맷({completeResult, agentResults})으로 돌려준다."""
    workflow = create_workflow(agents).compile()
    end = date.today()
    start = end - timedelta(days=90)
    portfolio = {
        "cash": 100000.0,
        "margin_requirement": 0.0,
        "margin_used": 0.0,
        "positions": {ticker: {"long": 0, "short": 0, "long_cost_basis": 0.0,
                               "short_cost_basis": 0.0, "short_margin_used": 0.0}},
        "realized_gains": {ticker: {"long": 0.0, "short": 0.0}},
    }
    progress.start()
    try:
        final_state = workflow.invoke({
            "messages": [],
            "data": {
                "tickers": [ticker],
                "portfolio": portfolio,
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
                "analyst_signals": {},
                "language": language,
            },
            "metadata": {
                "show_reasoning": False,
                "model_name": model,
                "model_provider": provider,
                "language": language,
            },
        })
    finally:
        progress.stop()

    signals = final_state["data"]["analyst_signals"]
    decisions_raw = final_state["messages"][-1].content if final_state["messages"] else "{}"
    try:
        decisions = json.loads(decisions_raw).get("decisions", json.loads(decisions_raw))
    except Exception:
        decisions = {}

    agent_results = []
    for agent_key, analysis in signals.items():
        # 그래프는 노드 이름(…_agent)을 키로 쓴다. 화면·저장 포맷은 에이전트 키다.
        base_key = agent_key[:-6] if agent_key.endswith("_agent") else agent_key
        agent_results.append({
            "agentKey": base_key,
            "status": "complete",
            "analysis": analysis,
        })
    return {
        "completeResult": {"decisions": decisions, "analyst_signals": signals},
        "agentResults": agent_results,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ticker", default="000660.KS")
    parser.add_argument("--rounds", type=int, default=10)
    parser.add_argument("--agents", default=",".join(DEFAULT_AGENTS))
    parser.add_argument("--model", default="gpt-5.4-nano")
    parser.add_argument("--provider", default="OpenAI")
    parser.add_argument("--language", default="ko")
    parser.add_argument("--out", default="tmp/report_health_rounds")
    args = parser.parse_args()

    out_dir = ROOT / args.out
    out_dir.mkdir(parents=True, exist_ok=True)
    agents = [a.strip() for a in args.agents.split(",") if a.strip()]

    written = []
    for round_no in range(1, args.rounds + 1):
        print(f"[round {round_no}/{args.rounds}] {args.ticker} …", flush=True)
        try:
            payload = run_once(args.ticker, agents, args.model, args.provider, args.language)
        except Exception as exc:  # 라운드 하나가 죽어도 나머지는 계속 돌린다
            print(f"  ! 실행 실패: {exc}", flush=True)
            payload = {"completeResult": {"decisions": {}},
                       "agentResults": [{"agentKey": "run", "status": "error", "message": str(exc)}]}
        path = out_dir / f"round_{round_no:02d}.json"
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        written.append(path)
        print(f"  → {path.relative_to(ROOT)}", flush=True)

    print("\n채점 대상:")
    for path in written:
        print(f"  {path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
