from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MUNGER_SOURCE = ROOT / "src/agents/charlie_munger.py"


def test_munger_facts_bundle_uses_human_readable_labels() -> None:
    source = MUNGER_SOURCE.read_text(encoding="utf-8")
    bundle_source = source[source.index("def make_munger_facts_bundle") : source.index("def compute_confidence")]

    assert '"해자 점수"' in bundle_source
    assert '"경영진 점수"' in bundle_source
    assert '"예측가능성 점수"' in bundle_source
    assert '"밸류에이션 점수"' in bundle_source
    assert '"FCF 수익률"' in bundle_source
    assert '"적정가 추정치"' in bundle_source
    assert '"안전마진"' in bundle_source
    assert '"핵심 체크"' in bundle_source
    assert '"moat_strong"' not in bundle_source
    assert '"predictability_score"' not in bundle_source
    assert '"valuation_score"' not in bundle_source
