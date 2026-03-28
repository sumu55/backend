"""Run the FastAPI server."""
import uvicorn
import os

if __name__ == "__main__":
    uvicorn.run(
        "api.main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", 8000)),
        reload=True
    )
