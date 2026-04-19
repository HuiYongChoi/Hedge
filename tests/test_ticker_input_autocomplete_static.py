from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
TICKER_INPUT = ROOT / "app/frontend/src/components/ui/ticker-input.tsx"


class TickerInputAutocompleteStaticTests(unittest.TestCase):
    def test_completed_suggestion_hides_dropdown(self):
        source = TICKER_INPUT.read_text(encoding="utf-8")

        self.assertIn("function isExactSuggestionMatch", source)
        self.assertIn("!isExactSuggestionMatch(currentTerm, suggestions)", source)
        self.assertIn("if (hasCompletedSuggestion(term, staticResults))", source)

    def test_keyboard_selection_ignores_ime_composition(self):
        source = TICKER_INPUT.read_text(encoding="utf-8")

        self.assertIn("isComposingRef", source)
        self.assertIn("const [draftValue, setDraftValue]", source)
        self.assertIn("value={draftValue}", source)
        self.assertIn("onCompositionStart", source)
        self.assertIn("onCompositionEnd", source)
        self.assertIn("e.nativeEvent.isComposing", source)
        self.assertIn("if (isComposing)", source)
        self.assertIn("const isInputComposing", source)
        self.assertIn("if (isInputComposing)", source)

    def test_selection_uses_live_input_value_to_avoid_korean_duplicate_commit(self):
        source = TICKER_INPUT.read_text(encoding="utf-8")

        self.assertIn("const currentValue = inputRef.current?.value ?? value", source)
        self.assertIn("const parts = currentValue.split(',')", source)
        self.assertIn("skipNextFetchRef.current = true", source)

    def test_selected_korean_api_suggestion_updates_resolver_mapping(self):
        source = TICKER_INPUT.read_text(encoding="utf-8")

        self.assertIn("function rememberKoreanTickerSuggestion", source)
        self.assertIn("KOREAN_NAME_TO_TICKER[suggestion.name] = suggestion.ticker", source)
        self.assertIn("data.forEach(rememberKoreanTickerSuggestion)", source)
        self.assertIn("rememberKoreanTickerSuggestion(suggestion)", source)

    def test_dropdown_rows_are_full_width_and_readable_for_korean_names(self):
        source = TICKER_INPUT.read_text(encoding="utf-8")

        self.assertIn("w-full max-h-72", source)
        self.assertIn("min-w-0 flex-1", source)
        self.assertNotIn("font-mono font-semibold w-20", source)


if __name__ == "__main__":
    unittest.main()
