"""Google Sheets store — same interface as MockStore.

Active when MOCK_MODE=false. Needs a read-write token saved by
scripts/authorize_sheets.py (reco's token is read-only; do not reuse it).

Tabs:
  reorder_sheet          — existing demand queue (read); app appends response cols
  vendor_db, admin_db    — account stores for login. LOCKED (app-only writes).
  confirmed_reorder      — ledger of every submitted vendor response
  reOrder_fully_accepted / reOrder_partially_accepted / reOrder_rejected
                         — responses routed by outcome, with an =IMAGE() thumbnail
  ReorderRequests, Payments, PurchaseOrders, AuditLog — created if missing
"""

import pickle
import time
from datetime import datetime

import gspread
from google.auth.transport.requests import Request
from werkzeug.security import check_password_hash, generate_password_hash

from config import Config
from app.store.mock import MASTER_ADMIN_EMAIL, image_formula

CACHE_TTL = 30  # seconds

DEMAND_SHEET = Config.GOOGLE_DEMAND_TAB
VENDOR_DB = "vendor_db"
ADMIN_DB = "admin_db"
CONFIRMED = "confirmed_reorder"
OUTCOME_TABS = {
    "accepted": "reOrder_fully_accepted",
    "partial": "reOrder_partially_accepted",
    "rejected": "reOrder_rejected",
}
LOCKED_TABS = (VENDOR_DB, ADMIN_DB)
RESPONSE_HEADERS = ["response_status", "fulfill_qty", "remark", "reject_reason", "responded_at", "locked"]

# image is the FIRST column so the =IMAGE() thumbnail leads each ledger row
LEDGER_HEADERS = ["image", "demand_id", "vendor_name", "sku", "pid", "product_type",
                  "required_qty", "fulfill_qty", "outcome", "remark", "reason", "submitted_at"]

TAB_HEADERS = {
    VENDOR_DB: ["id", "name", "email", "status", "password_hash", "contact", "phone", "address", "gstin", "created_at"],
    ADMIN_DB: ["email", "name", "password_hash", "role", "granted_by", "created_at"],
    CONFIRMED: LEDGER_HEADERS,
    OUTCOME_TABS["accepted"]: LEDGER_HEADERS,
    OUTCOME_TABS["partial"]: LEDGER_HEADERS,
    OUTCOME_TABS["rejected"]: LEDGER_HEADERS,
    "ReorderRequests": ["id", "vendor", "sku", "product", "qty", "status", "date", "notes"],
    "Payments": ["id", "ref", "vendor", "amount", "date", "utr", "status", "resolution_note"],
    "PurchaseOrders": ["id", "vendor", "po", "qty", "amount", "fileName", "status", "date"],
    "AuditLog": ["actor", "action", "target", "ts"],
}


def _now_ts():
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def _today():
    return datetime.now().strftime("%Y-%m-%d")


def _new_id(prefix):
    return prefix + str(int(time.time() * 1000))


