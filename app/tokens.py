"""Token plumbing for the three-token auth model.

- Access JWT: short-lived, stateless, signed with JWT_SECRET. Carries the user
  claims so the API can authorise a request without a store lookup.
- Refresh token: opaque `id.secret`, stored server-side (only the secret's hash
  is kept). One-time-use — rotated on every refresh so a leaked token is caught
  and expires fast. Revocable (logout drops it).

The refresh store is in-process (a dict). Fine for a single dev server; for
multi-worker production swap _REFRESH for Redis/DB (same interface).
"""

import hashlib
import secrets
import time

import jwt

from config import Config

# Derive a fixed 32-byte HMAC key so short dev secrets still satisfy HS256's
# minimum key length. Production strength still depends on a strong JWT_SECRET.
_SIGNING_KEY = hashlib.sha256(Config.JWT_SECRET.encode()).digest()


# ── access JWT ───────────────────────────────────────────────────────────
def make_access(claims):
    payload = {**claims, "type": "access", "exp": int(time.time()) + Config.ACCESS_TTL}
    return jwt.encode(payload, _SIGNING_KEY, algorithm="HS256")


def read_access(token):
    if not token:
        return None
    try:
        payload = jwt.decode(token, _SIGNING_KEY, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    if payload.get("type") != "access":
        return None
    return {k: v for k, v in payload.items() if k not in ("type", "exp")}


# ── refresh token (server-side, rotating) ────────────────────────────────
_REFRESH = {}  # rid -> {"hash": str, "identity": dict, "exp": float}


def _hash(s):
    return hashlib.sha256((s or "").encode()).hexdigest()


def _parse(cookie):
    if not cookie or "." not in cookie:
        return None, None
    rid, secret = cookie.split(".", 1)
    return rid, secret


def issue_refresh(identity):
    """identity = minimal, stable handle to the account (role + id/email)."""
    rid = secrets.token_urlsafe(9)
    secret = secrets.token_urlsafe(32)
    _REFRESH[rid] = {"hash": _hash(secret), "identity": identity,
                     "exp": time.time() + Config.REFRESH_TTL}
    return f"{rid}.{secret}"


def _valid_record(cookie):
    rid, secret = _parse(cookie)
    rec = _REFRESH.get(rid)
    if not rec or rec["exp"] < time.time() or rec["hash"] != _hash(secret):
        return rid, None
    return rid, rec


def rotate_refresh(cookie):
    """Verify, invalidate (one-time use), and mint a fresh refresh token for the
    same identity. Returns (identity, new_cookie) or (None, None)."""
    rid, rec = _valid_record(cookie)
    if not rec:
        return None, None
    _REFRESH.pop(rid, None)
    return rec["identity"], issue_refresh(rec["identity"])


def revoke_refresh(cookie):
    rid, _ = _parse(cookie)
    _REFRESH.pop(rid, None)
