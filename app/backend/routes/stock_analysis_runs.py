from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional

from app.backend.database import get_db
from app.backend.models.schemas import (
    ErrorResponse,
    StockAnalysisRunCreateRequest,
    StockAnalysisRunResponse,
    StockAnalysisRunUpdateRequest,
)
from app.backend.repositories.stock_analysis_run_repository import StockAnalysisRunRepository


router = APIRouter(prefix="/stock-analysis-runs", tags=["stock-analysis-runs"])


@router.post(
    "/",
    response_model=StockAnalysisRunResponse,
    responses={500: {"model": ErrorResponse, "description": "Internal server error"}},
)
async def create_stock_analysis_run(
    request: StockAnalysisRunCreateRequest,
    db: Session = Depends(get_db),
):
    """Persist a standalone Stock Analysis snapshot."""
    try:
        repo = StockAnalysisRunRepository(db)
        run = repo.create_run(
            ticker=request.ticker,
            language=request.language,
            status=request.status,
            request_data=request.request_data,
            result_data=request.result_data,
            ui_state=request.ui_state,
            error_message=request.error_message,
        )
        return StockAnalysisRunResponse.from_orm(run)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create Stock Analysis run: {str(e)}")


@router.get(
    "/latest",
    response_model=Optional[StockAnalysisRunResponse],
    responses={500: {"model": ErrorResponse, "description": "Internal server error"}},
)
async def get_latest_stock_analysis_run(db: Session = Depends(get_db)):
    """Get the latest standalone Stock Analysis snapshot."""
    try:
        repo = StockAnalysisRunRepository(db)
        run = repo.get_latest_run()
        return StockAnalysisRunResponse.from_orm(run) if run else None
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve latest Stock Analysis run: {str(e)}")


@router.get(
    "/{run_id}",
    response_model=StockAnalysisRunResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Stock Analysis run not found"},
        500: {"model": ErrorResponse, "description": "Internal server error"},
    },
)
async def get_stock_analysis_run(run_id: int, db: Session = Depends(get_db)):
    """Get a standalone Stock Analysis snapshot by ID."""
    try:
        repo = StockAnalysisRunRepository(db)
        run = repo.get_run_by_id(run_id)
        if not run:
            raise HTTPException(status_code=404, detail="Stock Analysis run not found")
        return StockAnalysisRunResponse.from_orm(run)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve Stock Analysis run: {str(e)}")


@router.put(
    "/{run_id}",
    response_model=StockAnalysisRunResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Stock Analysis run not found"},
        500: {"model": ErrorResponse, "description": "Internal server error"},
    },
)
async def update_stock_analysis_run(
    run_id: int,
    request: StockAnalysisRunUpdateRequest,
    db: Session = Depends(get_db),
):
    """Update a standalone Stock Analysis snapshot."""
    try:
        repo = StockAnalysisRunRepository(db)
        run = repo.update_run(
            run_id=run_id,
            ticker=request.ticker,
            language=request.language,
            status=request.status,
            request_data=request.request_data,
            result_data=request.result_data,
            ui_state=request.ui_state,
            error_message=request.error_message,
        )
        if not run:
            raise HTTPException(status_code=404, detail="Stock Analysis run not found")
        return StockAnalysisRunResponse.from_orm(run)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update Stock Analysis run: {str(e)}")
