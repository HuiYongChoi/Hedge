from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TICKER_INPUT = ROOT / "app/frontend/src/components/ui/ticker-input.tsx"


def test_ticker_input_shows_exact_symbol_matches_from_autocomplete_results() -> None:
    source = TICKER_INPUT.read_text(encoding="utf-8")

    assert "currentTerm !== dismissedTerm" in source
    assert "suggestions.length > 0" in source
    assert "!isExactSuggestionMatch(currentTerm, suggestions)" not in source
