# Mirraw Vendor Hub — Build Plan

Two-portal web app (Vendor + Admin) backed by Google Sheets, matching the design in
`Mirraw Vendor Hub.dc.html` (the design file is the UI spec — every screen, modal,
badge state and interaction below comes from it).

---

## 1. Architecture

```
Frontend (React/Next.js, styled per the .dc.html design)
        │  fetch + app JWT
        ▼
Flask API (gunicorn)
        │  gspread (OAuth user credentials — same pattern as the reco project)
        ▼
Google Spreadsheet  1NuKu423Gu1Pmdi6Pf_-F5-4UhEL5zQmEYV0z_QzVtVM  (reorder_sheet)
```

## 2. Google credentials — reuse the reco setup

The reco project (`C:\Users\ankit\Downloads\reco`) already has a working pattern we copy:

- **Google Cloud project:** `recommendation-496913`
- **OAuth client:** `credentials/credentials.json` (web client, secret inside —
  keep it out of git, load path from env like reco's `GOOGLE_OAUTH_CREDS_PATH`)
- **Sheet access:** one-time browser consent → save token (reco uses `token.pickle`) →
  `gspread.authorize(creds)`; refresh token renews automatically
  (see `reco/app/services/google_sheets_service.py`)

**Two changes needed vs reco:**

1. **Scope must be read-write.** Reco's token is `spreadsheets.readonly`; the hub writes
   vendor responses back. Run the consent flow once with
   `https://www.googleapis.com/auth/spreadsheets` (+ `drive.file` if invoices go to Drive)
   and save a new token. Do NOT reuse reco's token.pickle.
2. **Same OAuth client also powers user login.** Add the hub's callback URL
   (e.g. `http://localhost:5000/auth/google/callback` + the production URL) to the
   client's authorized redirect URIs in Google Cloud Console. Backend-sheet access and
   user login are two separate flows that happen to share one client ID.

Login rules (unchanged from the agreed plan):
- **Admin:** Google OAuth, only `@mirraw.com` emails accepted.
- **Vendor:** Google OAuth, any domain — email must match a row in the `Vendors` tab,
  otherwise "not a registered vendor, contact admin". No self-signup.
- After OAuth, backend issues its own short-lived JWT (`role`, `vendor_id`) via
  Flask-JWT-Extended; all API calls use it.

## 3. Sheet schema

### Existing tab: `reorder_sheet` (the demand queue — source of truth)
Columns as they exist today:

| col | header | notes |
|-----|--------|-------|
| A | sku_code | e.g. CLAPFESRRE260014 |
| B | design_id | numeric PID (shown as "PID" in vendor UI) |
| C | image_link | assets0.mirraw.com URL → thumbnail in vendor table |
| D | product_type | Sarees / Lehengas / Salwar Kameez… (some rows repeat the SKU — treat non-matching values as blank) |
| E | vendor_name | matches `Vendors.name` |
| F | order_quantity | requested qty |
| G | cost_price | ₹ |
| H | (qty duplicate) | ignore |
| I | po | PO number, e.g. P0/260478 — one PO covers multiple rows |
| J | order_date | e.g. "15- Jun-2026" (note the loose format — parse with dayfirst, strip spaces) |

**Columns the app appends (vendor responses written back):**
`row_id` (stable key we assign), `response_status` (new / accepted / partial / rejected),
`fulfill_qty`, `remark`, `reject_reason`, `responded_at`, `locked` (TRUE after vendor
submits — locked rows are read-only in the vendor UI), `version`, `updated_at`.

Data quirks already visible in the sheet: blank spacer rows (skip), a stray `0` row,
`product_type` sometimes repeating the SKU. The repository layer must tolerate all three.

### New tabs the app creates
- **`Vendors`** — id, name, email, status (active/suspended), contact_name, phone,
  address, gstin, created_at. Email is the OAuth identity key; `name` must match
  `reorder_sheet.vendor_name`.
- **`PurchaseOrders`** — id, po_number, vendor_id, total_qty, amount, status
  (Awaiting Invoice / Uploaded / Under Review / Paid / Disputed), invoice_file,
  invoice_date, version, updated_at. Seeded by grouping `reorder_sheet` by `po`.
- **`Payments`** — id, vendor_id, invoice_ref, amount, date, utr, status
  (Pending Confirmation / Confirmed / Disputed), resolution_note, confirmed_at,
  version, updated_at.
- **`AuditLog`** — id, actor, action, target, timestamp. Append-only; feeds both the
  admin Audit screen and the vendor dashboard "Recent Activity".

Invoice PDFs: upload to Google Drive folder via the same credentials (`drive.file`
scope), store the Drive link in `PurchaseOrders.invoice_file`.

## 4. Screens (from the design file)

### Vendor portal — nav: Dashboard · Reorders · Payments · Profile
- **Dashboard:** 4 cards (Pending Reorders / Approved / Pending Payments /
  Confirmed·This Month) + Recent Activity feed (from AuditLog).
- **Reorders — subtab "New Requests":** rows from `reorder_sheet` for this vendor with
  `response_status = new`: image, SKU, PID, product type, cost price, qty →
  **Accept** (modal: fulfill qty; if qty < requested it becomes *partial* and a remark
  is required; cannot exceed requested) or **Reject** (modal: reason dropdown —
  Out of stock / Product discontinued / Cost price too low / Insufficient production
  capacity / Lead time too short / Design-material unavailable / Other free text).
- **Reorders — subtab "Updates":** responded rows (accepted / partial / rejected badges,
  fulfilled x/y, remark or reason). **Edit** re-opens the modal; **Submit** locks the
  row (writes `locked=TRUE` to the sheet) and shows "✓ Submitted".
- **Payments:** "Awaiting Invoice" POs (PO number, qty, amount → attach PDF → Submit,
  button disabled until a file is picked) and "Submitted Invoices" list
  (Uploaded / Paid / Disputed badges). Plus confirm-receipt / dispute modals for
  payments recorded by admin.
- **Profile:** Google account fields read-only; contact / phone / address / GSTIN editable.

### Admin portal — nav: Dashboard · Reorders · Payments · Vendors · Audit Log
- **Dashboard:** cards (Total Vendors / Pending Reorders / Pending Payments / Disputed
  Payments) + "Needs Attention" quick-action list (pending reorders, disputes).
- **Reorders:** status chips (All/Pending/Approved/Rejected) + vendor dropdown filter;
  row click opens a right-side detail panel with admin notes textarea and
  **Approve / Reject** buttons.
- **Payments:** status chips + vendor filter; **Record New Payment** modal (vendor,
  invoice ref, amount ₹, date, UTR reference no.) → status Pending Confirmation;
  **Resolve** button on disputed rows (resolution note → Confirmed).
- **Vendors:** table with Add Vendor / Edit / Suspend / Reactivate (suspended vendors
  can't log in).
- **Audit Log:** filterable by actor.

## 5. Backend layout

```
app/
  __init__.py            # app factory
  extensions.py          # oauth (Authlib), jwt, cache, limiter
  sheets/
    client.py            # gspread auth — reco pattern, read-write scope, token file
    repository.py        # tab-agnostic get/append/update with version check + lock
  auth/routes.py         # /auth/google/login, /auth/google/callback (?portal=vendor|admin)
  vendor/routes.py       # demands list/respond/submit-lock, POs + invoice upload,
                         # payment confirm/dispute, profile
  admin/routes.py        # reorder decisions, record payment, resolve dispute,
                         # vendor CRUD, audit log
  schemas.py             # pydantic request/response models
config.py                # env: SHEET_ID, OAUTH creds path, JWT secret, ADMIN_DOMAIN
wsgi.py
```

Core endpoints:
- `GET  /auth/google/login?portal=` · `GET /auth/google/callback`
- `GET  /vendor/demands?status=` · `POST /vendor/demands/<row_id>/respond`
  (accept/partial/reject payload) · `POST /vendor/demands/<row_id>/submit` (lock)
- `GET  /vendor/pos` · `POST /vendor/pos/<id>/invoice` (multipart PDF)
- `GET  /vendor/payments` · `POST /vendor/payments/<id>/confirm|dispute`
- `GET/PUT /vendor/profile`
- `GET  /admin/reorders` · `PATCH /admin/reorders/<id>` (approve/reject + notes)
- `GET/POST /admin/payments` · `PATCH /admin/payments/<id>/resolve`
- `GET/POST/PATCH /admin/vendors`
- `GET  /admin/audit`

Concurrency: optimistic `version` column check on every update; single Redis (or
file-lock in dev) mutex around read-modify-write since Sheets has no transactions.
Cache sheet reads ~30–60s; bust on any write.

## 6. Build order

1. Google Cloud console: add hub redirect URIs to the existing OAuth client; run the
   one-time consent for a **read-write** sheet token (script: `scripts/authorize_sheets.py`).
2. Create the new tabs (`Vendors`, `PurchaseOrders`, `Payments`, `AuditLog`) + append
   the response columns to `reorder_sheet`; backfill `row_id`s; seed POs from the `po`
   column.
3. `sheets/repository.py` + tests against a copy of the real sheet (handle blank rows,
   the date format, SKU-in-product_type rows).
4. Auth: shared OAuth flow, domain gate for admin, `Vendors`-email lookup for vendor,
   JWT issuance. Test the "email not in Vendors" path explicitly.
5. Vendor API + screens: demands (accept/partial/reject/lock) first — that's the core
   loop — then POs/invoice upload, then payments confirm/dispute, then profile.
6. Admin API + screens: reorder decisions → record payment / resolve → vendor CRUD →
   audit log.
7. Email notifications on status changes (vendor responded / admin decided / payment
   recorded).
8. Deploy: Flask+gunicorn on Render/Railway, frontend on Vercel; secrets
   (OAuth client JSON, saved sheet token, JWT secret) as env vars — re-issue the
   OAuth client secret before going live since the current one has been sitting in
   plaintext in the reco folder.

Escape hatch unchanged: repository interface is generic, swappable to Postgres later
without touching routes or frontend.
