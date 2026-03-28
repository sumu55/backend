"""FastAPI main application."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import CORS_ORIGINS
from .database import Base, engine
from . import models  # noqa: F401  (ensure models are registered with Base)
from .auth.routes import router as auth_router
from .routes import user_router, sensor_router, prediction_router, history_router, vibration_router
from .websocket import router as ws_router

app = FastAPI(title="Smart Shoe Health Monitor API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(user_router, prefix="/user")
app.include_router(sensor_router, prefix="/sensor-data")
app.include_router(prediction_router, prefix="/prediction")
app.include_router(history_router, prefix="/history")
app.include_router(vibration_router, prefix="/vibration-trigger")
app.include_router(ws_router, prefix="/ws")

@app.on_event("startup")
def _startup_create_tables():
    Base.metadata.create_all(bind=engine)


@app.get("/")
def root():
    return {"message": "Smart Shoe Health Monitor API", "docs": "/docs"}


@app.get("/health")
def health():
    return {"status": "ok"}