class SheetsStore:
    def __init__(self):
        with open(Config.SHEETS_TOKEN_PATH, "rb") as f:
            creds = pickle.load(f)
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
        self.client = gspread.authorize(creds)
        self.sheet = self.client.open_by_key(Config.GOOGLE_SHEET_ID)
        self._cache = {}
        self._ensure_tabs()

    # ── plumbing ─────────────────────────────────────────────────────────
    def _ensure_tabs(self):
        existing = {ws.title for ws in self.sheet.worksheets()}
        for tab, headers in TAB_HEADERS.items():
            if tab in existing:
                continue
            try:
                ws = self.sheet.add_worksheet(title=tab, rows=200, cols=len(headers))
                ws.update("A1", [headers])
            except gspread.exceptions.APIError as e:
                # Idempotent: another worker/request may have just created it.
                if "already exists" not in str(e):
                    raise
        # make sure response columns exist on the demand sheet
        try:
            ws = self.sheet.worksheet(DEMAND_SHEET)
        except gspread.WorksheetNotFound:
            tabs = [w.title for w in self.sheet.worksheets()]
            raise RuntimeError(
                f"Demand tab '{DEMAND_SHEET}' not found in the spreadsheet. "
                f"Available tabs: {tabs}. Rename the tab to '{DEMAND_SHEET}' or set "
                f"GOOGLE_DEMAND_TAB in .env to the correct tab name."
            )
        headers = [h.strip() for h in ws.row_values(1)]
        missing = [h for h in RESPONSE_HEADERS if h not in headers]
        if missing:
            start_col = len(headers) + 1
            ws.update(gspread.utils.rowcol_to_a1(1, start_col), [missing])
        self._seed_master_admin()
        for tab in LOCKED_TABS:
            self._lock_tab(tab)

    def _seed_master_admin(self):
        """Ensure the one hard-coded master admin exists in admin_db."""
        for r in self._rows(ADMIN_DB):
            if (r.get("email") or "").strip().lower() == MASTER_ADMIN_EMAIL:
                return
        self._append(ADMIN_DB, {
            "email": MASTER_ADMIN_EMAIL, "name": "Dhruti Vaghasiya",
            "password_hash": generate_password_hash("admin123"),
            "role": "master", "granted_by": "", "created_at": _now_ts(),
        })

    def _lock_tab(self, tab):
        """Protect a tab so only this (the app's) account can edit it — a real
        lock for everyone else. Best-effort: skip if already protected."""
        try:
            ws = self.sheet.worksheet(tab)
            meta = self.sheet.fetch_sheet_metadata()
            for s in meta.get("sheets", []):
                if s.get("properties", {}).get("sheetId") == ws.id and s.get("protectedRanges"):
                    return  # already locked
            self.sheet.batch_update({"requests": [{"addProtectedRange": {"protectedRange": {
                "range": {"sheetId": ws.id},
                "description": "Locked — managed by Vendor Hub",
                "warningOnly": False,
            }}}]})
        except Exception as e:
            print(f"[SheetsStore] could not lock {tab}: {e}")

    def _purge_demand(self, demand_id):
        """Remove any prior ledger rows for this demand so an edit re-routes
        cleanly instead of duplicating (delete bottom-up to keep indices valid)."""
        for tab in (CONFIRMED, *OUTCOME_TABS.values()):
            rows = [r["_row"] for r in self._rows(tab) if r.get("demand_id") == demand_id]
            if not rows:
                continue
            ws = self.sheet.worksheet(tab)
            for row_num in sorted(rows, reverse=True):
                ws.delete_rows(row_num)
            self._bust(tab)

    def _rows(self, tab):
        """All rows of a tab as list of dicts keyed by header, cached briefly."""
        hit = self._cache.get(tab)
        if hit and time.time() - hit[0] < CACHE_TTL:
            return hit[1]
        ws = self.sheet.worksheet(tab)
        values = ws.get_all_values()
        if not values:
            return []
        headers = [h.strip() for h in values[0]]
        rows = []
        for idx, raw in enumerate(values[1:], start=2):  # sheet row number
            row = {headers[i]: (raw[i] if i < len(raw) else "") for i in range(len(headers))}
            row["_row"] = idx
            rows.append(row)
        self._cache[tab] = (time.time(), rows)
        return rows

    def _bust(self, tab):
        self._cache.pop(tab, None)

    def _append(self, tab, record):
        headers = TAB_HEADERS[tab]
        ws = self.sheet.worksheet(tab)
        ws.append_row([str(record.get(h, "") if record.get(h) is not None else "") for h in headers],
                      value_input_option="USER_ENTERED")
        self._bust(tab)

    def _update_row(self, tab, row_number, fields):
        headers = TAB_HEADERS[tab] if tab in TAB_HEADERS else None
        ws = self.sheet.worksheet(tab)
        if headers is None:
            headers = [h.strip() for h in ws.row_values(1)]
        cells = []
        for key, val in fields.items():
            if key in headers:
                col = headers.index(key) + 1
                cells.append(gspread.Cell(row_number, col, "" if val is None else str(val)))
        if cells:
            ws.update_cells(cells, value_input_option="USER_ENTERED")
        self._bust(tab)

    # ── auth ─────────────────────────────────────────────────────────────
    def register_vendor(self, name, email, password):
        email = email.strip().lower()
        for r in self._rows(VENDOR_DB):
            if (r.get("email") or "").strip().lower() == email:
                if (r.get("password_hash") or "").strip():
                    return None, "An account with this email already exists. Try signing in."
                # Pre-created by an admin — claim it.
                self._update_row(VENDOR_DB, r["_row"],
                                 {"password_hash": generate_password_hash(password), "name": name or r.get("name")})
                return self.get_vendor(r["id"]), None
        v = {"id": _new_id("v"), "name": name, "email": email, "status": "active",
             "password_hash": generate_password_hash(password), "created_at": _now_ts(),
             "contact": "", "phone": "", "address": "", "gstin": ""}
        self._append(VENDOR_DB, v)
        return {k: v[k] for k in ("id", "name", "email", "status", "contact", "phone", "address", "gstin")}, None

    def authenticate_vendor(self, email, password):
        email = email.strip().lower()
        for r in self._rows(VENDOR_DB):
            if (r.get("email") or "").strip().lower() == email:
                h = (r.get("password_hash") or "").strip()
                if h and check_password_hash(h, password):
                    return {"id": r["id"], "name": r.get("name", ""), "email": r.get("email", ""),
                            "status": r.get("status", "active") or "active"}
                return None
        return None

    def register_admin(self, name, email, password):
        email = email.strip().lower()
        for r in self._rows(ADMIN_DB):
            if (r.get("email") or "").strip().lower() == email:
                return None, "An account with this email already exists. Try signing in."
        self._append(ADMIN_DB, {
            "email": email, "name": name, "password_hash": generate_password_hash(password),
            "role": "viewer", "granted_by": "", "created_at": _now_ts(),
        })
        return {"name": name, "email": email, "role": "viewer"}, None

    def authenticate_admin(self, email, password):
        email = email.strip().lower()
        for r in self._rows(ADMIN_DB):
            if (r.get("email") or "").strip().lower() == email:
                h = (r.get("password_hash") or "").strip()
                if h and check_password_hash(h, password):
                    return {"name": r.get("name", ""), "email": email, "role": r.get("role", "viewer") or "viewer"}
                return None
        return None

    def get_admin(self, email):
        email = (email or "").strip().lower()
        for r in self._rows(ADMIN_DB):
            if (r.get("email") or "").strip().lower() == email:
                return {"name": r.get("name", ""), "email": email, "role": r.get("role", "viewer") or "viewer"}
        return None

    def get_admins(self):
        return [
            {"email": r.get("email", ""), "name": r.get("name", ""),
             "role": r.get("role", "viewer") or "viewer", "granted_by": r.get("granted_by", "")}
            for r in self._rows(ADMIN_DB) if r.get("email")
        ]

    def set_admin_role(self, email, role, granted_by):
        email = email.strip().lower()
        for r in self._rows(ADMIN_DB):
            if (r.get("email") or "").strip().lower() == email:
                if (r.get("role") or "") == "master":
                    return None
                self._update_row(ADMIN_DB, r["_row"],
                                 {"role": role, "granted_by": granted_by if role == "editor" else ""})
                return {"email": email, "name": r.get("name", ""), "role": role}
        return None

    # ── vendors ──────────────────────────────────────────────────────────
    def get_vendors(self):
        out = []
        for r in self._rows(VENDOR_DB):
            if not r.get("id"):
                continue
            out.append({"id": r["id"], "name": r.get("name", ""), "email": r.get("email", ""),
                        "status": r.get("status", "active") or "active",
                        "contact": r.get("contact", ""), "phone": r.get("phone", ""),
                        "address": r.get("address", ""), "gstin": r.get("gstin", "")})
        return out

    def find_vendor_by_email(self, email):
        email = (email or "").strip().lower()
        for v in self.get_vendors():
            if v["email"].strip().lower() == email:
                return v
        return None

    def get_vendor(self, vid):
        for v in self.get_vendors():
            if v["id"] == vid:
                return v
        return None

    def add_vendor(self, fields):
        v = {"id": _new_id("v"), "contact": "", "phone": "", "address": "", "gstin": "",
             "created_at": _now_ts()}
        v.update(fields)
        self._append(VENDOR_DB, v)
        return v

    def update_vendor(self, vid, fields):
        for r in self._rows(VENDOR_DB):
            if r.get("id") == vid:
                self._update_row(VENDOR_DB, r["_row"], fields)
                v = dict(r)
                v.update(fields)
                return v
        return None

    # ── demands (reorder_sheet) ──────────────────────────────────────────
    def get_demands(self, vendor_id=None):
        vendor_name = None
        if vendor_id is not None:
            v = self.get_vendor(vendor_id)
            vendor_name = (v["name"].strip().lower() if v else "__none__")
        out = []
        for r in self._rows(DEMAND_SHEET):
            sku = (r.get("sku_code") or "").strip()
            vname = (r.get("vendor_name") or "").strip()
            if not sku or not vname:
                continue  # blank spacer rows / stray junk
            if vendor_name is not None and vname.lower() != vendor_name:
                continue
            ptype = (r.get("product_type") or "").strip()
            if ptype == sku:
                ptype = ""  # sheet quirk: product_type sometimes repeats the SKU
            try:
                qty = int(float(r.get("order_quantity") or 0))
            except ValueError:
                qty = 0
            try:
                cost = float(r.get("cost_price") or 0)
            except ValueError:
                cost = 0
            fq = r.get("fulfill_qty", "")
            out.append({
                "id": "row" + str(r["_row"]),
                "_row": r["_row"],
                "vendor_name": vname,
                "sku": sku,
                "pid": (r.get("design_id") or "").strip(),
                "type": ptype or "—",
                "cost": cost,
                "qty": qty,
                "po": (r.get("po") or "").strip(),
                "order_date": (r.get("order_date") or "").strip(),
                "image": (r.get("image_link") or "").strip(),
                "status": (r.get("response_status") or "new").strip() or "new",
                "fulfillQty": int(float(fq)) if str(fq).strip() else None,
                "remark": r.get("remark", ""),
                "reason": r.get("reject_reason", ""),
                "locked": str(r.get("locked", "")).strip().upper() == "TRUE",
            })
        return out

    def get_demand(self, did):
        for d in self.get_demands():
            if d["id"] == did:
                return d
        return None

    def respond_demand(self, did, status, fulfill_qty, remark, reason):
        d = self.get_demand(did)
        if not d:
            return None
        self._update_row(DEMAND_SHEET, d["_row"], {
            "response_status": status,
            "fulfill_qty": "" if fulfill_qty is None else fulfill_qty,
            "remark": remark or "",
            "reject_reason": reason or "",
            "responded_at": _now_ts(),
        })
        # route into confirmed_reorder + the matching outcome tab
        d = {**d, "status": status, "fulfillQty": fulfill_qty, "remark": remark or "", "reason": reason or ""}
        rec = {
            "image": image_formula(d.get("image")),
            "demand_id": d["id"], "vendor_name": d.get("vendor_name", ""),
            "sku": d["sku"], "pid": d.get("pid", ""), "product_type": d.get("type", ""),
            "required_qty": d["qty"], "fulfill_qty": "" if fulfill_qty is None else fulfill_qty,
            "outcome": status, "remark": remark or "", "reason": reason or "", "submitted_at": _now_ts(),
        }
        self._purge_demand(d["id"])
        self._append(CONFIRMED, rec)
        if status in OUTCOME_TABS:
            self._append(OUTCOME_TABS[status], rec)
        return d

    def lock_demand(self, did):
        d = self.get_demand(did)
        if not d:
            return None
        self._update_row(DEMAND_SHEET, d["_row"], {"locked": "TRUE"})
        return d

    # ── reorder requests ─────────────────────────────────────────────────
    def get_reorders(self, vendor_id=None):
        out = []
        for r in self._rows("ReorderRequests"):
            if not r.get("id"):
                continue
            if vendor_id is not None and r.get("vendor") != vendor_id:
                continue
            try:
                qty = int(float(r.get("qty") or 0))
            except ValueError:
                qty = 0
            out.append({"id": r["id"], "vendor": r.get("vendor", ""), "sku": r.get("sku", ""),
                        "product": r.get("product", ""), "qty": qty,
                        "status": r.get("status", "pending") or "pending",
                        "date": r.get("date", ""), "notes": r.get("notes", "")})
        out.reverse()  # newest first
        return out

    def add_reorder(self, vendor_id, sku, product, qty, notes):
        r = {"id": _new_id("r"), "vendor": vendor_id, "sku": sku, "product": product,
             "qty": qty, "status": "pending", "date": _today(), "notes": notes or ""}
        self._append("ReorderRequests", r)
        return r

    def decide_reorder(self, rid, decision, notes):
        for r in self._rows("ReorderRequests"):
            if r.get("id") == rid:
                self._update_row("ReorderRequests", r["_row"], {"status": decision, "notes": notes or ""})
                return r
        return None

    # ── payments ─────────────────────────────────────────────────────────
    def get_payments(self, vendor_id=None):
        out = []
        for r in self._rows("Payments"):
            if not r.get("id"):
                continue
            if vendor_id is not None and r.get("vendor") != vendor_id:
                continue
            try:
                amount = float(r.get("amount") or 0)
            except ValueError:
                amount = 0
            out.append({"id": r["id"], "ref": r.get("ref", ""), "vendor": r.get("vendor", ""),
                        "amount": amount, "date": r.get("date", ""), "utr": r.get("utr", "—") or "—",
                        "status": r.get("status", "Pending Confirmation") or "Pending Confirmation"})
        out.reverse()
        return out

    def add_payment(self, vendor_id, ref, amount, date, utr):
        p = {"id": _new_id("p"), "ref": ref, "vendor": vendor_id, "amount": amount,
             "date": date or _today(), "utr": utr or "—", "status": "Pending Confirmation"}
        self._append("Payments", p)
        return p

    def set_payment_status(self, pid, status, note=None):
        for r in self._rows("Payments"):
            if r.get("id") == pid:
                fields = {"status": status}
                if note:
                    fields["resolution_note"] = note
                self._update_row("Payments", r["_row"], fields)
                return r
        return None

    # ── purchase orders / invoices ───────────────────────────────────────
    def get_invoices(self, vendor_id=None):
        out = []
        for r in self._rows("PurchaseOrders"):
            if not r.get("id"):
                continue
            if vendor_id is not None and r.get("vendor") != vendor_id:
                continue
            try:
                qty = int(float(r.get("qty") or 0))
            except ValueError:
                qty = 0
            try:
                amount = float(r.get("amount") or 0)
            except ValueError:
                amount = 0
            out.append({"id": r["id"], "vendor": r.get("vendor", ""), "po": r.get("po", ""),
                        "qty": qty, "amount": amount,
                        "fileName": r.get("fileName") or None,
                        "status": r.get("status", "Awaiting Invoice") or "Awaiting Invoice",
                        "date": r.get("date") or None})
        return out

    def attach_invoice(self, iid, file_name):
        for r in self._rows("PurchaseOrders"):
            if r.get("id") == iid:
                self._update_row("PurchaseOrders", r["_row"],
                                 {"fileName": file_name, "status": "Uploaded", "date": _today()})
                return r
        return None

    # ── audit ────────────────────────────────────────────────────────────
    def get_audit(self):
        rows = [r for r in self._rows("AuditLog") if r.get("actor")]
        rows.reverse()  # newest first
        return [{"actor": r["actor"], "action": r.get("action", ""),
                 "target": r.get("target", ""), "ts": r.get("ts", "")} for r in rows]

    def push_audit(self, actor, action, target):
        entry = {"actor": actor, "action": action, "target": target, "ts": _now_ts()}
        self._append("AuditLog", entry)
        return entry
