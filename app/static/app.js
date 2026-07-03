/* Mirraw Vendor Hub — glass UI frontend, wired to the Flask API.
   Auth: access JWT + rotating refresh + CSRF (see app/tokens.py). */
'use strict';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const REJECT_REASONS = ['Out of stock', 'Product discontinued', 'Cost price too low', 'Insufficient production capacity', 'Lead time too short', 'Design/material unavailable', 'Other (please specify)'];
const PARTIAL_REASONS = ['Limited stock on hand', 'Awaiting restock', 'Limited production capacity', 'Material / fabric shortage', 'Other (please specify)'];

const STATUS = {
  new: ['b-plum', 'New'], accepted: ['b-ok', 'Accepted'], partial: ['b-warn', 'Partial'], rejected: ['b-bad', 'Rejected'],
  'Pending Confirmation': ['b-warn', 'Pending'], Confirmed: ['b-ok', 'Confirmed'], Disputed: ['b-bad', 'Disputed'],
  active: ['b-ok', 'Active'], suspended: ['b-bad', 'Suspended'],
};

const App = {
  user: null, data: null, csrf: null, loginError: null,
  state: {
    portal: 'vendor', authMode: 'signin', screen: 'dashboard',
    reorderSubtab: 'new',
    aReStatus: 'all', aReVendor: 'all', aPayStatus: 'all', aPayVendor: 'all', auditActor: 'all',
    acceptId: null, rejectId: null, payAction: null, showRecordPay: false, resolveId: null,
    vendorForm: null, editingProfile: false, lightbox: null,
  },

  // ── bootstrap / networking ──────────────────────────────────────────
  async init() {
    let me = await (await fetch('/api/me')).json();
    if (!me.user && await this.tryRefresh()) me = await (await fetch('/api/me')).json();
    this.user = me.user; this.csrf = me.csrf;
    if (this.user) { this.state.portal = this.user.role; await this.refreshData(false); }
    this.render();
  },
  async tryRefresh() {
    const r = await fetch('/auth/refresh', { method: 'POST' });
    if (!r.ok) return false;
    const j = await r.json().catch(() => ({}));
    this.csrf = j.csrf || this.csrf; if (j.user) this.user = j.user; return true;
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
      if (j.code === 'expired' && await this.tryRefresh()) res = await this._send(path, opts);
      else { this.forceLogout(); throw new Error('session'); }
    }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { this.showToast(j.error || 'Something went wrong'); throw new Error(j.error || res.status); }
    return j;
  },
  _send(path, opts) {
    const headers = { ...(opts.headers || {}) };
    let body = opts.body;
    if (opts.json !== undefined) { body = JSON.stringify(opts.json); headers['Content-Type'] = 'application/json'; }
    if (this.csrf) headers['X-CSRF-Token'] = this.csrf;
    return fetch(path, { method: opts.method || 'POST', body, headers });
  },

  // Instant click feedback: press → spinner/disabled → re-render (or restore on error)
  async btnRun(btn, fn) {
    if (btn.dataset.busy) return;
    btn.dataset.busy = '1';
    const html = btn.innerHTML, dark = !btn.classList.contains('btn-primary') && !btn.classList.contains('btn-solid-green') && !btn.classList.contains('btn-solid-red');
    btn.disabled = true;
    btn.innerHTML = `<span class="spin${dark ? ' spin-dark' : ''}"></span>${btn.dataset.loading || ''}`;
    try { await fn(); }
    catch (e) { /* toast already shown */ }
    finally { if (document.body.contains(btn)) { btn.disabled = false; btn.innerHTML = html; delete btn.dataset.busy; } }
  },

  // ── helpers ─────────────────────────────────────────────────────────
  money(n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); },
  num(n) { return Number(n || 0).toLocaleString('en-IN'); },
  fmtDate(d) {
    if (!d) return '—';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d));
    if (m) return +m[3] + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1];
    return String(d);
  },
  vendorName(id) { const v = (this.data.vendors || []).find((x) => x.id === id); return v ? v.name : '—'; },
  badge(status) {
    const [cls, label] = STATUS[status] || ['b-warn', status || '—'];
    return `<span class="badge ${cls}"><span class="dot"></span>${esc(label)}</span>`;
  },
  img(d, size = 76) {
    const s = `width:${size}px;height:${size}px;`;
    if (d.image) return `<div class="pimg" style="${s}background-image:url('${esc(d.image)}')" onclick="App.openImg('${esc(d.image)}')" title="View full size"></div>`;
    return `<div class="pimg ph" style="${s}"></div>`;
  },
  openImg(url) { this.state.lightbox = url; this.renderModals(); },
  showToast(msg) {
    if (this._t) clearTimeout(this._t);
    document.getElementById('toast-root').innerHTML = `<div class="toast"><div class="inner"><span style="width:18px;height:18px;border-radius:50%;background:#2e9e58;color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">✓</span>${esc(msg)}</div></div>`;
    this._t = setTimeout(() => { document.getElementById('toast-root').innerHTML = ''; }, 2800);
  },
  set(patch) { Object.assign(this.state, patch); this.render(); },
  canEdit() { return this.user.role === 'vendor' || !!this.user.canEdit; },

  // ── auth / nav ──────────────────────────────────────────────────────
  togglePortal() { this.loginError = null; this.set({ portal: this.state.portal === 'vendor' ? 'admin' : 'vendor', authMode: 'signin' }); },
  setAuthMode(m) { this.loginError = null; this.set({ authMode: m }); },
  goTo(k) { this.set({ screen: k }); },
  async doLogout() {
    await fetch('/auth/logout', { method: 'POST', headers: this.csrf ? { 'X-CSRF-Token': this.csrf } : {} });
    this.user = null; this.data = null; this.csrf = null; this.render();
  },
  async submitAuth() {
    const isVendor = this.state.portal === 'vendor';
    const signup = this.state.authMode === 'signup';
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const payload = { email, password };
    let path;
    if (signup) {
      payload.name = document.getElementById('auth-name').value.trim();
      if (isVendor) { payload.vendorId = document.getElementById('auth-vid').value.trim(); path = '/auth/vendor/signup'; }
      else path = '/auth/admin/signup';
    } else path = isVendor ? '/auth/vendor/login' : '/auth/admin/login';
    this.loginError = null;
    let res, j;
    try {
      res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      j = await res.json().catch(() => ({}));
    } catch (e) { this.loginError = 'Network error — is the server running?'; this.render(); throw e; }
    if (!res.ok) { this.loginError = j.error || 'Something went wrong'; this.render(); throw new Error(j.error); }
    this.user = j.user; this.csrf = j.csrf;
    this.state.portal = this.user.role; this.state.screen = 'dashboard';
    await this.refreshData();
  },

  render() {
    const root = document.getElementById('root');
    if (!this.user || !this.data) root.innerHTML = this.renderLogin();
    else root.innerHTML = this.renderApp();
    this.renderModals();
  },

  // ── login ───────────────────────────────────────────────────────────
  renderLogin() {
    const isVendor = this.state.portal === 'vendor';
    const signup = this.state.authMode === 'signup';
    const err = this.loginError ? `<div style="width:100%;box-sizing:border-box;text-align:center;font-size:13px;color:var(--bad);background:var(--bad-bg);border-radius:11px;padding:10px 14px">${esc(this.loginError)}</div>` : '';
    const field = (label, input) => `<div class="field"><div class="label">${label}</div>${input}</div>`;
    const nameField = signup ? field(isVendor ? 'Business / Vendor Name' : 'Full Name', `<input id="auth-name" class="input" placeholder="${isVendor ? 'e.g. Anokhi Textiles' : 'e.g. Priya Menon'}"/>`) : '';
    const vidField = (signup && isVendor) ? field('Vendor ID <span style="color:var(--faint);font-weight:400">(from Mirraw)</span>', `<input id="auth-vid" class="input mono" placeholder="e.g. 8i59121213"/>`) : '';
    const kd = "onkeydown=\"if(event.key==='Enter')App.btnRun(document.getElementById('auth-go'),()=>App.submitAuth())\"";
    return `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px">
      <div style="width:100%;max-width:410px;display:flex;flex-direction:column;align-items:center;gap:24px">
        <div style="display:flex;flex-direction:column;align-items:center;gap:13px">
          <div style="width:52px;height:52px;border-radius:15px;background:var(--plum);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:26px;box-shadow:0 10px 26px rgba(108,42,87,.34)">M</div>
          <div style="text-align:center">
            <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--faint);font-weight:700">Mirraw</div>
            <div style="font-size:23px;font-weight:600;margin-top:2px">Vendor Hub</div>
          </div>
        </div>
        <div class="glass-strong" style="width:100%;padding:30px;display:flex;flex-direction:column;align-items:center;gap:18px">
          <div style="text-align:center;display:flex;flex-direction:column;gap:5px">
            <div style="font-size:19px;font-weight:600">${isVendor ? 'Vendor Portal' : 'Admin Portal'}</div>
            <div style="font-size:14px;color:var(--muted);line-height:1.5">${isVendor ? 'Manage your reorders and payments with Mirraw.' : 'Operations console for the Mirraw marketplace.'}</div>
          </div>
          <div style="width:100%;display:inline-flex;padding:4px;background:rgba(120,90,110,.09);border-radius:12px">
            <button onclick="App.setAuthMode('signin')" class="btn ${!signup ? 'btn-primary' : ''} btn-block btn-sm" style="${!signup ? '' : 'background:transparent;box-shadow:none;color:var(--muted)'}">Sign In</button>
            <button onclick="App.setAuthMode('signup')" class="btn ${signup ? 'btn-primary' : ''} btn-block btn-sm" style="${signup ? '' : 'background:transparent;box-shadow:none;color:var(--muted)'}">Sign Up</button>
          </div>
          ${err}${nameField}${vidField}
          ${field('Email', `<input id="auth-email" class="input" type="email" placeholder="you@company.com" ${kd}/>`)}
          ${field('Password', `<input id="auth-password" class="input" type="password" placeholder="${signup ? 'At least 6 characters' : 'Your password'}" ${kd}/>`)}
          <button id="auth-go" onclick="App.btnRun(this,()=>App.submitAuth())" class="btn btn-primary btn-block" style="padding:12px" data-loading="">${signup ? 'Create Account' : 'Sign In'}</button>
          <div style="font-size:12px;color:var(--faint);text-align:center">${isVendor ? 'Vendors sign in with their own email.' : 'Mirraw staff only. New accounts start view-only.'}</div>
        </div>
        <button onclick="App.togglePortal()" class="btn btn-ghost btn-sm" style="background:transparent;border:none;color:var(--plum)">${isVendor ? 'Switch to Admin Portal →' : 'Switch to Vendor Portal →'}</button>
      </div>
    </div>`;
  },

  // ── app shell ───────────────────────────────────────────────────────
  renderApp() {
    const s = this.state, u = this.user;
    const isVendor = u.role === 'vendor';
    const titles = { dashboard: 'Dashboard', reorders: 'Reorder Requests', payments: 'Payments', profile: 'Profile', vendors: 'Vendors', audit: 'Audit Log', access: 'Team Access' };
    const navKeys = isVendor ? ['dashboard', 'reorders', 'payments', 'profile']
      : ['dashboard', 'reorders', 'payments', 'vendors', 'audit', ...(u.isMaster ? ['access'] : [])];
    const nav = navKeys.map((k) => `<div onclick="App.goTo('${k}')" class="nav-item ${s.screen === k ? 'on' : ''}"><span class="dot"></span><span>${titles[k]}</span></div>`).join('');

    const roleBadge = (!isVendor && u.adminRole) ? { master: 'Master', editor: 'Editor', viewer: 'View-only' }[u.adminRole] : null;
    let screen = '';
    if (s.screen === 'dashboard') screen = isVendor ? this.vDashboard() : this.aDashboard();
    else if (s.screen === 'reorders') screen = isVendor ? this.vReorders() : this.aReorders();
    else if (s.screen === 'payments') screen = isVendor ? this.vPayments() : this.aPayments();
    else if (s.screen === 'profile') screen = this.vProfile();
    else if (s.screen === 'vendors') screen = this.aVendors();
    else if (s.screen === 'audit') screen = this.aAudit();
    else if (s.screen === 'access') screen = this.aAccess();

    const banner = (!isVendor && !this.canEdit()) ? `<div class="glass" style="max-width:1120px;margin-bottom:20px;display:flex;align-items:center;gap:11px;padding:13px 16px;font-size:13.5px;color:var(--warn);background:rgba(251,238,209,.6)"><span style="font-size:16px">👁️</span> You have <b style="margin:0 3px">view-only</b> access — ask the master admin for edit rights to take actions.</div>` : '';

    return `
    <div style="display:flex;min-height:100vh">
      <aside class="glass" style="width:250px;flex-shrink:0;margin:14px;border-radius:20px;display:flex;flex-direction:column;position:sticky;top:14px;height:calc(100vh - 28px)">
        <div style="padding:20px 18px 16px;display:flex;align-items:center;gap:11px;border-bottom:1px solid var(--line)">
          <div style="width:34px;height:34px;border-radius:10px;background:var(--plum);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;flex-shrink:0">M</div>
          <div style="min-width:0"><div style="font-size:14px;font-weight:600;line-height:1.1">Mirraw</div><div style="font-size:11px;color:var(--faint);font-weight:600">${isVendor ? 'Vendor Portal' : 'Admin Portal'}</div></div>
        </div>
        <nav style="flex:1;padding:14px 12px;display:flex;flex-direction:column;gap:4px">${nav}</nav>
        <div style="padding:12px;border-top:1px solid var(--line)">
          <div style="display:flex;align-items:center;gap:10px;padding:6px 8px">
            <div style="width:32px;height:32px;border-radius:50%;background:var(--plum-tint);color:var(--plum);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:13px;flex-shrink:0">${esc(u.initials)}</div>
            <div style="min-width:0;flex:1"><div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(u.name)}</div><div style="font-size:11px;color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(u.email)}</div></div>
          </div>
          <button onclick="App.doLogout()" class="btn btn-ghost btn-block btn-sm" style="margin-top:6px;background:transparent;border:none;justify-content:flex-start;color:var(--muted)">Sign out</button>
        </div>
      </aside>
      <div style="flex:1;min-width:0;display:flex;flex-direction:column">
        <header style="height:64px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:0 30px 0 20px;position:sticky;top:0;z-index:20">
          <div style="font-size:18px;font-weight:600">${titles[s.screen]}</div>
          <div style="display:flex;align-items:center;gap:12px">
            ${roleBadge ? `<span class="badge ${u.canEdit ? 'b-ok' : 'b-warn'}"><span class="dot"></span>${roleBadge}</span>` : ''}
            <span class="badge b-plum" style="text-transform:uppercase;letter-spacing:.04em;font-size:11px">${isVendor ? 'Vendor' : 'Admin'}</span>
            <div style="width:34px;height:34px;border-radius:50%;background:var(--plum-tint);color:var(--plum);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:13px">${esc(u.initials)}</div>
          </div>
        </header>
        <div style="flex:1;padding:14px 30px 60px;overflow-y:auto">${banner}${screen}</div>
      </div>
    </div>`;
  },

  kpi(label, value, tone, sub) {
    const tones = { amber: 'var(--warn-dot)', green: 'var(--ok-dot)', red: 'var(--bad-dot)', plum: 'var(--plum)' };
    return `<div class="glass" style="padding:18px 18px 16px;position:relative;overflow:hidden">
      <div style="position:absolute;top:0;left:0;width:3px;height:100%;background:${tones[tone]}"></div>
      <div style="font-size:13px;color:var(--muted);font-weight:500">${esc(label)}</div>
      <div style="font-size:30px;font-weight:700;margin:8px 0 3px;letter-spacing:-.02em">${esc(value)}</div>
      <div style="font-size:12px;color:var(--faint)">${esc(sub)}</div></div>`;
  },
  panel(title, right, body) {
    return `<div class="glass" style="overflow:hidden">
      <div style="padding:16px 20px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:15px;font-weight:600">${title}</span>${right || ''}</div>${body}</div>`;
  },
  emptyRow(title, sub) { return `<div class="empty"><b>${title}</b><span>${sub}</span></div>`; },

  // ── VENDOR: dashboard ───────────────────────────────────────────────
  vDashboard() {
    const d = this.data, now = new Date();
    const mp = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const nw = d.demands.filter((x) => x.status === 'new').length;
    const acc = d.demands.filter((x) => x.status === 'accepted' || x.status === 'partial').length;
    const payPend = d.payments.filter((p) => p.status === 'Pending Confirmation').length;
    const conf = d.payments.filter((p) => p.status === 'Confirmed' && String(p.date).startsWith(mp)).length;
    const cards = [
      this.kpi('New Requests', nw, 'amber', 'awaiting your response'),
      this.kpi('Accepted', acc, 'green', 'confirmed to Mirraw'),
      this.kpi('Payments to Confirm', payPend, 'amber', 'check your account'),
      this.kpi('Confirmed · ' + MONTHS_FULL[now.getMonth()], conf, 'green', String(now.getFullYear())),
    ].join('');
    const acts = d.audit.slice(0, 7).map((a) => `<div class="trow" style="display:flex;gap:13px"><span style="width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${a.actor.includes('Admin') ? 'var(--plum)' : 'var(--ok-dot)'}"></span><div style="flex:1;min-width:0;font-size:14px">${esc(a.actor)} ${esc(a.action)} <span class="mono b-plum badge" style="padding:1px 7px">${esc(a.target)}</span></div><div style="font-size:12px;color:var(--faint);white-space:nowrap">${esc(a.ts)}</div></div>`).join('');
    return `<div style="max-width:1120px">
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px">${cards}</div>
      ${this.panel('Recent Activity', '', d.audit.length ? acts : this.emptyRow('No activity yet', 'Your reorder responses and payment updates will show here.'))}
    </div>`;
  },

  // ── VENDOR: reorders (New / Updates) ────────────────────────────────
  vReorders() {
    const s = this.state, ds = this.data.demands;
    const news = ds.filter((d) => d.status === 'new'), upd = ds.filter((d) => d.status !== 'new');
    const isNew = s.reorderSubtab === 'new';
    const tab = (k, label, n, on) => `<button onclick="App.set({reorderSubtab:'${k}'})" class="btn btn-sm ${on ? '' : ''}" style="${on ? 'background:#fff;box-shadow:var(--shadow)' : 'background:transparent;box-shadow:none;color:var(--muted)'}">${label} <span class="badge ${on ? 'b-plum' : ''}" style="padding:1px 7px;${on ? '' : 'background:rgba(120,90,110,.1);color:var(--faint)'}">${n}</span></button>`;
    let body;
    if (isNew) {
      const rows = news.map((d) => `<div class="trow" style="display:grid;grid-template-columns:88px 130px 110px 1fr 110px 70px 200px;gap:14px;min-width:940px">
        ${this.img(d)}
        <div class="mono" style="font-size:12.5px;color:var(--plum)">${esc(d.sku)}</div>
        <div class="mono" style="font-size:12px;color:var(--faint)">${esc(d.pid)}</div>
        <div style="font-weight:500">${esc(d.type)}</div>
        <div>${this.money(d.cost)}</div>
        <div style="font-weight:700">${this.num(d.qty)}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button onclick="App.openAccept('${d.id}')" class="btn btn-success btn-sm">Accept</button>
          <button onclick="App.openReject('${d.id}')" class="btn btn-danger btn-sm">Reject</button>
        </div></div>`).join('');
      body = `<div style="font-size:13.5px;color:var(--muted);margin-bottom:14px">Reorder demands from Mirraw. Tap the image to enlarge. Accept and say how many you can supply, or reject with a reason.</div>
        ${this.panel(`<div class="thead" style="display:grid;grid-template-columns:88px 130px 110px 1fr 110px 70px 200px;gap:14px;min-width:940px;padding:0;background:none;border:none;text-transform:none;letter-spacing:0;color:#8a8a94"><span>Image</span><span>SKU</span><span>PID</span><span>Product</span><span>Cost</span><span>Qty</span><span style="text-align:right">Response</span></div>`, '',
        news.length ? rows : this.emptyRow('All caught up', 'No new reorder demands right now.'))}`;
    } else {
      const rows = upd.map((d) => {
        const detail = d.status === 'rejected' ? d.reason : (d.status === 'partial' ? d.remark : 'Full quantity confirmed');
        const fulfill = (d.status === 'accepted' || d.status === 'partial') ? `${d.fulfillQty} / ${d.qty}` : '—';
        return `<div class="trow" style="display:grid;grid-template-columns:88px 130px 1fr 120px 100px 1.2fr 90px;gap:14px;min-width:1000px">
          ${this.img(d, 64)}
          <div class="mono" style="font-size:12.5px;color:var(--plum)">${esc(d.sku)}</div>
          <div style="font-weight:500">${esc(d.type)}</div>
          <div>${this.badge(d.status)}</div>
          <div style="color:#52525b">${esc(fulfill)}</div>
          <div style="color:var(--muted);font-size:13px">${esc(detail || '—')}</div>
          <div style="display:flex;justify-content:flex-end"><button onclick="App.editDemand('${d.id}')" class="btn btn-ghost btn-sm">Edit</button></div></div>`;
      }).join('');
      body = `<div style="font-size:13.5px;color:var(--muted);margin-bottom:14px">Your submitted responses. Tap Edit to revise and resubmit any of them.</div>
        ${this.panel(`<div class="thead" style="display:grid;grid-template-columns:88px 130px 1fr 120px 100px 1.2fr 90px;gap:14px;min-width:1000px;padding:0;background:none;border:none;text-transform:none;letter-spacing:0;color:#8a8a94"><span>Image</span><span>SKU</span><span>Product</span><span>Response</span><span>Fulfilled</span><span>Details</span><span></span></div>`, '',
        upd.length ? rows : this.emptyRow('Nothing yet', 'Accepted and rejected demands appear here.'))}`;
    }
    return `<div style="max-width:1120px">
      <div style="display:inline-flex;padding:4px;background:rgba(120,90,110,.08);border-radius:12px;margin-bottom:20px;gap:2px">${tab('new', 'New Requests', news.length, isNew)}${tab('updates', 'Updates', upd.length, !isNew)}</div>
      ${body}</div>`;
  },

  openAccept(id) { const d = this.data.demands.find((x) => x.id === id); this._acc = { qty: (d.status === 'accepted' || d.status === 'partial') ? String(d.fulfillQty) : '', reason: PARTIAL_REASONS.includes(d.remark) ? d.remark : (d.remark ? 'Other (please specify)' : ''), other: (d.remark && !PARTIAL_REASONS.includes(d.remark)) ? d.remark : '' }; this.set({ acceptId: id, rejectId: null }); },
  openReject(id) { const d = this.data.demands.find((x) => x.id === id); const known = REJECT_REASONS.includes(d.reason); this._rej = { reason: d.status === 'rejected' ? (known ? d.reason : 'Other (please specify)') : '', other: (d.status === 'rejected' && !known) ? d.reason : '' }; this.set({ rejectId: id, acceptId: null }); },
  editDemand(id) { const d = this.data.demands.find((x) => x.id === id); if (d.status === 'rejected') this.openReject(id); else this.openAccept(id); },

  onAcceptQty(reqQty) {
    const q = document.getElementById('acc-qty').value;
    const wrap = document.getElementById('acc-partial');
    const n = q === '' ? NaN : +q;
    if (!isNaN(n) && n === reqQty) wrap.innerHTML = `<div style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ok);font-weight:600"><span style="width:16px;height:16px;border-radius:50%;background:var(--ok-dot);color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px">✓</span> Supplying the full quantity.</div>`;
    else if (!isNaN(n) && n > 0 && n < reqQty) wrap.innerHTML = this._partialReasonHtml(reqQty - n);
    else wrap.innerHTML = '';
  },
  _partialReasonHtml(short) {
    const opts = PARTIAL_REASONS.map((r) => `<option ${this._acc.reason === r ? 'selected' : ''}>${esc(r)}</option>`).join('');
    const showOther = this._acc.reason === 'Other (please specify)';
    return `<div class="field"><div class="label" style="color:var(--warn)">Short by ${short} — why? (Mirraw will see this)</div>
      <select id="acc-reason" class="select" onchange="document.getElementById('acc-other-w').style.display=this.value==='Other (please specify)'?'block':'none'"><option value="">Select a reason…</option>${opts}</select>
      <div id="acc-other-w" style="display:${showOther ? 'block' : 'none'};margin-top:10px"><textarea id="acc-other" class="textarea" placeholder="Describe the reason…">${esc(this._acc.other)}</textarea></div></div>`;
  },
  renderAccept() {
    const d = this.data.demands.find((x) => x.id === this.state.acceptId); if (!d) return '';
    const partial = this._acc.qty !== '' && +this._acc.qty > 0 && +this._acc.qty < d.qty;
    const full = +this._acc.qty === d.qty;
    return this._modal('Accept Reorder', `<span class="mono" style="color:var(--plum)">${esc(d.sku)}</span> · ${esc(d.type)}`, `
      <div style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,.5);border:1px solid var(--line);border-radius:12px;padding:12px 14px">
        <span style="font-size:13px;color:var(--muted)">Quantity Mirraw needs</span><span style="font-size:16px;font-weight:700">${this.num(d.qty)}</span></div>
      <div class="field"><div class="label">How many can you supply?</div><input id="acc-qty" class="input" type="number" min="1" max="${d.qty}" value="${esc(this._acc.qty)}" placeholder="Enter quantity" oninput="App.onAcceptQty(${d.qty})"/></div>
      <div id="acc-partial">${partial ? this._partialReasonHtml(d.qty - +this._acc.qty) : (full ? '<div style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ok);font-weight:600"><span style="width:16px;height:16px;border-radius:50%;background:var(--ok-dot);color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px">✓</span> Supplying the full quantity.</div>' : '')}</div>`,
      `<button onclick="App.set({acceptId:null})" class="btn btn-ghost">Cancel</button><button onclick="App.btnRun(this,()=>App.submitAccept())" class="btn btn-solid-green">Submit</button>`, () => this.set({ acceptId: null }));
  },
  async submitAccept() {
    const d = this.data.demands.find((x) => x.id === this.state.acceptId);
    const q = document.getElementById('acc-qty').value;
    const n = q === '' ? NaN : +q;
    if (isNaN(n) || n < 1) { this.showToast('Enter how many you can supply'); return; }
    if (n > d.qty) { this.showToast('Cannot exceed the requested quantity (' + d.qty + ')'); return; }
    let remark = '';
    if (n < d.qty) {
      const sel = document.getElementById('acc-reason').value;
      if (!sel) { this.showToast('Pick a reason for the short quantity'); return; }
      const other = (document.getElementById('acc-other') || {}).value || '';
      if (sel === 'Other (please specify)' && !other.trim()) { this.showToast('Describe the reason'); return; }
      remark = sel === 'Other (please specify)' ? other.trim() : sel;
    }
    await this.api(`/api/vendor/demands/${d.id}/respond`, { json: { kind: 'accept', fulfillQty: n, remark } });
    this.state.acceptId = null; this.state.reorderSubtab = 'updates';
    await this.refreshData();
    this.showToast(n < d.qty ? 'Submitted (partial) — sent to Mirraw' : 'Submitted — sent to Mirraw');
  },
  renderReject() {
    const d = this.data.demands.find((x) => x.id === this.state.rejectId); if (!d) return '';
    const opts = REJECT_REASONS.map((r) => `<option ${this._rej.reason === r ? 'selected' : ''}>${esc(r)}</option>`).join('');
    const showOther = this._rej.reason === 'Other (please specify)';
    return this._modal('Reject Reorder', `<span class="mono" style="color:var(--plum)">${esc(d.sku)}</span> · ${esc(d.type)}`, `
      <div class="field"><div class="label">Reason for rejecting</div>
        <select id="rej-reason" class="select" onchange="document.getElementById('rej-other-w').style.display=this.value==='Other (please specify)'?'block':'none'"><option value="">Select a reason…</option>${opts}</select></div>
      <div id="rej-other-w" class="field" style="display:${showOther ? 'flex' : 'none'}"><div class="label">Please specify</div><textarea id="rej-other" class="textarea" placeholder="Describe your reason…">${esc(this._rej.other)}</textarea></div>`,
      `<button onclick="App.set({rejectId:null})" class="btn btn-ghost">Cancel</button><button onclick="App.btnRun(this,()=>App.submitReject())" class="btn btn-solid-red">Submit</button>`, () => this.set({ rejectId: null }));
  },
  async submitReject() {
    const d = this.data.demands.find((x) => x.id === this.state.rejectId);
    const sel = document.getElementById('rej-reason').value;
    if (!sel) { this.showToast('Select a reason for rejecting'); return; }
    const other = (document.getElementById('rej-other') || {}).value || '';
    if (sel === 'Other (please specify)' && !other.trim()) { this.showToast('Describe the reason'); return; }
    const reason = sel === 'Other (please specify)' ? other.trim() : sel;
    await this.api(`/api/vendor/demands/${d.id}/respond`, { json: { kind: 'reject', reason } });
    this.state.rejectId = null; this.state.reorderSubtab = 'updates';
    await this.refreshData();
    this.showToast('Rejected — sent to Mirraw');
  },

  // ── VENDOR: payments (confirm / dispute) ────────────────────────────
  vPayments() {
    const ps = this.data.payments;
    const rows = ps.map((p) => `<div class="trow" style="display:grid;grid-template-columns:150px 120px 130px 150px 1fr;gap:14px;min-width:820px">
      <div class="mono" style="font-size:12.5px;color:var(--plum)">${esc(p.ref)}</div>
      <div style="font-weight:600">${this.money(p.amount)}</div>
      <div style="color:var(--muted)">${this.fmtDate(p.date)}</div>
      <div class="mono" style="font-size:12px;color:var(--faint)">${esc(p.utr)}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">${this.badge(p.status)}
        ${p.status === 'Pending Confirmation' ? `<span style="display:flex;gap:8px"><button onclick="App.openPay('${p.id}','confirm')" class="btn btn-success btn-sm">Confirm</button><button onclick="App.openPay('${p.id}','dispute')" class="btn btn-danger btn-sm">Dispute</button></span>` : ''}</div></div>`).join('');
    return `<div style="max-width:1120px">
      <div style="font-size:13.5px;color:var(--muted);margin-bottom:14px">Payments Mirraw has sent you. Confirm the ones you've received, or dispute if something's wrong.</div>
      ${this.panel(`<div class="thead" style="display:grid;grid-template-columns:150px 120px 130px 150px 1fr;gap:14px;min-width:820px;padding:0;background:none;border:none;text-transform:none;letter-spacing:0;color:#8a8a94"><span>Invoice Ref</span><span>Amount</span><span>Date</span><span>Reference No.</span><span>Status</span></div>`, '',
      ps.length ? rows : this.emptyRow('No payments yet', 'Payments recorded by Mirraw will appear here to confirm.'))}</div>`;
  },
  openPay(id, kind) { this.set({ payAction: { id, kind } }); },
  renderPay() {
    const pa = this.state.payAction; if (!pa) return '';
    const p = this.data.payments.find((x) => x.id === pa.id); const conf = pa.kind === 'confirm';
    return this._modal(conf ? 'Confirm Payment' : 'Dispute Payment', '', `
      <div style="font-size:13.5px;color:var(--muted);line-height:1.5">${conf ? 'Confirm you have received this payment in full. Mirraw will be notified.' : 'Flag this payment as not received or incorrect. Mirraw will investigate.'}</div>
      <div style="background:rgba(255,255,255,.5);border:1px solid var(--line);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;justify-content:space-between"><span style="font-size:13px;color:var(--faint)">Invoice</span><span class="mono" style="font-size:13px;font-weight:600;color:var(--plum)">${esc(p.ref)}</span></div>
        <div style="display:flex;justify-content:space-between"><span style="font-size:13px;color:var(--faint)">Amount</span><span style="font-size:13px;font-weight:600">${this.money(p.amount)}</span></div></div>`,
      `<button onclick="App.set({payAction:null})" class="btn btn-ghost">Cancel</button><button onclick="App.btnRun(this,()=>App.submitPay())" class="btn ${conf ? 'btn-solid-green' : 'btn-solid-red'}">${conf ? 'Confirm Receipt' : 'Raise Dispute'}</button>`, () => this.set({ payAction: null }));
  },
  async submitPay() {
    const { id, kind } = this.state.payAction;
    await this.api(`/api/vendor/payments/${id}/action`, { json: { kind } });
    this.state.payAction = null; await this.refreshData();
    this.showToast(kind === 'confirm' ? 'Payment confirmed' : 'Payment disputed');
  },

  // ── VENDOR: profile ─────────────────────────────────────────────────
  vProfile() {
    const v = this.data.vendor || {}, editing = this.state.editingProfile;
    const ro = (label, val, mono) => `<div><div style="font-size:12.5px;color:var(--faint);margin-bottom:5px">${label}</div><div class="${mono ? 'mono' : ''}" style="font-size:14.5px;font-weight:500">${esc(val || '—')}</div></div>`;
    const body = editing ? `<div style="display:flex;flex-direction:column;gap:16px">
        <div class="field"><div class="label">Primary Contact</div><input id="pf-contact" class="input" value="${esc(v.contact)}"/></div>
        <div class="field"><div class="label">Phone</div><input id="pf-phone" class="input" value="${esc(v.phone)}"/></div>
        <div class="field"><div class="label">Address</div><textarea id="pf-address" class="textarea">${esc(v.address)}</textarea></div></div>`
      : `<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px 24px">${ro('Primary Contact', v.contact)}${ro('Phone', v.phone)}${ro('GSTIN', v.gstin, true)}${ro('Address', v.address)}</div>
         <button onclick="App.set({editingProfile:true})" class="btn btn-ghost btn-sm" style="margin-top:22px;color:var(--plum)">Edit Contact Info</button>`;
    return `<div style="max-width:720px"><div class="glass" style="overflow:hidden">
      <div style="padding:22px 24px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:16px">
        <div style="width:54px;height:54px;border-radius:15px;background:var(--plum-tint);color:var(--plum);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:20px">${esc(this.user.initials)}</div>
        <div style="flex:1"><div style="font-size:18px;font-weight:600">${esc(v.name || this.user.vendorName)}</div><div style="font-size:13.5px;color:var(--faint)">Vendor · ID <span class="mono">${esc(v.vendor_id || this.user.vendorCode || '—')}</span></div></div>
        ${editing ? `<button onclick="App.btnRun(this,()=>App.saveProfile())" class="btn btn-primary btn-sm">Save Changes</button>` : ''}
      </div>
      <div style="padding:24px">
        <div style="font-size:12px;font-weight:700;color:#8a8a94;text-transform:uppercase;letter-spacing:.04em;margin-bottom:14px">Account · from sign-up</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px 24px;margin-bottom:26px">${ro('Vendor Name', v.name || this.user.vendorName)}<div><div style="font-size:12.5px;color:var(--faint);margin-bottom:5px">Email</div><div style="display:flex;align-items:center;gap:8px"><span style="font-size:14.5px;font-weight:500">${esc(this.user.email)}</span></div></div></div>
        <div style="font-size:12px;font-weight:700;color:#8a8a94;text-transform:uppercase;letter-spacing:.04em;margin-bottom:14px">Contact Information</div>${body}
      </div></div></div>`;
  },
  async saveProfile() {
    await this.api('/api/vendor/profile', { method: 'PUT', json: { contact: document.getElementById('pf-contact').value, phone: document.getElementById('pf-phone').value, address: document.getElementById('pf-address').value } });
    this.state.editingProfile = false; await this.refreshData(); this.showToast('Profile updated');
  },

  // ── ADMIN: dashboard ────────────────────────────────────────────────
  aDashboard() {
    const d = this.data;
    const nw = d.demands.filter((x) => x.status === 'new').length;
    const short = d.demands.filter((x) => x.status === 'partial').length;
    const cards = [
      this.kpi('Total Vendors', d.vendors.length, 'plum', d.vendors.filter((v) => v.status === 'active').length + ' active'),
      this.kpi('Awaiting Response', nw, 'amber', 'vendors yet to reply'),
      this.kpi('Partial Fills', short, 'amber', 'short of requested qty'),
      this.kpi('Disputed Payments', d.payments.filter((p) => p.status === 'Disputed').length, 'red', 'need resolution'),
    ].join('');
    const attn = [];
    d.payments.filter((p) => p.status === 'Disputed').forEach((p) => attn.push({ tag: 'Dispute', c: 'b-bad', title: p.ref + ' · ' + this.money(p.amount), meta: this.vendorName(p.vendor), to: 'payments' }));
    d.demands.filter((x) => x.status === 'partial').slice(0, 4).forEach((x) => attn.push({ tag: 'Partial', c: 'b-warn', title: x.sku + ' · ' + x.type, meta: `${x.vendor_name} · ${x.fulfillQty}/${x.qty}`, to: 'reorders' }));
    const rows = attn.map((a) => `<div onclick="App.goTo('${a.to}')" class="trow hover" style="display:flex;gap:14px"><span class="badge ${a.c}" style="text-transform:uppercase;font-size:11px;letter-spacing:.03em"><span class="dot"></span>${a.tag}</span><div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:500">${esc(a.title)}</div><div style="font-size:12.5px;color:var(--faint)">${esc(a.meta)}</div></div><span style="color:#c4b8c1;font-size:18px">›</span></div>`).join('');
    return `<div style="max-width:1120px">
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px">${cards}</div>
      ${this.panel('Needs Attention', '<span style="font-size:12px;color:var(--faint)">Quick actions</span>', attn.length ? rows : this.emptyRow('All clear', 'No disputes or short fills right now.'))}</div>`;
  },

  // ── ADMIN: reorders (read-only view of vendor responses) ────────────
  aReorders() {
    const s = this.state, ds = this.data.demands;
    const chip = (label, val, cur, key) => `<button onclick="App.set({${key}:'${val}'})" class="chip ${val === cur ? 'on' : ''}">${label}</button>`;
    const chips = ['all', 'new', 'accepted', 'partial', 'rejected'].map((v) => chip(v === 'all' ? 'All' : (STATUS[v] ? STATUS[v][1] : v), v, s.aReStatus, 'aReStatus')).join('');
    const vopts = this.data.vendors.map((v) => `<option value="${v.vendor_id || v.id}" ${s.aReVendor === (v.vendor_id || v.id) ? 'selected' : ''}>${esc(v.name)}</option>`).join('');
    const list = ds.filter((x) => (s.aReStatus === 'all' || x.status === s.aReStatus) && (s.aReVendor === 'all' || x.vendor_id === s.aReVendor));
    const rows = list.map((x) => `<div class="trow" style="display:grid;grid-template-columns:70px 1.1fr 130px 1.2fr 80px 90px 130px;gap:12px;min-width:1000px">
      ${this.img(x, 52)}
      <div style="font-weight:500">${esc(x.vendor_name)}</div>
      <div class="mono" style="font-size:12.5px;color:var(--plum)">${esc(x.sku)}</div>
      <div style="color:#52525b">${esc(x.type)}</div>
      <div>${this.num(x.qty)}</div>
      <div style="color:#52525b">${x.status === 'accepted' || x.status === 'partial' ? x.fulfillQty + '/' + x.qty : '—'}</div>
      <div>${this.badge(x.status)}</div></div>`).join('');
    return `<div style="max-width:1120px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:18px">
        <div style="display:flex;gap:8px;flex-wrap:wrap">${chips}</div>
        <select onchange="App.set({aReVendor:this.value})" class="select" style="width:auto"><option value="all">All vendors</option>${vopts}</select></div>
      ${this.panel(`<div class="thead" style="display:grid;grid-template-columns:70px 1.1fr 130px 1.2fr 80px 90px 130px;gap:12px;min-width:1000px;padding:0;background:none;border:none;text-transform:none;letter-spacing:0;color:#8a8a94"><span>Image</span><span>Vendor</span><span>SKU</span><span>Product</span><span>Qty</span><span>Fulfilled</span><span>Response</span></div>`, '',
      list.length ? rows : this.emptyRow('No matching demands', 'Adjust the filters to see more.'))}</div>`;
  },

  // ── ADMIN: payments ─────────────────────────────────────────────────
  aPayments() {
    const s = this.state, ps = this.data.payments;
    const chip = (label, val) => `<button onclick="App.set({aPayStatus:'${val}'})" class="chip ${val === s.aPayStatus ? 'on' : ''}">${label}</button>`;
    const chips = chip('All', 'all') + chip('Pending', 'Pending Confirmation') + chip('Confirmed', 'Confirmed') + chip('Disputed', 'Disputed');
    const vopts = this.data.vendors.map((v) => `<option value="${v.id}" ${s.aPayVendor === v.id ? 'selected' : ''}>${esc(v.name)}</option>`).join('');
    const list = ps.filter((p) => (s.aPayStatus === 'all' || p.status === s.aPayStatus) && (s.aPayVendor === 'all' || p.vendor === s.aPayVendor));
    const rows = list.map((p) => `<div class="trow" style="display:grid;grid-template-columns:1.1fr 140px 120px 120px 140px 150px 90px;gap:12px;min-width:1000px">
      <div style="font-weight:500">${esc(this.vendorName(p.vendor))}</div>
      <div class="mono" style="font-size:12.5px;color:var(--plum)">${esc(p.ref)}</div>
      <div style="font-weight:600">${this.money(p.amount)}</div>
      <div style="color:var(--muted)">${this.fmtDate(p.date)}</div>
      <div class="mono" style="font-size:12px;color:var(--faint)">${esc(p.utr)}</div>
      <div>${this.badge(p.status)}</div>
      <div style="display:flex;justify-content:flex-end">${(p.status === 'Disputed' && this.canEdit()) ? `<button onclick="App.openResolve('${p.id}')" class="btn btn-ghost btn-sm" style="color:var(--plum)">Resolve</button>` : ''}</div></div>`).join('');
    const recordBtn = this.canEdit() ? `<button onclick="App.set({showRecordPay:true})" class="btn btn-primary btn-sm"><span style="font-size:16px">+</span> Record Payment</button>` : '';
    return `<div style="max-width:1120px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:18px">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${chips}<select onchange="App.set({aPayVendor:this.value})" class="select" style="width:auto;margin-left:4px"><option value="all">All vendors</option>${vopts}</select></div>${recordBtn}</div>
      ${this.panel(`<div class="thead" style="display:grid;grid-template-columns:1.1fr 140px 120px 120px 140px 150px 90px;gap:12px;min-width:1000px;padding:0;background:none;border:none;text-transform:none;letter-spacing:0;color:#8a8a94"><span>Vendor</span><span>Invoice</span><span>Amount</span><span>Date</span><span>Reference</span><span>Status</span><span></span></div>`, '',
      list.length ? rows : this.emptyRow('No matching payments', 'Adjust the filters to see more.'))}</div>`;
  },
  openResolve(id) { this.set({ resolveId: id }); },
  renderResolve() {
    const p = this.data.payments.find((x) => x.id === this.state.resolveId); if (!p) return '';
    return this._modal('Resolve Dispute', '', `
      <div style="font-size:13.5px;color:var(--muted);line-height:1.5">Mark <span class="mono" style="color:var(--plum)">${esc(p.ref)}</span> (${this.money(p.amount)}) from ${esc(this.vendorName(p.vendor))} as resolved &amp; confirmed.</div>
      <div class="field"><div class="label">Resolution note</div><textarea id="res-note" class="textarea" placeholder="How was this resolved?"></textarea></div>`,
      `<button onclick="App.set({resolveId:null})" class="btn btn-ghost">Cancel</button><button onclick="App.btnRun(this,()=>App.submitResolve())" class="btn btn-primary">Resolve &amp; Confirm</button>`, () => this.set({ resolveId: null }));
  },
  async submitResolve() {
    await this.api(`/api/admin/payments/${this.state.resolveId}/resolve`, { json: { note: document.getElementById('res-note').value } });
    this.state.resolveId = null; await this.refreshData(); this.showToast('Dispute resolved');
  },
  renderRecordPay() {
    const vopts = this.data.vendors.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join('');
    const today = new Date().toISOString().slice(0, 10);
    return this._modal('Record New Payment', 'Log a payment sent to a vendor for confirmation.', `
      <div class="field"><div class="label">Vendor</div><select id="rp-vendor" class="select"><option value="">Select vendor…</option>${vopts}</select></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="field"><div class="label">Invoice Ref</div><input id="rp-ref" class="input mono" placeholder="INV-2026-0430"/></div>
        <div class="field"><div class="label">Amount (₹)</div><input id="rp-amount" class="input" type="number" placeholder="150000"/></div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="field"><div class="label">Date</div><input id="rp-date" class="input" type="date" value="${today}"/></div>
        <div class="field"><div class="label">Reference No.</div><input id="rp-utr" class="input mono" placeholder="UTR…"/></div></div>`,
      `<button onclick="App.set({showRecordPay:false})" class="btn btn-ghost">Cancel</button><button onclick="App.btnRun(this,()=>App.submitRecordPay())" class="btn btn-primary">Record Payment</button>`, () => this.set({ showRecordPay: false }));
  },
  async submitRecordPay() {
    const g = (id) => document.getElementById(id).value;
    const vendor = g('rp-vendor'), ref = g('rp-ref').trim(), amount = g('rp-amount');
    if (!vendor || !ref || !amount) { this.showToast('Vendor, invoice ref and amount are required'); return; }
    await this.api('/api/admin/payments', { json: { vendor, ref, amount, date: g('rp-date'), utr: g('rp-utr').trim() } });
    this.state.showRecordPay = false; await this.refreshData(); this.showToast('Payment recorded');
  },

  // ── ADMIN: vendors ──────────────────────────────────────────────────
  aVendors() {
    const rows = this.data.vendors.map((v) => {
      const initials = (v.name || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
      const actions = this.canEdit() ? `<button onclick="App.openEditVendor('${v.id}')" class="btn btn-ghost btn-sm">Edit</button>${v.status === 'active' ? `<button onclick="App.btnRun(this,()=>App.toggleVendor('${v.id}'))" class="btn btn-danger btn-sm">Suspend</button>` : `<button onclick="App.btnRun(this,()=>App.toggleVendor('${v.id}'))" class="btn btn-success btn-sm">Reactivate</button>`}` : '<span style="font-size:12.5px;color:#c4b8c1">—</span>';
      return `<div class="trow" style="display:grid;grid-template-columns:1.3fr 110px 1.4fr 120px 170px;gap:12px;min-width:840px">
        <div style="display:flex;align-items:center;gap:11px"><div style="width:32px;height:32px;border-radius:50%;background:var(--plum-tint);color:var(--plum);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:12px;flex-shrink:0">${esc(initials)}</div><span style="font-weight:500">${esc(v.name)}</span></div>
        <div class="mono" style="font-size:12.5px;color:var(--faint)">${esc(v.vendor_id || '—')}</div>
        <div style="color:var(--muted)">${esc(v.email)}</div>
        <div>${this.badge(v.status)}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end">${actions}</div></div>`;
    }).join('');
    const addBtn = this.canEdit() ? `<div style="display:flex;justify-content:flex-end;margin-bottom:18px"><button onclick="App.openAddVendor()" class="btn btn-primary btn-sm"><span style="font-size:16px">+</span> Add Vendor</button></div>` : '';
    return `<div style="max-width:1040px">${addBtn}
      ${this.panel(`<div class="thead" style="display:grid;grid-template-columns:1.3fr 110px 1.4fr 120px 170px;gap:12px;min-width:840px;padding:0;background:none;border:none;text-transform:none;letter-spacing:0;color:#8a8a94"><span>Vendor</span><span>Vendor ID</span><span>Email</span><span>Status</span><span style="text-align:right">Actions</span></div>`, '',
      this.data.vendors.length ? rows : this.emptyRow('No vendors yet', 'Vendors appear here once they sign up.'))}</div>`;
  },
  openAddVendor() { this._vf = { name: '', email: '', status: 'active' }; this.set({ vendorForm: 'add' }); },
  openEditVendor(id) { const v = this.data.vendors.find((x) => x.id === id); this._vf = { id: v.id, name: v.name, email: v.email, status: v.status }; this.set({ vendorForm: 'edit' }); },
  renderVendorForm() {
    const f = this._vf;
    return this._modal(f.id ? 'Edit Vendor' : 'Add Vendor', '', `
      <div class="field"><div class="label">Vendor Name</div><input id="vf-name" class="input" value="${esc(f.name)}" placeholder="e.g. Nakshatra Crafts"/></div>
      <div class="field"><div class="label">Email</div><input id="vf-email" class="input" value="${esc(f.email)}" placeholder="orders@vendor.in"/></div>
      <div class="field"><div class="label">Status</div><select id="vf-status" class="select"><option value="active" ${f.status === 'active' ? 'selected' : ''}>Active</option><option value="suspended" ${f.status === 'suspended' ? 'selected' : ''}>Suspended</option></select></div>`,
      `<button onclick="App.set({vendorForm:null})" class="btn btn-ghost">Cancel</button><button onclick="App.btnRun(this,()=>App.submitVendor())" class="btn btn-primary">Save Vendor</button>`, () => this.set({ vendorForm: null }));
  },
  async submitVendor() {
    const f = this._vf;
    const name = document.getElementById('vf-name').value.trim(), email = document.getElementById('vf-email').value.trim(), status = document.getElementById('vf-status').value;
    if (!name || !email) { this.showToast('Name and email are required'); return; }
    if (f.id) await this.api(`/api/admin/vendors/${f.id}`, { method: 'PUT', json: { name, email, status } });
    else await this.api('/api/admin/vendors', { json: { name, email, status } });
    this.state.vendorForm = null; await this.refreshData(); this.showToast(f.id ? 'Vendor updated' : 'Vendor added');
  },
  async toggleVendor(id) {
    const v = this.data.vendors.find((x) => x.id === id); const suspending = v.status === 'active';
    await this.api(`/api/admin/vendors/${id}/toggle`); await this.refreshData();
    this.showToast(suspending ? 'Vendor suspended' : 'Vendor reactivated');
  },

  // ── ADMIN: audit ────────────────────────────────────────────────────
  aAudit() {
    const s = this.state, au = this.data.audit;
    const actors = ['all', ...Array.from(new Set(au.map((a) => a.actor)))];
    const opts = actors.map((a) => `<option value="${esc(a)}" ${s.auditActor === a ? 'selected' : ''}>${a === 'all' ? 'All actors' : esc(a)}</option>`).join('');
    const list = au.filter((a) => s.auditActor === 'all' || a.actor === s.auditActor);
    const rows = list.map((a) => `<div class="trow" style="display:grid;grid-template-columns:1.4fr 1.4fr 1fr 160px;gap:12px;min-width:780px;font-size:13.5px">
      <div style="display:flex;align-items:center;gap:10px"><div style="width:26px;height:26px;border-radius:50%;background:var(--plum-tint);color:var(--plum);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:11px;flex-shrink:0">${esc((a.actor.split(' ')[0] || '?').slice(0, 2).toUpperCase())}</div><span style="font-weight:500">${esc(a.actor)}</span></div>
      <div style="color:#52525b">${esc(a.action)}</div>
      <div class="mono" style="font-size:12.5px;color:var(--plum)">${esc(a.target)}</div>
      <div class="mono" style="font-size:12px;color:var(--faint)">${esc(a.ts)}</div></div>`).join('');
    return `<div style="max-width:1040px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px"><span style="font-size:13px;color:#8a8a94;font-weight:500">Filter by actor</span><select onchange="App.set({auditActor:this.value})" class="select" style="width:auto">${opts}</select></div>
      ${this.panel(`<div class="thead" style="display:grid;grid-template-columns:1.4fr 1.4fr 1fr 160px;gap:12px;min-width:780px;padding:0;background:none;border:none;text-transform:none;letter-spacing:0;color:#8a8a94"><span>Actor</span><span>Action</span><span>Target</span><span>Time</span></div>`, '',
      list.length ? rows : this.emptyRow('No log entries', 'No actions match this filter.'))}</div>`;
  },

  // ── ADMIN: team access (master) ─────────────────────────────────────
  aAccess() {
    const team = this.data.team || [];
    const rb = (role) => this.badge(role === 'master' ? 'active' : (role === 'editor' ? 'accepted' : 'partial')).replace(/>(Active|Accepted|Partial)</, `>${role === 'master' ? 'Master' : role === 'editor' ? 'Editor' : 'View-only'}<`);
    const rows = team.map((a) => {
      const initials = (a.name || a.email).split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
      let act = '';
      if (a.role === 'master') act = `<span style="font-size:12.5px;color:var(--faint)">Master admin</span>`;
      else if (a.email === this.user.email) act = `<span style="font-size:12.5px;color:var(--faint)">You</span>`;
      else if (a.role === 'editor') act = `<button onclick="App.btnRun(this,()=>App.setRole('${esc(a.email)}','viewer'))" class="btn btn-danger btn-sm">Revoke edit</button>`;
      else act = `<button onclick="App.btnRun(this,()=>App.setRole('${esc(a.email)}','editor'))" class="btn btn-success btn-sm">Grant edit</button>`;
      return `<div class="trow" style="display:grid;grid-template-columns:1.5fr 1.6fr 130px 140px;gap:12px;min-width:760px">
        <div style="display:flex;align-items:center;gap:11px"><div style="width:32px;height:32px;border-radius:50%;background:var(--plum-tint);color:var(--plum);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:12px;flex-shrink:0">${esc(initials)}</div><span style="font-weight:500">${esc(a.name || '—')}</span></div>
        <div style="color:var(--muted)">${esc(a.email)}</div><div>${rb(a.role)}</div><div style="display:flex;justify-content:flex-end">${act}</div></div>`;
    }).join('');
    return `<div style="max-width:1000px">
      <div style="font-size:13.5px;color:var(--muted);margin-bottom:16px">Grant edit access to Mirraw staff. Editors can approve, record payments and manage vendors; view-only admins can see everything but change nothing.</div>
      ${this.panel(`<div class="thead" style="display:grid;grid-template-columns:1.5fr 1.6fr 130px 140px;gap:12px;min-width:760px;padding:0;background:none;border:none;text-transform:none;letter-spacing:0;color:#8a8a94"><span>Name</span><span>Email</span><span>Access</span><span style="text-align:right">Manage</span></div>`, '',
      team.length ? rows : this.emptyRow('No admins yet', 'Admin accounts appear here.'))}</div>`;
  },
  async setRole(email, role) {
    await this.api(`/api/admin/team/${encodeURIComponent(email)}/role`, { json: { role } });
    await this.refreshData(); this.showToast(role === 'editor' ? 'Edit access granted' : 'Set to view-only');
  },

  // ── modals + lightbox ───────────────────────────────────────────────
  _modal(title, sub, body, foot, onClose) {
    return `<div class="overlay" onclick="App._mc()"><div class="modal" onclick="event.stopPropagation()">
      <div class="modal-head"><div class="modal-title">${title}</div>${sub ? `<div class="modal-sub">${sub}</div>` : ''}</div>
      <div class="modal-body">${body}</div><div class="modal-foot">${foot}</div></div></div>`;
  },
  _mc() { this.set({ acceptId: null, rejectId: null, payAction: null, showRecordPay: false, resolveId: null, vendorForm: null }); },
  renderModals() {
    const s = this.state; let html = '';
    if (s.acceptId) html += this.renderAccept();
    else if (s.rejectId) html += this.renderReject();
    else if (s.payAction) html += this.renderPay();
    else if (s.showRecordPay) html += this.renderRecordPay();
    else if (s.resolveId) html += this.renderResolve();
    else if (s.vendorForm) html += this.renderVendorForm();
    if (s.lightbox) html += `<div class="lightbox" onclick="App.state.lightbox=null;App.renderModals()"><button class="x">✕</button><img src="${esc(s.lightbox)}" onclick="event.stopPropagation()"/></div>`;
    document.getElementById('modal-root').innerHTML = html;
  },
};

window.App = App;
App.init();
