"""Prediction and AI insight routes."""
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, Query, Body
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User, SensorData, Prediction
from ..auth.dependencies import get_current_user
from ..services.ml_predictor import predict, get_trend_insight

router = APIRouter()


@router.get("")
def get_prediction(
    limit: int = Query(20, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    rows = db.query(Prediction).filter(Prediction.user_id == user.id).order_by(Prediction.timestamp.desc()).limit(limit).all()
    return [{"id": r.id, "prediction": r.prediction, "insight_text": r.insight_text, "timestamp": r.timestamp.isoformat()} for r in rows]


# NOTE: /insight must be declared BEFORE the POST "" route to prevent FastAPI matching "insight" as a body param
@router.get("/insight")
def get_ai_insight(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Generate AI insight from recent sensor history."""
    history = db.query(SensorData).filter(SensorData.user_id == user.id).order_by(SensorData.timestamp.desc()).limit(30).all()
    hist_list = [{"temperature": h.temperature, "humidity": h.humidity, "blood_flow": h.blood_flow, "motion": h.motion} for h in reversed(history)]
    insight = get_trend_insight(hist_list)
    return {"insight": insight}


@router.post("")
def create_prediction(
    data: Optional[dict] = Body(None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if data:
        temperature = data.get("temperature")
        humidity    = data.get("humidity")
        blood_flow  = data.get("blood_flow")
        motion      = data.get("motion")
    else:
        temperature = humidity = blood_flow = motion = None

    if None in (temperature, humidity, blood_flow, motion):
        from fastapi import HTTPException
        raise HTTPException(400, "JSON body with temperature, humidity, blood_flow, motion required")

    pred, insight = predict(temperature, humidity, blood_flow, motion)
    record = Prediction(
        user_id=user.id, device_id="SIM-001", prediction=pred,
        temperature=temperature, humidity=humidity,
        blood_flow=blood_flow, motion=motion,
        insight_text=insight, timestamp=datetime.utcnow()
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return {"prediction": pred, "insight_text": insight}
