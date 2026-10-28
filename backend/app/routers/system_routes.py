import json
import datetime
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.app.auth import get_current_user
from backend.app.database import get_db
from backend.app.models import User, SystemSetting

logger = logging.getLogger("system_routes")
router = APIRouter(prefix="/api/system", tags=["system"])


class UpdateBrandingPayload(BaseModel):
    app_name: str | None = None
    logo_url: str | None = None


DEFAULT_BRANDING = {
    "app_name": "AI Studio",
    "logo_url": "",
}


@router.get("/branding")
def get_branding(db: Session = Depends(get_db)):
    """
    Returns public brand configuration (application name and logo URL).
    Accessible without authentication so navbar, branding, and login views can render.
    """
    try:
        setting = db.query(SystemSetting).filter(SystemSetting.key == "branding").first()
        if not setting:
            return DEFAULT_BRANDING
        data = json.loads(setting.value)
        return {
            "app_name": data.get("app_name") or "AI Studio",
            "logo_url": data.get("logo_url") or "",
        }
    except Exception as e:
        logger.warning(f"Could not retrieve system branding setting: {e}")
        return DEFAULT_BRANDING


@router.put("/branding")
def update_branding(
    payload: UpdateBrandingPayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Updates the system branding (app name and logo URL).
    Strictly restricted to users with the 'admin' role.
    """
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrative privileges are required to configure system branding.",
        )

    clean_app_name = (payload.app_name.strip() if payload.app_name else "AI Studio") or "AI Studio"
    clean_logo_url = payload.logo_url.strip() if payload.logo_url else ""

    branding_dict = {
        "app_name": clean_app_name,
        "logo_url": clean_logo_url,
    }

    setting = db.query(SystemSetting).filter(SystemSetting.key == "branding").first()
    if not setting:
        setting = SystemSetting(
            key="branding",
            value=json.dumps(branding_dict),
            updated_at=datetime.datetime.utcnow(),
        )
        db.add(setting)
    else:
        setting.value = json.dumps(branding_dict)
        setting.updated_at = datetime.datetime.utcnow()

    db.commit()
    logger.info(f"System branding updated by {current_user.email}: name='{clean_app_name}', logo='{clean_logo_url}'")
    return branding_dict
