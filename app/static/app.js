/* Mirraw Vendor Hub — frontend.
   1:1 port of "Mirraw Vendor Hub.dc.html" (the design file), wired to the Flask API.
   All markup/inline styles below are copied from the design; only the data
   plumbing (fetch calls) is new. */
'use strict';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const REJECT_REASONS = ['Out of stock', 'Product discontinued', 'Cost price too low', 'Insufficient production capacity', 'Lead time too short', 'Design/material unavailable', 'Other (free text)'];

const App = {
  user: null,
  data: null,
  csrf: null,
  loginError: null,
  pendingFiles: {},
  state: {
    portal: 'vendor',
    authMode: 'signin',
    screen: 'dashboard',
    reorderSubtab: 'new',
    aReorderStatus: 'all', aReorderVendor: 'all',
    aPayStatus: 'all', aPayVendor: 'all',
    auditActor: 'all',
    acceptId: null, rejectId: null,
    showReorderForm: false,
    payAction: null,
    showRecordPay: false,
    resolveId: null,
    vendorForm: null,
    detailId: null,
    editingProfile: false,
  },

  // ── bootstrap ─────────────────────────────────────────────────────────
  async init() {
    let me = await (await fetch('/api/me')).json();
    // access token may have expired between visits — try one silent refresh
    if (!me.user && await this.tryRefresh()) me = await (await fetch('/api/me')).json();
    this.user = me.user;
    this.csrf = me.csrf;
    if (this.user) { this.state.portal = this.user.role; await this.refreshData(false); }
    this.render();
  },

  // Silent access-token renewal via the rotating refresh cookie.
  async tryRefresh() {
    const r = await fetch('/auth/refresh', { method: 'POST' });
    if (!r.ok) return false;
    const j = await r.json().catch(() => ({}));
    this.csrf = j.csrf || this.csrf;
    if (j.user) this.user = j.user;
    return true;
  },

  forceLogout() { this.user = null; this.data = null; this.csrf = null; this.render(); },

  async refreshData(rerender = true) {
    let res = await fetch('/api/bootstrap');
    if (res.status === 401 && await this.tryRefresh()) res = await fetch('/api/bootstrap');
    if (res.status === 401) { this.forceLogout(); return; }
    this.data = await res.json();
    if (rerender) this.render();
  },

  async api(path, opts = {}) {
    let res = await this._send(path, opts);
    if (res.status === 401) {
      const j = await res.clone().json().catch(() => ({}));
      if (j.code === 'expired' && await this.tryRefresh()) {
        res = await this._send(path, opts);  // retry once with a fresh access token
      } else {
        this.forceLogout();
        throw new Error('session');
      }
    }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { this.showToast(j.error || 'Something went wrong'); throw new Error(j.error || res.status); }
    return j;
  },

  _send(path, opts) {
    // Rebuilt each attempt so a refresh-retry re-sends body + fresh CSRF header.
    const headers = { ...(opts.headers || {}) };
    let body = opts.body;
    if (opts.json !== undefined) { body = JSON.stringify(opts.json); headers['Content-Type'] = 'application/json'; }
    if (this.csrf) headers['X-CSRF-Token'] = this.csrf;
    return fetch(path, { method: opts.method || 'POST', body, headers });
  },

  // ── helpers (from the design file) ────────────────────────────────────
  vendorName(id) { const v = (this.data.vendors || []).find((x) => x.id === id); return v ? v.name : (this.user.vendorName || '—'); },
  money(n) { return '₹' + Number(n).toLocaleString('en-IN'); },
  fmtDate(d) {
    if (!d) return '—';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d));
    if (!m) return String(d);
    return +m[3] + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1];
  },
  badge(status) {
    const m = {
      pending: { bg: '#fbeed1', c: '#8a5a00', dot: '#d99200', label: 'Pending' },
      approved: { bg: '#dcf3e4', c: '#1b6b3a', dot: '#2e9e58', label: 'Approved' },
      rejected: { bg: '#fbe2e2', c: '#a01f1f', dot: '#d64545', label: 'Rejected' },
      'Pending Confirmation': { bg: '#fbeed1', c: '#8a5a00', dot: '#d99200', label: 'Pending Confirmation' },
      Confirmed: { bg: '#dcf3e4', c: '#1b6b3a', dot: '#2e9e58', label: 'Confirmed' },
      Disputed: { bg: '#fbe2e2', c: '#a01f1f', dot: '#d64545', label: 'Disputed' },
      accepted: { bg: '#dcf3e4', c: '#1b6b3a', dot: '#2e9e58', label: 'Accepted' },
      partial: { bg: '#fbeed1', c: '#8a5a00', dot: '#d99200', label: 'Partial' },
      'Under Review': { bg: '#fbeed1', c: '#8a5a00', dot: '#d99200', label: 'Under Review' },
      Uploaded: { bg: '#e7e9f2', c: '#3a4a8a', dot: '#5a6cc4', label: 'Uploaded' },
      Paid: { bg: '#dcf3e4', c: '#1b6b3a', dot: '#2e9e58', label: 'Paid' },
      'Awaiting Invoice': { bg: '#fbeed1', c: '#8a5a00', dot: '#d99200', label: 'Awaiting Invoice' },
      active: { bg: '#dcf3e4', c: '#1b6b3a', dot: '#2e9e58', label: 'Active' },
      suspended: { bg: '#fbe2e2', c: '#a01f1f', dot: '#d64545', label: 'Suspended' },
    };
    return m[status] || m.pending;
  },
  badgeHtml(status) {
    const b = this.badge(status);
    return `<span style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px 3px 8px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap;background:${b.bg};color:${b.c};"><span style="width:6px;height:6px;border-radius:50%;background:${b.dot};"></span>${b.label}</span>`;
  },
  demandImg(d) {
    const base = 'width:64px;height:64px;border-radius:10px;border:1px solid #e8e0e5;flex-shrink:0;';
    if (d.image) {
      return `<div onclick="window.open('${esc(d.image)}','_blank')" style="${base}background:url('${esc(d.image)}') center/cover no-repeat #f2ecef;cursor:zoom-in;" title="Open image"></div>`;
    }
    return `<div style="${base}background:repeating-linear-gradient(135deg,#f2ecef,#f2ecef 6px,#e6dce4 6px,#e6dce4 12px);"></div>`;
  },

  showToast(msg) {
    if (this._t) clearTimeout(this._t);
    document.getElementById('toast-root').innerHTML = `
      <div style="position: fixed; bottom: 26px; left: 50%; transform: translateX(-50%); z-index: 200; animation: toastIn 0.28s cubic-bezier(0.16,1,0.3,1);">
        <div style="display: flex; align-items: center; gap: 11px; background: #1c1c22; color: #fff; padding: 12px 18px; border-radius: 11px; box-shadow: 0 12px 34px rgba(0,0,0,0.24); font-size: 14px; font-weight: 500;">
          <span style="width: 18px; height: 18px; border-radius: 50%; background: #2e9e58; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0;">✓</span>
          ${esc(msg)}
        </div>
      </div>`;
    this._t = setTimeout(() => { document.getElementById('toast-root').innerHTML = ''; }, 2800);
  },

  set(patch) { Object.assign(this.state, patch); this.render(); },

  // ── auth / nav ────────────────────────────────────────────────────────
  async doLogout() {
    await fetch('/auth/logout', { method: 'POST', headers: this.csrf ? { 'X-CSRF-Token': this.csrf } : {} });
    this.user = null; this.data = null; this.csrf = null; this.render();
  },
  togglePortal() { this.loginError = null; this.set({ portal: this.state.portal === 'vendor' ? 'admin' : 'vendor', authMode: 'signin' }); },
  setAuthMode(m) { this.loginError = null; this.set({ authMode: m }); },
  goTo(k) { this.set({ screen: k, detailId: null }); },

  async submitAuth() {
    const isVendor = this.state.portal === 'vendor';
    const signup = this.state.authMode === 'signup';
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const payload = { email, password };
    let path;
    if (signup) {
      payload.name = document.getElementById('auth-name').value.trim();
      path = isVendor ? '/auth/vendor/signup' : '/auth/admin/signup';
    } else {
      path = isVendor ? '/auth/vendor/login' : '/auth/admin/login';
    }
    this.loginError = null;
    let res, j;
    try {
      res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      j = await res.json().catch(() => ({}));
    } catch (e) { this.loginError = 'Network error — is the server running?'; this.render(); return; }
    if (!res.ok) { this.loginError = j.error || 'Something went wrong'; this.render(); return; }
    this.user = j.user;
    this.csrf = j.csrf;
    this.state.portal = this.user.role;
    this.state.screen = 'dashboard';
    await this.refreshData();
  },

  // ── render root ───────────────────────────────────────────────────────
  render() {
    const root = document.getElementById('root');
    if (!this.user || !this.data) { root.innerHTML = this.renderLogin(); return; }
    root.innerHTML = this.renderApp();
  },

  // ── login screen ──────────────────────────────────────────────────────
  renderLogin() {
    const isVendor = this.state.portal === 'vendor';
    const signup = this.state.authMode === 'signup';
    const loginTitle = isVendor ? 'Vendor Portal' : 'Admin Portal';
    const loginTagline = isVendor ? 'Manage your reorders and payment confirmations with Mirraw.' : 'Internal operations console for Mirraw marketplace.';
    const portalSwitchLabel = isVendor ? 'Switch to Admin Portal →' : 'Switch to Vendor Portal →';
    const errHtml = this.loginError ? `<div style="width: 100%; box-sizing: border-box; text-align: center; font-size: 13px; color: #a01f1f; background: #fbe2e2; border-radius: 9px; padding: 10px 14px;">${esc(this.loginError)}</div>` : '';
    const inputStyle = 'width: 100%; box-sizing: border-box; padding: 11px 13px; border-radius: 10px; border: 1px solid #dcdce2; font-size: 14px; outline: none;';
    const label = (t) => `<div style="font-size: 12.5px; color: #6b6b76; margin-bottom: 6px; font-weight: 500; align-self: flex-start;">${t}</div>`;
    const field = (l, inner) => `<div style="width: 100%;">${label(l)}${inner}</div>`;

    const nameLabel = isVendor ? 'Business / Vendor Name' : 'Full Name';
    const namePlaceholder = isVendor ? 'e.g. Anokhi Textiles' : 'e.g. Priya Menon';
    const nameField = signup ? field(nameLabel, `<input id="auth-name" placeholder="${namePlaceholder}" style="${inputStyle}" />`) : '';
    const submitLabel = signup ? 'Create Account' : 'Sign In';
    const footer = isVendor
      ? 'Vendors sign in with their own email address.'
      : 'Mirraw staff only. New accounts are view-only until the admin grants access.';

    // both portals get a Sign In / Sign Up toggle
    const modeToggle = `
      <div style="width: 100%; display: inline-flex; padding: 4px; background: #f0eef0; border-radius: 11px;">
        <button onclick="App.setAuthMode('signin')" style="flex:1;padding:8px 12px;border-radius:8px;border:none;cursor:pointer;font-size:13.5px;font-weight:600;background:${!signup ? '#fff' : 'transparent'};color:${!signup ? '#1c1c22' : '#6b6b76'};box-shadow:${!signup ? '0 1px 3px rgba(0,0,0,0.09)' : 'none'};">Sign In</button>
        <button onclick="App.setAuthMode('signup')" style="flex:1;padding:8px 12px;border-radius:8px;border:none;cursor:pointer;font-size:13.5px;font-weight:600;background:${signup ? '#fff' : 'transparent'};color:${signup ? '#1c1c22' : '#6b6b76'};box-shadow:${signup ? '0 1px 3px rgba(0,0,0,0.09)' : 'none'};">Sign Up</button>
      </div>`;

    return `
    <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; background: radial-gradient(120% 120% at 50% 0%, #ffffff 0%, #f4f1f3 60%, #efe9ed 100%);">
      <div style="width: 100%; max-width: 400px; display: flex; flex-direction: column; align-items: center; gap: 26px;">
        <div style="display: flex; flex-direction: column; align-items: center; gap: 14px;">
          <div style="width: 46px; height: 46px; border-radius: 12px; background: #6c2a57; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 24px; box-shadow: 0 6px 18px rgba(108,42,87,0.28);">M</div>
          <div style="text-align: center;">
            <div style="font-size: 13px; letter-spacing: 0.14em; text-transform: uppercase; color: #9a8f95; font-weight: 600;">Mirraw</div>
            <div style="font-size: 22px; font-weight: 600; margin-top: 2px;">Vendor Hub</div>
          </div>
        </div>
        <div style="width: 100%; box-sizing: border-box; background: #fff; border: 1px solid #ebebef; border-radius: 16px; padding: 30px 30px; box-shadow: 0 12px 40px rgba(28,28,34,0.06); display: flex; flex-direction: column; align-items: center; gap: 18px;">
          <div style="text-align: center; display: flex; flex-direction: column; gap: 6px;">
            <div style="font-size: 19px; font-weight: 600;">${loginTitle}</div>
            <div style="font-size: 14px; color: #6b6b76; line-height: 1.5;">${loginTagline}</div>
          </div>
          ${modeToggle}
          ${errHtml}
          ${nameField}
          ${field('Email', `<input id="auth-email" type="email" placeholder="you@company.com" onkeydown="if(event.key==='Enter')App.submitAuth()" style="${inputStyle}" />`)}
          ${field('Password', `<input id="auth-password" type="password" placeholder="${signup ? 'At least 6 characters' : 'Your password'}" onkeydown="if(event.key==='Enter')App.submitAuth()" style="${inputStyle}" />`)}
          <button onclick="App.submitAuth()" class="hv-primary" style="width: 100%; padding: 12px 16px; border-radius: 10px; border: none; background: #6c2a57; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer;">${submitLabel}</button>
          <div style="font-size: 12px; color: #a2a2ac; text-align: center;">${footer}</div>
        </div>
        <button onclick="App.togglePortal()" style="background: none; border: none; color: #6c2a57; font-size: 13px; font-weight: 600; cursor: pointer;">${portalSwitchLabel}</button>
      </div>
    </div>`;
  },

  // ── app shell ─────────────────────────────────────────────────────────
  canEdit() { return this.user.role === 'vendor' || !!this.user.canEdit; },

  renderApp() {
    const s = this.state;
    const isVendor = this.user.role === 'vendor';
    const isMaster = !!this.user.isMaster;
    const titles = { dashboard: 'Dashboard', reorders: 'Reorder Requests', payments: 'Payments', profile: 'Profile', vendors: 'Vendors', audit: 'Audit Log', access: 'Team Access' };
    const navKeys = isVendor
      ? ['dashboard', 'reorders', 'payments', 'profile']
      : ['dashboard', 'reorders', 'payments', 'vendors', 'audit', ...(isMaster ? ['access'] : [])];
    const portalLabel = isVendor ? 'Vendor Portal' : 'Admin Portal';
    const roleBadge = (!isVendor && this.user.adminRole) ? { master: 'Master', editor: 'Editor', viewer: 'View-only' }[this.user.adminRole] : null;
    const viewOnlyBanner = (!isVendor && !this.canEdit()) ? `
      <div style="max-width:1120px;margin-bottom:20px;display:flex;align-items:center;gap:10px;background:#fbf1e0;border:1px solid #f0dcb8;border-radius:11px;padding:12px 16px;font-size:13.5px;color:#8a5a00;">
        <span style="font-size:15px;">👁️</span> You have <strong>view-only</strong> access. Ask the master admin to grant you edit rights to approve reorders, record payments, or manage vendors.
      </div>` : '';

    const nav = navKeys.map((k) => {
      const active = s.screen === k;
      return `<div onclick="App.goTo('${k}')" class="hv-nav" style="display:flex;align-items:center;gap:11px;padding:8px 12px;border-radius:9px;font-size:14px;font-weight:${active ? 600 : 500};cursor:pointer;color:${active ? '#6c2a57' : '#52525b'};background:${active ? '#f3e9ef' : 'transparent'};">
        <span style="width:7px;height:7px;border-radius:50%;flex-shrink:0;background:${active ? '#6c2a57' : '#c4c4ce'};"></span>
        <span>${titles[k]}</span>
      </div>`;
    }).join('');

    let screen = '';
    if (s.screen === 'dashboard') screen = isVendor ? this.renderVendorDashboard() : this.renderAdminDashboard();
    else if (s.screen === 'reorders') screen = isVendor ? this.renderVendorReorders() : this.renderAdminReorders();
    else if (s.screen === 'payments') screen = isVendor ? this.renderVendorPayments() : this.renderAdminPayments();
    else if (s.screen === 'profile') screen = this.renderProfile();
    else if (s.screen === 'vendors') screen = this.renderVendorsAdmin();
    else if (s.screen === 'audit') screen = this.renderAudit();
    else if (s.screen === 'access') screen = this.renderAccess();

    return `
    <div style="display: flex; min-height: 100vh;">
      <aside style="width: 244px; flex-shrink: 0; background: #fbfbfc; border-right: 1px solid #ebebef; display: flex; flex-direction: column; position: sticky; top: 0; height: 100vh;">
        <div style="padding: 20px 18px 16px; display: flex; align-items: center; gap: 11px; border-bottom: 1px solid #f0f0f3;">
          <div style="width: 32px; height: 32px; border-radius: 9px; background: #6c2a57; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 17px; flex-shrink: 0;">M</div>
          <div style="min-width: 0;">
            <div style="font-size: 14px; font-weight: 600; line-height: 1.1;">Mirraw</div>
            <div style="font-size: 11px; color: #9a8f95; font-weight: 500;">${portalLabel}</div>
          </div>
        </div>
        <nav style="flex: 1; padding: 14px 12px; display: flex; flex-direction: column; gap: 3px;">${nav}</nav>
        <div style="padding: 12px; border-top: 1px solid #f0f0f3; display: flex; flex-direction: column; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 10px; padding: 6px 8px;">
            <div style="width: 30px; height: 30px; border-radius: 50%; background: #efe4eb; color: #6c2a57; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 13px; flex-shrink: 0;">${esc(this.user.initials)}</div>
            <div style="min-width: 0; flex: 1;">
              <div style="font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(this.user.name)}</div>
              <div style="font-size: 11px; color: #9a9aa2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(this.user.email)}</div>
            </div>
          </div>
          <button onclick="App.doLogout()" class="hv-nav-out" style="width: 100%; text-align: left; padding: 8px 10px; border-radius: 8px; border: none; background: none; color: #6b6b76; font-size: 13px; font-weight: 500; cursor: pointer;">Sign out</button>
        </div>
      </aside>
      <div style="flex: 1; min-width: 0; display: flex; flex-direction: column;">
        <header style="height: 60px; flex-shrink: 0; background: rgba(251,251,252,0.86); backdrop-filter: blur(8px); border-bottom: 1px solid #ebebef; display: flex; align-items: center; justify-content: space-between; padding: 0 32px; position: sticky; top: 0; z-index: 20;">
          <div style="font-size: 17px; font-weight: 600;">${titles[s.screen]}</div>
          <div style="display: flex; align-items: center; gap: 14px;">
            ${roleBadge ? `<span style="font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: ${this.user.canEdit ? '#1b6b3a' : '#8a5a00'}; background: ${this.user.canEdit ? '#dcf3e4' : '#fbeed1'}; padding: 5px 10px; border-radius: 999px;">${roleBadge}</span>` : ''}
            <span style="font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: #6c2a57; background: #f3e9ef; padding: 5px 11px; border-radius: 999px;">${portalLabel}</span>
            <div style="width: 32px; height: 32px; border-radius: 50%; background: #efe4eb; color: #6c2a57; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 13px;">${esc(this.user.initials)}</div>
          </div>
        </header>
        <div style="flex: 1; padding: 30px 32px 60px; overflow-y: auto;">${viewOnlyBanner}${screen}</div>
      </div>
    </div>
    ${this.renderModals()}`;
  },

  // ── dashboards ────────────────────────────────────────────────────────
  card(label, value, tone, sub) {
    const tones = { amber: '#d99200', green: '#2e9e58', red: '#d64545', plum: '#6c2a57' };
    return `<div style="background: #fff; border: 1px solid #ebebef; border-radius: 14px; padding: 18px 18px 16px; position: relative; overflow: hidden;">
      <div style="position: absolute; top: 0; left: 0; width: 3px; height: 100%; background: ${tones[tone]};"></div>
      <div style="font-size: 13px; color: #6b6b76; font-weight: 500;">${esc(label)}</div>
      <div style="font-size: 30px; font-weight: 700; margin: 8px 0 3px; letter-spacing: -0.02em;">${esc(value)}</div>
      <div style="font-size: 12px; color: #a2a2ac;">${esc(sub)}</div>
    </div>`;
  },

  renderVendorDashboard() {
    const d = this.data;
    const now = new Date();
    const monthPrefix = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const vPend = d.reorders.filter((r) => r.status === 'pending').length;
    const vAppr = d.reorders.filter((r) => r.status === 'approved').length;
    const vPayPend = d.payments.filter((p) => p.status === 'Pending Confirmation').length;
    const vConfMonth = d.payments.filter((p) => p.status === 'Confirmed' && String(p.date).startsWith(monthPrefix)).length;
    const cards = [
      this.card('Pending Reorders', vPend, 'amber', 'awaiting admin review'),
      this.card('Approved Reorders', vAppr, 'green', 'in production'),
      this.card('Pending Payments', vPayPend, 'amber', 'confirm receipt'),
      this.card('Confirmed · This Month', vConfMonth, 'green', MONTHS_FULL[now.getMonth()] + ' ' + now.getFullYear()),
    ].join('');

    const myName = this.user.vendorName;
    const mySkus = new Set([...d.reorders.map((r) => r.sku), ...d.demands.map((x) => x.sku)]);
    const myRefs = new Set(d.payments.map((p) => p.ref));
    const activity = d.audit
      .filter((a) => a.actor === myName || (a.actor.includes('Admin') && (mySkus.has(a.target) || myRefs.has(a.target))))
      .slice(0, 6);
    const rows = activity.map((a) => `
      <div style="display: flex; align-items: center; gap: 13px; padding: 13px 20px; border-bottom: 1px solid #f4f4f6;">
        <span style="width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: ${a.actor.includes('Admin') ? '#6c2a57' : '#2e9e58'};"></span>
        <div style="flex: 1; min-width: 0;">
          <span style="font-size: 14px;">${esc(a.actor)} ${esc(a.action)} </span>
          <span style="font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; color: #6c2a57; background: #f6eef2; padding: 1px 7px; border-radius: 5px;">${esc(a.target)}</span>
        </div>
        <div style="font-size: 12px; color: #a2a2ac; white-space: nowrap;">${esc(a.ts)}</div>
      </div>`).join('');

    return `<div style="max-width: 1120px;"><div>
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px;">${cards}</div>
      <div style="background: #fff; border: 1px solid #ebebef; border-radius: 14px; overflow-x: auto;">
        <div style="padding: 16px 20px; border-bottom: 1px solid #f0f0f3; font-size: 15px; font-weight: 600;">Recent Activity</div>
        ${activity.length ? `<div>${rows}</div>` : `<div style="padding: 40px 20px; text-align: center; font-size: 13px; color: #a2a2ac;">No recent activity yet.</div>`}
      </div>
    </div></div>`;
  },

  renderAdminDashboard() {
    const d = this.data;
    const cards = [
      this.card('Total Vendors', d.vendors.length, 'plum', d.vendors.filter((v) => v.status === 'active').length + ' active'),
      this.card('Pending Reorders', d.reorders.filter((r) => r.status === 'pending').length, 'amber', 'need decision'),
      this.card('Pending Payments', d.payments.filter((p) => p.status === 'Pending Confirmation').length, 'amber', 'awaiting vendor'),
      this.card('Disputed Payments', d.payments.filter((p) => p.status === 'Disputed').length, 'red', 'need resolution'),
    ].join('');

    const attn = [];
    d.reorders.filter((r) => r.status === 'pending').slice(0, 3).forEach((r) => attn.push({
      tag: 'Reorder', tagBg: '#f3e9ef', tagC: '#6c2a57',
      title: r.sku + ' · ' + r.product, meta: this.vendorName(r.vendor) + ' · ' + r.qty + ' units', to: 'reorders',
    }));
    d.payments.filter((p) => p.status === 'Disputed').forEach((p) => attn.push({
      tag: 'Dispute', tagBg: '#fbe2e2', tagC: '#a01f1f',
      title: p.ref + ' · ' + this.money(p.amount), meta: this.vendorName(p.vendor), to: 'payments',
    }));
    const rows = attn.map((a) => `
      <div onclick="App.goTo('${a.to}')" class="hv-row" style="display: flex; align-items: center; gap: 14px; padding: 14px 20px; border-bottom: 1px solid #f4f4f6; cursor: pointer;">
        <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase; padding: 4px 9px; border-radius: 6px; flex-shrink: 0; background: ${a.tagBg}; color: ${a.tagC};">${a.tag}</span>
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 14px; font-weight: 500;">${esc(a.title)}</div>
          <div style="font-size: 12.5px; color: #9a9aa2;">${esc(a.meta)}</div>
        </div>
        <span style="color: #c4c4ce; font-size: 18px;">›</span>
      </div>`).join('');

    return `<div style="max-width: 1120px;"><div>
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px;">${cards}</div>
      <div style="background: #fff; border: 1px solid #ebebef; border-radius: 14px; overflow-x: auto;">
        <div style="padding: 16px 20px; border-bottom: 1px solid #f0f0f3; display: flex; align-items: center; justify-content: space-between;">
          <span style="font-size: 15px; font-weight: 600;">Needs Attention</span>
          <span style="font-size: 12px; color: #a2a2ac;">Quick actions</span>
        </div>
        ${attn.length ? `<div>${rows}</div>` : `<div style="padding: 40px 20px; text-align: center; font-size: 13px; color: #a2a2ac;">Nothing needs attention right now.</div>`}
      </div>
    </div></div>`;
  },

  // ── vendor: reorders (incoming demands) ───────────────────────────────
  setSubtab(t) { this.set({ reorderSubtab: t }); },

  renderVendorReorders() {
    const s = this.state;
    const demands = this.data.demands;
    const newDemands = demands.filter((d) => d.status === 'new');
    const updDemands = demands.filter((d) => d.status !== 'new');
    const subTabStyle = (active) => `display:inline-flex;align-items:center;gap:7px;padding:7px 15px;border-radius:8px;border:none;cursor:pointer;font-size:13.5px;font-weight:600;background:${active ? '#fff' : 'transparent'};color:${active ? '#1c1c22' : '#6b6b76'};box-shadow:${active ? '0 1px 3px rgba(0,0,0,0.09)' : 'none'};`;
    const subTabCountStyle = (active) => `background:${active ? '#f3e9ef' : '#e2e0e4'};color:${active ? '#6c2a57' : '#8a8a94'};font-size:11px;font-weight:700;padding:1px 7px;border-radius:999px;`;
    const isNew = s.reorderSubtab === 'new';

    let body = '';
    if (isNew) {
      const rows = newDemands.map((d) => `
        <div style="display: grid; grid-template-columns: 80px 130px 120px 1fr 120px 80px 210px; gap: 14px; min-width: 940px; padding: 13px 20px; border-bottom: 1px solid #f4f4f6; align-items: center; font-size: 14px;">
          ${this.demandImg(d)}
          <div style="font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; color: #6c2a57;">${esc(d.sku)}</div>
          <div style="font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: #8a8a94;">${esc(d.pid)}</div>
          <div style="font-weight: 500;">${esc(d.type)}</div>
          <div>${this.money(d.cost)}</div>
          <div style="font-weight: 600;">${Number(d.qty).toLocaleString('en-IN')}</div>
          <div style="display: flex; gap: 8px; justify-content: flex-end;">
            <button onclick="App.openAccept('${d.id}')" class="hv-green" style="padding: 7px 15px; border-radius: 8px; border: none; background: #dcf3e4; color: #1b6b3a; font-size: 13px; font-weight: 600; cursor: pointer;">Accept</button>
            <button onclick="App.openReject('${d.id}')" class="hv-red" style="padding: 7px 15px; border-radius: 8px; border: 1px solid #f0d3d3; background: #fff; color: #a01f1f; font-size: 13px; font-weight: 600; cursor: pointer;">Reject</button>
          </div>
        </div>`).join('');
      body = `
        <div style="font-size: 13.5px; color: #6b6b76; margin-bottom: 14px;">Reorder demands sent by Mirraw. Accept and confirm how many you can fulfill, or reject with a reason.</div>
        <div style="background: #fff; border: 1px solid #ebebef; border-radius: 14px; overflow-x: auto;">
          <div style="display: grid; grid-template-columns: 80px 130px 120px 1fr 120px 80px 210px; gap: 14px; min-width: 940px; padding: 12px 20px; background: #fafafb; border-bottom: 1px solid #ebebef; font-size: 12px; font-weight: 600; color: #8a8a94; text-transform: uppercase; letter-spacing: 0.03em;">
            <div></div><div>SKU</div><div>PID</div><div>Product Type</div><div>Cost Price</div><div>Qty</div><div style="text-align: right;">Response</div>
          </div>
          ${newDemands.length ? rows : `
          <div style="padding: 60px 20px; text-align: center;">
            <div style="font-size: 15px; font-weight: 600; color: #52525b;">All caught up</div>
            <div style="font-size: 13px; color: #a2a2ac; margin-top: 5px;">No new reorder demands right now. New demands from Mirraw appear here.</div>
          </div>`}
        </div>`;
    } else {
      const rows = updDemands.map((d) => {
        const detail = d.status === 'rejected' ? d.reason : (d.status === 'partial' ? d.remark : (d.status === 'accepted' ? 'Full quantity confirmed' : '—'));
        const fulfill = (d.status === 'accepted' || d.status === 'partial') ? (d.fulfillQty + ' / ' + d.qty) : '—';
        const action = `<div style="display: flex; gap: 8px; align-items: center;">
              <span style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: #1b6b3a;"><span style="width:14px;height:14px;border-radius:50%;background:#2e9e58;color:#fff;display:flex;align-items:center;justify-content:center;font-size:8px;">✓</span> Submitted</span>
              <button onclick="App.editDemand('${d.id}')" class="hv-grey" style="padding: 6px 13px; border-radius: 8px; border: 1px solid #e4e4ea; background: #fff; color: #52525b; font-size: 13px; font-weight: 500; cursor: pointer;">Edit</button>
            </div>`;
        return `
        <div style="display: grid; grid-template-columns: 80px 130px 1fr 130px 110px 1.3fr 190px; gap: 14px; min-width: 1000px; padding: 13px 20px; border-bottom: 1px solid #f4f4f6; align-items: center; font-size: 14px;">
          ${this.demandImg(d)}
          <div style="font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; color: #6c2a57;">${esc(d.sku)}</div>
          <div style="font-weight: 500;">${esc(d.type)}</div>
          <div>${this.badgeHtml(d.status)}</div>
          <div style="color: #52525b;">${esc(fulfill)}</div>
          <div style="color: #6b6b76; font-size: 13px;">${esc(detail)}</div>
          <div style="display: flex; gap: 8px; justify-content: flex-end; align-items: center;">${action}</div>
        </div>`;
      }).join('');
      body = `
        <div style="font-size: 13.5px; color: #6b6b76; margin-bottom: 14px;">Your responses. Review or edit, then submit to lock the row and send it to Mirraw.</div>
        <div style="background: #fff; border: 1px solid #ebebef; border-radius: 14px; overflow-x: auto;">
          <div style="display: grid; grid-template-columns: 80px 130px 1fr 130px 110px 1.3fr 190px; gap: 14px; min-width: 1000px; padding: 12px 20px; background: #fafafb; border-bottom: 1px solid #ebebef; font-size: 12px; font-weight: 600; color: #8a8a94; text-transform: uppercase; letter-spacing: 0.03em;">
            <div></div><div>SKU</div><div>Product Type</div><div>Response</div><div>Fulfilled</div><div>Remark / Reason</div><div style="text-align: right;">Action</div>
          </div>
          ${updDemands.length ? rows : `
          <div style="padding: 60px 20px; text-align: center;">
            <div style="font-size: 15px; font-weight: 600; color: #52525b;">Nothing here yet</div>
            <div style="font-size: 13px; color: #a2a2ac; margin-top: 5px;">Accepted and rejected requests move here for review before you submit.</div>
          </div>`}
        </div>`;
    }

    return `<div style="max-width: 1120px;"><div>
      <div style="display: inline-flex; padding: 4px; background: #f0eef0; border-radius: 11px; margin-bottom: 20px;">
        <button onclick="App.setSubtab('new')" style="${subTabStyle(isNew)}">New Requests <span style="${subTabCountStyle(isNew)}">${newDemands.length}</span></button>
        <button onclick="App.setSubtab('updates')" style="${subTabStyle(!isNew)}">Updates <span style="${subTabCountStyle(!isNew)}">${updDemands.length}</span></button>
      </div>
      ${body}
    </div></div>`;
  },

  // ── admin: reorders ───────────────────────────────────────────────────
  filterChip(label, val, cur, handler) {
    const active = val === cur;
    return `<button onclick="${handler}" style="padding:6px 13px;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer;border:1px solid ${active ? '#6c2a57' : '#e4e4ea'};background:${active ? '#6c2a57' : '#fff'};color:${active ? '#fff' : '#52525b'};">${label}</button>`;
  },

  renderAdminReorders() {
    const s = this.state;
    const d = this.data;
    const chips = [
      this.filterChip('All', 'all', s.aReorderStatus, "App.set({aReorderStatus:'all'})"),
      this.filterChip('Pending', 'pending', s.aReorderStatus, "App.set({aReorderStatus:'pending'})"),
      this.filterChip('Approved', 'approved', s.aReorderStatus, "App.set({aReorderStatus:'approved'})"),
      this.filterChip('Rejected', 'rejected', s.aReorderStatus, "App.set({aReorderStatus:'rejected'})"),
    ].join('');
    const vendorOpts = d.vendors.map((v) => `<option value="${v.id}" ${s.aReorderVendor === v.id ? 'selected' : ''}>${esc(v.name)}</option>`).join('');
    const list = d.reorders.filter((r) => (s.aReorderStatus === 'all' || r.status === s.aReorderStatus) && (s.aReorderVendor === 'all' || r.vendor === s.aReorderVendor));
    const rows = list.map((r) => `
      <div onclick="App.openDetail('${r.id}')" class="hv-row" style="display: grid; grid-template-columns: 1.3fr 130px 1.4fr 80px 140px 120px 40px; gap: 12px; min-width: 980px; padding: 14px 20px; border-bottom: 1px solid #f4f4f6; align-items: center; font-size: 14px; cursor: pointer;">
        <div style="font-weight: 500;">${esc(this.vendorName(r.vendor))}</div>
        <div style="font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; color: #6c2a57;">${esc(r.sku)}</div>
        <div style="color: #52525b;">${esc(r.product)}</div>
        <div>${Number(r.qty).toLocaleString('en-IN')}</div>
        <div>${this.badgeHtml(r.status)}</div>
        <div style="color: #6b6b76;">${this.fmtDate(r.date)}</div>
        <div style="text-align: right; color: #c4c4ce; font-size: 18px;">›</div>
      </div>`).join('');

    return `<div style="max-width: 1120px;"><div>
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; gap: 16px; flex-wrap: wrap;">
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">${chips}</div>
        <select onchange="App.set({aReorderVendor:this.value})" style="padding: 8px 12px; border-radius: 9px; border: 1px solid #e4e4ea; background: #fff; font-size: 13px; color: #52525b; cursor: pointer;">
          <option value="all">All vendors</option>${vendorOpts}
        </select>
      </div>
      <div style="background: #fff; border: 1px solid #ebebef; border-radius: 14px; overflow-x: auto;">
        <div style="display: grid; grid-template-columns: 1.3fr 130px 1.4fr 80px 140px 120px 40px; gap: 12px; min-width: 980px; padding: 12px 20px; background: #fafafb; border-bottom: 1px solid #ebebef; font-size: 12px; font-weight: 600; color: #8a8a94; text-transform: uppercase; letter-spacing: 0.03em;">
          <div>Vendor</div><div>SKU</div><div>Product</div><div>Qty</div><div>Status</div><div>Requested</div><div></div>
        </div>
        ${list.length ? rows : `
        <div style="padding: 60px 20px; text-align: center;">
          <div style="font-size: 15px; font-weight: 600; color: #52525b;">No matching requests</div>
          <div style="font-size: 13px; color: #a2a2ac; margin-top: 5px;">Adjust your filters to see more.</div>
        </div>`}
      </div>
    </div></div>`;
  },

  // ── vendor: payments (POs + invoices) ─────────────────────────────────
  renderVendorPayments() {
    const invoices = this.data.invoices;
    const awaiting = invoices.filter((p) => p.status === 'Awaiting Invoice');
    const submitted = invoices.filter((p) => p.status !== 'Awaiting Invoice');

    const awaitingRows = awaiting.map((p) => {
      const pending = this.pendingFiles[p.id];
      const filecell = pending
        ? `<div style="display: inline-flex; align-items: center; gap: 9px; max-width: 100%; padding: 7px 12px; border-radius: 9px; border: 1px solid #e4e4ea; background: #faf9fa;">
            <span style="font-size: 10px; font-weight: 700; color: #a01f1f; background: #fbe2e2; padding: 3px 6px; border-radius: 5px; flex-shrink: 0;">PDF</span>
            <span style="flex: 1; min-width: 0; font-size: 12.5px; color: #1c1c22; font-family: 'IBM Plex Mono', monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(pending.name)}</span>
            <button onclick="App.clearPick('${p.id}')" class="hv-x" style="border: none; background: none; color: #9a9aa2; font-size: 14px; cursor: pointer; flex-shrink: 0; padding: 0;">✕</button>
          </div>`
        : `<label class="hv-upload" style="display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 9px; border: 1px dashed #c9b9c4; background: #fbf8fa; color: #6c2a57; font-size: 13px; font-weight: 600; cursor: pointer;">
            <span style="font-size: 14px;">↑</span> Upload PDF
            <input type="file" accept="application/pdf" onchange="App.pickFile('${p.id}', this)" style="display: none;" />
          </label>`;
      const submitStyle = 'padding:7px 16px;border-radius:8px;border:none;font-size:13px;font-weight:600;color:#fff;' + (pending ? 'background:#6c2a57;cursor:pointer;' : 'background:#d9cdd4;cursor:not-allowed;');
      return `
      <div style="display: grid; grid-template-columns: 160px 100px 140px 1fr 130px; gap: 14px; min-width: 820px; padding: 13px 20px; border-bottom: 1px solid #f4f4f6; align-items: center; font-size: 14px;">
        <div style="font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; color: #6c2a57;">${esc(p.po)}</div>
        <div>${Number(p.qty).toLocaleString('en-IN')}</div>
        <div style="font-weight: 600;">${this.money(p.amount)}</div>
        <div style="min-width: 0;">${filecell}</div>
        <div style="text-align: right;"><button onclick="App.submitPO('${p.id}')" style="${submitStyle}">Submit</button></div>
      </div>`;
    }).join('');

    const submittedRows = submitted.map((p) => `
      <div style="display: grid; grid-template-columns: 160px 100px 140px 1fr 130px; gap: 12px; min-width: 720px; padding: 14px 20px; border-bottom: 1px solid #f4f4f6; align-items: center; font-size: 14px;">
        <div style="font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; color: #6c2a57;">${esc(p.po)}</div>
        <div>${Number(p.qty).toLocaleString('en-IN')}</div>
        <div style="font-weight: 600;">${this.money(p.amount)}</div>
        <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
          <span style="font-size: 10px; font-weight: 700; color: #a01f1f; background: #fbe2e2; padding: 3px 6px; border-radius: 5px; flex-shrink: 0;">PDF</span>
          <span style="font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; color: #6b6b76; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(p.fileName || '')}</span>
        </div>
        <div style="color: #6b6b76;">${this.fmtDate(p.date)}</div>
      </div>`).join('');

    return `<div style="max-width: 1120px;"><div>
      <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 12px;">
        <div style="font-size: 12px; font-weight: 600; color: #8a8a94; text-transform: uppercase; letter-spacing: 0.04em;">Awaiting Invoice</div>
        <div style="font-size: 12.5px; color: #a2a2ac;">PO details are synced from Mirraw — just attach the invoice PDF.</div>
      </div>
      <div style="background: #fff; border: 1px solid #ebebef; border-radius: 14px; overflow-x: auto; margin-bottom: 26px;">
        <div style="display: grid; grid-template-columns: 160px 100px 140px 1fr 130px; gap: 14px; min-width: 820px; padding: 12px 20px; background: #fafafb; border-bottom: 1px solid #ebebef; font-size: 12px; font-weight: 600; color: #8a8a94; text-transform: uppercase; letter-spacing: 0.03em;">
          <div>PO Number</div><div>Quantity</div><div>Amount</div><div>Invoice PDF</div><div style="text-align: right;">Action</div>
        </div>
        ${awaiting.length ? awaitingRows : `
        <div style="padding: 50px 20px; text-align: center;">
          <div style="font-size: 15px; font-weight: 600; color: #52525b;">All invoices submitted</div>
          <div style="font-size: 13px; color: #a2a2ac; margin-top: 5px;">New purchase orders from Mirraw will appear here to invoice.</div>
        </div>`}
      </div>
      <div style="font-size: 12px; font-weight: 600; color: #8a8a94; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 12px;">Submitted Invoices</div>
      <div style="background: #fff; border: 1px solid #ebebef; border-radius: 14px; overflow-x: auto;">
        <div style="display: grid; grid-template-columns: 160px 100px 140px 1fr 130px; gap: 12px; min-width: 720px; padding: 12px 20px; background: #fafafb; border-bottom: 1px solid #ebebef; font-size: 12px; font-weight: 600; color: #8a8a94; text-transform: uppercase; letter-spacing: 0.03em;">
          <div>PO Number</div><div>Quantity</div><div>Amount</div><div>Invoice</div><div>Submitted</div>
        </div>
        ${submitted.length ? submittedRows : `
        <div style="padding: 56px 20px; text-align: center;">
          <div style="font-size: 15px; font-weight: 600; color: #52525b;">No invoices submitted yet</div>
          <div style="font-size: 13px; color: #a2a2ac; margin-top: 5px;">Submit your first invoice using the form above.</div>
        </div>`}
      </div>
    </div></div>`;
  },

  // ── admin: payments ───────────────────────────────────────────────────
  renderAdminPayments() {
    const s = this.state;
    const d = this.data;
    const chips = [
      this.filterChip('All', 'all', s.aPayStatus, "App.set({aPayStatus:'all'})"),
      this.filterChip('Pending', 'Pending Confirmation', s.aPayStatus, "App.set({aPayStatus:'Pending Confirmation'})"),
      this.filterChip('Confirmed', 'Confirmed', s.aPayStatus, "App.set({aPayStatus:'Confirmed'})"),
      this.filterChip('Disputed', 'Disputed', s.aPayStatus, "App.set({aPayStatus:'Disputed'})"),
    ].join('');
    const vendorOpts = d.vendors.map((v) => `<option value="${v.id}" ${s.aPayVendor === v.id ? 'selected' : ''}>${esc(v.name)}</option>`).join('');
    const list = d.payments.filter((p) => (s.aPayStatus === 'all' || p.status === s.aPayStatus) && (s.aPayVendor === 'all' || p.vendor === s.aPayVendor));
    const rows = list.map((p) => `
      <div style="display: grid; grid-template-columns: 1.2fr 140px 120px 120px 140px 160px 100px; gap: 12px; min-width: 1040px; padding: 14px 20px; border-bottom: 1px solid #f4f4f6; align-items: center; font-size: 14px;">
        <div style="font-weight: 500;">${esc(this.vendorName(p.vendor))}</div>
        <div style="font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; color: #6c2a57;">${esc(p.ref)}</div>
        <div style="font-weight: 600;">${this.money(p.amount)}</div>
        <div style="color: #6b6b76;">${this.fmtDate(p.date)}</div>
        <div style="font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: #8a8a94;">${esc(p.utr)}</div>
        <div>${this.badgeHtml(p.status)}</div>
        <div style="text-align: right;">
          ${(p.status === 'Disputed' && this.canEdit()) ? `<button onclick="App.openResolve('${p.id}')" class="hv-plum" style="padding: 6px 12px; border-radius: 8px; border: 1px solid #e4e4ea; background: #fff; color: #6c2a57; font-size: 13px; font-weight: 600; cursor: pointer;">Resolve</button>` : ''}
        </div>
      </div>`).join('');

    return `<div style="max-width: 1120px;"><div>
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; gap: 16px; flex-wrap: wrap;">
        <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
          ${chips}
          <select onchange="App.set({aPayVendor:this.value})" style="padding: 8px 12px; border-radius: 9px; border: 1px solid #e4e4ea; background: #fff; font-size: 13px; color: #52525b; cursor: pointer; margin-left: 4px;">
            <option value="all">All vendors</option>${vendorOpts}
          </select>
        </div>
        ${this.canEdit() ? `<button onclick="App.set({showRecordPay:true})" class="hv-primary" style="display: flex; align-items: center; gap: 7px; padding: 9px 16px; border-radius: 9px; border: none; background: #6c2a57; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer;">
          <span style="font-size: 17px; line-height: 1;">+</span> Record New Payment
        </button>` : ''}
      </div>
      <div style="background: #fff; border: 1px solid #ebebef; border-radius: 14px; overflow-x: auto;">
        <div style="display: grid; grid-template-columns: 1.2fr 140px 120px 120px 140px 160px 100px; gap: 12px; min-width: 1040px; padding: 12px 20px; background: #fafafb; border-bottom: 1px solid #ebebef; font-size: 12px; font-weight: 600; color: #8a8a94; text-transform: uppercase; letter-spacing: 0.03em;">
          <div>Vendor</div><div>Invoice Ref</div><div>Amount</div><div>Date</div><div>Reference No.</div><div>Status</div><div></div>
        </div>
        ${list.length ? rows : `
        <div style="padding: 60px 20px; text-align: center;">
          <div style="font-size: 15px; font-weight: 600; color: #52525b;">No matching payments</div>
          <div style="font-size: 13px; color: #a2a2ac; margin-top: 5px;">Adjust your filters to see more.</div>
        </div>`}
      </div>
    </div></div>`;
  },

  // ── profile ───────────────────────────────────────────────────────────
  renderProfile() {
    const v = this.data.vendor || {};
    const editing = this.state.editingProfile;
    const body = editing
      ? `<div style="display: flex; flex-direction: column; gap: 16px;">
          <div>
            <div style="font-size: 12.5px; color: #6b6b76; margin-bottom: 6px; font-weight: 500;">Primary Contact</div>
            <input id="pf-contact" value="${esc(v.contact)}" style="width: 100%; padding: 10px 13px; border-radius: 9px; border: 1px solid #dcdce2; font-size: 14px; outline: none;" />
          </div>
          <div>
            <div style="font-size: 12.5px; color: #6b6b76; margin-bottom: 6px; font-weight: 500;">Phone</div>
            <input id="pf-phone" value="${esc(v.phone)}" style="width: 100%; padding: 10px 13px; border-radius: 9px; border: 1px solid #dcdce2; font-size: 14px; outline: none;" />
          </div>
          <div>
            <div style="font-size: 12.5px; color: #6b6b76; margin-bottom: 6px; font-weight: 500;">Address</div>
            <textarea id="pf-address" style="width: 100%; padding: 10px 13px; border-radius: 9px; border: 1px solid #dcdce2; font-size: 14px; outline: none; resize: vertical; min-height: 64px;">${esc(v.address)}</textarea>
          </div>
        </div>`
      : `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 18px 24px;">
          <div>
            <div style="font-size: 12.5px; color: #9a9aa2; margin-bottom: 5px;">Primary Contact</div>
            <div style="font-size: 14.5px; font-weight: 500;">${esc(v.contact || '—')}</div>
          </div>
          <div>
            <div style="font-size: 12.5px; color: #9a9aa2; margin-bottom: 5px;">Phone</div>
            <div style="font-size: 14.5px; font-weight: 500;">${esc(v.phone || '—')}</div>
          </div>
          <div>
            <div style="font-size: 12.5px; color: #9a9aa2; margin-bottom: 5px;">GSTIN</div>
            <div style="font-size: 14.5px; font-weight: 500; font-family: 'IBM Plex Mono', monospace;">${esc(v.gstin || '—')}</div>
          </div>
          <div>
            <div style="font-size: 12.5px; color: #9a9aa2; margin-bottom: 5px;">Address</div>
            <div style="font-size: 14.5px; font-weight: 500;">${esc(v.address || '—')}</div>
          </div>
        </div>
        <button onclick="App.set({editingProfile:true})" class="hv-plum" style="margin-top: 24px; padding: 9px 16px; border-radius: 9px; border: 1px solid #e4e4ea; background: #fff; color: #6c2a57; font-size: 14px; font-weight: 600; cursor: pointer;">Edit Contact Info</button>`;

    return `<div style="max-width: 720px;">
      <div style="background: #fff; border: 1px solid #ebebef; border-radius: 14px; overflow-x: auto;">
        <div style="padding: 22px 24px; border-bottom: 1px solid #f0f0f3; display: flex; align-items: center; gap: 16px;">
          <div style="width: 52px; height: 52px; border-radius: 14px; background: #efe4eb; color: #6c2a57; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 20px;">${esc(this.user.initials)}</div>
          <div style="flex: 1;">
            <div style="font-size: 18px; font-weight: 600;">${esc(v.name || this.user.vendorName)}</div>
            <div style="font-size: 13.5px; color: #9a9aa2;">Vendor account</div>
          </div>
          ${editing ? `<button onclick="App.saveProfile()" class="hv-primary" style="padding: 8px 16px; border-radius: 9px; border: none; background: #6c2a57; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer;">Save Changes</button>` : ''}
        </div>
        <div style="padding: 24px;">
          <div style="font-size: 12px; font-weight: 600; color: #8a8a94; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 14px;">Account · from Google</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 18px 24px; margin-bottom: 26px;">
            <div>
              <div style="font-size: 12.5px; color: #9a9aa2; margin-bottom: 5px;">Vendor Name</div>
              <div style="font-size: 14.5px; font-weight: 500;">${esc(v.name || this.user.vendorName)}</div>
            </div>
            <div>
              <div style="font-size: 12.5px; color: #9a9aa2; margin-bottom: 5px;">Email (read-only)</div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 14.5px; font-weight: 500;">${esc(this.user.email)}</span>
                <span style="font-size: 11px; color: #8a8a94; background: #f2f2f4; padding: 2px 7px; border-radius: 5px;">Google</span>
              </div>
            </div>
          </div>
          <div style="font-size: 12px; font-weight: 600; color: #8a8a94; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 14px;">Contact Information</div>
          ${body}
        </div>
      </div>
    </div>`;
  },

  async saveProfile() {
    const contact = document.getElementById('pf-contact').value;
    const phone = document.getElementById('pf-phone').value;
    const address = document.getElementById('pf-address').value;
    await this.api('/api/vendor/profile', { method: 'PUT', json: { contact, phone, address } });
    this.state.editingProfile = false;
    await this.refreshData();
    this.showToast('Profile updated');
  },

  // ── admin: vendors ────────────────────────────────────────────────────
  renderVendorsAdmin() {
    const rows = this.data.vendors.map((v) => {
      const initials = v.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
      const toggle = v.status === 'active'
        ? `<button onclick="App.toggleVendor('${v.id}')" class="hv-red" style="padding: 6px 12px; border-radius: 8px; border: 1px solid #f0d3d3; background: #fff; color: #a01f1f; font-size: 13px; font-weight: 500; cursor: pointer;">Suspend</button>`
        : `<button onclick="App.toggleVendor('${v.id}')" class="hv-green" style="padding: 6px 12px; border-radius: 8px; border: 1px solid #cfe8d8; background: #fff; color: #1b6b3a; font-size: 13px; font-weight: 500; cursor: pointer;">Reactivate</button>`;
      const actions = this.canEdit()
        ? `<button onclick="App.openEditVendor('${v.id}')" class="hv-grey" style="padding: 6px 12px; border-radius: 8px; border: 1px solid #e4e4ea; background: #fff; color: #52525b; font-size: 13px; font-weight: 500; cursor: pointer;">Edit</button>${toggle}`
        : `<span style="font-size: 12.5px; color: #c4c4ce;">—</span>`;
      return `
      <div style="display: grid; grid-template-columns: 1.4fr 1.4fr 130px 180px; gap: 12px; min-width: 780px; padding: 13px 20px; border-bottom: 1px solid #f4f4f6; align-items: center; font-size: 14px;">
        <div style="display: flex; align-items: center; gap: 11px;">
          <div style="width: 32px; height: 32px; border-radius: 50%; background: #efe4eb; color: #6c2a57; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 12px; flex-shrink: 0;">${esc(initials)}</div>
          <span style="font-weight: 500;">${esc(v.name)}</span>
        </div>
        <div style="color: #6b6b76;">${esc(v.email)}</div>
        <div>${this.badgeHtml(v.status)}</div>
        <div style="display: flex; gap: 8px; justify-content: flex-end;">${actions}</div>
      </div>`;
    }).join('');

    return `<div style="max-width: 1000px;">
      ${this.canEdit() ? `<div style="display: flex; justify-content: flex-end; margin-bottom: 18px;">
        <button onclick="App.openAddVendor()" class="hv-primary" style="display: flex; align-items: center; gap: 7px; padding: 9px 16px; border-radius: 9px; border: none; background: #6c2a57; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer;">
          <span style="font-size: 17px; line-height: 1;">+</span> Add Vendor
        </button>
      </div>` : ''}
      <div style="background: #fff; border: 1px solid #ebebef; border-radius: 14px; overflow-x: auto;">
        <div style="display: grid; grid-template-columns: 1.4fr 1.4fr 130px 180px; gap: 12px; min-width: 780px; padding: 12px 20px; background: #fafafb; border-bottom: 1px solid #ebebef; font-size: 12px; font-weight: 600; color: #8a8a94; text-transform: uppercase; letter-spacing: 0.03em;">
          <div>Vendor</div><div>Email</div><div>Status</div><div style="text-align: right;">Actions</div>
        </div>
        ${rows}
      </div>
    </div>`;
  },

  // ── admin: audit ──────────────────────────────────────────────────────
  renderAudit() {
    const s = this.state;
    const audit = this.data.audit;
    const actors = ['all', ...Array.from(new Set(audit.map((a) => a.actor)))];
    const opts = actors.map((a) => `<option value="${esc(a)}" ${s.auditActor === a ? 'selected' : ''}>${a === 'all' ? 'All actors' : esc(a)}</option>`).join('');
    const list = audit.filter((a) => s.auditActor === 'all' || a.actor === s.auditActor);
    const rows = list.map((a) => `
      <div style="display: grid; grid-template-columns: 1.4fr 1.4fr 1fr 160px; gap: 12px; min-width: 780px; padding: 12px 20px; border-bottom: 1px solid #f4f4f6; align-items: center; font-size: 13.5px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 11px; flex-shrink: 0; background: #f2eef1; color: #6c2a57;">${esc(a.actor.split(' ')[0].slice(0, 2).toUpperCase())}</div>
          <span style="font-weight: 500;">${esc(a.actor)}</span>
        </div>
        <div style="color: #52525b;">${esc(a.action)}</div>
        <div style="font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; color: #6c2a57;">${esc(a.target)}</div>
        <div style="color: #9a9aa2; font-family: 'IBM Plex Mono', monospace; font-size: 12px;">${esc(a.ts)}</div>
      </div>`).join('');

    return `<div style="max-width: 1000px;">
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 18px;">
        <span style="font-size: 13px; color: #8a8a94; font-weight: 500;">Filter by actor</span>
        <select onchange="App.set({auditActor:this.value})" style="padding: 8px 12px; border-radius: 9px; border: 1px solid #e4e4ea; background: #fff; font-size: 13px; color: #52525b; cursor: pointer;">${opts}</select>
      </div>
      <div style="background: #fff; border: 1px solid #ebebef; border-radius: 14px; overflow-x: auto;">
        <div style="display: grid; grid-template-columns: 1.4fr 1.4fr 1fr 160px; gap: 12px; min-width: 780px; padding: 12px 20px; background: #fafafb; border-bottom: 1px solid #ebebef; font-size: 12px; font-weight: 600; color: #8a8a94; text-transform: uppercase; letter-spacing: 0.03em;">
          <div>Actor</div><div>Action</div><div>Target</div><div>Timestamp</div>
        </div>
        ${list.length ? rows : `
        <div style="padding: 60px 20px; text-align: center;">
          <div style="font-size: 15px; font-weight: 600; color: #52525b;">No log entries</div>
          <div style="font-size: 13px; color: #a2a2ac; margin-top: 5px;">No actions match this filter.</div>
        </div>`}
      </div>
    </div>`;
  },

  // ── admin: team access (master only) ──────────────────────────────────
  renderAccess() {
    const team = this.data.team || [];
    const roleBadge = (role) => {
      const m = { master: { bg: '#efe4eb', c: '#6c2a57', label: 'Master' }, editor: { bg: '#dcf3e4', c: '#1b6b3a', label: 'Editor' }, viewer: { bg: '#fbeed1', c: '#8a5a00', label: 'View-only' } }[role] || { bg: '#f2f2f4', c: '#6b6b76', label: role };
      return `<span style="display:inline-flex;align-items:center;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;background:${m.bg};color:${m.c};">${m.label}</span>`;
    };
    const rows = team.map((a) => {
      const initials = (a.name || a.email).split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
      let action = '';
      if (a.role === 'master') action = `<span style="font-size: 12.5px; color: #a2a2ac;">Master admin</span>`;
      else if (a.email === this.user.email) action = `<span style="font-size: 12.5px; color: #a2a2ac;">You</span>`;
      else if (a.role === 'editor') action = `<button onclick="App.setTeamRole('${esc(a.email)}','viewer')" class="hv-red" style="padding: 6px 12px; border-radius: 8px; border: 1px solid #f0d3d3; background: #fff; color: #a01f1f; font-size: 13px; font-weight: 500; cursor: pointer;">Revoke edit</button>`;
      else action = `<button onclick="App.setTeamRole('${esc(a.email)}','editor')" class="hv-green" style="padding: 6px 12px; border-radius: 8px; border: 1px solid #cfe8d8; background: #fff; color: #1b6b3a; font-size: 13px; font-weight: 500; cursor: pointer;">Grant edit</button>`;
      return `
      <div style="display: grid; grid-template-columns: 1.5fr 1.6fr 130px 140px; gap: 12px; min-width: 760px; padding: 13px 20px; border-bottom: 1px solid #f4f4f6; align-items: center; font-size: 14px;">
        <div style="display: flex; align-items: center; gap: 11px;">
          <div style="width: 32px; height: 32px; border-radius: 50%; background: #efe4eb; color: #6c2a57; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 12px; flex-shrink: 0;">${esc(initials)}</div>
          <span style="font-weight: 500;">${esc(a.name || '—')}</span>
        </div>
        <div style="color: #6b6b76;">${esc(a.email)}</div>
        <div>${roleBadge(a.role)}</div>
        <div style="display: flex; justify-content: flex-end;">${action}</div>
      </div>`;
    }).join('');

    return `<div style="max-width: 1000px;">
      <div style="font-size: 13.5px; color: #6b6b76; margin-bottom: 16px;">Grant edit access to Mirraw staff. Editors can approve reorders, record payments and manage vendors; view-only admins can see everything but change nothing.</div>
      <div style="background: #fff; border: 1px solid #ebebef; border-radius: 14px; overflow-x: auto;">
        <div style="display: grid; grid-template-columns: 1.5fr 1.6fr 130px 140px; gap: 12px; min-width: 760px; padding: 12px 20px; background: #fafafb; border-bottom: 1px solid #ebebef; font-size: 12px; font-weight: 600; color: #8a8a94; text-transform: uppercase; letter-spacing: 0.03em;">
          <div>Name</div><div>Email</div><div>Access</div><div style="text-align: right;">Manage</div>
        </div>
        ${team.length ? rows : `<div style="padding: 50px 20px; text-align: center; font-size: 13px; color: #a2a2ac;">No admin accounts yet.</div>`}
      </div>
    </div>`;
  },
  async setTeamRole(email, role) {
    await this.api(`/api/admin/team/${encodeURIComponent(email)}/role`, { json: { role } });
    await this.refreshData();
    this.showToast(role === 'editor' ? 'Edit access granted' : 'Set to view-only');
  },

  // ── modals ────────────────────────────────────────────────────────────
  renderModals() {
    let html = '';
    const s = this.state;
    if (s.acceptId) html += this.renderAcceptModal();
    if (s.rejectId) html += this.renderRejectModal();
    if (s.showRecordPay) html += this.renderRecordPayModal();
    if (s.resolveId) html += this.renderResolveModal();
    if (s.vendorForm) html += this.renderVendorFormModal();
    if (s.detailId) html += this.renderDetailPanel();
    return html;
  },

  // accept demand
  openAccept(id) {
    const d = this.data.demands.find((x) => x.id === id);
    this._acceptPrefillQty = (d.status === 'accepted' || d.status === 'partial') ? String(d.fulfillQty) : '';
    this._acceptRemarkDraft = d.remark || '';
    this.set({ acceptId: id, rejectId: null });
  },
  renderAcceptModal() {
    const d = this.data.demands.find((x) => x.id === this.state.acceptId);
    if (!d) return '';
    return `
    <div onclick="App.set({acceptId:null})" style="position: fixed; inset: 0; z-index: 100; background: rgba(24,20,26,0.42); display: flex; align-items: center; justify-content: center; padding: 24px; animation: fadeIn 0.18s ease;">
      <div onclick="event.stopPropagation()" style="width: 100%; max-width: 440px; background: #fff; border-radius: 16px; box-shadow: 0 24px 70px rgba(0,0,0,0.28); overflow: hidden;">
        <div style="padding: 20px 24px; border-bottom: 1px solid #f0f0f3;">
          <div style="font-size: 17px; font-weight: 600;">Accept Reorder</div>
          <div style="font-size: 13px; color: #9a9aa2; margin-top: 3px;"><span style="font-family: 'IBM Plex Mono', monospace; color: #6c2a57;">${esc(d.sku)}</span> · ${esc(d.type)}</div>
        </div>
        <div style="padding: 22px 24px; display: flex; flex-direction: column; gap: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; background: #faf9fa; border: 1px solid #f0f0f3; border-radius: 10px; padding: 12px 14px;">
            <span style="font-size: 13px; color: #6b6b76;">Quantity requested by Mirraw</span>
            <span style="font-size: 16px; font-weight: 700;">${Number(d.qty).toLocaleString('en-IN')}</span>
          </div>
          <div>
            <div style="font-size: 12.5px; color: #6b6b76; margin-bottom: 6px; font-weight: 500;">How many can you fulfill?</div>
            <input id="accept-qty" type="number" placeholder="Enter quantity" value="${esc(this._acceptPrefillQty)}" oninput="App.onAcceptQtyInput(${d.qty})" style="width: 100%; padding: 10px 13px; border-radius: 9px; border: 1px solid #dcdce2; font-size: 14px; outline: none;" />
          </div>
          <div id="accept-extra"></div>
        </div>
        <div style="padding: 16px 24px; border-top: 1px solid #f0f0f3; display: flex; justify-content: flex-end; gap: 10px;">
          <button onclick="App.set({acceptId:null})" style="padding: 9px 16px; border-radius: 9px; border: 1px solid #e4e4ea; background: #fff; color: #52525b; font-size: 14px; font-weight: 500; cursor: pointer;">Cancel</button>
          <button onclick="App.submitAccept()" class="hv-darkgreen" style="padding: 9px 18px; border-radius: 9px; border: none; background: #1b6b3a; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer;">Submit</button>
        </div>
      </div>
    </div>`;
  },
  onAcceptQtyInput(reqQty) {
    const el = document.getElementById('accept-qty');
    const extra = document.getElementById('accept-extra');
    const remarkEl = document.getElementById('accept-remark');
    if (remarkEl) this._acceptRemarkDraft = remarkEl.value;
    const q = el.value === '' ? NaN : +el.value;
    if (!isNaN(q) && q === reqQty) {
      extra.innerHTML = `<div style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: #1b6b3a; font-weight: 500;"><span style="width:16px;height:16px;border-radius:50%;background:#2e9e58;color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;">✓</span> Fulfills the full requested quantity.</div>`;
    } else if (!isNaN(q) && q > 0 && q < reqQty) {
      extra.innerHTML = `<div>
        <div style="font-size: 12.5px; color: #8a5a00; margin-bottom: 6px; font-weight: 600;">Short of ${reqQty - q} units — add a remark</div>
        <textarea id="accept-remark" placeholder="Reason you can't fulfill the full quantity (e.g. limited stock, expected restock date)..." style="width: 100%; padding: 10px 13px; border-radius: 9px; border: 1px solid #dcdce2; font-size: 14px; outline: none; resize: vertical; min-height: 64px;">${esc(this._acceptRemarkDraft)}</textarea>
      </div>`;
    } else {
      extra.innerHTML = '';
    }
  },
  async submitAccept() {
    const d = this.data.demands.find((x) => x.id === this.state.acceptId);
    const qtyEl = document.getElementById('accept-qty');
    const remarkEl = document.getElementById('accept-remark');
    const q = qtyEl.value === '' ? NaN : +qtyEl.value;
    if (qtyEl.value === '' || isNaN(q) || q < 1) { this.showToast('Enter how many you can fulfill'); return; }
    if (q > d.qty) { this.showToast('Cannot exceed the requested quantity (' + d.qty + ')'); return; }
    const partial = q < d.qty;
    const remark = remarkEl ? remarkEl.value.trim() : '';
    if (partial && !remark) { this.showToast('Add a remark for the short quantity'); return; }
    await this.api(`/api/vendor/demands/${d.id}/respond`, { json: { kind: 'accept', fulfillQty: q, remark } });
    this.state.acceptId = null;
    this.state.reorderSubtab = 'updates';
    await this.refreshData();
    this.showToast(partial ? 'Submitted (partial) — sent to Mirraw' : 'Submitted — sent to Mirraw');
  },

  // reject demand
  openReject(id) {
    const d = this.data.demands.find((x) => x.id === id);
    const known = REJECT_REASONS.includes(d.reason);
    this._rejectPrefill = d.status === 'rejected' ? (known ? d.reason : 'Other (free text)') : '';
    this._rejectOtherPrefill = (d.status === 'rejected' && !known) ? d.reason : '';
    this.set({ rejectId: id, acceptId: null });
  },
  renderRejectModal() {
    const d = this.data.demands.find((x) => x.id === this.state.rejectId);
    if (!d) return '';
    const opts = REJECT_REASONS.map((r) => `<option value="${esc(r)}" ${this._rejectPrefill === r ? 'selected' : ''}>${esc(r)}</option>`).join('');
    const showOther = this._rejectPrefill === 'Other (free text)';
    return `
    <div onclick="App.set({rejectId:null})" style="position: fixed; inset: 0; z-index: 100; background: rgba(24,20,26,0.42); display: flex; align-items: center; justify-content: center; padding: 24px; animation: fadeIn 0.18s ease;">
      <div onclick="event.stopPropagation()" style="width: 100%; max-width: 440px; background: #fff; border-radius: 16px; box-shadow: 0 24px 70px rgba(0,0,0,0.28); overflow: hidden;">
        <div style="padding: 20px 24px; border-bottom: 1px solid #f0f0f3;">
          <div style="font-size: 17px; font-weight: 600;">Reject Reorder</div>
          <div style="font-size: 13px; color: #9a9aa2; margin-top: 3px;"><span style="font-family: 'IBM Plex Mono', monospace; color: #6c2a57;">${esc(d.sku)}</span> · ${esc(d.type)}</div>
        </div>
        <div style="padding: 22px 24px; display: flex; flex-direction: column; gap: 16px;">
          <div>
            <div style="font-size: 12.5px; color: #6b6b76; margin-bottom: 6px; font-weight: 500;">Reason for rejecting</div>
            <select id="reject-reason" onchange="document.getElementById('reject-other-wrap').style.display = this.value === 'Other (free text)' ? 'block' : 'none'" style="width: 100%; padding: 10px 13px; border-radius: 9px; border: 1px solid #dcdce2; font-size: 14px; outline: none; background: #fff;">
              <option value="" ${this._rejectPrefill === '' ? 'selected' : ''}>Select a reason...</option>
              ${opts}
            </select>
          </div>
          <div id="reject-other-wrap" style="display: ${showOther ? 'block' : 'none'};">
            <div style="font-size: 12.5px; color: #6b6b76; margin-bottom: 6px; font-weight: 500;">Please specify</div>
            <textarea id="reject-other" placeholder="Describe your reason for rejecting..." style="width: 100%; padding: 10px 13px; border-radius: 9px; border: 1px solid #dcdce2; font-size: 14px; outline: none; resize: vertical; min-height: 64px;">${esc(this._rejectOtherPrefill)}</textarea>
          </div>
        </div>
        <div style="padding: 16px 24px; border-top: 1px solid #f0f0f3; display: flex; justify-content: flex-end; gap: 10px;">
          <button onclick="App.set({rejectId:null})" style="padding: 9px 16px; border-radius: 9px; border: 1px solid #e4e4ea; background: #fff; color: #52525b; font-size: 14px; font-weight: 500; cursor: pointer;">Cancel</button>
          <button onclick="App.submitReject()" class="hv-darkred" style="padding: 9px 18px; border-radius: 9px; border: none; background: #a01f1f; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer;">Submit</button>
        </div>
      </div>
    </div>`;
  },
  async submitReject() {
    const d = this.data.demands.find((x) => x.id === this.state.rejectId);
    const reasonSel = document.getElementById('reject-reason').value;
    const other = document.getElementById('reject-other').value.trim();
    if (!reasonSel) { this.showToast('Select a reason for rejecting'); return; }
    if (reasonSel === 'Other (free text)' && !other) { this.showToast('Describe the reason'); return; }
    const reason = reasonSel === 'Other (free text)' ? other : reasonSel;
    await this.api(`/api/vendor/demands/${d.id}/respond`, { json: { kind: 'reject', reason } });
    this.state.rejectId = null;
    this.state.reorderSubtab = 'updates';
    await this.refreshData();
    this.showToast('Rejected — sent to Mirraw');
  },

  editDemand(id) {
    const d = this.data.demands.find((x) => x.id === id);
    if (d.status === 'rejected') this.openReject(id); else this.openAccept(id);
  },

  // vendor invoices
  pickFile(id, input) {
    const f = input.files && input.files[0];
    if (f) { this.pendingFiles[id] = f; this.render(); }
  },
  clearPick(id) { delete this.pendingFiles[id]; this.render(); },
  async submitPO(id) {
    const f = this.pendingFiles[id];
    if (!f) { this.showToast('Attach the invoice PDF first'); return; }
    const fd = new FormData();
    fd.append('file', f);
    await this.api(`/api/vendor/pos/${id}/invoice`, { body: fd });
    delete this.pendingFiles[id];
    await this.refreshData();
    this.showToast('Invoice submitted');
  },

  // admin: reorder detail panel
  openDetail(id) {
    const r = this.data.reorders.find((x) => x.id === id);
    this._detailNotesPrefill = r.notes || '';
    this.set({ detailId: id });
  },
  renderDetailPanel() {
    const r = this.data.reorders.find((x) => x.id === this.state.detailId);
    if (!r) return '';
    return `
    <div onclick="App.set({detailId:null})" style="position: fixed; inset: 0; z-index: 100; background: rgba(24,20,26,0.42); display: flex; justify-content: flex-end; animation: fadeIn 0.18s ease;">
      <div onclick="event.stopPropagation()" style="width: 440px; max-width: 92vw; background: #fff; height: 100%; box-shadow: -18px 0 60px rgba(0,0,0,0.18); display: flex; flex-direction: column; animation: panelIn 0.24s cubic-bezier(0.16,1,0.3,1);">
        <div style="padding: 22px 26px; border-bottom: 1px solid #f0f0f3; display: flex; align-items: flex-start; justify-content: space-between;">
          <div>
            <div style="font-size: 12px; font-weight: 600; color: #8a8a94; text-transform: uppercase; letter-spacing: 0.04em;">Reorder Request</div>
            <div style="font-size: 19px; font-weight: 600; margin-top: 5px; font-family: 'IBM Plex Mono', monospace; color: #6c2a57;">${esc(r.sku)}</div>
          </div>
          <button onclick="App.set({detailId:null})" class="hv-close" style="width: 30px; height: 30px; border-radius: 8px; border: none; background: #f4f4f6; color: #6b6b76; font-size: 17px; cursor: pointer;">✕</button>
        </div>
        <div style="flex: 1; overflow-y: auto; padding: 24px 26px;">
          <div style="display: flex; flex-direction: column; gap: 18px;">
            <div style="display: flex; justify-content: space-between; align-items: center;"><span style="font-size: 13px; color: #9a9aa2;">Status</span>${this.badgeHtml(r.status)}</div>
            <div style="display: flex; justify-content: space-between;"><span style="font-size: 13px; color: #9a9aa2;">Vendor</span><span style="font-size: 14px; font-weight: 500;">${esc(this.vendorName(r.vendor))}</span></div>
            <div style="display: flex; justify-content: space-between;"><span style="font-size: 13px; color: #9a9aa2;">Product</span><span style="font-size: 14px; font-weight: 500; text-align: right;">${esc(r.product)}</span></div>
            <div style="display: flex; justify-content: space-between;"><span style="font-size: 13px; color: #9a9aa2;">Quantity</span><span style="font-size: 14px; font-weight: 500;">${Number(r.qty).toLocaleString('en-IN')} units</span></div>
            <div style="display: flex; justify-content: space-between;"><span style="font-size: 13px; color: #9a9aa2;">Requested</span><span style="font-size: 14px; font-weight: 500;">${this.fmtDate(r.date)}</span></div>
          </div>
          <div style="margin-top: 26px;">
            <div style="font-size: 12.5px; color: #6b6b76; margin-bottom: 8px; font-weight: 600;">Admin notes to vendor</div>
            <textarea id="detail-notes" ${this.canEdit() ? '' : 'readonly'} placeholder="Add a note explaining your decision..." style="width: 100%; padding: 11px 13px; border-radius: 9px; border: 1px solid #dcdce2; font-size: 14px; outline: none; resize: vertical; min-height: 90px; background: ${this.canEdit() ? '#fff' : '#faf9fa'};">${esc(this._detailNotesPrefill)}</textarea>
          </div>
        </div>
        ${this.canEdit() ? `<div style="padding: 18px 26px; border-top: 1px solid #f0f0f3; display: flex; gap: 10px;">
          <button onclick="App.decideReorder('rejected')" class="hv-red" style="flex: 1; padding: 11px; border-radius: 9px; border: 1px solid #f0d3d3; background: #fff; color: #a01f1f; font-size: 14px; font-weight: 600; cursor: pointer;">Reject</button>
          <button onclick="App.decideReorder('approved')" class="hv-darkgreen" style="flex: 1; padding: 11px; border-radius: 9px; border: none; background: #1b6b3a; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer;">Approve</button>
        </div>` : `<div style="padding: 16px 26px; border-top: 1px solid #f0f0f3; font-size: 12.5px; color: #a2a2ac; text-align: center;">View-only access — you can't approve or reject.</div>`}
      </div>
    </div>`;
  },
  async decideReorder(decision) {
    const id = this.state.detailId;
    const notes = document.getElementById('detail-notes').value;
    await this.api(`/api/admin/reorders/${id}/decide`, { json: { decision, notes } });
    this.state.detailId = null;
    await this.refreshData();
    this.showToast(decision === 'approved' ? 'Reorder approved' : 'Reorder rejected');
  },

  // admin: record payment
  renderRecordPayModal() {
    const today = new Date().toISOString().slice(0, 10);
    const vendorOpts = this.data.vendors.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join('');
    return `
    <div onclick="App.set({showRecordPay:false})" style="position: fixed; inset: 0; z-index: 100; background: rgba(24,20,26,0.42); display: flex; align-items: center; justify-content: center; padding: 24px; animation: fadeIn 0.18s ease;">
      <div onclick="event.stopPropagation()" style="width: 100%; max-width: 460px; background: #fff; border-radius: 16px; box-shadow: 0 24px 70px rgba(0,0,0,0.28); overflow: hidden;">
        <div style="padding: 20px 24px; border-bottom: 1px solid #f0f0f3;">
          <div style="font-size: 17px; font-weight: 600;">Record New Payment</div>
          <div style="font-size: 13px; color: #9a9aa2; margin-top: 3px;">Log a payment sent to a vendor for confirmation.</div>
        </div>
        <div style="padding: 22px 24px; display: flex; flex-direction: column; gap: 16px;">
          <div>
            <div style="font-size: 12.5px; color: #6b6b76; margin-bottom: 6px; font-weight: 500;">Vendor</div>
            <select id="rp-vendor" style="width: 100%; padding: 10px 13px; border-radius: 9px; border: 1px solid #dcdce2; font-size: 14px; outline: none; background: #fff;">
              <option value="">Select vendor...</option>${vendorOpts}
            </select>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
            <div>
              <div style="font-size: 12.5px; color: #6b6b76; margin-bottom: 6px; font-weight: 500;">Invoice Ref</div>
              <input id="rp-ref" placeholder="INV-2026-0430" style="width: 100%; padding: 10px 13px; border-radius: 9px; border: 1px solid #dcdce2; font-size: 14px; outline: none; font-family: 'IBM Plex Mono', monospace;" />
            </div>
            <div>
              <div style="font-size: 12.5px; color: #6b6b76; margin-bottom: 6px; font-weight: 500;">Amount (₹)</div>
              <input id="rp-amount" type="number" placeholder="150000" style="width: 100%; padding: 10px 13px; border-radius: 9px; border: 1px solid #dcdce2; font-size: 14px; outline: none;" />
            </div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
            <div>
              <div style="font-size: 12.5px; color: #6b6b76; margin-bottom: 6px; font-weight: 500;">Date</div>
              <input id="rp-date" type="date" value="${today}" style="width: 100%; padding: 10px 13px; border-radius: 9px; border: 1px solid #dcdce2; font-size: 14px; outline: none;" />
            </div>
            <div>
              <div style="font-size: 12.5px; color: #6b6b76; margin-bottom: 6px; font-weight: 500;">Reference No.</div>
              <input id="rp-utr" placeholder="UTR..." style="width: 100%; padding: 10px 13px; border-radius: 9px; border: 1px solid #dcdce2; font-size: 14px; outline: none; font-family: 'IBM Plex Mono', monospace;" />
            </div>
          </div>
        </div>
        <div style="padding: 16px 24px; border-top: 1px solid #f0f0f3; display: flex; justify-content: flex-end; gap: 10px;">
          <button onclick="App.set({showRecordPay:false})" style="padding: 9px 16px; border-radius: 9px; border: 1px solid #e4e4ea; background: #fff; color: #52525b; font-size: 14px; font-weight: 500; cursor: pointer;">Cancel</button>
          <button onclick="App.submitRecordPay()" class="hv-primary" style="padding: 9px 18px; border-radius: 9px; border: none; background: #6c2a57; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer;">Record Payment</button>
        </div>
      </div>
    </div>`;
  },
  async submitRecordPay() {
    const vendor = document.getElementById('rp-vendor').value;
    const ref = document.getElementById('rp-ref').value.trim();
    const amount = document.getElementById('rp-amount').value;
    const date = document.getElementById('rp-date').value;
    const utr = document.getElementById('rp-utr').value.trim();
    if (!vendor || !ref || !amount) { this.showToast('Vendor, invoice ref and amount are required'); return; }
    await this.api('/api/admin/payments', { json: { vendor, ref, amount, date, utr } });
    this.state.showRecordPay = false;
    await this.refreshData();
    this.showToast('Payment recorded');
  },

  // admin: resolve dispute
  openResolve(id) { this.set({ resolveId: id }); },
  renderResolveModal() {
    const p = this.data.payments.find((x) => x.id === this.state.resolveId);
    if (!p) return '';
    return `
    <div onclick="App.set({resolveId:null})" style="position: fixed; inset: 0; z-index: 100; background: rgba(24,20,26,0.42); display: flex; align-items: center; justify-content: center; padding: 24px; animation: fadeIn 0.18s ease;">
      <div onclick="event.stopPropagation()" style="width: 100%; max-width: 440px; background: #fff; border-radius: 16px; box-shadow: 0 24px 70px rgba(0,0,0,0.28); overflow: hidden;">
        <div style="padding: 22px 24px 4px;">
          <div style="font-size: 17px; font-weight: 600;">Resolve Dispute</div>
          <div style="font-size: 13.5px; color: #6b6b76; margin-top: 8px; line-height: 1.5;">Mark <span style="font-family: 'IBM Plex Mono', monospace; color: #6c2a57;">${esc(p.ref)}</span> (${this.money(p.amount)}) from ${esc(this.vendorName(p.vendor))} as resolved and confirmed.</div>
        </div>
        <div style="padding: 16px 24px 22px;">
          <div style="font-size: 12.5px; color: #6b6b76; margin-bottom: 6px; font-weight: 500;">Resolution note</div>
          <textarea id="resolve-note" placeholder="Describe how this was resolved..." style="width: 100%; padding: 10px 13px; border-radius: 9px; border: 1px solid #dcdce2; font-size: 14px; outline: none; resize: vertical; min-height: 70px;"></textarea>
        </div>
        <div style="padding: 16px 24px; border-top: 1px solid #f0f0f3; display: flex; justify-content: flex-end; gap: 10px;">
          <button onclick="App.set({resolveId:null})" style="padding: 9px 16px; border-radius: 9px; border: 1px solid #e4e4ea; background: #fff; color: #52525b; font-size: 14px; font-weight: 500; cursor: pointer;">Cancel</button>
          <button onclick="App.submitResolve()" class="hv-primary" style="padding: 9px 18px; border-radius: 9px; border: none; background: #6c2a57; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer;">Resolve & Confirm</button>
        </div>
      </div>
    </div>`;
  },
  async submitResolve() {
    const note = document.getElementById('resolve-note').value.trim();
    await this.api(`/api/admin/payments/${this.state.resolveId}/resolve`, { json: { note } });
    this.state.resolveId = null;
    await this.refreshData();
    this.showToast('Dispute resolved');
  },

  // admin: add / edit vendor
  openAddVendor() { this.set({ vendorForm: { name: '', email: '', status: 'active' } }); },
  openEditVendor(id) {
    const v = this.data.vendors.find((x) => x.id === id);
    this.set({ vendorForm: { id: v.id, name: v.name, email: v.email, status: v.status } });
  },
  renderVendorFormModal() {
    const f = this.state.vendorForm;
    return `
    <div onclick="App.set({vendorForm:null})" style="position: fixed; inset: 0; z-index: 100; background: rgba(24,20,26,0.42); display: flex; align-items: center; justify-content: center; padding: 24px; animation: fadeIn 0.18s ease;">
      <div onclick="event.stopPropagation()" style="width: 100%; max-width: 440px; background: #fff; border-radius: 16px; box-shadow: 0 24px 70px rgba(0,0,0,0.28); overflow: hidden;">
        <div style="padding: 20px 24px; border-bottom: 1px solid #f0f0f3;">
          <div style="font-size: 17px; font-weight: 600;">${f.id ? 'Edit Vendor' : 'Add Vendor'}</div>
        </div>
        <div style="padding: 22px 24px; display: flex; flex-direction: column; gap: 16px;">
          <div>
            <div style="font-size: 12.5px; color: #6b6b76; margin-bottom: 6px; font-weight: 500;">Vendor Name</div>
            <input id="vf-name" value="${esc(f.name)}" placeholder="e.g. Nakshatra Crafts" style="width: 100%; padding: 10px 13px; border-radius: 9px; border: 1px solid #dcdce2; font-size: 14px; outline: none;" />
          </div>
          <div>
            <div style="font-size: 12.5px; color: #6b6b76; margin-bottom: 6px; font-weight: 500;">Email</div>
            <input id="vf-email" value="${esc(f.email)}" placeholder="orders@vendor.in" style="width: 100%; padding: 10px 13px; border-radius: 9px; border: 1px solid #dcdce2; font-size: 14px; outline: none;" />
          </div>
          <div>
            <div style="font-size: 12.5px; color: #6b6b76; margin-bottom: 6px; font-weight: 500;">Status</div>
            <select id="vf-status" style="width: 100%; padding: 10px 13px; border-radius: 9px; border: 1px solid #dcdce2; font-size: 14px; outline: none; background: #fff;">
              <option value="active" ${f.status === 'active' ? 'selected' : ''}>Active</option>
              <option value="suspended" ${f.status === 'suspended' ? 'selected' : ''}>Suspended</option>
            </select>
          </div>
        </div>
        <div style="padding: 16px 24px; border-top: 1px solid #f0f0f3; display: flex; justify-content: flex-end; gap: 10px;">
          <button onclick="App.set({vendorForm:null})" style="padding: 9px 16px; border-radius: 9px; border: 1px solid #e4e4ea; background: #fff; color: #52525b; font-size: 14px; font-weight: 500; cursor: pointer;">Cancel</button>
          <button onclick="App.submitVendor()" class="hv-primary" style="padding: 9px 18px; border-radius: 9px; border: none; background: #6c2a57; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer;">Save Vendor</button>
        </div>
      </div>
    </div>`;
  },
  async submitVendor() {
    const f = this.state.vendorForm;
    const name = document.getElementById('vf-name').value.trim();
    const email = document.getElementById('vf-email').value.trim();
    const status = document.getElementById('vf-status').value;
    if (!name || !email) { this.showToast('Name and email are required'); return; }
    if (f.id) {
      await this.api(`/api/admin/vendors/${f.id}`, { method: 'PUT', json: { name, email, status } });
    } else {
      await this.api('/api/admin/vendors', { json: { name, email, status } });
    }
    this.state.vendorForm = null;
    await this.refreshData();
    this.showToast(f.id ? 'Vendor updated' : 'Vendor added');
  },
  async toggleVendor(id) {
    const v = this.data.vendors.find((x) => x.id === id);
    const suspending = v.status === 'active';
    await this.api(`/api/admin/vendors/${id}/toggle`);
    await this.refreshData();
    this.showToast(suspending ? 'Vendor suspended' : 'Vendor reactivated');
  },
};

window.App = App;
App.init();
