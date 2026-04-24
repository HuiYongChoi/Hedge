from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.backend.database import get_db
from app.backend.models.schemas import ErrorResponse, SavedAnalysisCreateRequest, SavedAnalysisResponse
from app.backend.repositories.saved_analysis_repository import SavedAnalysisRepository

router = APIRouter(prefix="/saved-analyses", tags=["saved-analyses"])

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
        )
        return SavedAnalysisResponse.from_orm(saved)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save analysis: {str(e)}")

@router.get(
    "/",
    response_model=List[SavedAnalysisResponse],
    responses={500: {"model": ErrorResponse, "description": "Internal server error"}},
)
async def list_saved_analyses(
    limit: int = 50,
    skip: int = 0,
    db: Session = Depends(get_db),
):
    try:
        repo = SavedAnalysisRepository(db)
        items = repo.get_all(limit=limit, skip=skip)
        return [SavedAnalysisResponse.from_orm(item) for item in items]
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
        return SavedAnalysisResponse.from_orm(item)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get saved analysis: {str(e)}")
