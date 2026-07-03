"""Email + password authentication with a three-token model.

On sign-in/up we issue: an access JWT (cookie `at`), a rotating refresh token
(cookie `rt`, only sent to /auth/*), and a CSRF token (in the Flask session,
echoed to the client so it can send it back as X-CSRF-Token on writes).

- Vendors: self-service sign-up + sign-in with their own email.
- Admins: @mirraw.com only; a fresh signup is view-only until the master grants
  editor access. Sign-in only for existing accounts.

This is user login. The backend's own access to the Google Sheet is separate
(scripts/authorize_sheets.py).
"""

import secrets

from flask import Blueprint, jsonify, make_response, request, session

from config import Config
from app import tokens
from app.store import get_store

auth_bp = Blueprint("auth", __name__)


def _is_mirraw(email):
    return email.split("@")[-1] == Config.ADMIN_DOMAIN.lower()


def _initials(name):
    parts = [p for p in (name or "").split() if p]
    return "".join(p[0] for p in parts[:2]).upper() if parts else "?"


# ── claims ↔ identity ────────────────────────────────────────────────────
def _vendor_claims(vendor):
    return {
        "role": "vendor", "name": vendor["name"], "email": vendor["email"],
        "initials": _initials(vendor["name"]),
        "vendorId": vendor["id"], "vendorName": vendor["name"],
    }


def _admin_claims(admin):
    role = admin.get("role", "viewer")
    return {
        "role": "admin", "adminRole": role, "canEdit": role in ("master", "editor"),
        "isMaster": role == "master",
        "name": admin["name"], "email": admin["email"], "initials": _initials(admin["name"]),
    }


def _identity(claims):
    if claims["role"] == "vendor":
        return {"role": "vendor", "vendorId": claims["vendorId"]}
    return {"role": "admin", "email": claims["email"]}


# ── token/cookie issuing ─────────────────────────────────────────────────
def _set_auth_cookies(resp, access, refresh=None):
    resp.set_cookie("at", access, httponly=True, samesite="Lax",
                    secure=Config.COOKIE_SECURE, max_age=Config.ACCESS_TTL, path="/")
    if refresh is not None:
        resp.set_cookie("rt", refresh, httponly=True, samesite="Lax",
                        secure=Config.COOKIE_SECURE, max_age=Config.REFRESH_TTL, path="/auth")


def _issue(claims, new_refresh=True):
    """Fresh access JWT (+ optional new refresh) + a new CSRF token."""
    csrf = secrets.token_urlsafe(24)
    session["csrf"] = csrf
    resp = make_response(jsonify({"ok": True, "user": claims, "csrf": csrf}))
    refresh = tokens.issue_refresh(_identity(claims)) if new_refresh else None
    _set_auth_cookies(resp, tokens.make_access(claims), refresh)
    return resp


# ── vendor ───────────────────────────────────────────────────────────────
@auth_bp.route("/auth/vendor/signup", methods=["POST"])
def vendor_signup():
    body = request.get_json(force=True)
    name = (body.get("name") or "").strip()
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    if not name or not email or not password:
        return jsonify({"error": "Name, email and password are all required"}), 400
    if "@" not in email or "." not in email.split("@")[-1]:
        return jsonify({"error": "Enter a valid email address"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    vendor, err = get_store().register_vendor(name, email, password)
    if err:
        return jsonify({"error": err}), 400
    return _issue(_vendor_claims(vendor))


@auth_bp.route("/auth/vendor/login", methods=["POST"])
def vendor_login():
    body = request.get_json(force=True)
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    if not email or not password:
        return jsonify({"error": "Enter your email and password"}), 400

    vendor = get_store().authenticate_vendor(email, password)
    if not vendor:
        return jsonify({"error": "Invalid email or password"}), 401
    if vendor.get("status") == "suspended":
        return jsonify({"error": "Your account is suspended. Contact the Mirraw admin."}), 403
    return _issue(_vendor_claims(vendor))


# ── admin ────────────────────────────────────────────────────────────────
@auth_bp.route("/auth/admin/signup", methods=["POST"])
def admin_signup():
    body = request.get_json(force=True)
    name = (body.get("name") or "").strip()
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    if not name or not email or not password:
        return jsonify({"error": "Name, email and password are all required"}), 400
    if not _is_mirraw(email):
        return jsonify({"error": f"Admin access is limited to @{Config.ADMIN_DOMAIN} email addresses"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    admin, err = get_store().register_admin(name, email, password)
    if err:
        return jsonify({"error": err}), 400
    return _issue(_admin_claims(admin))


@auth_bp.route("/auth/admin/login", methods=["POST"])
def admin_login():
    body = request.get_json(force=True)
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    if not email or not password:
        return jsonify({"error": "Enter your email and password"}), 400
    if not _is_mirraw(email):
        return jsonify({"error": f"Admin access is limited to @{Config.ADMIN_DOMAIN} email addresses"}), 400

    admin = get_store().authenticate_admin(email, password)
    if not admin:
        return jsonify({"error": "Invalid email or password"}), 401
    return _issue(_admin_claims(admin))


# ── refresh / logout / me ────────────────────────────────────────────────
@auth_bp.route("/auth/refresh", methods=["POST"])
def refresh():
    identity, new_refresh = tokens.rotate_refresh(request.cookies.get("rt"))
    if not identity:
        return jsonify({"error": "Session expired", "code": "expired"}), 401

    # Rebuild claims from the store so role changes (grant/revoke, suspend)
    # take effect on the next refresh rather than living forever in a token.
    store = get_store()
    if identity["role"] == "vendor":
        v = store.get_vendor(identity["vendorId"])
        if not v or v.get("status") == "suspended":
            return jsonify({"error": "Account unavailable", "code": "expired"}), 401
        claims = _vendor_claims(v)
    else:
        a = store.get_admin(identity["email"])
        if not a:
            return jsonify({"error": "Account unavailable", "code": "expired"}), 401
        claims = _admin_claims(a)

    csrf = secrets.token_urlsafe(24)
    session["csrf"] = csrf
    resp = make_response(jsonify({"ok": True, "user": claims, "csrf": csrf}))
    _set_auth_cookies(resp, tokens.make_access(claims), new_refresh)
    return resp


@auth_bp.route("/auth/logout", methods=["POST"])
def logout():
    tokens.revoke_refresh(request.cookies.get("rt"))
    session.clear()
    resp = make_response(jsonify({"ok": True}))
    resp.delete_cookie("at", path="/")
    resp.delete_cookie("rt", path="/auth")
    return resp


@auth_bp.route("/api/me")
def me():
    user = tokens.read_access(request.cookies.get("at"))
    return jsonify({"user": user, "csrf": session.get("csrf")})
