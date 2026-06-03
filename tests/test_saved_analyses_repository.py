import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.backend.database.connection import Base
from app.backend.database.models import SavedAnalysis  # noqa: F401 — ensures table is registered
from app.backend.repositories.saved_analysis_repository import SavedAnalysisRepository


@pytest.fixture()
def db_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


def test_delete_removes_row(db_session):
    repo = SavedAnalysisRepository(db_session)
    item = repo.create(source_tab='stock_analysis', ticker='MU', language='ko')
    repo.delete(item.id)
    assert repo.get_by_id(item.id) is None


def test_filter_by_source_tab(db_session):
    repo = SavedAnalysisRepository(db_session)
    repo.create(source_tab='stock_analysis', ticker='AAPL', language='ko')
    repo.create(source_tab='data_sandbox', ticker='AAPL', language='ko')
    items = repo.get_all(source_tab='stock_analysis')
    assert len(items) == 1
    assert items[0].source_tab == 'stock_analysis'


def test_filter_by_ticker_case_insensitive(db_session):
    repo = SavedAnalysisRepository(db_session)
    repo.create(source_tab='stock_analysis', ticker='AAPL', language='ko')
    items = repo.get_all(ticker='aap')
    assert len(items) == 1


def test_count_with_filters(db_session):
    repo = SavedAnalysisRepository(db_session)
    repo.create(source_tab='stock_analysis', ticker='MU', language='ko')
    repo.create(source_tab='data_sandbox', ticker='MU', language='ko')
    repo.create(source_tab='stock_analysis', ticker='AAPL', language='ko')
    assert repo.count() == 3
    assert repo.count(source_tab='stock_analysis') == 2
    assert repo.count(ticker='MU') == 2


def test_create_uses_date_prefixed_company_display_name_for_kr_stock(db_session):
    repo = SavedAnalysisRepository(db_session)
    item = repo.create(
        source_tab='stock_analysis',
        ticker='005930.KS',
        language='ko',
        result_data={
            'complete_result': {
                'analyst_signals': {
                    'valuation_analyst': {
                        '005930.KS': {'company_name': '삼성전자'}
                    }
                }
            }
        },
    )

    assert item.result_data['saved_display_name'].endswith(' 삼성전자')
    assert item.result_data['saved_display_name'][:10] == item.created_at.strftime('%Y-%m-%d')


def test_update_display_name_persists_in_result_data(db_session):
    repo = SavedAnalysisRepository(db_session)
    item = repo.create(source_tab='stock_analysis', ticker='000660.KS', language='ko')

    updated = repo.update_display_name(item.id, '2026-06-03 SK하이닉스 메모')

    assert updated is not None
    assert updated.result_data['saved_display_name'] == '2026-06-03 SK하이닉스 메모'
