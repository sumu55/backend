"""Vibration trigger route."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User, VibrationTrigger
from ..auth.dependencies import get_current_user

router = APIRouter()


@router.post("")
def trigger_vibration(
    device_id: str = "SHOE-001",
    reason: str = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    record = VibrationTrigger(user_id=user.id, device_id=device_id, reason=reason)
    db.add(record)
    db.commit()
    return {"message": "Vibration trigger logged"}
