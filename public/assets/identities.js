// Sign in with Google or Microsoft, the account's side (src/oidc.js, 2026-10-29): the identities connected to the
// signed-in named account, Connect for each provider that is on, Disconnect for each one connected, and the word the
// provider's return left in the address (?oidc=...). Used by Settings (a manager) and the Accounts tab of /admin.
//   Identities.panel(el, { next })   next: the page to come back to after connecting (default: this page)
(function () {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const WORDS = {
    linked_google: "Google is connected. Next time, Sign in with Google is all it takes.",
    linked_microsoft: "Microsoft is connected. Next time, Sign in with Microsoft is all it takes.",
    taken: "That Google or Microsoft account is already connected to another Anetix account.",
    cancelled: "Nothing was connected.",
    failed: "That did not go through. Try again in a minute.",
    expired: "That took too long. Try again.",
  };
  async function panel(el, opts) {
    if (!el) return;
    opts = opts || {};
    const back = opts.next || (location.pathname + location.search.replace(/([?&])oidc=[^&]*&?/, "$1").replace(/[?&]$/, ""));
    const said = new URLSearchParams(location.search).get("oidc");
    let j = null;
    try { const r = await fetch("/api/me/identities", { cache: "no-store" }); if (r.ok) j = await r.json(); } catch (e) { /* not a named account */ }
    if (!j) { el.innerHTML = ""; return; }
    if (!j.providers.length && !j.identities.length) { el.innerHTML = '<div class="sub">Not switched on for this instance yet.</div>'; return; }
    const rows = j.identities.map((x) => `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:6px 0"><b>${x.provider === "google" ? "Google" : "Microsoft"}</b><span class="sub">${esc(x.email || "connected")}${x.last_used_at ? ", last used " + new Date(x.last_used_at).toLocaleDateString() : ""}</span><button class="quiet" style="margin:0" data-id="${Number(x.id)}">Disconnect</button></div>`).join("");
    const can = j.providers.filter((p) => !j.identities.some((x) => x.provider === p.id));
    el.innerHTML = (said && WORDS[said] ? `<div class="sub" style="color:${/^linked_/.test(said) ? "#2e7d4f" : "#b3261e"};margin:4px 0">${WORDS[said]}</div>` : "") + rows
      + can.map((p) => `<a class="btn quiet" style="display:inline-block;margin:6px 8px 0 0" href="/login/oidc/${encodeURIComponent(p.id)}?link=1&next=${encodeURIComponent(back)}">Connect ${esc(p.name)}</a>`).join("");
    for (const b of el.querySelectorAll("button[data-id]")) b.onclick = async () => {
      if (!confirm("Disconnect it? You sign in with your email and password, or a passkey, until you connect it again.")) return;
      await fetch(`/api/me/identities/${b.dataset.id}/remove`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      panel(el, opts);
    };
  }
  window.Identities = { panel };
})();
