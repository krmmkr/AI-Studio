from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from sqlalchemy.orm import Session
from backend.app.auth import get_current_user
from backend.app.database import get_db
from backend.app.models import User, DatasetFile
from backend.app.services.file_storage import save_user_file, read_user_file

router = APIRouter(prefix="/api/files", tags=["files"])

@router.get("")
def list_files(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    files = db.query(DatasetFile).filter(DatasetFile.user_id == current_user.id).order_by(DatasetFile.created_at.desc()).all()
    return [
        {
            "id": f.id,
            "filename": f.filename,
            "file_size": f.file_size,
            "mime_type": f.mime_type,
            "description": f.description,
            "created_at": f.created_at.isoformat() if f.created_at else None
        }
        for f in files
    ]

@router.get("/{file_id}/download")
def download_file(file_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    record = db.query(DatasetFile).filter(
        DatasetFile.id == file_id,
        DatasetFile.user_id == current_user.id
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="File not found")

    try:
        content = read_user_file(current_user.id, record.relative_path)
    except (PermissionError, FileNotFoundError) as e:
        raise HTTPException(status_code=403, detail=str(e))

    return Response(
        content=content,
        media_type=record.mime_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{record.filename}"'}
    )

@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    description: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    content = await file.read()
    file_id, relative_path, size = save_user_file(current_user.id, file.filename or "upload.dat", content)

    record = DatasetFile(
        id=file_id,
        user_id=current_user.id,
        filename=file.filename or "upload.dat",
        relative_path=relative_path,
        file_size=size,
        mime_type=file.content_type or "text/csv",
        description=description
    )
    db.add(record)
    db.commit()
    return {"id": file_id, "filename": record.filename, "size": size}
