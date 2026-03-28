"""
Vercel serverless function entry point.
This file is required by Vercel to deploy the FastAPI application.
"""
from .vercel_app import handler

# Export the handler for Vercel
app = handler
