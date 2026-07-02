"""In-memory store seeded with the same demo data as the design file.

Lets the whole app run (MOCK_MODE=true) before the Google Sheets
read-write token exists. Same interface as SheetsStore.
"""

import time
from datetime import datetime


def _now_ts():
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def _today():
    return datetime.now().strftime("%Y-%m-%d")


def _new_id(prefix):
    return prefix + str(int(time.time() * 1000))


class MockStore:
    def __init__(self):
        self.vendors = [
            {"id": "v1", "name": "Anokhi Textiles", "email": "anokhi@textiles.in", "status": "active",
             "contact": "Ananya Kapoor", "phone": "+91 98200 44112",
             "address": "14 Linking Rd, Bandra West, Mumbai 400050", "gstin": "27AAECM1234F1Z5"},
            {"id": "v2", "name": "Rivaayat Studio", "email": "orders@rivaayat.co", "status": "active",
             "contact": "", "phone": "", "address": "", "gstin": ""},
            {"id": "v3", "name": "Bandhani & Co", "email": "sales@bandhanico.in", "status": "active",
             "contact": "", "phone": "", "address": "", "gstin": ""},
            {"id": "v4", "name": "Kaledo Exports", "email": "hello@kaledo.in", "status": "suspended",
             "contact": "", "phone": "", "address": "", "gstin": ""},
            {"id": "v5", "name": "Meher Handlooms", "email": "meher@handloom.in", "status": "active",
             "contact": "", "phone": "", "address": "", "gstin": ""},
            {"id": "v6", "name": "Zariya Weaves", "email": "contact@zariya.in", "status": "active",
             "contact": "", "phone": "", "address": "", "gstin": ""},
        ]
        self.reorders = [
            {"id": "r1", "vendor": "v1", "sku": "ANK-SR-014", "product": "Silk Saree — Maroon", "qty": 120, "status": "pending", "date": "2026-06-28", "notes": ""},
            {"id": "r2", "vendor": "v1", "sku": "ANK-KT-220", "product": "Cotton Kurti Set", "qty": 300, "status": "approved", "date": "2026-06-20", "notes": "Approved. Ship by Jul 5."},
            {"id": "r3", "vendor": "v1", "sku": "ANK-LH-008", "product": "Lehenga — Ivory", "qty": 40, "status": "rejected", "date": "2026-06-12", "notes": "Design discontinued this season."},
            {"id": "r4", "vendor": "v2", "sku": "RIV-DP-101", "product": "Dupatta — Blockprint", "qty": 200, "status": "pending", "date": "2026-06-27", "notes": ""},
            {"id": "r5", "vendor": "v3", "sku": "BND-BG-055", "product": "Bandhani Bagru Suit", "qty": 150, "status": "approved", "date": "2026-06-18", "notes": "Approved at revised rate."},
            {"id": "r6", "vendor": "v5", "sku": "MEH-SH-030", "product": "Handloom Shawl", "qty": 90, "status": "pending", "date": "2026-06-29", "notes": ""},
            {"id": "r7", "vendor": "v6", "sku": "ZAR-BL-077", "product": "Zari Blouse Piece", "qty": 500, "status": "pending", "date": "2026-06-30", "notes": ""},
            {"id": "r8", "vendor": "v1", "sku": "ANK-SR-019", "product": "Silk Saree — Teal", "qty": 80, "status": "approved", "date": "2026-06-05", "notes": "Approved."},
        ]
        self.payments = [
            {"id": "p1", "ref": "INV-2026-0412", "vendor": "v1", "amount": 240000, "date": "2026-06-25", "utr": "UTR8891234", "status": "Pending Confirmation"},
            {"id": "p2", "ref": "INV-2026-0388", "vendor": "v1", "amount": 115500, "date": "2026-06-10", "utr": "UTR8712009", "status": "Confirmed"},
            {"id": "p3", "ref": "INV-2026-0351", "vendor": "v1", "amount": 86000, "date": "2026-05-28", "utr": "UTR8654432", "status": "Disputed"},
            {"id": "p4", "ref": "INV-2026-0420", "vendor": "v2", "amount": 310000, "date": "2026-06-26", "utr": "UTR8899871", "status": "Pending Confirmation"},
            {"id": "p5", "ref": "INV-2026-0399", "vendor": "v3", "amount": 172300, "date": "2026-06-15", "utr": "UTR8760012", "status": "Confirmed"},
            {"id": "p6", "ref": "INV-2026-0405", "vendor": "v6", "amount": 405000, "date": "2026-06-22", "utr": "UTR8801234", "status": "Disputed"},
            {"id": "p7", "ref": "INV-2026-0370", "vendor": "v5", "amount": 64800, "date": "2026-06-08", "utr": "UTR8690001", "status": "Confirmed"},
        ]
        self.audit = [
            {"actor": "Priya (Admin)", "action": "approved reorder", "target": "ANK-KT-220", "ts": "2026-06-20 09:14"},
            {"actor": "Anokhi Textiles", "action": "submitted reorder", "target": "ANK-SR-014", "ts": "2026-06-28 11:02"},
            {"actor": "Rahul (Admin)", "action": "recorded payment", "target": "INV-2026-0420", "ts": "2026-06-26 16:40"},
            {"actor": "Anokhi Textiles", "action": "confirmed payment", "target": "INV-2026-0388", "ts": "2026-06-11 10:20"},
            {"actor": "Priya (Admin)", "action": "rejected reorder", "target": "ANK-LH-008", "ts": "2026-06-12 14:05"},
            {"actor": "Zariya Weaves", "action": "disputed payment", "target": "INV-2026-0405", "ts": "2026-06-23 08:50"},
            {"actor": "Rahul (Admin)", "action": "suspended vendor", "target": "Kaledo Exports", "ts": "2026-06-14 12:30"},
            {"actor": "Bandhani & Co", "action": "submitted reorder", "target": "BND-BG-055", "ts": "2026-06-18 15:22"},
        ]
        # Incoming reorder demands (rows of reorder_sheet in real mode)
        self.demands = [
            {"id": "d1", "vendor": "v1", "sku": "ANK-SR-014", "pid": "PID-88213", "type": "Silk Saree", "cost": 1850, "qty": 120, "status": "new", "fulfillQty": None, "remark": "", "reason": "", "locked": False, "image": ""},
            {"id": "d2", "vendor": "v1", "sku": "ANK-KT-220", "pid": "PID-90455", "type": "Cotton Kurti Set", "cost": 640, "qty": 300, "status": "new", "fulfillQty": None, "remark": "", "reason": "", "locked": False, "image": ""},
            {"id": "d3", "vendor": "v1", "sku": "ANK-DP-101", "pid": "PID-77120", "type": "Blockprint Dupatta", "cost": 410, "qty": 200, "status": "new", "fulfillQty": None, "remark": "", "reason": "", "locked": False, "image": ""},
            {"id": "d4", "vendor": "v1", "sku": "ANK-LH-330", "pid": "PID-65540", "type": "Bridal Lehenga", "cost": 5200, "qty": 25, "status": "new", "fulfillQty": None, "remark": "", "reason": "", "locked": False, "image": ""},
            {"id": "d5", "vendor": "v1", "sku": "ANK-BL-077", "pid": "PID-81002", "type": "Zari Blouse Piece", "cost": 520, "qty": 500, "status": "rejected", "fulfillQty": None, "remark": "", "reason": "Cost price too low", "locked": False, "image": ""},
            {"id": "d6", "vendor": "v1", "sku": "ANK-SH-030", "pid": "PID-70088", "type": "Handloom Shawl", "cost": 980, "qty": 90, "status": "partial", "fulfillQty": 60, "remark": "Only 60 in stock; balance expected by mid-July.", "reason": "", "locked": False, "image": ""},
        ]
        # Purchase orders synced from the sheet in real mode
        self.invoices = [
            {"id": "i1", "vendor": "v1", "po": "PO-2026-0501", "qty": 150, "amount": 90000, "fileName": None, "status": "Awaiting Invoice", "date": None},
            {"id": "i2", "vendor": "v1", "po": "PO-2026-0498", "qty": 220, "amount": 132000, "fileName": None, "status": "Awaiting Invoice", "date": None},
            {"id": "i3", "vendor": "v1", "po": "PO-2026-0412", "qty": 120, "amount": 240000, "fileName": "invoice-0412.pdf", "status": "Paid", "date": "2026-06-25"},
            {"id": "i4", "vendor": "v1", "po": "PO-2026-0439", "qty": 300, "amount": 115500, "fileName": "invoice-0439.pdf", "status": "Uploaded", "date": "2026-06-28"},
            {"id": "i5", "vendor": "v1", "po": "PO-2026-0388", "qty": 80, "amount": 86000, "fileName": "invoice-0388.pdf", "status": "Disputed", "date": "2026-05-28"},
        ]

    # ── vendors ──────────────────────────────────────────────────────────
    def get_vendors(self):
        return self.vendors

    def find_vendor_by_email(self, email):
        email = (email or "").strip().lower()
        for v in self.vendors:
            if v["email"].lower() == email:
                return v
        return None

    def get_vendor(self, vid):
        for v in self.vendors:
            if v["id"] == vid:
                return v
        return None

    def add_vendor(self, fields):
        v = {"id": _new_id("v"), "contact": "", "phone": "", "address": "", "gstin": ""}
        v.update(fields)
        self.vendors.append(v)
        return v

    def update_vendor(self, vid, fields):
        v = self.get_vendor(vid)
        if v:
            v.update(fields)
        return v

    # ── demands (reorder_sheet rows) ─────────────────────────────────────
    def get_demands(self, vendor_id=None):
        if vendor_id is None:
            return self.demands
        return [d for d in self.demands if d["vendor"] == vendor_id]

    def get_demand(self, did):
        for d in self.demands:
            if d["id"] == did:
                return d
        return None

    def respond_demand(self, did, status, fulfill_qty, remark, reason):
        d = self.get_demand(did)
        if d:
            d.update({"status": status, "fulfillQty": fulfill_qty, "remark": remark, "reason": reason})
        return d

    def lock_demand(self, did):
        d = self.get_demand(did)
        if d:
            d["locked"] = True
        return d

    # ── vendor-initiated reorder requests ────────────────────────────────
    def get_reorders(self, vendor_id=None):
        if vendor_id is None:
            return self.reorders
        return [r for r in self.reorders if r["vendor"] == vendor_id]

    def add_reorder(self, vendor_id, sku, product, qty, notes):
        r = {"id": _new_id("r"), "vendor": vendor_id, "sku": sku, "product": product,
             "qty": qty, "status": "pending", "date": _today(), "notes": notes or ""}
        self.reorders.insert(0, r)
        return r

    def decide_reorder(self, rid, decision, notes):
        for r in self.reorders:
            if r["id"] == rid:
                r["status"] = decision
                r["notes"] = notes or ""
                return r
        return None

    # ── payments ─────────────────────────────────────────────────────────
    def get_payments(self, vendor_id=None):
        if vendor_id is None:
            return self.payments
        return [p for p in self.payments if p["vendor"] == vendor_id]

    def add_payment(self, vendor_id, ref, amount, date, utr):
        p = {"id": _new_id("p"), "ref": ref, "vendor": vendor_id, "amount": amount,
             "date": date or _today(), "utr": utr or "—", "status": "Pending Confirmation"}
        self.payments.insert(0, p)
        return p

    def set_payment_status(self, pid, status, note=None):
        for p in self.payments:
            if p["id"] == pid:
                p["status"] = status
                if note:
                    p["resolution_note"] = note
                return p
        return None

    # ── purchase orders / invoices ───────────────────────────────────────
    def get_invoices(self, vendor_id=None):
        if vendor_id is None:
            return self.invoices
        return [i for i in self.invoices if i["vendor"] == vendor_id]

    def attach_invoice(self, iid, file_name):
        for i in self.invoices:
            if i["id"] == iid:
                i.update({"fileName": file_name, "status": "Uploaded", "date": _today()})
                return i
        return None

    # ── audit ────────────────────────────────────────────────────────────
    def get_audit(self):
        return self.audit

    def push_audit(self, actor, action, target):
        entry = {"actor": actor, "action": action, "target": target, "ts": _now_ts()}
        self.audit.insert(0, entry)
        return entry
