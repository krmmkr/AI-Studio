from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from backend.app.auth import get_current_user
from backend.app.models import User
from backend.app.services.duckdb_service import duckdb_service

router = APIRouter(prefix="/api/duckdb", tags=["duckdb"])

class QueryPayload(BaseModel):
    sql: str
    limit: int | None = 1000
    offset: int | None = 0

@router.get("/datasets")
def get_duckdb_datasets(current_user: User = Depends(get_current_user)):
    return duckdb_service.list_datasets()

@router.post("/query")
def run_duckdb_query(payload: QueryPayload, current_user: User = Depends(get_current_user)):
    try:
        result = duckdb_service.execute_query(
            payload.sql,
            user_id=current_user.id,
            limit=payload.limit if payload.limit is not None else 1000,
            offset=payload.offset if payload.offset is not None else 0
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal database execution error: {str(e)}")
