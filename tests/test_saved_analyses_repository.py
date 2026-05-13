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
