"""Authentication routes."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from ..schemas import UserRegister, UserLogin, Token, UserProfile
from .dependencies import verify_password, get_password_hash, create_access_token, get_current_user
from ..config import GOOGLE_CLIENT_ID

router = APIRouter(prefix="/auth", tags=["auth"])


def user_to_dict(user: User, device_id: str = None) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "profile_picture": user.profile_picture,
        "provider": user.provider,
        "device_id": device_id
    }


@router.post("/register", response_model=Token)
def register(data: UserRegister, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    user = User(
        email=data.email,
        password_hash=get_password_hash(data.password),
        name=data.name,
        provider="email"
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token({"sub": str(user.id)})
    return Token(access_token=token, user=user_to_dict(user))


@router.post("/login", response_model=Token)
def login(data: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email).first()
    if not user or not user.password_hash:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token({"sub": str(user.id)})
    device = user.devices[0] if user.devices else None
    return Token(access_token=token, user=user_to_dict(user, device.device_id if device else None))


@router.get("/me", response_model=dict)
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    device = user.devices[0] if user.devices else None
    return user_to_dict(user, device.device_id if device else None)


@router.post("/google")
def google_auth(data: dict, db: Session = Depends(get_db)):
    """Google OAuth login.

    Expects JSON: { "id_token": "<google id token>" }

    - If `google-auth` is installed and `GOOGLE_CLIENT_ID` is set, the token is verified.
    - Otherwise, falls back to legacy demo format: "google|email|name|picture".
    """
    id_token = data.get("id_token", data.get("access_token", ""))
    if not id_token or id_token == "google|":
        raise HTTPException(status_code=400, detail="Invalid Google token")

    email = name = picture = google_sub = None

    # Preferred: verify real Google ID token
    # JWT/JWS is 3 parts; JWE is 5 parts. Treat any 3+ dot-separated token as JWT-like.
    token_looks_like_jwt = len(id_token.split(".")) >= 3
    if token_looks_like_jwt:
        if not GOOGLE_CLIENT_ID:
            # Without a client id, we cannot verify a real GIS credential JWT.
            raise HTTPException(
                status_code=500,
                detail="Backend Google OAuth is not configured (missing GOOGLE_CLIENT_ID).",
            )
        try:
            from google.oauth2 import id_token as google_id_token
            from google.auth.transport import requests as google_requests
        except ImportError as e:
            # If the frontend is sending a real JWT, failing silently makes debugging impossible.
            raise HTTPException(
                status_code=500,
                detail="Backend missing dependency 'google-auth'. Install it to verify Google ID tokens.",
            ) from e

        try:
            info = google_id_token.verify_oauth2_token(
                id_token,
                google_requests.Request(),
                GOOGLE_CLIENT_ID,
            )
            email = info.get("email")
            name = info.get("name") or info.get("given_name") or (email.split("@")[0] if email else "User")
            picture = info.get("picture")
            google_sub = info.get("sub")
        except Exception as e:
            raise HTTPException(status_code=401, detail="Invalid Google id_token") from e

    # Fallback: accept demo token format "google|email|name|picture"
    if not email:
        parts = id_token.split("|")
        if len(parts) < 3:
            raise HTTPException(status_code=400, detail="Invalid token format")
        provider, email, name = parts[0], parts[1], parts[2]
        picture = parts[3] if len(parts) > 3 else None
        if provider != "google":
            raise HTTPException(status_code=400, detail="Invalid provider")
        google_sub = email

    user = db.query(User).filter(User.email == email).first()
    if not user:
        user = User(email=email, name=name, profile_picture=picture, google_id=google_sub, provider="google")
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        user.profile_picture = picture or user.profile_picture
        user.name = name
        if not user.google_id:
            user.google_id = google_sub
        db.commit()
    token = create_access_token({"sub": str(user.id)})
    device = user.devices[0] if user.devices else None
    return Token(access_token=token, user=user_to_dict(user, device.device_id if device else None))
