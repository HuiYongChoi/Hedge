from unittest.mock import patch

import src.tools.api as api


def test_alphavantage_skips_request_when_key_unset(monkeypatch):
    """AV_API_KEY 미설정 시 외부 호출 없이 None 을 반환한다."""
    monkeypatch.setattr(api, "AV_API_KEY", "")
    with patch("src.tools.api.requests.get") as mock_get:
        assert api._fetch_alphavantage_metrics("AAPL") is None
    mock_get.assert_not_called()


def test_alphavantage_uses_key_from_env(monkeypatch):
    monkeypatch.setattr(api, "AV_API_KEY", "test-key")
    with patch("src.tools.api.requests.get") as mock_get:
        mock_get.return_value.status_code = 500
        assert api._fetch_alphavantage_metrics("AAPL") is None
    mock_get.assert_called_once()
    assert "apikey=test-key" in mock_get.call_args.args[0]
