"""History route for time-series data."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User, SensorData
from ..auth.dependencies import get_current_user

router = APIRouter()


@router.get("")
def get_history(
    limit: int = Query(100, le=500),
    device_id: str = Query(None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    q = db.query(SensorData).filter(SensorData.user_id == user.id)
    if device_id:
        q = q.filter(SensorData.device_id == device_id)
    rows = q.order_by(SensorData.timestamp.desc()).limit(limit).all()
    return [{
        "temperature": r.temperature, "humidity": r.humidity,
        "blood_flow": r.blood_flow, "motion": r.motion,
        "timestamp": r.timestamp.isoformat()
    } for r in reversed(rows)]
