"""WebSocket for real-time sensor updates."""
import json
import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict, Set

router = APIRouter()
active_connections: Dict[int, Set[WebSocket]] = {}


from .auth.dependencies import decode_access_token

@router.websocket("")
async def websocket_endpoint(websocket: WebSocket, token: str = None):
    # Allow connection without strict auth, but validate token if provided
    await websocket.accept()
    user_id = 1
    if token:
        try:
            payload = decode_access_token(token)
            user_id = int(payload.get("sub", 1))
        except:
            pass
    if user_id not in active_connections:
        active_connections[user_id] = set()
    active_connections[user_id].add(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                if msg.get("type") == "subscribe":
                    # Client subscribed
                    await websocket.send_json({"type": "subscribed", "user_id": user_id})
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        active_connections[user_id].discard(websocket)
        if not active_connections[user_id]:
            del active_connections[user_id]


def broadcast_sensor_data(user_id: int, data: dict):
    """Call from API when new sensor data arrives to push to WebSocket clients."""
    if user_id not in active_connections:
        return
    msg = json.dumps({"type": "sensor", "data": data})
    for ws in list(active_connections[user_id]):
        try:
            asyncio.create_task(ws.send_text(msg))
        except Exception:
            pass
