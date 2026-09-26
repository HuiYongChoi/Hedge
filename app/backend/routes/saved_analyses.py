from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session
from typing import List, Optional

from app.backend.database import get_db
from app.backend.models.schemas import (
    ErrorResponse,
    SavedAnalysisCreateRequest,
    SavedAnalysisResponse,
    SavedAnalysisUpdateRequest,
)
from app.backend.repositories.saved_analysis_repository import SavedAnalysisRepository, build_saved_display_name

router = APIRouter(prefix="/saved-analyses", tags=["saved-analyses"])


#: 목록에서 빼는 큰 필드 — 지수 전체 스캔은 종목 결과가 수백 개라 목록 응답이 수십 MB 로 커진다.
#: 목록 행은 요약(counts·scanned·total)만 쓰고, 상세는 한 건 조회로 전체를 받는다.
_LIST_OMIT = {"quality_buy": ("results",)}


def _to_list_response(item) -> SavedAnalysisResponse:
    response = _to_response(item)
    omit = _LIST_OMIT.get(item.source_tab)
    if omit and isinstance(response.result_data, dict):
        response.result_data = {k: v for k, v in response.result_data.items() if k not in omit}
    return response


def _to_response(item) -> SavedAnalysisResponse:
    response = SavedAnalysisResponse.from_orm(item)
    response.display_name = build_saved_display_name(
        ticker=item.ticker,
        created_at=item.created_at,
        request_data=item.request_data,
        result_data=item.result_data,
    )
    return response

@router.post(
    "/",
    response_model=SavedAnalysisResponse,
    responses={500: {"model": ErrorResponse, "description": "Internal server error"}},
)
async def save_analysis(
    request: SavedAnalysisCreateRequest,
    db: Session = Depends(get_db),
):
    try:
        repo = SavedAnalysisRepository(db)
        saved = repo.create(
            source_tab=request.source_tab,
            ticker=request.ticker,
            language=request.language,
            request_data=request.request_data,
            result_data=request.result_data,
            display_name=request.display_name,
        )
        return _to_response(saved)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save analysis: {str(e)}")

@router.get(
    "/",
    response_model=List[SavedAnalysisResponse],
    responses={500: {"model": ErrorResponse, "description": "Internal server error"}},
)
async def list_saved_analyses(
    response: Response,
    limit: int = 50,
    skip: int = 0,
    source_tab: Optional[str] = None,
    ticker: Optional[str] = None,
    created_from: Optional[str] = None,
    created_to: Optional[str] = None,
    db: Session = Depends(get_db),
):
    try:
        repo = SavedAnalysisRepository(db)
        items = repo.get_all(
            limit=limit,
            skip=skip,
            source_tab=source_tab,
            ticker=ticker,
            created_from=created_from,
            created_to=created_to,
        )
        total = repo.count(
            source_tab=source_tab,
            ticker=ticker,
            created_from=created_from,
            created_to=created_to,
        )
        response.headers["X-Total-Count"] = str(total)
        return [_to_list_response(item) for item in items]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list saved analyses: {str(e)}")

@router.get(
    "/{analysis_id}",
    response_model=SavedAnalysisResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Saved analysis not found"},
        500: {"model": ErrorResponse, "description": "Internal server error"},
    },
)
async def get_saved_analysis(
    analysis_id: int,
    db: Session = Depends(get_db),
):
    try:
        repo = SavedAnalysisRepository(db)
        item = repo.get_by_id(analysis_id)
        if not item:
            raise HTTPException(status_code=404, detail="Saved analysis not found")
        return _to_response(item)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get saved analysis: {str(e)}")

@router.patch(
    "/{analysis_id}",
    response_model=SavedAnalysisResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Saved analysis not found"},
        500: {"model": ErrorResponse, "description": "Internal server error"},
    },
)
async def update_saved_analysis(
    analysis_id: int,
    request: SavedAnalysisUpdateRequest,
    db: Session = Depends(get_db),
):
    try:
        repo = SavedAnalysisRepository(db)
        item = repo.update_display_name(analysis_id, request.display_name)
        if not item:
            raise HTTPException(status_code=404, detail="Saved analysis not found")
        return _to_response(item)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update saved analysis: {str(e)}")

@router.delete(
    "/{analysis_id}",
    status_code=204,
    responses={
        404: {"model": ErrorResponse, "description": "Saved analysis not found"},
        500: {"model": ErrorResponse, "description": "Internal server error"},
    },
)
async def delete_saved_analysis(
    analysis_id: int,
    db: Session = Depends(get_db),
):
    try:
        repo = SavedAnalysisRepository(db)
        item = repo.get_by_id(analysis_id)
        if not item:
            raise HTTPException(status_code=404, detail="Saved analysis not found")
        repo.delete(analysis_id)
        return None
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete saved analysis: {str(e)}")
