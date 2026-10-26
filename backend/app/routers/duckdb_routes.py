from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from pydantic import BaseModel
from backend.app.auth import get_current_user
from backend.app.models import User
from backend.app.services.duckdb_service import duckdb_service

router = APIRouter(prefix="/api/duckdb", tags=["duckdb"])

MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50MB ceiling

class QueryPayload(BaseModel):
    sql: str
    limit: int | None = 1000
    offset: int | None = 0

class DiskImportPayload(BaseModel):
    path: str
    table_name: str | None = None

@router.get("/datasets")
def get_duckdb_datasets(current_user: User = Depends(get_current_user)):
    return duckdb_service.list_datasets()

@router.post("/upload")
async def upload_duckdb_dataset(
    file: UploadFile = File(...),
    table_name: str | None = Form(None),
    current_user: User = Depends(get_current_user)
):
    """Uploads a local CSV, Parquet, or JSON dataset file into DuckDB with size protection."""
    try:
        chunks = []
        total_size = 0
        while chunk := await file.read(1024 * 1024):  # 1MB chunk
            total_size += len(chunk)
            if total_size > MAX_UPLOAD_BYTES:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail="File exceeds maximum allowed size of 50MB."
                )
            chunks.append(chunk)
        content = b"".join(chunks)

        res = duckdb_service.import_file_dataset(
            filename=file.filename or "dataset.csv",
            file_bytes=content,
            table_name=table_name
        )
        if res.get("status") == "error":
            raise HTTPException(status_code=400, detail=res.get("error", "Import failed"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process file upload: {str(e)}")

@router.post("/import-disk")
def import_disk_dataset(
    payload: DiskImportPayload,
    current_user: User = Depends(get_current_user)
):
    """Imports an existing dataset file (.csv, .parquet, .json) already on the VM/disk into DuckDB."""
    try:
        res = duckdb_service.import_disk_dataset(
            disk_path=payload.path,
            table_name=payload.table_name
        )
        if res.get("status") == "error":
            raise HTTPException(status_code=400, detail=res.get("error", "Import failed"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to import disk file: {str(e)}")

@router.delete("/datasets/{table_name}")
def delete_duckdb_dataset(
    table_name: str,
    current_user: User = Depends(get_current_user)
):
    """Drops a dataset table and removes its cached file."""
    success = duckdb_service.drop_table(table_name)
    if not success:
        raise HTTPException(status_code=400, detail=f"Failed to drop table '{table_name}'")
    return {"status": "success", "message": f"Table '{table_name}' deleted"}

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
