"""보고서 본문을 사람이 읽는 한국어로 만드는 렌더 계층 규칙 검증.

여기 인용된 문장은 실제 배포본이 뽑아낸 보고서(SK하이닉스·삼성전자)에서 그대로
옮긴 것이다. 전문 용어는 그대로 두고, 말투와 표기만 일상어로 바꾸는 게 목표다.
"""

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
NORMALIZER = ROOT / "app/frontend/src/lib/financial-text-normalizer.ts"
HELPERS = ROOT / "app/frontend/src/components/reports/analyst-report-v5/helpers.ts"

SRC = NORMALIZER.read_text(encoding="utf-8")
HELPERS_SRC = HELPERS.read_text(encoding="utf-8")


class PlainKoreanTests(unittest.TestCase):
    """'…가 제시된다' 같은 논문 투가 한 보고서 안에서 '…합니다'와 뒤섞여 있었다."""

    def test_sentence_endings_are_converted(self):
        self.assertIn("const SENTENCE_ENDINGS", SRC)
        for stem in ("'제시된다'", "'명시된다'", "'확인된다'", "'한다'", "'된다'", "'없다'"):
            self.assertIn(stem, SRC, f"{stem} 어미 변환 규칙이 있어야 한다")

    def test_longest_ending_wins(self):
        """'제시된다'가 '된다'에 먼저 먹히면 '제시됩니다'가 되어 의도한 표현을 잃는다."""
        self.assertIn("sort((a, b) => b.length - a.length)", SRC)

    def test_quotes_are_not_rewritten(self):
        """인용부호 안은 회사·공시의 말이다. 고쳐 쓰면 근거가 아니게 된다."""
        self.assertIn("function mapOutsideQuotes", SRC)
        self.assertIn("normalizeToPlainKorean", SRC)

    def test_stilted_phrases_ordered_longest_first(self):
        """짧은 규칙이 앞서면 긴 문장을 못 잡아 오히려 더 어색해진다(실측)."""
        long_idx = SRC.index("여부를\\s*단정할")
        short_idx = SRC.index("[/확인이\\s*제한된다/g")
        self.assertLess(long_idx, short_idx)


class RawFieldNameTests(unittest.TestCase):
    """모델이 분석 데이터의 키 이름을 그대로 옮겨 적는다. 독자에게는 암호다."""

    def test_korean_suffixed_fields_are_translated(self):
        for field in ("concerns_ko", "evidence_ko", "verdict_ko", "notes_ko", "grade_ko"):
            self.assertIn(field, SRC, f"{field} 치환 규칙이 있어야 한다")

    def test_life_cycle_pair_handled_before_single(self):
        """'life_cycle. evidence_ko에 따르면'은 두 키가 붙어 문장이 끊긴 형태다."""
        pair = SRC.index("life_cycle\\s*\\.\\s*evidence_ko")
        single = SRC.index("[/\\blife_cycle\\b/gi")
        self.assertLess(pair, single)

    def test_korean_word_boundary_not_used(self):
        r"""JS 정규식의 \b 는 한글 앞에서 성립하지 않는다 — 규칙이 조용히 안 걸린다."""
        self.assertNotIn("/\\b경영진", SRC)

    def test_prompt_only_wording_removed(self):
        """'(전처리)'는 프롬프트에서 온 말이다. 독자에게는 아무 의미가 없다."""
        self.assertIn("전처리", SRC)


class NumberAndLabelRepairTests(unittest.TestCase):
    def test_repeated_ratio_labels_collapse(self):
        """실측: '이자부채비율 (이자부채비율, 이자부채비율 (이자부채비율 (…)))'."""
        self.assertIn("collapseRepeatedRatioLabels", SRC)

    def test_fragmented_percent_repaired(self):
        """실측: '이자부채비율290.0%.9%'."""
        self.assertIn("repairFragmentedPercents", SRC)

    def test_currency_prefix_mismatch_stripped(self):
        """실측: 'USD 435,059 백만원' — 통화와 단위가 어긋난다."""
        self.assertIn("stripMismatchedCurrencyPrefix", SRC)

    def test_margin_of_safety_shown_as_percent(self):
        """'안전마진이 음수 (-0.43)'은 크기가 안 읽힌다. -43% 로 보여야 한다."""
        self.assertIn("안전마진|margin\\s*of\\s*safety", SRC)

    def test_noisy_percent_precision_trimmed(self):
        """'12.999%'는 정밀도가 아니라 잡음이다."""
        self.assertIn("(\\d+\\.\\d{3,})%", SRC)

    def test_leftover_markers_stripped(self):
        """실측: '검토 필요 - [ ] 위험관리', '[?] 경영진 종합평가', 고아 ']'."""
        self.assertIn("stripLeftoverMarkers", SRC)


class PipelineWiringTests(unittest.TestCase):
    def test_all_passes_are_wired(self):
        entry = SRC[SRC.index("export function normalizeFinancialDisplayText"):]
        for fn in (
            "normalizeToPlainKorean",
            "humanizeRawFieldNames",
            "collapseRepeatedRatioLabels",
            "repairFragmentedPercents",
            "stripMismatchedCurrencyPrefix",
            "stripLeftoverMarkers",
            "stripLeakedSourceMarkers",
        ):
            self.assertIn(fn, entry, f"{fn} 이 정규화 파이프라인에 연결돼야 한다")

    def test_dedupe_keeps_block_head(self):
        """블록 첫 문장은 절대 지우지 않는다 — 지우면 뒤 문장이 주어를 잃는다.

        예전에는 '블록 안 문장이 전부 앞서 나왔으면 블록을 통째로 버린다'고 했는데,
        뒤 섹션이 앞 섹션의 요지를 풀어 쓰는 정상적 서술까지 전멸시켰다
        (실측: 리스크 715자→10자, 크로스체크 573자→12자). 이제 블록 전체 지문이
        똑같을 때만 버리고, 블록 안에서는 첫 문장을 보존한다.
        """
        helpers = HELPERS.read_text(encoding="utf-8")
        self.assertIn("if (index === 0) { seenSentences.add(key); return true; }", helpers)
        self.assertIn("blockKey.length >= 40 && seenBlocks.has(blockKey)", helpers)
