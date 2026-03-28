"""Vercel-compatible FastAPI application with /v1/api base path."""
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum

from .database import Base, engine
from . import models  # noqa: F401
from .auth.routes import router as auth_router
from .routes import user_router, sensor_router, prediction_router, history_router, vibration_router

# Create FastAPI app with /v1/api prefix
app = FastAPI(
    title="Smart Shoe Health Monitor API",
    version="2.0.0",
    root_path="/v1/api"
)

# CORS - Allow all origins for production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for shared hosting
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth_router)
app.include_router(user_router, prefix="/user")
app.include_router(sensor_router, prefix="/sensor-data")
app.include_router(prediction_router, prefix="/prediction")
app.include_router(history_router, prefix="/history")
app.include_router(vibration_router, prefix="/vibration-trigger")

@app.on_event("startup")
def _startup_create_tables():
    """Create database tables on startup."""
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as e:
        print(f"Database initialization error: {e}")

@app.get("/")
def root():
    """API root endpoint."""
    return {
        "status": "API running",
        "message": "Smart Shoe Health Monitor API v2.0",
        "version": "2.0.0",
        "docs": "/v1/api/docs"
    }

@app.get("/health")
def health():
    """Health check endpoint."""
    return {"status": "ok", "service": "smart-shoe-api"}

# Device pairing endpoint
@app.post("/pair")
async def pair_device(request: Request):
    """
    Pair a Bluetooth device with the backend.
    Expected body: {"device_id": "SMART_SHOE_001", "connection": "bluetooth"}
    """
    try:
        body = await request.json()
        device_id = body.get("device_id", "UNKNOWN")
        connection_type = body.get("connection", "bluetooth")
        
        return {
            "status": "paired",
            "device_id": device_id,
            "connection": connection_type,
            "message": "Device paired successfully"
        }
    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }

# Mangum handler for Vercel
handler = Mangum(app)
