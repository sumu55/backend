"""SQLAlchemy models."""
from sqlalchemy import Column, Integer, String, Float, DateTime, BigInteger, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(255), unique=True, nullable=False)
    password_hash = Column(String(255))
    name = Column(String(255), nullable=False)
    profile_picture = Column(String(512))
    google_id = Column(String(255), unique=True)
    provider = Column(String(50), default="email")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    devices = relationship("Device", back_populates="user")


class Device(Base):
    __tablename__ = "devices"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    device_id = Column(String(100), unique=True, nullable=False)
    device_name = Column(String(255), default="Smart Shoe")
    last_seen = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="devices")


class SensorData(Base):
    __tablename__ = "sensor_data"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    device_id = Column(String(100), nullable=False)
    temperature = Column(Float, nullable=False)
    humidity = Column(Float, nullable=False)
    blood_flow = Column(Float, nullable=False)
    motion = Column(Float, nullable=False)
    timestamp = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class Prediction(Base):
    __tablename__ = "predictions"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    device_id = Column(String(100), nullable=False)
    prediction = Column(Integer, nullable=False)  # 0=normal, 1=risk
    temperature = Column(Float)
    humidity = Column(Float)
    blood_flow = Column(Float)
    motion = Column(Float)
    insight_text = Column(Text)
    timestamp = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class VibrationTrigger(Base):
    __tablename__ = "vibration_triggers"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    device_id = Column(String(100), nullable=False)
    reason = Column(String(255))
    triggered_at = Column(DateTime, default=datetime.utcnow)
