// Passkeys in the browser (src/passkeys.js is the server). One small file for every page that adds a passkey or signs
// in with one: the product's sign-in, the setup page, the board, settings and /admin. anetix.ai's wall carries its own
// copy of the sign-in half (www/pages.js), since it is another origin.
//   Passkey.supported()                         the browser can do passkeys at all
//   Passkey.platform()                          -> Promise<bool>: this device has Face ID, a fingerprint or Windows Hello
//   Passkey.add({ label })                      -> { ok, passkey } | { cancelled } | { error }   (signed in already)
//   Passkey.signIn({ email, conditional, signal }) -> the /login answer plus passkey: true | { cancelled } | { error }
//   Passkey.stepUp()                            -> { passkey } | { cancelled } | { error }   a fresh check for an admin action
(function () {
  const b2u = (buf) => { const a = new Uint8Array(buf); let s = ""; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
  const u2b = (s) => { s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; const bin = atob(s); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a.buffer; };
  const supported = () => typeof window.PublicKeyCredential === "function" && !!(navigator.credentials && navigator.credentials.create);
  async function platform() { try { return supported() && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch (e) { return false; } }
  async function conditionalOk() { try { return supported() && typeof PublicKeyCredential.isConditionalMediationAvailable === "function" && (await PublicKeyCredential.isConditionalMediationAvailable()); } catch (e) { return false; } }
  const cancelled = (e) => e && (e.name === "NotAllowedError" || e.name === "AbortError");
  const said = async (r) => { const j = await r.json().catch(() => ({})); return j.error || `the platform answered ${r.status}`; };

  async function add({ label } = {}) {
    if (!supported()) return { error: "this browser cannot make passkeys" };
    const r = await fetch("/api/me/passkeys/options", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!r.ok) return { error: await said(r) };
    const o = await r.json();
    let cred;
    try {
      cred = await navigator.credentials.create({ publicKey: { ...o, challenge: u2b(o.challenge), user: { ...o.user, id: u2b(o.user.id) }, excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: u2b(c.id) })) } });
    } catch (e) {
      if (e && e.name === "InvalidStateError") return { error: "this device already holds a passkey for this account" };
      return cancelled(e) ? { cancelled: true } : { error: e.message || String(e) };
    }
    const resp = cred.response;
    const body = { label, response: { id: cred.id, rawId: b2u(cred.rawId), type: cred.type, authenticatorAttachment: cred.authenticatorAttachment || undefined, clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
      response: { clientDataJSON: b2u(resp.clientDataJSON), attestationObject: b2u(resp.attestationObject), transports: resp.getTransports ? resp.getTransports() : [] } } };
    const f = await fetch("/api/me/passkeys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!f.ok) return { error: await said(f) };
    return f.json();
  }

  async function signIn({ email, conditional = false, signal, base = "" } = {}) {
    if (!supported()) return { error: "this browser cannot use passkeys" };
    if (conditional && !(await conditionalOk())) return { cancelled: true };
    const r = await fetch(base + "/login/passkey/options", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!r.ok) return { error: await said(r) };
    const o = await r.json();
    let cred;
    try {
      cred = await navigator.credentials.get({ publicKey: { ...o, challenge: u2b(o.challenge), allowCredentials: (o.allowCredentials || []).map((c) => ({ ...c, id: u2b(c.id) })) }, mediation: conditional ? "conditional" : "optional", signal });
    } catch (e) { return cancelled(e) ? { cancelled: true } : { error: e.message || String(e) }; }
    if (!cred) return { cancelled: true };
    const a = cred.response;
    const body = { email: email || "", response: { id: cred.id, rawId: b2u(cred.rawId), type: cred.type, authenticatorAttachment: cred.authenticatorAttachment || undefined, clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
      response: { clientDataJSON: b2u(a.clientDataJSON), authenticatorData: b2u(a.authenticatorData), signature: b2u(a.signature), userHandle: a.userHandle ? b2u(a.userHandle) : undefined } } };
    const f = await fetch(base + "/login/passkey", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await f.json().catch(() => ({}));
    if (!f.ok) return { error: j.error || `the platform answered ${f.status}`, status: f.status };
    return j;
  }
  // A fresh passkey check for an admin-level action (2026-09-27, Brendan: "allow me to use passkey and not just
  // authenticator apps for my things that are admin level permission items"). The answer goes in the action's own body
  // as { passkey }, where a code would; the server checks it once against this account's passkeys.
  async function stepUp() {
    if (!supported()) return { error: "this browser cannot use passkeys" };
    const r = await fetch("/api/me/passkeys/step-up/options", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!r.ok) return { error: await said(r) };
    const o = await r.json();
    let cred;
    try {
      cred = await navigator.credentials.get({ publicKey: { ...o, challenge: u2b(o.challenge), allowCredentials: (o.allowCredentials || []).map((c) => ({ ...c, id: u2b(c.id) })) } });
    } catch (e) { return cancelled(e) ? { cancelled: true } : { error: e.message || String(e) }; }
    if (!cred) return { cancelled: true };
    const a = cred.response;
    return { passkey: { id: cred.id, rawId: b2u(cred.rawId), type: cred.type, authenticatorAttachment: cred.authenticatorAttachment || undefined,
      clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
      response: { clientDataJSON: b2u(a.clientDataJSON), authenticatorData: b2u(a.authenticatorData), signature: b2u(a.signature), userHandle: a.userHandle ? b2u(a.userHandle) : undefined } } };
  }

  // A signed-in person's own passkeys, drawn into el: the list, Add a passkey, Remove. Used by /admin (My account)
  // and the company's Settings. Hides el when the session is not a named account.
  const esc = (x) => String(x == null ? "" : x).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const day = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");
  async function panel(el, { onChange } = {}) {
    if (!el) return;
    const r = await fetch("/api/me/passkeys", { cache: "no-store" });
    if (!r.ok) { el.style.display = "none"; return; }
    const j = await r.json();
    el.style.display = "";
    const rows = j.passkeys.map((k) => `<tr><td><b>${esc(k.label)}</b>${k.backed_up ? ' <small style="color:#51606f">synced</small>' : ""}</td><td>${day(k.created_at)}</td><td>${k.last_used_at ? day(k.last_used_at) : "not yet"}</td><td><button type="button" class="quiet" data-rm="${k.id}">Remove</button></td></tr>`).join("");
    el.innerHTML = (j.passkeys.length ? `<table class="acc" style="margin-bottom:8px"><tr><th>Passkey</th><th>Added</th><th>Last used</th><th></th></tr>${rows}</table>`
      : `<p style="margin:0 0 8px;color:#51606f;font-size:13px">None yet. With a passkey you sign in with your email and Face ID, a fingerprint or the device's PIN: no password, no code, and a look-alike page cannot use it. Your password and authenticator app stay as the way in from other devices.</p>`)
      + (supported() ? `<button type="button" class="go" data-add="1">Add a passkey${j.passkeys.length ? " on this device" : ""}</button>` : `<p style="color:#51606f;font-size:13px">This browser cannot make passkeys.</p>`)
      + `<div data-msg="1" style="font-size:13px;margin-top:6px"></div>`;
    const msg = el.querySelector("[data-msg]");
    const addBtn = el.querySelector("[data-add]");
    if (addBtn) addBtn.onclick = async () => {
      addBtn.disabled = true;
      const out = await add();
      addBtn.disabled = false;
      if (out.ok) { await panel(el, { onChange }); if (onChange) onChange(); return; }
      msg.style.color = out.cancelled ? "#51606f" : "#b3261e";
      msg.textContent = out.cancelled ? "No passkey was made." : out.error;
    };
    el.querySelectorAll("[data-rm]").forEach((b) => { b.onclick = async () => {
      if (!confirm("Remove this passkey? The device that holds it can no longer sign in with it. Your password and authenticator app still work.")) return;
      const x = await fetch(`/api/me/passkeys/${b.dataset.rm}/remove`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!x.ok) { msg.style.color = "#b3261e"; msg.textContent = await said(x); return; }
      await panel(el, { onChange }); if (onChange) onChange();
    }; });
  }
  window.Passkey = { supported, platform, conditionalOk, add, signIn, panel, stepUp };
})();
