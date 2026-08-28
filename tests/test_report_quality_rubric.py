"""보고서 품질 채점표 — 실제 배포본 텍스트로 채점해 만점인지 확인한다.

사용자가 배포본에서 지적한 결함을 그대로 규칙으로 옮겼다. 규칙이 사라지거나
파이프라인이 바뀌어 결함이 되살아나면 이 테스트가 감점으로 잡는다.
"""

from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "app/frontend"
RUBRIC = FRONTEND / "scripts/report-quality-rubric.mjs"
FIXTURE = ROOT / "tests/fixtures/report_defects.txt"
NODE = Path("/Users/huiyong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node")


class ReportQualityRubricTests(unittest.TestCase):
    def test_rubric_and_fixture_exist(self):
        self.assertTrue(RUBRIC.exists(), "채점표 스크립트가 있어야 한다")
        self.assertTrue(FIXTURE.exists(), "실측 결함 고정 데이터가 있어야 한다")

    def test_fixture_holds_the_reported_defects(self):
        """고정 데이터가 비면 채점이 항상 만점이 되어 의미가 없어진다."""
        text = FIXTURE.read_text(encoding="utf-8")
        for defect in ("[#+]", "period:", "base_fcff", "**", "표기되지만,",
                       "점검한 항목 수", "Alignment", "확인 필요", "growth_analysis",
                       "낮음 입니다"):
            self.assertIn(defect, text, f"실측 결함 '{defect}' 이 고정 데이터에 있어야 한다")

    @unittest.skipUnless(NODE.exists() and (FRONTEND / "node_modules/typescript").exists(),
                         "node 런타임 또는 typescript 가 없는 환경")
    def test_scores_full_marks(self):
        result = subprocess.run(
            [str(NODE), "scripts/report-quality-rubric.mjs", str(FIXTURE)],
            cwd=FRONTEND, capture_output=True, text=True, timeout=180,
        )
        self.assertEqual(
            result.returncode, 0,
            f"채점 미달:\n{result.stdout[-2000:]}\n{result.stderr[-800:]}",
        )
        # 총점을 못 박지 않는다 — 채점 항목이 늘어도 '만점'이면 통과해야 한다.
        self.assertIn("★ 만점", result.stdout)


if __name__ == "__main__":
    unittest.main()


class RenderWiringTests(unittest.TestCase):
    """채점기만 통과하고 화면에는 안 붙는 상태를 막는다.

    보고서 전체 중복 제거를 채점기에만 연결해 두었다가 실제 렌더에는 빠져 있던
    적이 있다. 채점 만점이 곧 화면 품질이려면 같은 함수를 화면도 써야 한다.
    """

    V5 = ROOT / "app/frontend/src/components/reports/analyst-report-v5"

    def test_report_body_applies_report_wide_dedupe(self):
        body = (self.V5 / "report-body.tsx").read_text(encoding="utf-8")
        self.assertIn("dedupeEvidenceItemsAcrossReport(", body)
        self.assertIn("items={itemsBySection[sectionIndex]}", body)

    def test_section_uses_items_from_parent(self):
        section = (self.V5 / "report-section.tsx").read_text(encoding="utf-8")
        self.assertIn("providedItems ?? parseEvidenceItems(sectionText)", section)

    def test_rubric_uses_the_same_dedupe(self):
        rubric = RUBRIC.read_text(encoding="utf-8")
        self.assertIn("dedupeEvidenceItemsAcrossReport", rubric)


class CorpusSweepTests(unittest.TestCase):
    """실제 저장된 보고서 전체를 여러 번 채점한다.

    고정 데이터 몇 개만 만점이면 '내가 본 결함만 고친' 상태다. 서버에 저장돼 있던
    실제 리포트 본문을 전부 돌려, 연속으로 만점이 나오는지 확인한다.
    """

    SWEEP = FRONTEND / "scripts/report-quality-sweep.mjs"
    FIXTURES = ROOT / "tests/fixtures"

    def test_corpus_is_not_empty(self):
        """코퍼스가 비면 스윕이 항상 통과해 의미가 없어진다."""
        files = list(self.FIXTURES.glob("*.txt"))
        self.assertGreaterEqual(len(files), 20, "실측 보고서 코퍼스가 20개 이상이어야 한다")

    @unittest.skipUnless(NODE.exists() and (FRONTEND / "node_modules/typescript").exists(),
                         "node 런타임 또는 typescript 가 없는 환경")
    def test_full_marks_three_rounds(self):
        result = subprocess.run(
            [str(NODE), "scripts/report-quality-sweep.mjs", str(self.FIXTURES), "--rounds", "3"],
            cwd=FRONTEND, capture_output=True, text=True, timeout=900,
        )
        self.assertEqual(result.returncode, 0, f"스윕 미달:\n{result.stdout[-3000:]}")
        self.assertIn("연속 만점", result.stdout)
