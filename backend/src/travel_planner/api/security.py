"""Auth: argon2 password hashing, signed JWT access tokens, current-user dependency, per-user daily quota."""

from __future__ import annotations

import time
from typing import Annotated

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from ..cache import get_cache
from ..config import get_settings
from ..db import get_session
from ..models import User

_ph = PasswordHasher()


def hash_password(pw: str) -> str:
    return _ph.hash(pw)


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return _ph.verify(hashed, pw)
    except VerifyMismatchError:
        return False


def make_token(user_id: str) -> str:
    s = get_settings()
    now = int(time.time())
    return jwt.encode({"sub": user_id, "iat": now, "exp": now + s.access_token_minutes * 60}, s.secret_key, algorithm="HS256")


def current_user(db: Annotated[Session, Depends(get_session)], authorization: Annotated[str | None, Header()] = None) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in to continue")
    try:
        payload = jwt.decode(authorization.split(" ", 1)[1], get_settings().secret_key, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your session expired. Sign in again.") from None
    user = db.get(User, payload["sub"])
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account not found")
    return user


CurrentUser = Annotated[User, Depends(current_user)]


def enforce_quota(user: User) -> None:
    s = get_settings()
    n = get_cache().incr(f"quota:{user.id}:{time.strftime('%Y%m%d')}", 86400)
    if n > s.daily_run_quota:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            f"Daily planning limit of {s.daily_run_quota} runs reached. Try again tomorrow.")
