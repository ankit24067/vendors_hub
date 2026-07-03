import os
import re
import time
from functools import wraps

from flask import Blueprint, jsonify, request, session
from werkzeug.utils import secure_filename

from config import Config
from app import tokens
from app.store import get_store

api_bp = Blueprint("api", __name__, url_prefix="/api")

REJECT_REASONS = [
    "Out of stock", "Product discontinued", "Cost price too low",
    "Insufficient production capacity", "Lead time too short",
    "Design/material unavailable",
]


def _current_user():
    """Authenticated user from the access JWT cookie (stateless)."""
    return tokens.read_access(request.cookies.get("at"))


def _csrf_ok():
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return True
    sent = request.headers.get("X-CSRF-Token")
    return bool(sent) and sent == session.get("csrf")


def require(role):
    def deco(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            user = _current_user()
            if not user:
                return jsonify({"error": "Not signed in", "code": "expired"}), 401
            if not _csrf_ok():
                return jsonify({"error": "Invalid or missing CSRF token"}), 403
            if role and user["role"] != role:
                return jsonify({"error": "Forbidden"}), 403
            return fn(user, *args, **kwargs)
        return wrapper
    return deco


def require_admin(editor=False, master=False):
    """Admin gate. editor=True blocks view-only admins; master=True is the
    grant-access owner only."""
    def deco(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            user = _current_user()
            if not user:
                return jsonify({"error": "Not signed in", "code": "expired"}), 401
            if not _csrf_ok():
                return jsonify({"error": "Invalid or missing CSRF token"}), 403
            if user["role"] != "admin":
                return jsonify({"error": "Forbidden"}), 403
            if master and not user.get("isMaster"):
                return jsonify({"error": "Only the master admin can manage access"}), 403
            if editor and not user.get("canEdit"):
                return jsonify({"error": "You have view-only access. Ask the master admin for edit rights."}), 403
            return fn(user, *args, **kwargs)
        return wrapper
    return deco


def _admin_actor(user):
    return user["name"].split()[0] + " (Admin)"


# ── bootstrap ────────────────────────────────────────────────────────────
@api_bp.route("/bootstrap")
@require(None)
def bootstrap(user):
    store = get_store()
    if user["role"] == "vendor":
        vid = user["vendorId"]
        return jsonify({
            "user": user,
            "demands": store.get_demands(vid),
            "reorders": store.get_reorders(vid),
            "payments": store.get_payments(vid),
            "invoices": store.get_invoices(vid),
            "audit": store.get_audit(),
            "vendor": store.get_vendor(vid),
        })
    return jsonify({
        "user": user,
        "vendors": store.get_vendors(),
        "reorders": store.get_reorders(),
        "payments": store.get_payments(),
        "audit": store.get_audit(),
        "team": store.get_admins() if user.get("isMaster") else [],
    })


# ── admin: access management (master only) ───────────────────────────────
@api_bp.route("/admin/team/<email>/role", methods=["POST"])
@require_admin(master=True)
def set_team_role(user, email):
    body = request.get_json(force=True)
    role = body.get("role")
    if role not in ("editor", "viewer"):
        return jsonify({"error": "Role must be editor or viewer"}), 400
    if email.strip().lower() == user["email"]:
        return jsonify({"error": "You can't change your own access"}), 400
    store = get_store()
    updated = store.set_admin_role(email, role, user["email"])
    if not updated:
        return jsonify({"error": "Admin not found (or is the master account)"}), 404
    store.push_audit(_admin_actor(user),
                     "granted edit access to" if role == "editor" else "set to view-only", email)
    return jsonify({"ok": True})


# ── vendor: demands ──────────────────────────────────────────────────────
@api_bp.route("/vendor/demands/<did>/respond", methods=["POST"])
@require("vendor")
def respond_demand(user, did):
    store = get_store()
    d = store.get_demand(did)
    if not d:
        return jsonify({"error": "Demand not found"}), 404
    if d.get("locked"):
        return jsonify({"error": "This row is already submitted"}), 400

    body = request.get_json(force=True)
    kind = body.get("kind")
    if kind == "reject":
        reason = (body.get("reason") or "").strip()
        if not reason:
            return jsonify({"error": "Select a reason for rejecting"}), 400
        store.respond_demand(did, "rejected", None, "", reason)
        store.push_audit(user["vendorName"], "rejected reorder", d["sku"])
        return jsonify({"ok": True})

    # accept (full or partial)
    try:
        q = int(body.get("fulfillQty"))
    except (TypeError, ValueError):
        return jsonify({"error": "Enter how many you can fulfill"}), 400
    if q < 1:
        return jsonify({"error": "Enter how many you can fulfill"}), 400
    if q > d["qty"]:
        return jsonify({"error": f"Cannot exceed the requested quantity ({d['qty']})"}), 400
    partial = q < d["qty"]
    remark = (body.get("remark") or "").strip()
    if partial and not remark:
        return jsonify({"error": "Add a remark for the short quantity"}), 400
    store.respond_demand(did, "partial" if partial else "accepted", q, remark if partial else "", "")
    store.push_audit(user["vendorName"],
                     "partially accepted reorder" if partial else "accepted reorder", d["sku"])
    return jsonify({"ok": True, "partial": partial})


@api_bp.route("/vendor/demands/<did>/submit", methods=["POST"])
@require("vendor")
def submit_demand(user, did):
    store = get_store()
    d = store.get_demand(did)
    if not d:
        return jsonify({"error": "Demand not found"}), 404
    if d["status"] == "new":
        return jsonify({"error": "Respond to the demand first"}), 400
    store.lock_demand(did)
    store.push_audit(user["vendorName"], "submitted reorder response", d["sku"])
    return jsonify({"ok": True})


# ── vendor: reorder requests ─────────────────────────────────────────────
@api_bp.route("/vendor/reorders", methods=["POST"])
@require("vendor")
def add_reorder(user):
    body = request.get_json(force=True)
    sku = (body.get("sku") or "").strip()
    product = (body.get("product") or "").strip()
    try:
        qty = int(body.get("qty"))
    except (TypeError, ValueError):
        qty = 0
    if not sku or not product or qty < 1:
        return jsonify({"error": "Please fill SKU, product and quantity"}), 400
    store = get_store()
    store.add_reorder(user["vendorId"], sku, product, qty, body.get("notes") or "")
    store.push_audit(user["vendorName"], "submitted reorder", sku)
    return jsonify({"ok": True})


# ── vendor: payments ─────────────────────────────────────────────────────
@api_bp.route("/vendor/payments/<pid>/action", methods=["POST"])
@require("vendor")
def payment_action(user, pid):
    body = request.get_json(force=True)
    kind = body.get("kind")
    if kind not in ("confirm", "dispute"):
        return jsonify({"error": "Invalid action"}), 400
    store = get_store()
    p = store.set_payment_status(pid, "Confirmed" if kind == "confirm" else "Disputed")
    if not p:
        return jsonify({"error": "Payment not found"}), 404
    store.push_audit(user["vendorName"],
                     "confirmed payment" if kind == "confirm" else "disputed payment", p["ref"])
    return jsonify({"ok": True})


# ── vendor: invoice upload ───────────────────────────────────────────────
@api_bp.route("/vendor/pos/<iid>/invoice", methods=["POST"])
@require("vendor")
def upload_invoice(user, iid):
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify({"error": "Attach the invoice PDF first"}), 400
    if not f.filename.lower().endswith(".pdf"):
        return jsonify({"error": "Only PDF files are accepted"}), 400
    store = get_store()
    safe = secure_filename(f.filename)
    stored = f"{int(time.time())}_{safe}"
    f.save(os.path.join(Config.UPLOAD_DIR, stored))
    inv = store.attach_invoice(iid, safe)
    if not inv:
        return jsonify({"error": "Purchase order not found"}), 404
    store.push_audit(user["vendorName"], "submitted invoice", inv["po"])
    return jsonify({"ok": True})


# ── vendor: profile ──────────────────────────────────────────────────────
@api_bp.route("/vendor/profile", methods=["PUT"])
@require("vendor")
def update_profile(user):
    body = request.get_json(force=True)
    fields = {k: (body.get(k) or "").strip() for k in ("contact", "phone", "address")}
    store = get_store()
    store.update_vendor(user["vendorId"], fields)
    return jsonify({"ok": True})


# ── admin: reorders ──────────────────────────────────────────────────────
@api_bp.route("/admin/reorders/<rid>/decide", methods=["POST"])
@require_admin(editor=True)
def decide_reorder(user, rid):
    body = request.get_json(force=True)
    decision = body.get("decision")
    if decision not in ("approved", "rejected"):
        return jsonify({"error": "Invalid decision"}), 400
    store = get_store()
    r = store.decide_reorder(rid, decision, body.get("notes") or "")
    if not r:
        return jsonify({"error": "Reorder not found"}), 404
    store.push_audit(_admin_actor(user),
                     "approved reorder" if decision == "approved" else "rejected reorder", r["sku"])
    return jsonify({"ok": True})


# ── admin: payments ──────────────────────────────────────────────────────
@api_bp.route("/admin/payments", methods=["POST"])
@require_admin(editor=True)
def record_payment(user):
    body = request.get_json(force=True)
    vendor = body.get("vendor")
    ref = (body.get("ref") or "").strip()
    try:
        amount = float(body.get("amount"))
    except (TypeError, ValueError):
        amount = 0
    if not vendor or not ref or amount <= 0:
        return jsonify({"error": "Vendor, invoice ref and amount are required"}), 400
    store = get_store()
    if not store.get_vendor(vendor):
        return jsonify({"error": "Unknown vendor"}), 400
    store.add_payment(vendor, ref, amount, (body.get("date") or "").strip(), (body.get("utr") or "").strip())
    store.push_audit(_admin_actor(user), "recorded payment", ref)
    return jsonify({"ok": True})


@api_bp.route("/admin/payments/<pid>/resolve", methods=["POST"])
@require_admin(editor=True)
def resolve_payment(user, pid):
    body = request.get_json(force=True)
    store = get_store()
    p = store.set_payment_status(pid, "Confirmed", note=(body.get("note") or "").strip())
    if not p:
        return jsonify({"error": "Payment not found"}), 404
    store.push_audit(_admin_actor(user), "resolved dispute on", p["ref"])
    return jsonify({"ok": True})


# ── admin: vendors ───────────────────────────────────────────────────────
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@api_bp.route("/admin/vendors", methods=["POST"])
@require_admin(editor=True)
def add_vendor(user):
    body = request.get_json(force=True)
    name = (body.get("name") or "").strip()
    email = (body.get("email") or "").strip()
    if not name or not email:
        return jsonify({"error": "Name and email are required"}), 400
    if not EMAIL_RE.match(email):
        return jsonify({"error": "Enter a valid email"}), 400
    store = get_store()
    if store.find_vendor_by_email(email):
        return jsonify({"error": "A vendor with this email already exists"}), 400
    store.add_vendor({"name": name, "email": email, "status": body.get("status") or "active"})
    store.push_audit(_admin_actor(user), "added vendor", name)
    return jsonify({"ok": True})


@api_bp.route("/admin/vendors/<vid>", methods=["PUT"])
@require_admin(editor=True)
def edit_vendor(user, vid):
    body = request.get_json(force=True)
    name = (body.get("name") or "").strip()
    email = (body.get("email") or "").strip()
    if not name or not email:
        return jsonify({"error": "Name and email are required"}), 400
    store = get_store()
    v = store.update_vendor(vid, {"name": name, "email": email, "status": body.get("status") or "active"})
    if not v:
        return jsonify({"error": "Vendor not found"}), 404
    store.push_audit(_admin_actor(user), "updated vendor", name)
    return jsonify({"ok": True})


@api_bp.route("/admin/vendors/<vid>/toggle", methods=["POST"])
@require_admin(editor=True)
def toggle_vendor(user, vid):
    store = get_store()
    v = store.get_vendor(vid)
    if not v:
        return jsonify({"error": "Vendor not found"}), 404
    new_status = "suspended" if v["status"] == "active" else "active"
    store.update_vendor(vid, {"status": new_status})
    store.push_audit(_admin_actor(user),
                     "suspended vendor" if new_status == "suspended" else "reactivated vendor", v["name"])
    return jsonify({"ok": True})
