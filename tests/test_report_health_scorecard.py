"""보고서 건전성 채점표 — 2026-08-30 사고를 규칙으로 못 박는다.

그날 무슨 일이 있었나
    모델이 signal 을 "중립" 이라고 한국어로 돌려줬다. 스키마는 bullish/bearish/
    neutral 만 받으므로 검증이 3회 다 실패했고, 이미 완성돼 있던 다모다란 분석이
    통째로 버려졌다. 화면에는 신뢰도 0%, 02~06 섹션이 "이 섹션에 적용할 데이터가
    없습니다" 로 나갔다.

    기존 문장 채점표(report-quality-rubric)는 그 보고서에 만점을 줬다. 볼 문장이
    없으면 감점할 것도 없기 때문이다. 그래서 '문장이 좋은가'가 아니라 '보고서가
    실제로 나왔는가'를 보는 채점표를 따로 둔다.

고정 데이터
    그날 실제로 저장된 실행 결과(stock_analysis_runs id=1)를 그대로 넣었다.
    지어낸 입력으로 채점표를 만들면 다음 사고도 똑같이 놓친다.
"""

from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "app/frontend"
SCORECARD = FRONTEND / "scripts/report-health-scorecard.mjs"
BROKEN = ROOT / "tests/fixtures/report_health/broken_run_000660_260830.json"
NODE = Path("/Users/huiyong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node")


def _node() -> Path | None:
    if NODE.exists():
        return NODE
    import shutil
    found = shutil.which("node")
    return Path(found) if found else None


def _score(path: Path) -> str:
    node = _node()
    result = subprocess.run(
        [str(node), "scripts/report-health-scorecard.mjs", str(path)],
        cwd=FRONTEND, capture_output=True, text=True, timeout=180,
    )
    return result.stdout + result.stderr


class ReportHealthScorecardTests(unittest.TestCase):
    def test_scorecard_and_fixture_exist(self):
        self.assertTrue(SCORECARD.exists(), "건전성 채점표가 있어야 한다")
        self.assertTrue(BROKEN.exists(), "실측 실패 실행이 고정 데이터로 있어야 한다")

    def test_fixture_still_holds_the_failure(self):
        """고정 데이터가 고쳐지면 채점표가 항상 만점이 되어 의미가 없어진다."""
        text = BROKEN.read_text(encoding="utf-8")
        self.assertIn("분석 중 오류가 발생하여", text)
        self.assertIn("모델 응답을 신뢰 가능한 구조로 파싱하지 못했습니다", text)

    def test_scorecard_uses_the_same_section_splitter_as_the_screen(self):
        """채점만 통과하고 화면은 다른 상태를 막는다."""
        source = SCORECARD.read_text(encoding="utf-8")
        self.assertIn("splitReasoningIntoSections", source)
        self.assertIn("analyst-report-v5/helpers.ts", source)

    @unittest.skipUnless(_node() and (FRONTEND / "node_modules/typescript").exists(),
                         "node 런타임 또는 typescript 가 없는 환경")
    def test_broken_run_is_caught_on_every_defect_the_user_reported(self):
        out = _score(BROKEN)
        # 사용자가 PDF 에서 지적한 것 그대로:
        self.assertIn("✗ 분석이 버려지지 않음", out, "분석이 통째로 버려진 것을 잡아야 한다")
        self.assertIn("✗ 완료된 에이전트의 신뢰도가 0 이 아님", out, "신뢰도 0% 를 잡아야 한다")
        self.assertIn("✗ 보고서 6개 섹션이 비지 않음", out, "빈 섹션을 잡아야 한다")
        self.assertIn("✗ 선행 컨센서스가 있으면 선행 DCF 도 나옴", out,
                      "선행 실적 반영 수치가 안 나간 것을 잡아야 한다")
        self.assertNotIn("★ 만점", out, "실패한 보고서가 만점을 받으면 안 된다")

    @unittest.skipUnless(_node() and (FRONTEND / "node_modules/typescript").exists(),
                         "node 런타임 또는 typescript 가 없는 환경")
    def test_section_split_reads_headings_the_model_actually_writes(self):
        """줄 가운데 붙은 "### 제목"을 못 읽으면 04 리스크가 통째로 빈다(10회 중 3회)."""
        node = _node()
        result = subprocess.run(
            [str(node), "scripts/check-section-split.mjs"],
            cwd=FRONTEND, capture_output=True, text=True, timeout=180,
        )
        self.assertEqual(result.returncode, 0,
                         f"섹션 분류 점검 실패:\n{result.stdout}\n{result.stderr}")

    @unittest.skipUnless(_node() and (FRONTEND / "node_modules/typescript").exists(),
                         "node 런타임 또는 typescript 가 없는 환경")
    def test_scorecard_exits_nonzero_on_failure(self):
        """스윕과 배포 게이트가 종료 코드로 판단한다."""
        node = _node()
        result = subprocess.run(
            [str(node), "scripts/report-health-scorecard.mjs", str(BROKEN)],
            cwd=FRONTEND, capture_output=True, text=True, timeout=180,
        )
        self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
