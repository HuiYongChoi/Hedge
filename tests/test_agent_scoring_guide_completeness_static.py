"""
Static test: verifies that agent scoring guide in tab-content.tsx
stays in sync with the actual Python agent code.

All checks are pure file-read / string-search — no Python imports needed.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TAB_CONTENT = ROOT / "app/frontend/src/components/tabs/tab-content.tsx"
ANALYSTS_CONFIG = ROOT / "src/utils/analysts.py"

# ── All 19 analyst agents that must appear in the scoring guide ────────────────
EXPECTED_AGENT_NAMES_EN = [
    "Warren Buffett",
    "Charlie Munger",
    "Aswath Damodaran",
    "Cathie Wood",
    "Peter Lynch",
    "Phil Fisher",
    "Bill Ackman",
    "Ben Graham",
    "Michael Burry",
    "Mohnish Pabrai",
    "Nassim Taleb",
    "Stanley Druckenmiller",
    "Rakesh Jhunjhunwala",
    "Technical Analyst",
    "Fundamentals Analyst",
    "Growth Analyst",
    "News Sentiment Analyst",
    "Sentiment Analyst",
    "Valuation Analyst",
]

# ── Quantitative values taken directly from Python scoring functions ──────────
# Each tuple: (agent name hint, string that must appear in guide, python source file, reason)
QUANT_THRESHOLDS = [
    # Michael Burry — michael_burry.py: FCF yield > 0.10 → score += 4
    ("Michael Burry", "10%", "michael_burry.py", "FCF yield 10% threshold → 4 pts"),
    # Mohnish Pabrai — mohnish_pabrai.py: total_score >= 7.5 → bullish
    ("Mohnish Pabrai", "7.5", "mohnish_pabrai.py", "buy threshold 7.5 / 10"),
    # Mohnish Pabrai — total_score <= 4.0 → bearish
    ("Mohnish Pabrai", "4.0", "mohnish_pabrai.py", "sell threshold 4.0 / 10"),
    # Nassim Taleb — 7 components totaling 50 pts
    ("Nassim Taleb", "50", "nassim_taleb.py", "50-point total scale"),
    # Stanley Druckenmiller — growth/momentum weight 0.35
    ("Stanley Druckenmiller", "35%", "stanley_druckenmiller.py", "growth/momentum 35% weight"),
    # Rakesh Jhunjhunwala — max_score = 24
    ("Rakesh Jhunjhunwala", "24", "rakesh_jhunjhunwala.py", "24-point total scale"),
    # Technical Analyst — weighted_signal_combination threshold 0.2
    ("Technical Analyst", "0.2", "technicals.py", "bullish/bearish threshold ±0.2"),
    # Technical Analyst — trend weight 0.25, momentum weight 0.25
    ("Technical Analyst", "25%", "technicals.py", "trend/momentum 25% weights"),
    # Fundamentals Analyst — ROE threshold 0.15
    ("Fundamentals Analyst", "15%", "fundamentals.py", "ROE 15% threshold"),
    # Fundamentals Analyst — P/E threshold 25
    ("Fundamentals Analyst", "25", "fundamentals.py", "P/E 25 expensive threshold"),
    # Growth Analyst — bullish threshold 0.6
    ("Growth Analyst", "0.6", "growth_agent.py", "weighted score 0.6 = bullish"),
    # Growth Analyst — growth weight 0.40
    ("Growth Analyst", "40%", "growth_agent.py", "growth 40% weight"),
    # Valuation Analyst — weighted_gap > 0.15 → bullish
    ("Valuation Analyst", "15%", "valuation.py", "15% gap buy/sell threshold"),
    # Valuation Analyst — DCF weight 0.35
    ("Valuation Analyst", "35%", "valuation.py", "DCF 35% weight"),
    # Sentiment Analyst — insider_weight = 0.3, news_weight = 0.7
    ("Sentiment Analyst", "70%", "sentiment.py", "news 70% weight"),
    ("Sentiment Analyst", "30%", "sentiment.py", "insider 30% weight"),
    # News Sentiment Analyst — LLM 70% + proportion 30%
    ("News Sentiment Analyst", "70%", "news_sentiment.py", "LLM confidence 70% weight"),
]


def test_all_agents_present_in_scoring_guide() -> None:
    """Every analyst in ANALYST_CONFIG must have a named entry in the guide."""
    source = TAB_CONTENT.read_text(encoding="utf-8")
    missing = [name for name in EXPECTED_AGENT_NAMES_EN if name not in source]
    assert not missing, f"Agents missing from agentScoringGuides: {missing}"


def test_guide_has_buy_and_sell_rules_for_all_agents() -> None:
    """Every agent entry must declare both buyRuleEn and sellRuleEn."""
    source = TAB_CONTENT.read_text(encoding="utf-8")
    buy_count = source.count("buyRuleEn:")
    sell_count = source.count("sellRuleEn:")
    assert buy_count >= len(EXPECTED_AGENT_NAMES_EN), (
        f"Expected ≥{len(EXPECTED_AGENT_NAMES_EN)} buyRuleEn entries, found {buy_count}"
    )
    assert sell_count >= len(EXPECTED_AGENT_NAMES_EN), (
        f"Expected ≥{len(EXPECTED_AGENT_NAMES_EN)} sellRuleEn entries, found {sell_count}"
    )


def test_guide_quantitative_thresholds_match_python_code() -> None:
    """Key numeric thresholds from Python scoring functions must appear in the guide."""
    source = TAB_CONTENT.read_text(encoding="utf-8")
    failures = []
    for agent_hint, value, py_file, reason in QUANT_THRESHOLDS:
        if value not in source:
            failures.append(
                f"  [{agent_hint}] '{value}' missing — expected from {py_file} ({reason})"
            )
    assert not failures, "Quantitative threshold mismatches:\n" + "\n".join(failures)


def test_all_four_categories_present_in_guide() -> None:
    """All four category values must be declared in agentScoringGuides."""
    source = TAB_CONTENT.read_text(encoding="utf-8")
    for cat in ("'value'", "'growth'", "'macro'", "'technical'"):
        assert f"category: {cat}" in source, (
            f"Category {cat} not found in agentScoringGuides"
        )


def test_search_and_filter_ui_present() -> None:
    """The detail section must include search input and category filter state."""
    source = TAB_CONTENT.read_text(encoding="utf-8")
    assert "searchQuery" in source, "searchQuery state missing from MainGuide"
    assert "selectedCategory" in source, "selectedCategory state missing from MainGuide"
    assert "Search" in source, "Search icon import missing"
    # Category filter labels in both languages
    for label in ("가치 투자", "성장 투자", "거시 및 행동주의", "기술 및 분석"):
        assert label in source, f"Korean category label '{label}' missing from filter"


def test_analysts_config_all_agents_are_analyst_type() -> None:
    """All entries in ANALYST_CONFIG with type='analyst' must be covered in guide."""
    analysts_source = ANALYSTS_CONFIG.read_text(encoding="utf-8")
    guide_source = TAB_CONTENT.read_text(encoding="utf-8")

    # Extract display_name values from analysts.py by simple pattern
    import re
    display_names = re.findall(r'"display_name":\s*"([^"]+)"', analysts_source)
    missing = [n for n in display_names if n not in guide_source]
    assert not missing, (
        f"These analyst display_names from analysts.py are missing from the guide: {missing}"
    )


def test_korean_agent_names_present_in_guide() -> None:
    """Korean names for all 19 agents must appear in the guide."""
    source = TAB_CONTENT.read_text(encoding="utf-8")
    korean_names = [
        "워런 버핏", "찰리 멍거", "애스워스 다모다란", "캐시 우드",
        "피터 린치", "필 피셔", "빌 애크먼", "벤 그레이엄",
        "마이클 버리", "모니시 파브라이", "나심 탈레브", "스탠리 드러켄밀러",
        "라케시 준준왈라", "기술적 분석가", "기본적 분석가", "성장 분석가",
        "뉴스 감성 분석가", "시장 심리 분석가", "가치평가 분석가",
    ]
    missing = [name for name in korean_names if name not in source]
    assert not missing, f"Korean agent names missing from guide: {missing}"
