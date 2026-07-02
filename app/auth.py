"""Google OAuth login for both portals.

- Admin portal: only ADMIN_DOMAIN emails are accepted.
- Vendor portal: email must exist in the Vendors tab (no self-signup).
- MOCK_MODE: the login button signs in a demo identity, no Google round-trip.

The OAuth client's registered redirect URI is the site root
(http://127.0.0.1:8000/), so the callback arrives at "/" with ?code&state
and app/__init__.py forwards it to handle_oauth_callback().
"""

from flask import Blueprint, jsonify, redirect, request, session

from config import Config
from app.store import get_store

auth_bp = Blueprint("auth", __name__)

LOGIN_SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
]


def _initials(name):
    parts = [p for p in (name or "").split() if p]
    if not parts:
        return "?"
    return "".join(p[0] for p in parts[:2]).upper()


def _login_error(msg):
    session.pop("user", None)
    return redirect("/?login_error=" + msg)


def _establish_session(portal, email, name):
    store = get_store()
    if portal == "admin":
        domain = email.split("@")[-1].lower()
        if domain != Config.ADMIN_DOMAIN.lower():
            return _login_error("admin_domain")
        session["user"] = {
            "role": "admin", "name": name, "email": email, "initials": _initials(name),
        }
    else:
        vendor = store.find_vendor_by_email(email)
        if vendor is None:
            return _login_error("vendor_unknown")
        if vendor.get("status") == "suspended":
            return _login_error("vendor_suspended")
        session["user"] = {
            "role": "vendor", "name": name or vendor["name"], "email": email,
            "initials": _initials(name or vendor["name"]),
            "vendorId": vendor["id"], "vendorName": vendor["name"],
        }
    return redirect("/")


@auth_bp.route("/auth/google/login")
def google_login():
    portal = request.args.get("portal", "vendor")
    if portal not in ("vendor", "admin"):
        portal = "vendor"

    if Config.MOCK_MODE:
        # Demo identities matching the mock store
        if portal == "admin":
            return _establish_session("admin", "priya@" + Config.ADMIN_DOMAIN, "Priya Menon")
        return _establish_session("vendor", "anokhi@textiles.in", "Ananya Kapoor")

    from google_auth_oauthlib.flow import Flow

    flow = Flow.from_client_secrets_file(
        Config.GOOGLE_OAUTH_CREDS_PATH,
        scopes=LOGIN_SCOPES,
        redirect_uri=request.url_root,  # registered redirect URI is the site root
    )
    auth_url, state = flow.authorization_url(prompt="select_account")
    session["oauth_state"] = state
    session["oauth_portal"] = portal
    return redirect(auth_url)


def handle_oauth_callback():
    from google_auth_oauthlib.flow import Flow
    from google.oauth2 import id_token as google_id_token
    from google.auth.transport.requests import Request as GoogleRequest

    state = session.pop("oauth_state", None)
    portal = session.pop("oauth_portal", "vendor")
    if not state or state != request.args.get("state"):
        return _login_error("state_mismatch")

    flow = Flow.from_client_secrets_file(
        Config.GOOGLE_OAUTH_CREDS_PATH,
        scopes=LOGIN_SCOPES,
        state=state,
        redirect_uri=request.url_root,
    )
    try:
        flow.fetch_token(authorization_response=request.url)
        creds = flow.credentials
        info = google_id_token.verify_oauth2_token(
            creds.id_token, GoogleRequest(), audience=flow.client_config["client_id"]
        )
    except Exception:
        return _login_error("oauth_failed")

    email = info.get("email", "")
    name = info.get("name", "") or email.split("@")[0]
    if not email or not info.get("email_verified", False):
        return _login_error("oauth_failed")
    return _establish_session(portal, email, name)


@auth_bp.route("/auth/logout", methods=["POST"])
def logout():
    session.pop("user", None)
    return jsonify({"ok": True})


@auth_bp.route("/api/me")
def me():
    return jsonify({"user": session.get("user")})
