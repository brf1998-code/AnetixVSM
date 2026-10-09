// Ask Anetix: the assistant's panel on the improvement board (2026-10-08, src/assist.js, docs/ASSISTANT.md).
// Managers only: the board shows the button when its own data says manager or admin, and every route behind it
// refuses a floor session anyway. The panel is its own piece of the page: the board's 4 s redraw never touches it.
// Its state (open, which conversation, which chip) is kept for the tab in sessionStorage, so a reload after a deploy
// comes back to the same place.
(function () {
  const SLUG = location.pathname.split("/")[2];
  const API = `/api/c/${SLUG}/assist`;
  const KEY = `anx_assist.${SLUG}`;
  const st = { open: false, cfg: null, scope: null, conv: null, messages: [], view: "chat", poll: null, busy: false, list: null, err: null, down: null };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify({ open: st.open, conv: st.conv && st.conv.id, scope: st.scope })); } catch (e) {} };
  const restore = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch (e) { return null; } };
  const isMgr = () => { try { return typeof MGR === "function" && MGR(); } catch (e) { return false; } };
  async function api(method, path, body) {
    const r = await fetch(API + path, { method, cache: "no-store", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error((j && j.error) || "That did not work. Try again in a moment.");
    return j;
  }

  // ---- a little formatting, nothing else: bold, italics, lists, paragraphs. No links, no images, no HTML.
  function md(text) {
    const inline = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<i>$2</i>").replace(/\[Show me\]/g, "<span class=\"ax-k\">Show me</span>");
    const out = []; let list = null;
    for (const raw of String(text || "").split("\n")) {
      const line = raw.trimEnd();
      const b = /^\s*[-*•]\s+(.*)$/.exec(line), n = /^\s*\d+[.)]\s+(.*)$/.exec(line);
      if (b || n) { const kind = b ? "ul" : "ol"; if (!list || list.kind !== kind) { if (list) out.push(`</${list.kind}>`); out.push(`<${kind}>`); list = { kind }; } out.push(`<li>${inline((b || n)[1])}</li>`); continue; }
      if (list) { out.push(`</${list.kind}>`); list = null; }
      if (!line.trim()) { out.push("<div class=\"ax-gap\"></div>"); continue; }
      out.push(`<p>${inline(line)}</p>`);
    }
    if (list) out.push(`</${list.kind}>`);
    return out.join("");
  }

  const CSS = `
  #ax-btn { display:inline-flex; align-items:center; gap:6px; background:rgba(255,255,255,.14); color:#fff; border:1px solid rgba(255,255,255,.4); border-radius:18px; padding:6px 12px; font:700 13px system-ui,sans-serif; cursor:pointer; min-height:0; margin:0; }
  #ax-btn:hover, #ax-btn:focus-visible { background:rgba(255,255,255,.24); }
  .ax { position:fixed; top:0; right:0; bottom:0; width:430px; max-width:100vw; background:#fff; color:#1c242e; z-index:10050; display:flex; flex-direction:column; box-shadow:-6px 0 24px rgba(20,30,45,.18); font:14px/1.45 system-ui,sans-serif; }
  .ax[hidden] { display:none; }
  .ax-h { display:flex; align-items:center; gap:8px; padding:10px 12px; background:#1f3a5f; color:#fff; }
  .ax-h b { font-size:15px; margin-right:auto; }
  .ax-h button { background:none; border:1px solid rgba(255,255,255,.35); color:#fff; border-radius:14px; padding:4px 10px; font:600 12.5px system-ui,sans-serif; cursor:pointer; min-height:0; margin:0; }
  .ax-h button.x { border:none; font-size:20px; line-height:1; padding:2px 6px; }
  .ax-chips { display:flex; gap:6px; padding:8px 12px; overflow-x:auto; border-bottom:1px solid #d5dbe3; background:#f2f4f7; scrollbar-width:thin; }
  .ax-chips button { flex:none; background:#fff; border:1px solid #c8d0da; color:#1f3a5f; border-radius:16px; padding:5px 11px; font:600 12.5px system-ui,sans-serif; cursor:pointer; white-space:nowrap; min-height:0; margin:0; }
  .ax-chips button.on { background:#1f3a5f; border-color:#1f3a5f; color:#fff; }
  .ax-note { font-size:11.5px; color:#51606f; padding:6px 12px; border-bottom:1px solid #eef1f5; }
  .ax-note b { color:#7a4a00; }
  .ax-body { flex:1; overflow-y:auto; padding:12px; display:flex; flex-direction:column; gap:12px; }
  .ax-intro { color:#51606f; font-size:13.5px; }
  .ax-start { display:flex; flex-direction:column; gap:6px; margin-top:6px; }
  .ax-start button { text-align:left; background:#f2f4f7; border:1px solid #d5dbe3; border-radius:10px; padding:8px 10px; font:13.5px system-ui,sans-serif; color:#1c242e; cursor:pointer; min-height:0; margin:0; }
  .ax-start button:hover { border-color:#1f3a5f; }
  .ax-u { align-self:flex-end; max-width:85%; background:#e8eef6; border-radius:12px 12px 2px 12px; padding:8px 11px; white-space:pre-wrap; word-wrap:break-word; }
  .ax-a { max-width:100%; }
  .ax-a p { margin:0 0 4px; } .ax-a ul, .ax-a ol { margin:2px 0 6px; padding-left:20px; } .ax-a li { margin:2px 0; }
  .ax-gap { height:6px; }
  .ax-k { font-weight:700; color:#1f3a5f; }
  .ax-run { color:#51606f; font-size:13px; display:flex; flex-direction:column; gap:2px; }
  .ax-run .now { color:#1c242e; font-weight:600; display:flex; align-items:center; gap:7px; }
  .ax-run .was { font-size:12px; opacity:.75; }
  .ax-spin { width:12px; height:12px; border:2px solid #c8d0da; border-top-color:#1f3a5f; border-radius:50%; animation:axs 0.8s linear infinite; flex:none; }
  @keyframes axs { to { transform:rotate(360deg); } }
  .ax-fail { color:#7a4a00; background:#fff4e5; border-radius:8px; padding:8px 10px; font-size:13px; }
  .ax-set { display:inline-block; font-size:10.5px; font-weight:800; letter-spacing:.05em; color:#7a4a00; background:#fbefe0; border-radius:8px; padding:1px 7px; margin-bottom:4px; }
  .ax-looked { margin-top:6px; font-size:11.5px; color:#51606f; display:flex; flex-wrap:wrap; gap:4px 6px; align-items:center; }
  .ax-looked a, .ax-looked span.r { background:#f2f4f7; border-radius:8px; padding:1px 7px; color:#51606f; text-decoration:none; }
  .ax-looked a:hover { color:#1f3a5f; text-decoration:underline; }
  .ax-show { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
  .ax-show a { background:#0e8a86; color:#fff; border-radius:16px; padding:5px 12px; font-weight:700; font-size:12.5px; text-decoration:none; }
  .ax-card { margin-top:8px; border:1px solid #0e8a86; border-left-width:4px; border-radius:10px; padding:10px; background:#f5fbfb; }
  .ax-card .t { font-size:12.5px; color:#51606f; margin-bottom:6px; }
  .ax-card .t b { color:#1c242e; }
  .ax-card textarea { width:100%; min-height:84px; font:13.5px/1.4 system-ui,sans-serif; border:1px solid #c8d0da; border-radius:8px; padding:7px 8px; box-sizing:border-box; resize:vertical; }
  .ax-card .sub { font-size:12px; color:#51606f; margin-top:5px; }
  .ax-card .acts { display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; align-items:center; }
  .ax-card .go { background:#0e8a86; color:#fff; border:none; border-radius:8px; padding:7px 12px; font:700 13px system-ui,sans-serif; cursor:pointer; min-height:0; margin:0; }
  .ax-card .quiet, .ax-th button.reason { background:none; border:none; color:#51606f; text-decoration:underline; font:12.5px system-ui,sans-serif; cursor:pointer; padding:4px; min-height:0; margin:0; }
  .ax-card.done { border-color:#2e7d4f; background:#eef7f1; }
  .ax-card.away { border-color:#c8d0da; background:#f7f8fa; color:#51606f; }
  .ax-th { display:flex; gap:4px; margin-top:6px; align-items:center; }
  .ax-th button.t { background:none; border:1px solid transparent; border-radius:8px; padding:2px 5px; cursor:pointer; color:#8a96a3; min-height:0; margin:0; line-height:0; }
  .ax-th button.t:hover, .ax-th button.t.on { color:#1f3a5f; border-color:#d5dbe3; }
  .ax-th input { flex:1; font:12.5px system-ui,sans-serif; border:1px solid #c8d0da; border-radius:6px; padding:4px 6px; }
  .ax-th .ok { font-size:11.5px; color:#2e7d4f; }
  .ax-f { border-top:1px solid #d5dbe3; padding:8px 12px 12px; background:#fff; }
  .ax-f textarea { width:100%; min-height:44px; max-height:160px; font:14px/1.4 system-ui,sans-serif; border:1px solid #c8d0da; border-radius:10px; padding:8px 10px; box-sizing:border-box; resize:none; }
  .ax-f .row { display:flex; align-items:flex-start; gap:8px; margin-top:6px; }
  .ax-f .row .sos-dictate { margin:0!important; }
  .ax-f .row .send { margin-left:auto; background:#1f3a5f; color:#fff; border:none; border-radius:10px; padding:8px 16px; font:700 13.5px system-ui,sans-serif; cursor:pointer; min-height:0; }
  .ax-f .row .send:disabled { opacity:.5; cursor:default; }
  .ax-err { color:#b3261e; font-size:12.5px; min-height:0; }
  .ax-hist { display:flex; flex-direction:column; gap:6px; }
  .ax-hist button { text-align:left; background:#fff; border:1px solid #d5dbe3; border-radius:10px; padding:8px 10px; cursor:pointer; font:13.5px system-ui,sans-serif; color:#1c242e; min-height:0; margin:0; }
  .ax-hist button small { display:block; color:#51606f; font-size:11.5px; margin-top:2px; }
  @media (max-width: 720px) { .ax { width:100vw; box-shadow:none; } .ax-f textarea { font-size:16px; } }
  @media (min-width: 1100px) { body.ax-open { padding-right:430px; } }
  `;

  let root = null;
  function css() { if (document.getElementById("ax-css")) return; const style = document.createElement("style"); style.id = "ax-css"; style.textContent = CSS; document.head.appendChild(style); }
  function mount() {
    if (root) return;
    css();
    root = document.createElement("aside");
    root.className = "ax"; root.hidden = true; root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "Ask Anetix");
    root.innerHTML = `<div class="ax-h"><b>Ask Anetix</b><button type="button" data-a="hist">History</button><button type="button" data-a="new">New</button><button type="button" class="x" data-a="close" aria-label="Close">&times;</button></div>
      <div class="ax-chips" role="group" aria-label="What to talk about"></div><div class="ax-note"></div>
      <div class="ax-body" aria-live="polite"></div>
      <form class="ax-f"><textarea rows="2" placeholder="Ask about your tools, or how Anetix works" aria-label="Your question"></textarea><div class="ax-err"></div><div class="row"><span class="mic"></span><button class="send" type="submit">Send</button></div></form>`;
    document.body.appendChild(root);
    root.querySelector("[data-a=close]").onclick = close;
    root.querySelector("[data-a=new]").onclick = () => { stopPoll(); st.conv = null; st.messages = []; st.view = "chat"; save(); draw(); focusBox(); };
    root.querySelector("[data-a=hist]").onclick = showHistory;
    const box = root.querySelector(".ax-f textarea");
    box.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
    box.addEventListener("input", () => { box.style.height = "auto"; box.style.height = Math.min(160, box.scrollHeight) + "px"; });
    root.querySelector(".ax-f").addEventListener("submit", (e) => { e.preventDefault(); send(); });
    if (window.Dictate) { const w = window.Dictate.attach(box); if (w) root.querySelector(".ax-f .mic").appendChild(w); }
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && st.open) close(); });
  }
  const focusBox = () => { const b = root && root.querySelector(".ax-f textarea"); if (b) setTimeout(() => b.focus(), 30); };

  // ---- the button in the band ----------------------------------------------------------------------------------
  function placeButton() {
    const dock = document.getElementById("askdock");
    if (!dock) return;
    if (!isMgr() || (st.cfg && st.cfg.mode === "off")) { dock.innerHTML = ""; return; }
    css();   // the button's own look, before the panel is ever opened
    if (!document.getElementById("ax-btn")) {
      dock.innerHTML = `<button type="button" id="ax-btn" title="Ask about your tools, or how Anetix works"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7"/><path d="M12 17h.01"/></svg>Ask Anetix</button>`;
      document.getElementById("ax-btn").onclick = () => (st.open ? close() : open());
    }
  }

  async function config() {
    if (!st.cfg) st.cfg = await api("GET", "");
    return st.cfg;
  }
  // open({ kind, module }): opens on that chip, a new conversation when it differs from the one showing
  async function open(scope) {
    mount();
    st.open = true; root.hidden = false; st.err = null; document.body.classList.add("ax-open");
    try { await config(); } catch (e) { st.err = e.message; }
    if (scope && (!st.scope || st.scope.kind !== scope.kind || st.scope.module !== scope.module)) { stopPoll(); st.scope = { kind: scope.kind, module: scope.module || null }; st.conv = null; st.messages = []; st.view = "chat"; }
    if (!st.scope) st.scope = defaultScope();
    save(); draw(); focusBox();
    if (st.conv && st.messages.some((m) => m.status === "running")) startPoll();
  }
  function close() { st.open = false; if (root) root.hidden = true; document.body.classList.remove("ax-open"); stopPoll(); if (window.Dictate && root) window.Dictate.stop(root); save(); }
  // the tool the board is filtered to, else the whole company
  function defaultScope() {
    try { if (typeof SEL !== "undefined" && SEL && SEL.size === 1) { const m = [...SEL][0]; if (st.cfg && st.cfg.chips.some((c) => c.module === m)) return { kind: "tool", module: m }; } } catch (e) {}
    return { kind: "company", module: null };
  }
  const sameScope = (a, b) => a && b && a.kind === b.kind && (a.module || null) === (b.module || null);

  function draw() {
    if (!root) return;
    const cfg = st.cfg;
    const chips = root.querySelector(".ax-chips");
    chips.innerHTML = cfg ? cfg.chips.map((c, i) => `<button type="button" data-i="${i}" class="${sameScope(c, st.scope) ? "on" : ""}" aria-pressed="${sameScope(c, st.scope)}">${esc(c.label)}</button>`).join("") : "";
    chips.querySelectorAll("button").forEach((b) => { b.onclick = () => { const c = cfg.chips[Number(b.dataset.i)]; if (sameScope(c, st.scope) && st.view === "chat") return; stopPoll(); st.scope = { kind: c.kind, module: c.module || null }; st.conv = null; st.messages = []; st.view = "chat"; save(); draw(); focusBox(); }; });
    const on = chips.querySelector("button.on"); if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest", inline: "nearest" });
    root.querySelector(".ax-note").innerHTML = cfg ? `${esc(cfg.disclosure)}${cfg.demo_line ? ` <b>Demo: set answers.</b> ${esc(cfg.demo_line)}` : ""}` : "";
    const body = root.querySelector(".ax-body");
    const form = root.querySelector(".ax-f");
    form.hidden = st.view !== "chat";
    if (st.view === "history") { body.innerHTML = histHtml(); wireHist(body); return; }
    if (st.err && !cfg) { body.innerHTML = `<div class="ax-fail">${esc(st.err)}</div>`; return; }
    const running = st.messages.some((m) => m.status === "running");
    form.querySelector(".send").disabled = running || st.busy;
    if (!st.messages.length) { body.innerHTML = emptyHtml(); wireStarters(body); return; }
    const near = body.scrollHeight - body.scrollTop - body.clientHeight < 60;
    body.innerHTML = st.messages.map(msgHtml).join("");
    wireMessages(body);
    if (near || running) body.scrollTop = body.scrollHeight;
  }
  function emptyHtml() {
    const cfg = st.cfg || { intro: {}, starters: {} };
    const k = st.scope ? st.scope.kind : "company";
    const chip = cfg.chips && cfg.chips.find((c) => sameScope(c, st.scope));
    return `<div class="ax-intro">${esc(cfg.intro[k] || "")}${k === "tool" && chip ? ` <b>${esc(chip.label)}</b>.` : ""}</div>
      <div class="ax-start">${(cfg.starters[k] || []).map((s, i) => `<button type="button" data-s="${i}">${esc(s)}</button>`).join("")}</div>`;
  }
  function wireStarters(body) {
    const k = st.scope ? st.scope.kind : "company";
    body.querySelectorAll("[data-s]").forEach((b) => { b.onclick = () => { const box = root.querySelector(".ax-f textarea"); box.value = (st.cfg.starters[k] || [])[Number(b.dataset.s)] || ""; box.dispatchEvent(new Event("input")); box.focus(); box.setSelectionRange(box.value.length, box.value.length); }; });
  }
  const THUMB = (down) => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${down ? 'style="transform:rotate(180deg)"' : ""}><path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3zm0 0l4-8a2.5 2.5 0 0 1 2.5 2.5V8h5.3a2 2 0 0 1 2 2.3l-1.3 8A2 2 0 0 1 17.5 20H7"/></svg>`;
  function msgHtml(m) {
    if (m.role === "user") return `<div class="ax-u">${esc(m.text)}</div>`;
    if (m.status === "running") {
      const steps = m.steps || [];
      return `<div class="ax-a ax-run" data-m="${m.id}"><div class="now"><span class="ax-spin"></span>${esc(steps.length ? steps[steps.length - 1] : "Thinking")}…</div>${steps.slice(0, -1).reverse().slice(0, 4).map((s) => `<div class="was">${esc(s)}</div>`).join("")}</div>`;
    }
    if (m.status === "failed") return `<div class="ax-a"><div class="ax-fail">${esc(m.text || "That did not work.")}</div></div>`;
    let h = `<div class="ax-a" data-m="${m.id}">${m.scripted ? '<span class="ax-set">SET ANSWER</span>' : ""}${md(m.text)}`;
    if (m.scripted) {   // the demo line is at the top of the panel; under a set answer, only the way to go live, when there is one
      const gl = typeof DATA !== "undefined" && DATA && DATA.golive && DATA.golive.url && !DATA.golive.line ? DATA.golive : null;
      if (gl) h += `<div class="ax-looked"><a href="${esc(gl.url)}">${esc(gl.action || "Go live")}</a></div>`;
    }
    if ((m.shows || []).length) h += `<div class="ax-show">${m.shows.map((s) => `<a href="${esc(s.url)}" title="Opens ${esc(s.tool)} with the spot ringed">Show me: ${esc(s.title)}</a>`).join("")}</div>`;
    if (m.card) h += cardHtml(m);
    if ((m.looked_at || []).length) h += `<div class="ax-looked">Looked at: ${m.looked_at.map((l) => l.href ? `<a href="${esc(l.href)}">${esc(l.label)}</a>` : `<span class="r">${esc(l.label)}</span>`).join("")}</div>`;
    if (!m.scripted) {
      const asking = st.down === m.id;
      h += `<div class="ax-th"><button type="button" class="t ${m.thumbs === 1 ? "on" : ""}" data-up="${m.id}" aria-label="Good answer" title="Good answer">${THUMB(false)}</button><button type="button" class="t ${m.thumbs === -1 ? "on" : ""}" data-down="${m.id}" aria-label="Not right" title="Not right">${THUMB(true)}</button>${asking ? `<input data-why="${m.id}" maxlength="500" placeholder="What was off? (optional)"><button type="button" class="reason" data-save="${m.id}">Save</button>` : m.thumbs ? '<span class="ok">Thanks</span>' : ""}</div>`;
    }
    return h + "</div>";
  }
  function cardHtml(m) {
    const c = m.card;
    const where = `${c.tool === "platform" ? "To <b>Anetix</b> (the software itself)" : `For <b>${esc(c.tool_title)}</b>`}${c.screen ? ` · ${esc(c.screen.label)}` : ""}`;
    if (c.state === "filed") return `<div class="ax-card done"><div class="t">${where}</div><div>${esc(c.what)}</div><div class="sub">${c.tool === "platform" ? `Sent to Anetix as #${c.feedback_id}. The answer shows under Requests to Anetix.` : `Sent as #${c.feedback_id}. A draft of the change lands in Reviewing in a moment, for approval as usual.`}</div></div>`;
    if (c.state === "dismissed") return `<div class="ax-card away"><div class="t">${where}</div><div>${esc(c.what)}</div><div class="sub">Not sent.</div></div>`;
    return `<div class="ax-card" data-card="${m.id}"><div class="t">${where}</div><textarea data-what="${m.id}" aria-label="The request">${esc(c.what)}</textarea>
      ${c.why ? `<div class="sub">Why: ${esc(c.why)}</div>` : ""}${(c.similar || []).length ? `<div class="sub">May already be asked on the board: ${c.similar.map((id) => "#" + Number(id)).join(", ")}.</div>` : ""}
      <div class="acts"><button type="button" class="go" data-file="${m.id}">${c.tool === "platform" ? "Send to Anetix" : "Send to Reviewing"}</button><button type="button" class="quiet" data-away="${m.id}">Not now</button></div>
      <div class="sub">${c.tool === "platform" ? "It goes to the Anetix team, under Requests to Anetix." : "A change is drafted for it in Reviewing. Nothing is built until it is approved there."}</div></div>`;
  }
  function wireMessages(body) {
    body.querySelectorAll("[data-up],[data-down]").forEach((b) => { b.onclick = async () => {
      const id = Number(b.dataset.up || b.dataset.down), up = Boolean(b.dataset.up);
      try { await api("POST", `/messages/${id}/thumbs`, { up }); const m = st.messages.find((x) => x.id === id); if (m) m.thumbs = up ? 1 : -1; st.down = up ? null : id; draw(); if (!up) { const i = root.querySelector(`[data-why="${id}"]`); if (i) i.focus(); } } catch (e) { showErr(e.message); }
    }; });
    body.querySelectorAll("[data-save]").forEach((b) => { b.onclick = async () => {
      const id = Number(b.dataset.save), i = root.querySelector(`[data-why="${id}"]`);
      try { await api("POST", `/messages/${id}/thumbs`, { up: false, reason: i ? i.value : "" }); st.down = null; draw(); } catch (e) { showErr(e.message); }
    }; });
    body.querySelectorAll("[data-file]").forEach((b) => { b.onclick = async () => {
      const id = Number(b.dataset.file), t = root.querySelector(`[data-what="${id}"]`);
      b.disabled = true; b.textContent = "Sending…";
      try { const j = await api("POST", `/messages/${id}/file`, { what: t ? t.value : undefined }); const m = st.messages.find((x) => x.id === id); if (m) m.card = { ...m.card, state: "filed", feedback_id: j.feedback_id, what: t ? t.value : m.card.what }; draw(); if (typeof window.load === "function") setTimeout(() => { try { window.load(); } catch (e) {} }, 400); }   // window.load: the board's own redraw, so the new card shows
      catch (e) { b.disabled = false; b.textContent = "Send to Reviewing"; showErr(e.message); }
    }; });
    body.querySelectorAll("[data-away]").forEach((b) => { b.onclick = async () => {
      const id = Number(b.dataset.away);
      try { await api("POST", `/messages/${id}/dismiss`, {}); const m = st.messages.find((x) => x.id === id); if (m) m.card = { ...m.card, state: "dismissed" }; draw(); } catch (e) { showErr(e.message); }
    }; });
  }
  function showErr(msg) { const e = root && root.querySelector(".ax-err"); if (e) { e.textContent = msg || ""; if (msg) setTimeout(() => { if (e.textContent === msg) e.textContent = ""; }, 8000); } }

  // ---- sending, and waiting for the answer --------------------------------------------------------------------
  async function send() {
    const box = root.querySelector(".ax-f textarea");
    const text = box.value.trim();
    if (!text || st.busy || st.messages.some((m) => m.status === "running")) return;
    st.busy = true; showErr("");
    if (window.Dictate) window.Dictate.stop(root);
    try {
      if (!st.conv) { const j = await api("POST", "/conversations", { scope: st.scope }); st.conv = j.conversation; save(); }
      const j = await api("POST", `/conversations/${st.conv.id}/messages`, { text });
      box.value = ""; box.dispatchEvent(new Event("input"));
      st.messages.push(j.user, j.assistant);
      st.busy = false; draw();
      if (j.assistant.status === "running") startPoll();
    } catch (e) { st.busy = false; draw(); showErr(e.message); }
  }
  function startPoll() { stopPoll(); st.poll = setTimeout(pollOnce, 1100); }
  function stopPoll() { if (st.poll) clearTimeout(st.poll); st.poll = null; }
  async function pollOnce() {
    st.poll = null;
    if (!st.conv || !st.open) return;
    const id = st.conv.id;
    try {
      const j = await api("GET", `/conversations/${id}`);
      if (!st.conv || st.conv.id !== id) return;
      st.messages = j.messages; draw();
      if (j.messages.some((m) => m.status === "running")) st.poll = setTimeout(pollOnce, 1100);
    } catch (e) { st.poll = setTimeout(pollOnce, 3000); }
  }
  async function openConversation(id) {
    mount(); st.open = true; root.hidden = false; document.body.classList.add("ax-open");
    try {
      await config();
      const j = await api("GET", `/conversations/${Number(id)}`);
      st.conv = j.conversation; st.messages = j.messages; st.scope = { kind: j.conversation.scope_kind, module: j.conversation.scope_module || null }; st.view = "chat";
      save(); draw();
      if (j.messages.some((m) => m.status === "running")) startPoll();
    } catch (e) { st.view = "chat"; draw(); showErr(e.message === "no such conversation" ? "That conversation is someone else's." : e.message); }
  }

  // ---- history ------------------------------------------------------------------------------------------------
  async function showHistory() {
    if (st.view === "history") { st.view = "chat"; draw(); return; }
    stopPoll(); st.view = "history"; st.list = null; draw();
    try { st.list = (await api("GET", "/conversations")).conversations; } catch (e) { st.list = []; showErr(e.message); }
    draw();
  }
  function histHtml() {
    if (!st.list) return '<div class="ax-intro">Loading…</div>';
    if (!st.list.length) return '<div class="ax-intro">No conversations yet.</div>';
    const what = (c) => (c.scope_kind === "tool" ? c.tool_title || c.scope_module : c.scope_kind === "help" ? "Anetix help" : "Whole company");
    return `<div class="ax-hist">${st.list.map((c) => `<button type="button" data-c="${c.id}">${esc(c.title || "(no question yet)")}<small>${esc(what(c))} · ${new Date(c.updated_at).toLocaleDateString()} · ${c.questions} question${c.questions === 1 ? "" : "s"}</small></button>`).join("")}</div>`;
  }
  function wireHist(body) { body.querySelectorAll("[data-c]").forEach((b) => { b.onclick = () => openConversation(Number(b.dataset.c)); }); }

  // ---- start ----------------------------------------------------------------------------------------------------
  // the band's button follows the board's own data (manager or admin); ?ask=<tool> opens the panel on that tool
  async function boot() {
    if (isMgr()) { try { await config(); } catch (e) { /* the button still shows; opening says what is wrong */ } }
    placeButton();
    if (st.cfg && st.cfg.mode === "off") return;   // Anetix switched it off for this company
    const saved = restore();
    const want = new URLSearchParams(location.search).get("ask");
    if (!isMgr()) return;
    if (want) {
      const u = new URL(location.href); u.searchParams.delete("ask"); history.replaceState(null, "", u.pathname + u.search + u.hash);
      open(want === "company" || want === "help" ? { kind: want } : { kind: "tool", module: want });
    } else if (saved && saved.open) {
      st.scope = saved.scope || null;
      if (saved.conv) openConversation(saved.conv); else open();
    }
  }
  let tries = 0;
  (function wait() { if (typeof DATA !== "undefined" && DATA) { boot(); setInterval(placeButton, 4000); return; } if (++tries < 200) setTimeout(wait, 100); })();
  window.Assist = { open, close, openConversation, on: () => !(st.cfg && st.cfg.mode === "off") };
})();
