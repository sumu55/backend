"""User profile routes."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User, Device
from ..schemas import UserProfile, UserProfileResponse, UserUpdate, PairRequest
from ..auth.dependencies import get_current_user, get_password_hash

router = APIRouter()


@router.get("/profile", response_model=UserProfileResponse)
def get_profile(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    device = db.query(Device).filter(Device.user_id == user.id).first()
    return {
        "user": user,
        "device": {"device_id": device.device_id, "status": "paired"} if device else None
    }


@router.post("/pair")
def pair_device(data: PairRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    device = db.query(Device).filter(Device.user_id == user.id).first()
    if device:
        device.device_id = data.device_id
    else:
        new_device = Device(user_id=user.id, device_id=data.device_id)
        db.add(new_device)
    db.commit()
    return {"message": "Device paired successfully", "status": "paired"}


@router.put("/update")
def update_profile(data: UserUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if data.name is not None:
        user.name = data.name
    if data.password is not None and data.password.strip():
        user.password_hash = get_password_hash(data.password)
    db.commit()
    db.refresh(user)
    return {"message": "Profile updated"}
