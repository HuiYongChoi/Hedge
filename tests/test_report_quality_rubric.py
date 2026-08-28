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
                       "점검한 항목 수", "Alignment"):
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
        self.assertIn("100 / 100", result.stdout)


if __name__ == "__main__":
    unittest.main()
