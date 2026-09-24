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
    CORPUS = ROOT / "tests/fixtures/corpus"

    def test_corpus_is_not_empty(self):
        """코퍼스가 비면 스윕이 항상 통과해 의미가 없어진다."""
        files = list(self.CORPUS.glob("*.txt"))
        self.assertGreaterEqual(len(files), 20, "실측 보고서 코퍼스가 20개 이상이어야 한다")

    @unittest.skipUnless(NODE.exists() and (FRONTEND / "node_modules/typescript").exists(),
                         "node 런타임 또는 typescript 가 없는 환경")
    def test_full_marks_three_rounds(self):
        result = subprocess.run(
            [str(NODE), "scripts/report-quality-sweep.mjs", str(self.CORPUS), str(FIXTURE), "--rounds", "3"],
            cwd=FRONTEND, capture_output=True, text=True, timeout=900,
        )
        self.assertEqual(result.returncode, 0, f"스윕 미달:\n{result.stdout[-3000:]}")
        self.assertIn("연속 만점", result.stdout)


class CorpusCollectorTests(unittest.TestCase):
    """분석을 돌릴 때마다 코퍼스가 두꺼워지도록 적립기를 둔다."""

    COLLECTOR = ROOT / "scripts/collect_report_corpus.py"

    def test_collector_exists(self):
        self.assertTrue(self.COLLECTOR.exists())

    def test_dedupes_by_content_hash(self):
        """같은 본문을 반복 적립하면 개수만 늘고 검증력은 그대로다."""
        src = self.COLLECTOR.read_text(encoding="utf-8")
        self.assertIn("hashlib.sha1", src)
        self.assertIn("if digest in known:", src)

    def test_caps_corpus_size(self):
        """무한히 쌓이면 스윕이 느려져 배포 게이트가 부담이 된다."""
        src = self.COLLECTOR.read_text(encoding="utf-8")
        self.assertIn("while len(files) > max_files:", src)

    def test_only_report_text_is_collected(self):
        """설정값·키가 든 컬럼을 담지 않도록 본문 키만 본다."""
        src = self.COLLECTOR.read_text(encoding="utf-8")
        self.assertIn('key in ("reasoning", "summary")', src)


class DeployGateTests(unittest.TestCase):
    """결함을 화면에서 발견하기 전에 배포를 막는다."""

    DEPLOY = ROOT / "deploy_aws.sh"

    def test_deploy_runs_the_sweep(self):
        src = self.DEPLOY.read_text(encoding="utf-8")
        self.assertIn("report-quality-sweep.mjs", src)
        self.assertIn("배포를 중단합니다", src)

    def test_gate_runs_before_deploying(self):
        """게이트가 배포 뒤에 있으면 이미 나간 뒤라 의미가 없다."""
        src = self.DEPLOY.read_text(encoding="utf-8")
        self.assertLess(src.index("report-quality-sweep.mjs"), src.index("Deploying to"))

    def test_skip_is_explicit_and_logged(self):
        src = self.DEPLOY.read_text(encoding="utf-8")
        self.assertIn("SKIP_REPORT_QUALITY_GATE", src)
        self.assertIn("건너뜁니다", src)


class StandardDocumentTests(unittest.TestCase):
    """기준을 문서로 못 박아 두고, 채점표가 그 기준을 따르는지 확인한다.

    기준이 머릿속에만 있으면 같은 지적이 되풀이된다. 새 결함을 발견하면
    문서 → 채점 항목 → 수정 순서로 처리한다.
    """

    DOC = ROOT / "docs/report/QUALITY_STANDARD.md"
    RUBRIC_SRC = FRONTEND / "scripts/report-quality-rubric.mjs"

    def test_standard_document_exists(self):
        self.assertTrue(self.DOC.exists())

    def test_standard_covers_every_family(self):
        text = self.DOC.read_text(encoding="utf-8")
        for heading in ("해석을 떠안지 않는다", "기계의 말을 쓰지 않는다",
                        "문장은 끝맺고", "줄바꿈은", "되풀이하지 않는다",
                        "원문은 살리고 번역", "숙제를 남기지 않는다"):
            self.assertIn(heading, text)

    def test_rubric_has_an_item_per_family(self):
        """기준만 있고 채점 항목이 없으면 검증되지 않는다."""
        src = self.RUBRIC_SRC.read_text(encoding="utf-8")
        for rule_id in ("rawfield", "dottedfield", "abbrev", "dangling", "headcut",
                        "listbreak", "longline", "repeatline", "dupclaim",
                        "homework", "engquote" if "engquote" in src else "englishword"):
            self.assertIn(f"id: '{rule_id}'", src, f"채점 항목 '{rule_id}' 이 있어야 한다")


class KoreanProseTests(unittest.TestCase):
    """본문에 영어·원시 필드명·중복 숫자가 남지 않는지.

    거듭 지적받은 결함이다. 그동안 필드명을 사전에 하나씩 적어 왔고, 그래서
    에이전트가 새 지표를 내보낼 때마다 그 이름이 화면에 샜다(실측 2026-09-04:
    한 보고서에 여섯 개 동시). 목록이 아니라 일반 규칙으로 막고 여기서 못 박는다.
    """

    CHECK = FRONTEND / "scripts/check-korean-prose.mjs"

    def test_check_exists(self):
        self.assertTrue(self.CHECK.exists())

    @unittest.skipUnless(NODE.exists() and (FRONTEND / "node_modules/typescript").exists(),
                         "node 런타임 또는 typescript 가 없는 환경")
    def test_prose_is_clean(self):
        result = subprocess.run(
            [str(NODE), "scripts/check-korean-prose.mjs"],
            cwd=FRONTEND, capture_output=True, text=True, timeout=180,
        )
        self.assertEqual(result.returncode, 0,
                         f"본문 한국어 점검 실패:\n{result.stdout}\n{result.stderr}")

    def test_unknown_field_names_are_handled_by_rule_not_by_list(self):
        """사전에 없는 필드명도 화면에 남으면 안 된다 — 목록 방식이 반복의 원인이었다."""
        source = (ROOT / "app/frontend/src/lib/financial-text-normalizer.ts").read_text(encoding="utf-8")
        self.assertIn("function normalizeRawFieldNames", source)
        self.assertIn("function collapseDuplicateNumbers", source)
        self.assertIn("function tidyKoreanProse", source)
