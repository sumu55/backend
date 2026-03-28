"""Pydantic schemas for request/response validation."""
from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import datetime


# Auth
class UserRegister(BaseModel):
    email: str
    password: str
    name: str

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        v = (v or "").strip()
        if "@" not in v or "." not in v.split("@")[-1]:
            raise ValueError("Invalid email")
        return v


class UserLogin(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        v = (v or "").strip()
        if "@" not in v or "." not in v.split("@")[-1]:
            raise ValueError("Invalid email")
        return v


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class GoogleAuth(BaseModel):
    id_token: str


# User
class UserProfile(BaseModel):
    id: int
    email: str
    name: str
    profile_picture: Optional[str]
    provider: str

    class Config:
        from_attributes = True


class DeviceInfo(BaseModel):
    device_id: str
    status: str


class UserProfileResponse(BaseModel):
    user: UserProfile
    device: Optional[DeviceInfo]


class PairRequest(BaseModel):
    device_id: str


class UserUpdate(BaseModel):
    name: Optional[str] = None
    password: Optional[str] = None


# Sensor
class SensorDataCreate(BaseModel):
    temperature: float
    humidity: float
    blood_flow: float
    motion: float
    timestamp: Optional[datetime] = None


class SensorDataResponse(BaseModel):
    id: int
    temperature: float
    humidity: float
    blood_flow: float
    motion: float
    timestamp: datetime

    class Config:
        from_attributes = True


# Prediction
class PredictionResponse(BaseModel):
    id: int
    prediction: int  # 0=normal, 1=risk
    insight_text: Optional[str]
    timestamp: datetime

    class Config:
        from_attributes = True


class PredictionCreate(BaseModel):
    temperature: float
    humidity: float
    blood_flow: float
    motion: float


# Vibration
class VibrationTrigger(BaseModel):
    device_id: str
    reason: Optional[str] = None
