import datetime
import base64
import hashlib
import bcrypt
import jwt
from cryptography.fernet import Fernet
from fastapi import Depends, HTTPException, status, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from backend.app.config import (
    JWT_SECRET,
    JWT_ALGORITHM,
    JWT_EXPIRATION_MINUTES,
    is_auth_enabled,
    DEFAULT_ADMIN_EMAIL,
    DEFAULT_ADMIN_PASSWORD,
)
from backend.app.database import get_db
from backend.app.models import User

# Derive a consistent 32-byte urlsafe base64 key from JWT_SECRET for field-level encryption
_fernet_key = base64.urlsafe_b64encode(hashlib.sha256(JWT_SECRET.encode("utf-8")).digest())
_cipher = Fernet(_fernet_key)

def encrypt_secret(plain_text: str | None) -> str | None:
    """Encrypts a sensitive string (e.g. MCP auth header or API key) for safe storage."""
    if not plain_text:
        return None
    try:
        return _cipher.encrypt(plain_text.encode("utf-8")).decode("utf-8")
    except Exception:
        return plain_text

def decrypt_secret(cipher_text: str | None) -> str | None:
    """Decrypts a stored ciphertext string. Gracefully returns plaintext if not encrypted."""
    if not cipher_text:
        return None
    try:
        return _cipher.decrypt(cipher_text.encode("utf-8")).decode("utf-8")
    except Exception:
        return cipher_text

security = HTTPBearer(auto_error=False)

def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False

def create_access_token(data: dict, expires_delta: datetime.timedelta | None = None) -> str:
    to_encode = data.copy()
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    if expires_delta:
        expire = now_utc + expires_delta
    else:
        expire = now_utc + datetime.timedelta(minutes=JWT_EXPIRATION_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return encoded_jwt

def decode_access_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.PyJWTError:
        return None

def get_dev_default_user(db: Session) -> User:
    """Retrieves or provisions the default administrator for local development and testing when AUTH is disabled."""
    user = db.query(User).filter(User.email == DEFAULT_ADMIN_EMAIL).first()
    if not user:
        user = User(
            email=DEFAULT_ADMIN_EMAIL,
            hashed_password=hash_password(DEFAULT_ADMIN_PASSWORD),
            role="admin",
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    return user

def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    token: str | None = Query(None),
    db: Session = Depends(get_db)
) -> User:
    raw_token = None
    if credentials:
        raw_token = credentials.credentials
    elif token:
        raw_token = token

    if not raw_token:
        # If AUTH is disabled (e.g. AUTH=false for local dev and testing), allow frictionless access
        if not is_auth_enabled():
            return get_dev_default_user(db)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication credentials were not provided",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_access_token(raw_token)
    if not payload:
        if not is_auth_enabled():
            return get_dev_default_user(db)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user_id = payload.get("sub")
    if user_id is None:
        if not is_auth_enabled():
            return get_dev_default_user(db)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")
    
    try:
        user_id_int = int(user_id)
        user = db.query(User).filter(User.id == user_id_int).first()
    except (ValueError, TypeError):
        user = db.query(User).filter(User.email == str(user_id)).first()

    if not user:
        if not is_auth_enabled():
            return get_dev_default_user(db)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user
