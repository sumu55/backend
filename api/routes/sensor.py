"""Sensor data routes - real and simulated."""
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User, Device, SensorData
from ..schemas import SensorDataCreate, SensorDataResponse
from ..auth.dependencies import get_current_user
from ..services.sensor_simulator import generate_simulated_data
from ..websocket import broadcast_sensor_data
import requests
import os

router = APIRouter()
_global_last_sim = {}


@router.get("", response_model=list)
def get_sensor_data(
    limit: int = Query(50, le=500),
    device_id: str = Query(None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    q = db.query(SensorData).filter(SensorData.user_id == user.id)
    if device_id:
        q = q.filter(SensorData.device_id == device_id)
    rows = q.order_by(SensorData.timestamp.desc()).limit(limit).all()
    return [{"id": r.id, "temperature": r.temperature, "humidity": r.humidity, "blood_flow": r.blood_flow, "motion": r.motion, "timestamp": r.timestamp.isoformat()} for r in rows]


@router.post("", response_model=dict)
def post_sensor_data(
    data: SensorDataCreate,
    device_id: str = Query("SHOE-001"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    ts = data.timestamp or datetime.utcnow()
    record = SensorData(
        user_id=user.id, device_id=device_id,
        temperature=data.temperature, humidity=data.humidity,
        blood_flow=data.blood_flow, motion=data.motion,
        timestamp=ts
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    # Auto-register or update device
    dev = db.query(Device).filter(Device.user_id == user.id, Device.device_id == device_id).first()
    if not dev:
        dev = Device(user_id=user.id, device_id=device_id)
        db.add(dev)
        db.commit()
    if dev:
        dev.last_seen = datetime.utcnow()
        db.commit()

    # Broadcast to WebSocket
    broadcast_sensor_data(user.id, data.model_dump() if hasattr(data, "model_dump") else data.dict())

    # Trigger Push Notification if temp > 40
    if data.temperature > 40:
        app_id = "add31a2c-d632-491c-ae62-4da16d96e567"
        api_key = os.getenv("ONESIGNAL_REST_API_KEY", "YOUR_REST_API_KEY")
        headers = {
            "Content-Type": "application/json; charset=utf-8",
            "Authorization": f"Basic {api_key}"
        }
        payload = {
            "app_id": app_id,
            "headings": {"en": "⚠️ Health Alert"},
            "contents": {"en": f"High body temperature detected ({data.temperature}°C)"},
            "included_segments": ["All"]
        }
        try:
            requests.post("https://onesignal.com/api/v1/notifications", json=payload, headers=headers, timeout=5)
        except Exception as e:
            print(f"Failed to send push notification: {e}")

    return {"id": record.id, "timestamp": record.timestamp.isoformat()}


@router.get("/simulate")
def simulate_sensor(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Generate realistic random sensor data (simulation API)."""
    key = str(user.id)
    base = _global_last_sim.get(key)
    sim = generate_simulated_data(base)
    _global_last_sim[key] = sim
    ts = datetime.fromisoformat(sim["timestamp"].replace("Z", "+00:00"))
    record = SensorData(
        user_id=user.id, device_id="SIM-001",
        temperature=sim["temperature"], humidity=sim["humidity"],
        blood_flow=sim["blood_flow"], motion=sim["motion"],
        timestamp=ts
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return sim
