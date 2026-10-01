// Module creation popout (docs/MODULE-CREATION.md, "The intake popout").
// One popout serves the fixed questions, the agent's generated rounds and the
// design gate. Opened from the request card on the board. Every answer saves
// as it is given; closing at any point is safe. Platform code: the in-app
// build agent never touches this file.
window.Intake = (() => {
  const SLUG = location.pathname.split("/")[2];
  let ID = null, V = null, IDX = 0, POLL = null, SAVE = null, ROOT = null, ERR = "", MODE = "q";
  // the confirm screen (2026-10-01): changes asked for per point (id -> words), things to add, which editor is open
  // ("p3", "add", or null), whether the person reached the end of the list, and the one "I've read all" tick
  let CHANGES = new Map(), ADDS = [], EDITPT = null, SAWEND = false, READ = false, DESIGN_AT = null;

  const CSS = `
  .ik-back { position:fixed; inset:0; background:rgba(28,36,46,.6); z-index:20000; display:flex; align-items:center; justify-content:center; padding:18px; }
  .ik-box { background:#fff; color:var(--ink,#1c242e); border-radius:14px; width:100%; max-width:760px; max-height:calc(100vh - 36px); display:flex; flex-direction:column; box-shadow:0 12px 40px rgba(0,0,0,.35); font-size:14px; }
  .ik-head { display:flex; align-items:center; gap:12px; padding:12px 18px; border-bottom:1px solid var(--line,#d5dbe3); }
  .ik-head .ik-round { font-size:11.5px; text-transform:uppercase; letter-spacing:.06em; color:var(--steel,#51606f); font-weight:800; }
  .ik-head .ik-title { font-weight:800; font-size:15px; flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .ik-head .ik-prog { font-size:12.5px; color:var(--steel,#51606f); white-space:nowrap; }
  .ik-head .ik-x { border:1px solid var(--line,#d5dbe3); background:#fff; color:var(--ink,#1c242e); border-radius:8px; padding:6px 10px; font-weight:700; cursor:pointer; margin:0; min-height:0; font-size:12.5px; }
  .ik-bar { height:4px; background:var(--fog,#f2f4f7); } .ik-bar i { display:block; height:4px; background:var(--green,#2e7d4f); transition:width .3s; }
  .ik-body { padding:18px; overflow:auto; flex:1 1 auto; }
  .ik-q { font-size:19px; font-weight:800; line-height:1.3; margin-bottom:6px; }
  .ik-hint { color:var(--steel,#51606f); font-size:13px; line-height:1.45; margin-bottom:14px; }
  .ik-why { background:var(--tealSoft,#e3f2f1); color:var(--teal,#0e8a86); border-radius:8px; padding:8px 10px; font-size:13px; margin-bottom:14px; }
  .ik-chips { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px; }
  .ik-chip { border:1.5px solid var(--line,#d5dbe3); background:#fff; color:var(--ink,#1c242e); border-radius:20px; padding:9px 14px; font-size:13.5px; font-weight:600; cursor:pointer; margin:0; min-height:0; }
  .ik-chip.on { background:var(--navy,#1f3a5f); border-color:var(--navy,#1f3a5f); color:#fff; }
  .ik-box textarea, .ik-box input[type=text], .ik-box input[type=number] { width:100%; font-family:inherit; font-size:14px; border:1px solid var(--line,#d5dbe3); border-radius:8px; padding:9px 10px; }
  .ik-box textarea { min-height:96px; }
  .ik-sub { font-size:12.5px; color:var(--steel,#51606f); margin:10px 0 4px; font-weight:700; }
  .ik-row { display:flex; gap:8px; align-items:center; margin-bottom:8px; }
  .ik-row input[type=text] { flex:1 1 auto; }
  .ik-row .ik-n { width:34px; font-weight:800; color:var(--steel,#51606f); text-align:right; }
  .ik-row button { border:1px solid var(--line,#d5dbe3); background:#f6f8fa; color:var(--ink,#1c242e); border-radius:7px; padding:6px 9px; font-size:12px; font-weight:700; cursor:pointer; margin:0; min-height:0; }
  .ik-row button:disabled { opacity:.35; }
  .ik-add { border:1px dashed var(--line,#d5dbe3); background:#fff; color:var(--navy,#1f3a5f); border-radius:8px; padding:8px 12px; font-weight:700; cursor:pointer; margin:0 0 8px; min-height:0; font-size:13px; }
  .ik-grp { border:1px solid var(--line,#d5dbe3); border-radius:10px; padding:10px 12px; margin-bottom:10px; }
  .ik-grp b { display:block; margin-bottom:6px; }
  .ik-grp input[type=number] { width:110px; }
  .ik-files { margin-top:10px; }
  .ik-file { display:flex; gap:10px; align-items:center; border:1px solid var(--line,#d5dbe3); border-radius:8px; padding:6px 10px; margin-bottom:6px; font-size:13px; }
  .ik-file img { width:44px; height:44px; object-fit:cover; border-radius:6px; }
  .ik-file .ik-meta { color:var(--steel,#51606f); font-size:12px; flex:1 1 auto; }
  .ik-file button { border:none; background:none; color:var(--red,#b3261e); font-weight:700; cursor:pointer; margin:0; min-height:0; padding:4px; }
  .ik-attach { display:inline-block; border:1px solid var(--navy,#1f3a5f); color:var(--navy,#1f3a5f); background:#fff; border-radius:8px; padding:8px 12px; font-weight:700; cursor:pointer; font-size:13px; margin:6px 0 0; }
  .ik-attach input { display:none; }
  .ik-count { font-size:11.5px; color:var(--steel,#51606f); text-align:right; margin:3px 0 6px; }
  .ik-count.full { color:var(--red,#b3261e); font-weight:700; }
  .ik-err { background:#fdeceb; color:var(--red,#b3261e); border-radius:8px; padding:8px 10px; margin-top:10px; font-size:13px; }
  .ik-foot { display:flex; gap:8px; align-items:center; padding:12px 18px; border-top:1px solid var(--line,#d5dbe3); flex-wrap:wrap; }
  .ik-foot .ik-sp { flex:1 1 auto; }
  .ik-foot button { margin:0; min-height:38px; }
  .ik-think { text-align:center; padding:40px 10px; }
  .ik-think .ik-spin { width:34px; height:34px; border:4px solid var(--amber,#c2620a); border-right-color:transparent; border-radius:50%; animation:ikspin .9s linear infinite; margin:0 auto 14px; }
  @keyframes ikspin { to { transform:rotate(360deg) } }
  .ik-bluf { font-size:17px; font-weight:800; line-height:1.35; margin-bottom:12px; }
  .ik-item { display:flex; gap:10px; align-items:flex-start; padding:8px 0; border-top:1px solid var(--line,#d5dbe3); line-height:1.4; }
  .ik-item input { width:18px; height:18px; margin-top:2px; flex:none; }
  .ik-est { background:var(--amberSoft,#fbefe0); color:var(--amber,#c2620a); border-radius:8px; padding:8px 10px; font-weight:700; margin:12px 0; font-size:13px; }
  .ik-flag { background:#fdeceb; color:var(--red,#b3261e); border-radius:8px; padding:8px 10px; margin:8px 0; font-size:12.5px; }
  .ik-ref { white-space:pre-wrap; font-size:13.5px; line-height:1.5; background:var(--fog,#f2f4f7); border-radius:10px; padding:14px; }
  .ik-ref textarea { min-height:360px; font-size:13px; }
  .ik-gate { font-size:12.5px; color:var(--steel,#51606f); margin-top:8px; }
  /* the confirm screen (2026-10-01): numbered points, a tag saying what each is about, Change this under each */
  .ik-intro { background:var(--fog,#f2f4f7); border-radius:10px; padding:10px 12px; font-size:13.5px; line-height:1.45; margin-bottom:12px; }
  .ik-intro b { display:block; font-size:15px; margin-bottom:2px; }
  .ik-points { list-style:none; margin:0 0 6px; padding:0; }
  .ik-pt { display:flex; gap:10px; padding:10px 0; border-top:1px solid var(--line,#d5dbe3); }
  .ik-pt .ik-num { flex:none; width:24px; height:24px; border-radius:50%; background:var(--navy,#1f3a5f); color:#fff; font-weight:800; font-size:12.5px; display:flex; align-items:center; justify-content:center; margin-top:1px; }
  .ik-pt .ik-ptbody { flex:1 1 auto; min-width:0; }
  .ik-pt .ik-ptext { line-height:1.45; font-size:14.5px; }
  .ik-tag { display:inline-block; font-size:10.5px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; color:var(--steel,#51606f); background:var(--fog,#f2f4f7); border-radius:6px; padding:2px 6px; margin:0 6px 3px 0; }
  .ik-mark { display:inline-block; font-size:10.5px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; border-radius:6px; padding:2px 6px; margin:0 6px 3px 0; background:var(--amberSoft,#fbefe0); color:var(--amber,#c2620a); }
  .ik-mark.new { background:#e6f2ea; color:var(--green,#2e7d4f); }
  .ik-link { border:none; background:none; color:var(--navy,#1f3a5f); font-weight:700; font-size:12.5px; padding:4px 0 0; margin:0; min-height:0; cursor:pointer; text-decoration:underline; }
  .ik-ask { background:var(--amberSoft,#fbefe0); border-radius:8px; padding:7px 9px; margin-top:6px; font-size:13px; line-height:1.4; }
  .ik-ask b { color:var(--amber,#c2620a); }
  .ik-ask .ik-link { padding:0 0 0 8px; }
  .ik-editor { margin-top:6px; } .ik-editor textarea { min-height:70px; }
  .ik-editor .ik-row2 { display:flex; gap:8px; margin-top:6px; } .ik-editor .ik-row2 button { margin:0; min-height:34px; }
  .ik-removed { color:var(--steel,#51606f); font-size:12.5px; margin:4px 0 8px; }
  .ik-pend { background:var(--amberSoft,#fbefe0); color:var(--ink,#1c242e); border-radius:8px; padding:9px 11px; font-size:13.5px; margin:12px 0 4px; }
  .ik-readall { display:flex; gap:10px; align-items:center; border:2px solid var(--green,#2e7d4f); background:#eef6ec; border-radius:10px; padding:11px 12px; margin:14px 0 4px; font-weight:800; font-size:14.5px; cursor:pointer; }
  .ik-readall input { width:20px; height:20px; flex:none; margin:0; }
  .ik-readall[hidden] { display:none; }
  .ik-end { height:1px; }
  .ik-foot .ik-gate { margin:0; font-size:12.5px; }
  /* the questions (2026-10-01): needed or optional and what the answer is for, one line; a dot per question */
  .ik-need { display:flex; gap:8px; align-items:baseline; font-size:12.5px; color:var(--steel,#51606f); margin-bottom:6px; line-height:1.35; }
  .ik-need .ik-chipneed { flex:none; font-size:10.5px; font-weight:800; text-transform:uppercase; letter-spacing:.06em; border-radius:6px; padding:2px 7px; background:var(--navy,#1f3a5f); color:#fff; }
  .ik-need .ik-chipneed.opt { background:var(--fog,#f2f4f7); color:var(--steel,#51606f); }
  .ik-dots { display:flex; flex-wrap:wrap; gap:6px; padding:8px 18px 0; }
  .ik-dot { width:14px; height:14px; border-radius:50%; border:2px solid var(--line,#d5dbe3); background:#fff; padding:0; margin:0; min-height:0; cursor:pointer; }
  .ik-dot.done { background:var(--green,#2e7d4f); border-color:var(--green,#2e7d4f); }
  .ik-dot.miss { border-color:var(--red,#b3261e); }
  .ik-dot.now { box-shadow:0 0 0 2px #fff, 0 0 0 4px var(--navy,#1f3a5f); }
  .ik-done { text-align:center; padding:30px 10px; }
  .ik-done b { display:block; font-size:18px; margin-bottom:8px; }
  /* the phone: full screen, the head on two lines (the round and Close first, the title under them), 16px
     boxes so iOS does not zoom the page on focus, and the foot's buttons full width (Brendan, 2026-09-26) */
  @media (max-width: 640px) {
    .ik-back { padding:0; }
    .ik-box { max-width:none; max-height:none; height:100%; border-radius:0; font-size:15px; }
    .ik-head { flex-wrap:wrap; gap:4px 10px; padding:10px 14px; }
    .ik-head .ik-round { order:1; flex:1 1 auto; }
    .ik-head .ik-prog { order:2; }
    .ik-head .ik-x { order:3; min-height:36px; padding:6px 12px; }
    .ik-head .ik-title { order:4; flex:1 1 100%; white-space:normal; font-size:15px; line-height:1.3; }
    .ik-body { padding:14px; }
    .ik-q { font-size:18px; }
    .ik-hint, .ik-why { font-size:14px; }
    .ik-box textarea, .ik-box input[type=text], .ik-box input[type=number] { font-size:16px; }
    .ik-chip { font-size:15px; padding:10px 14px; min-height:42px; }
    .ik-row button { min-height:38px; min-width:38px; }
    .ik-item input { width:22px; height:22px; }
    .ik-pt .ik-ptext { font-size:15px; }
    .ik-link { font-size:14px; padding-top:6px; }
    .ik-dots { padding:8px 14px 0; } .ik-dot { width:16px; height:16px; }
    .ik-ref textarea { min-height:50vh; }
    .ik-foot { padding:10px 14px; gap:8px; }
    .ik-foot .ik-sp { display:none; }
    .ik-foot button { flex:1 1 auto; min-height:44px; font-size:14.5px; }
    .ik-foot .ik-gate { flex:1 1 100%; order:-1; text-align:center; }
  }`;

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const api = async (url, body, method) => {
    const r = await fetch(url, { method: method || (body === undefined ? "GET" : "POST"), headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || "something went wrong"); e.missing = j.missing; throw e; }
    return j;
  };
  const qs = () => V.questions.filter((q) => q.round === V.round);
  const cur = () => qs()[IDX];
  const ans = (id) => (V.answers || {})[id];

  // ---- open, close, refresh ----------------------------------------------------
  async function start() {
    try { const v = await api(`/api/c/${SLUG}/intakes`, {}); await open(v.id); }
    catch (e) { alert(e.message); }
  }
  async function open(id) {
    ID = id; ERR = ""; EDITPT = null; SAWEND = false; READ = false; DESIGN_AT = null; loadChanges();
    if (!document.getElementById("ik-css")) { const s = document.createElement("style"); s.id = "ik-css"; s.textContent = CSS; document.head.appendChild(s); }
    if (!ROOT) {
      ROOT = document.createElement("div"); ROOT.id = "intake-root"; document.body.appendChild(ROOT);
      // every box with a limit says how much room is left once it gets close, and says so plainly when it is full
      ROOT.addEventListener("input", (e) => counter(e.target));
    }
    try { V = await api(`/api/intakes/${id}`); } catch (e) { alert(e.message); return; }
    IDX = firstOpen();
    MODE = modeFor();
    render();
    document.addEventListener("keydown", onKey);
    if (V.status === "thinking") poll();
  }
  function onKey(e) { if (e.key === "Escape") close(); }
  async function close() {
    if (window.Dictate && ROOT) Dictate.stop(ROOT);
    await flush();
    if (POLL) { clearInterval(POLL); POLL = null; }
    document.removeEventListener("keydown", onKey);
    if (ROOT) ROOT.innerHTML = "";
    ID = null; V = null;
    const u = new URL(location.href); if (u.searchParams.has("intake")) { u.searchParams.delete("intake"); history.replaceState(null, "", u.pathname + u.search); }
    if (typeof window.load === "function") window.load();
  }
  async function refresh() { if (!ID) return; V = await api(`/api/intakes/${ID}`); }
  function modeFor() {
    if (V.status === "thinking") return "think";
    if (V.status === "design") { freshDesign(); return "design"; }
    if (V.status === "confirmed" || V.status === "building" || V.status === "done") return "confirmed";
    if (V.status === "abandoned") return "gone";
    return "q";
  }
  function firstOpen() {
    const list = qs();
    const i = list.findIndex((q) => (V.missing || []).includes(q.id));
    if (i >= 0) return i;
    return V.round > 1 ? 0 : Math.min(list.length - 1, list.filter((q) => answered(q)).length);
  }
  function answered(q) {
    const v = ans(q.id);
    if (v == null) return false;
    if (q.kind === "text") return String(v).trim().length > 0;
    if (q.kind === "choice") return Boolean((v.picks && v.picks.length) || (v.other && String(v.other).trim()));
    if (q.kind === "roles") return Object.keys(v).length > 0;
    if (q.kind === "devices") return Object.values(v).some((d) => d && d.length);
    if (q.kind === "order" || q.kind === "items") return Array.isArray(v) && v.filter((s) => String(s).trim()).length >= (q.min || 1);
    return true;
  }
  function poll() {
    if (POLL) clearInterval(POLL);
    POLL = setInterval(async () => {
      try { await refresh(); } catch (e) { return; }
      if (V.status !== "thinking") {
        clearInterval(POLL); POLL = null;
        MODE = modeFor(); IDX = 0; render();
      }
    }, 2000);
  }

  // ---- the confirm screen's changes ------------------------------------------------------
  // Unsent changes are kept in this browser per request (a phone that locks, a popout closed by mistake), and dropped
  // once the agent has the design back. A new design (its time changes) starts the reading over: nothing is ticked.
  const changesKey = () => `ik-changes-${ID}`;
  let SAVED_AT = null;   // the version of the requirements the kept changes were written against
  function loadChanges() {
    CHANGES = new Map(); ADDS = []; SAVED_AT = null;
    try { const j = JSON.parse(localStorage.getItem(changesKey()) || "null"); if (j) { CHANGES = new Map(j.points || []); ADDS = j.adds || []; SAVED_AT = j.at || null; } } catch (e) {}
  }
  function keepChanges() {
    try { if (CHANGES.size || ADDS.length) localStorage.setItem(changesKey(), JSON.stringify({ points: [...CHANGES], adds: ADDS, at: (V && V.design && V.design.at) || null })); else localStorage.removeItem(changesKey()); } catch (e) {}
  }
  function freshDesign() {
    const at = (V.design || {}).at || null;
    if (at === DESIGN_AT) return;
    // the agent's new version answers the changes sent; kept ones written against another version are dropped too
    if (DESIGN_AT !== null || (SAVED_AT && SAVED_AT !== at)) { CHANGES = new Map(); ADDS = []; keepChanges(); }
    const ids = new Set(((V.design || {}).items || []).map((p) => p.id));
    for (const k of [...CHANGES.keys()]) if (!ids.has(k)) CHANGES.delete(k);
    DESIGN_AT = at; SAWEND = false; READ = false; EDITPT = null;
  }
  const pendingCount = () => CHANGES.size + ADDS.length;

  // ---- saving --------------------------------------------------------------------
  const pending = {};
  function stage(qid, value) {
    pending[qid] = value;
    V.answers = { ...(V.answers || {}), [qid]: value };
    if (SAVE) clearTimeout(SAVE);
    SAVE = setTimeout(flush, 700);
  }
  async function flush() {
    if (SAVE) { clearTimeout(SAVE); SAVE = null; }
    const ids = Object.keys(pending);
    for (const qid of ids) {
      const value = pending[qid]; delete pending[qid];
      try { const v = await api(`/api/intakes/${ID}/answer`, { id: qid, value }); if (V) { V.missing = v.missing; V.round_answered = v.round_answered; V.round_total = v.round_total; V.round_done = v.round_done; V.name = v.name; V.slug = v.slug; V.status = v.status; } ERR = ""; }
      catch (e) { ERR = e.message; if (V) render(); return false; }
    }
    if (V && ids.length) { const p = ROOT.querySelector(".ik-prog"); if (p) p.textContent = progressText(); const b = ROOT.querySelector(".ik-bar i"); if (b) b.style.width = progressPct() + "%"; const t = ROOT.querySelector(".ik-title"); if (t) t.textContent = titleText(); }
    return true;
  }

  function counter(el) {
    if (!el || !el.getAttribute || !el.getAttribute("maxlength")) return;
    const max = Number(el.getAttribute("maxlength")), len = (el.value || "").length;
    // the talk button (dictate.js) sits right under a box; the counter goes under that
    const mic = el.nextElementSibling && el.nextElementSibling.classList && el.nextElementSibling.classList.contains("sos-dictate") ? el.nextElementSibling : null;
    const after = mic || el;
    let c = after.nextElementSibling && after.nextElementSibling.classList && after.nextElementSibling.classList.contains("ik-count") ? after.nextElementSibling : null;
    if (len < max * 0.8) { if (c) c.remove(); return; }
    if (!c) { c = document.createElement("div"); c.className = "ik-count"; after.insertAdjacentElement("afterend", c); }
    c.textContent = len >= max ? `This box is full (${max} characters). Shorten it, or put the rest in the next answer.` : `${max - len} characters left`;
    c.classList.toggle("full", len >= max);
  }

  // ---- rendering -----------------------------------------------------------------
  const roundLabel = () => (MODE === "design" ? "Confirm the requirements" : MODE === "confirmed" ? "Confirmed" : V.round > 1 ? `The agent's questions, round ${V.round}` : "Your answers");
  const titleText = () => (V.name ? `New tool: ${V.name}` : "New tool");
  const neededLeft = () => qs().filter((q) => q.required && !answered(q)).length;
  const progressText = () => {
    if (MODE === "q") { const left = neededLeft(); return `${V.round_answered} of ${V.round_total} answered${left ? ` · ${left} needed` : ""}`; }
    if (MODE === "think") return "The agent is working";
    if (MODE === "design") { const n = ((V.design || {}).items || []).length; return `${n} point${n === 1 ? "" : "s"} to read`; }
    return "";
  };
  const progressPct = () => (MODE === "q" ? Math.round(100 * (V.round_answered / Math.max(1, V.round_total))) : MODE === "think" ? 100 : 100);
  function render() {
    if (!ROOT || !V) return;
    if (window.Dictate) Dictate.stop(ROOT);   // the box being listened to is about to be redrawn; keep what was heard
    let body = "", foot = "";
    if (MODE === "q") { body = questionHtml(cur()); foot = questionFoot(); }
    else if (MODE === "think") {
      const rv = (V.design || {}).revising;
      body = rv
        ? `<div class="ik-think"><div class="ik-spin"></div><b>The agent is making your ${rv.count === 1 ? "change" : `${rv.count} changes`}.</b><div class="ik-hint" style="margin-top:8px">Every point you did not ask about stays exactly as it was. This takes a minute or two. You can close this and come back; the card on the board shows when it is ready.</div></div>`
        : `<div class="ik-think"><div class="ik-spin"></div><b>The agent is reading your answers${V.attachments && V.attachments.length ? " and the files you attached" : ""}.</b><div class="ik-hint" style="margin-top:8px">${V.rounds_generated || V.enough ? "Writing the requirements for you to confirm." : "Deciding whether it needs to ask anything else, or can write the requirements."} This takes a minute or two. You can close this and come back; the card on the board shows when it is ready.</div></div>`;
      foot = `<span class="ik-sp"></span><button class="quiet" onclick="Intake.close()">Close for now</button>`;
    }
    else if (MODE === "design") { body = designHtml(); foot = designFoot(); }
    else if (MODE === "confirmed") {
      const msg = V.status === "done" ? `<b>${esc(V.name)} is on the floor.</b><div class="ik-hint">Open it from the Tools line at the top of the board. From here it improves through feedback like any other tool. What you confirmed is kept as its reference.</div>`
        : V.status === "building" ? `<b>The agent is building ${esc(V.name)}.</b><div class="ik-hint">Watch the card on the board: it shows each step, then a preview and the button that puts it on the floor. Building takes several minutes.</div>`
        : V.error ? `<b>Requirements confirmed, but the build did not start.</b><div class="ik-hint">${esc(V.error)}. Use "Build it now" on the card to try again.</div>`
        : `<b>Requirements confirmed.</b><div class="ik-hint">The build starts from the card on the board ("Build it now").</div>`;
      body = `<div class="ik-done">${msg}${refDetails()}</div>`; foot = `<span class="ik-sp"></span><button class="primary" onclick="Intake.close()">Close</button>`;
    }
    else { body = `<div class="ik-done"><b>This request was withdrawn.</b></div>`; foot = `<span class="ik-sp"></span><button class="primary" onclick="Intake.close()">Close</button>`; }
    ROOT.innerHTML = `<div class="ik-back" onclick="if(event.target===this)Intake.close()"><div class="ik-box" role="dialog" aria-modal="true">
      <div class="ik-head"><span class="ik-round">${esc(roundLabel())}</span><span class="ik-title">${esc(titleText())}</span><span class="ik-prog">${esc(progressText())}</span><button class="ik-x" onclick="Intake.close()">Close</button></div>
      <div class="ik-bar"><i style="width:${progressPct()}%"></i></div>${MODE === "q" ? dotsHtml() : ""}
      <div class="ik-body">${body}${ERR ? `<div class="ik-err">${esc(ERR)}</div>` : ""}${V.error && MODE !== "think" ? `<div class="ik-err">Last time the agent was asked, it did not finish: ${esc(V.error)}. Try again below.</div>` : ""}</div>
      <div class="ik-foot">${foot}</div></div></div>`;
    // every answer box can be talked into instead of typed (dictate.js); the words save like typing does
    if (window.Dictate) Dictate.scan(ROOT, ".ik-body textarea");
    for (const el of ROOT.querySelectorAll("[maxlength]")) counter(el);
    const f = ROOT.querySelector(".ik-body textarea, .ik-body input[type=text]");
    if (f && MODE === "q" && window.innerWidth > 640) f.focus();
    if (MODE === "design") {
      const b = ROOT.querySelector(".ik-body");
      if (b) { b.addEventListener("scroll", seenEnd, { passive: true }); setTimeout(seenEnd, 50); }
      const ed = ROOT.querySelector(".ik-editor textarea");
      if (ed) { ed.focus(); ed.scrollIntoView({ block: "nearest" }); }
    }
  }
  // One dot per question of the round: green answered, a red ring for a needed one still empty that is behind you, a
  // ring on the one in front of you. Tap one to go there.
  function dotsHtml() {
    const list = qs();
    if (list.length < 2) return "";
    return `<div class="ik-dots" role="navigation" aria-label="The questions">${list.map((q, i) => {
      const cls = answered(q) ? "done" : q.required && (i < IDX || (V.missing || []).includes(q.id) && ERR) ? "miss" : "";
      return `<button class="ik-dot ${cls} ${i === IDX ? "now" : ""}" title="${esc(`${i + 1}. ${q.text}${q.required ? "" : " (optional)"}`)}" aria-label="Question ${i + 1}${answered(q) ? ", answered" : q.required ? ", needed" : ", optional"}" onclick="Intake.go(${i})"></button>`;
    }).join("")}</div>`;
  }
  // the "I've read all" tick shows once the end of the list has been on screen (or everything fits without scrolling)
  function seenEnd() {
    if (SAWEND || !ROOT || MODE !== "design") return;
    const b = ROOT.querySelector(".ik-body");
    if (!b) return;
    if (b.scrollTop + b.clientHeight >= b.scrollHeight - 30) {
      SAWEND = true;
      const r = ROOT.querySelector("#ik-readall");
      if (r) { r.hidden = false; if (b.scrollHeight > b.clientHeight + 2) r.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
      const g = ROOT.querySelector(".ik-foot .ik-gate"); if (g) g.textContent = "Tick the box above when you have read every point.";
    }
  }
  function questionFoot() {
    const list = qs(), last = IDX >= list.length - 1;
    const roundOne = V.round === 1;
    return `<button class="quiet" ${IDX === 0 ? "disabled" : ""} onclick="Intake.prev()">Back</button><span class="ik-sp"></span>`
      + (last ? `<button class="go" onclick="Intake.finishRound()">${roundOne ? "Done with these, ask the agent" : "Done, back to the agent"}</button>` : `<button class="primary" onclick="Intake.next()">Next</button>`);
  }
  function questionHtml(q) {
    if (!q) return `<div class="ik-done"><b>Nothing to answer right now.</b></div>`;
    // needed or optional, and what the answer is for, on one line above the question (2026-10-01)
    const need = `<div class="ik-need"><span class="ik-chipneed ${q.required ? "" : "opt"}">${q.required ? "Needed" : "Optional"}</span>${q.why ? `<span>${esc(q.why)}</span>` : ""}</div>`;
    let h = `${need}<div class="ik-q">${esc(q.text)}</div><div class="ik-hint">${esc(q.hint || "")}</div>`;
    if (IDX === 0 && V.round > 1) { const r = roundWhy(); if (r) h = `<div class="ik-why">${esc(r)}</div>` + h; }
    switch (q.kind) {
      case "text": h += q.multiline === false ? `<input type="text" maxlength="${q.max || 200}" value="${esc(ans(q.id) || "")}" oninput="Intake.setText('${q.id}', this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();Intake.next();}">` : `<textarea maxlength="${q.max || 2000}" oninput="Intake.setText('${q.id}', this.value)">${esc(ans(q.id) || "")}</textarea>`; break;
      case "choice": h += choiceHtml(q); break;
      case "roles": h += rolesHtml(q); break;
      case "devices": h += devicesHtml(q); break;
      case "order": h += listHtml(q, true); break;
      case "items": h += listHtml(q, false); break;
      case "attach": h += `<textarea placeholder="Anything to say about it (optional)" oninput="Intake.setAttachNote('${q.id}', this.value)">${esc((ans(q.id) || {}).note || "")}</textarea>`; break;
      default: h += `<textarea oninput="Intake.setText('${q.id}', this.value)">${esc(ans(q.id) || "")}</textarea>`;
    }
    if (q.attach || q.kind === "attach") h += filesHtml(q);
    return h;
  }
  function roundWhy() { return V.round_why || ""; }
  function choiceHtml(q) {
    const v = ans(q.id) || { picks: [], other: "", names: {}, note: "" };
    const picks = v.picks || [];
    let h = `<div class="ik-chips">${(q.options || []).map((o) => `<button class="ik-chip ${picks.includes(o.id) ? "on" : ""}" onclick="Intake.pick('${q.id}','${o.id}')">${esc(o.label)}</button>`).join("")}${q.other !== false ? `<button class="ik-chip ${v.otherOn || (v.other && v.other.trim()) ? "on" : ""}" onclick="Intake.pickOther('${q.id}')">Something else</button>` : ""}</div>`;
    for (const oid of picks) if ((q.names_for || []).includes(oid)) h += `<div class="ik-sub">What do you call ${esc(((q.options || []).find((o) => o.id === oid) || {}).label || "it").toLowerCase()}?</div><input type="text" value="${esc((v.names || {})[oid] || "")}" oninput="Intake.setName('${q.id}','${oid}', this.value)" placeholder="The name you use for it">`;
    if (v.otherOn || (v.other && v.other.trim())) h += `<div class="ik-sub">Something else</div><input type="text" value="${esc(v.other || "")}" oninput="Intake.setOther('${q.id}', this.value)" placeholder="Say it in your words">`;
    if (q.note) h += `<div class="ik-sub">In your words</div><textarea oninput="Intake.setNote('${q.id}', this.value)">${esc(v.note || "")}</textarea>`;
    return h;
  }
  function rolesHtml(q) {
    const v = ans(q.id) || {};
    let h = `<div class="ik-chips">${q.options.map((o) => `<button class="ik-chip ${o.id in v ? "on" : ""}" onclick="Intake.toggleRole('${q.id}','${o.id}')">${esc(o.label)}</button>`).join("")}</div>`;
    for (const o of q.options) if (o.id in v) h += `<div class="ik-grp"><b>${esc(o.label)}</b>About how many? <input type="number" min="1" max="9999" value="${esc(v[o.id] || "")}" oninput="Intake.setCount('${q.id}','${o.id}', this.value)"></div>`;
    return h;
  }
  function devicesHtml(q) {
    const who = ans("who") || {};
    const groups = (V.questions.find((x) => x.id === "who") || { options: [] }).options.filter((o) => o.id in who);
    if (!groups.length) return `<div class="ik-hint">Pick who uses it on the previous screen first.</div>`;
    const v = ans(q.id) || {};
    return groups.map((g) => `<div class="ik-grp"><b>${esc(g.label)}</b><div class="ik-chips">${q.options.map((d) => `<button class="ik-chip ${(v[g.id] || []).includes(d.id) ? "on" : ""}" onclick="Intake.toggleDevice('${q.id}','${g.id}','${d.id}')">${esc(d.label)}</button>`).join("")}</div></div>`).join("");
  }
  function listHtml(q, ordered) {
    const v = (ans(q.id) || []).slice();
    if (!v.length) v.push("");
    const max = q.max || 12;
    let h = v.map((s, i) => `<div class="ik-row">${ordered ? `<span class="ik-n">${i + 1}.</span>` : ""}<input type="text" maxlength="${q.item_max || 120}" value="${esc(s)}" oninput="Intake.setItem('${q.id}', ${i}, this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();Intake.addItem('${q.id}', ${i + 1});}">${ordered ? `<button ${i === 0 ? "disabled" : ""} onclick="Intake.moveItem('${q.id}', ${i}, -1)" title="Move up">&#8593;</button><button ${i === v.length - 1 ? "disabled" : ""} onclick="Intake.moveItem('${q.id}', ${i}, 1)" title="Move down">&#8595;</button>` : ""}<button onclick="Intake.removeItem('${q.id}', ${i})" title="Remove">&#10005;</button></div>`).join("");
    if (v.length < max) h += `<button class="ik-add" onclick="Intake.addItem('${q.id}')">${ordered ? "Add a stage" : "Add another"}</button>`;
    return h;
  }
  function filesHtml(q) {
    const files = (V.attachments || []).filter((a) => a.question_id === q.id);
    let h = `<div class="ik-files">${files.map((a) => `<div class="ik-file">${a.kind === "image" ? `<img src="/api/attachments/${a.id}" alt="">` : `<span style="font-size:22px">${a.kind === "sheet" ? "&#9638;" : "&#9636;"}</span>`}<span class="ik-meta"><b>${esc(a.filename)}</b><br>${a.kind === "sheet" && a.parsed ? `${a.parsed.row_count} rows: ${esc((a.parsed.headers || []).filter(Boolean).slice(0, 6).join(", "))}` : `${Math.max(1, Math.round(a.size / 1024))} KB`}</span><button onclick="Intake.removeFile(${a.id})" title="Remove">&#10005;</button></div>`).join("")}</div>`;
    h += `<label class="ik-attach">${files.length ? "Add another file" : "Attach a photo or a spreadsheet"}<input type="file" accept="image/*,.pdf,.csv,.xlsx,.tsv,.txt,application/pdf,text/csv" onchange="Intake.addFile('${q.id}', this)"></label> <span class="ik-hint" style="display:inline">A photo, a pdf, a csv or an xlsx. Up to 15 MB each.</span>`;
    return h;
  }
  function refDetails() {
    const d = V.design || {};
    return d.reference_md ? `<details style="text-align:left;margin-top:14px"><summary style="cursor:pointer;font-weight:700;color:var(--navy)">The reference</summary><div class="ik-ref" style="margin-top:8px">${esc(d.reference_md)}</div></details>` : "";
  }
  // The confirm screen (2026-10-01, from two first-time users): it says it is the requirements being confirmed and
  // what to do, the points are numbered with a tag for what each is about, a change goes to the agent in words
  // ("Change this", "Add something missing") instead of an edit of the full text, and one "I've read all N points"
  // tick, shown once the end of the list has been on screen, opens Approve build.
  const KIND_WORDS = { stages: "How it moves", people: "Who uses it", screen: "A screen", rule: "A rule", number: "A number it shows", connection: "What it works with", data: "Starting data", later: "Left for later" };
  function designHtml() {
    const d = V.design || {};
    const items = d.items || [];
    const n = items.length, pend = pendingCount();
    let h = `<div class="ik-intro"><b>Confirm the requirements</b>This is what the agent understood from your answers, in ${n} point${n === 1 ? "" : "s"}. Read each one. If one is wrong or something is missing, say so under it and the agent changes only that. When every point is right, confirm and the build starts.</div>`;
    h += `<div class="ik-bluf">${esc(d.bluf || "")}</div>`;
    h += `<ol class="ik-points">${items.map((it, i) => pointHtml(it, i)).join("")}</ol>`;
    if ((d.removed || []).length) h += `<div class="ik-removed">Taken out as you asked: ${esc(d.removed.join("; "))}</div>`;
    h += ADDS.map((a, i) => `<div class="ik-ask"><b>To add:</b> ${esc(a)}<button class="ik-link" onclick="Intake.dropAdd(${i})">remove</button></div>`).join("");
    if (EDITPT === "add") h += editorHtml("add", "", "What is missing? Say it in your words.");
    else h += `<button class="ik-add" onclick="Intake.changePoint('add')">+ Add something missing</button>`;
    if ((d.flags || []).length) h += `<div class="ik-flag">A few lines use words we try to avoid (${esc(d.flags.map((f) => `${f.where}: ${f.words.join(", ")}`).join("; "))}). Ask for a change under the point if you want them said differently.</div>`;
    // what it costs is not shown here (Brendan, 2026-09-20: no cost on the board); the estimate stays on the intake record and the admin page
    h += `<div class="ik-est">The first version: ${(d.screens || []).length} screen${(d.screens || []).length === 1 ? "" : "s"}, ${(d.connections || []).length} connection${(d.connections || []).length === 1 ? "" : "s"}.</div>`;
    // outside systems that are not turned on for this tool go to Anetix's integration team when this is approved (src/intake.js)
    const ho = (d.handoffs || []).filter((x) => x && x.system);
    if (ho.length) h += `<div class="ik-est" data-handoffs="${ho.length}"><b>Connected later by Anetix:</b> ${ho.map((x) => `${esc(x.system)}${x.until ? ` (until then, ${esc(String(x.until).replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase()))})` : ""}`).join("; ")}. Approving sends ${ho.length === 1 ? "it" : "them"} to Anetix's integration team, who set up the connection with you.</div>`;
    h += `<details><summary style="cursor:pointer;font-weight:700;color:var(--navy)">Read the full reference</summary><div class="ik-ref" style="margin-top:8px">${esc(d.reference_md || "")}</div></details>`;
    if (pend) h += `<div class="ik-pend" data-pending="${pend}"><b>${pend === 1 ? "1 change" : `${pend} changes`} to send.</b> The agent makes ${pend === 1 ? "it" : "them"} in one pass and keeps every other point as it is. Then you read the points it changed and confirm.</div>`;
    else h += `<label class="ik-readall" id="ik-readall" ${SAWEND ? "" : "hidden"}><input type="checkbox" ${READ ? "checked" : ""} onchange="Intake.readAll(this.checked)"> I've read all ${n} point${n === 1 ? "" : "s"}</label>`;
    h += `<div class="ik-end"></div>`;
    return h;
  }
  function pointHtml(it, i) {
    const ask = CHANGES.get(it.id);
    const tag = KIND_WORDS[it.kind] ? `<span class="ik-tag">${KIND_WORDS[it.kind]}</span>` : "";
    const mark = it.mark === "new" ? `<span class="ik-mark new">New</span>` : it.mark === "changed" ? `<span class="ik-mark">Changed as you asked</span>` : it.mark === "fit" ? `<span class="ik-mark">Changed to fit</span>` : "";
    let h = `<li class="ik-pt" data-pt="${esc(it.id)}"><span class="ik-num">${i + 1}</span><div class="ik-ptbody">${tag}${mark}<div class="ik-ptext">${esc(it.summary)}</div>`;
    if (EDITPT === it.id) h += editorHtml(it.id, ask || "", "What should be different about this point?");
    else if (ask) h += `<div class="ik-ask"><b>Your change:</b> ${esc(ask)}<button class="ik-link" onclick="Intake.changePoint('${esc(it.id)}')">edit</button><button class="ik-link" onclick="Intake.dropChange('${esc(it.id)}')">remove</button></div>`;
    else h += `<button class="ik-link" onclick="Intake.changePoint('${esc(it.id)}')">Change this</button>`;
    return h + `</div></li>`;
  }
  function editorHtml(which, value, placeholder) {
    return `<div class="ik-editor"><textarea id="ik-ed" maxlength="2000" placeholder="${esc(placeholder)}">${esc(value)}</textarea><div class="ik-row2"><button class="primary" onclick="Intake.saveChange()">${which === "add" ? "Add it" : "Keep this change"}</button><button class="quiet" onclick="Intake.cancelChange()">Cancel</button></div></div>`;
  }
  function designFoot() {
    const pend = pendingCount();
    if (pend) return `<button class="quiet" onclick="Intake.restart()">Start over</button><span class="ik-sp"></span><button class="go" id="ik-send" onclick="Intake.sendChanges()">Send ${pend === 1 ? "1 change" : `${pend} changes`} to the agent</button>`;
    return `<button class="quiet" onclick="Intake.restart()">Start over</button><span class="ik-gate">${SAWEND ? "Tick the box above when you have read every point." : "Read to the end of the list to confirm."}</span><span class="ik-sp"></span><button class="go" id="ik-approve" ${READ ? "" : "disabled"} onclick="Intake.approve()">Approve build</button>`;
  }

  // ---- actions --------------------------------------------------------------------
  function setText(qid, val) { stage(qid, val); }
  function setAttachNote(qid, val) { stage(qid, { ...(ans(qid) || {}), note: val }); }
  function choiceVal(qid) { return { picks: [], other: "", names: {}, note: "", ...(ans(qid) || {}) }; }
  function pick(qid, oid) {
    const q = qs().find((x) => x.id === qid) || V.questions.find((x) => x.id === qid); const v = choiceVal(qid);
    if (q.multi) v.picks = v.picks.includes(oid) ? v.picks.filter((p) => p !== oid) : [...v.picks, oid];
    else v.picks = v.picks.includes(oid) ? [] : [oid];
    if (v.picks.includes("nothing") && v.picks.length > 1) v.picks = oid === "nothing" ? ["nothing"] : v.picks.filter((p) => p !== "nothing");
    if (v.picks.includes("none") && v.picks.length > 1) v.picks = oid === "none" ? ["none"] : v.picks.filter((p) => p !== "none");
    stage(qid, v); render();
  }
  function pickOther(qid) { const v = choiceVal(qid); v.otherOn = !(v.otherOn || (v.other && v.other.trim())); if (!v.otherOn) v.other = ""; stage(qid, v); render(); }
  function setOther(qid, val) { const v = choiceVal(qid); v.other = val; v.otherOn = true; stage(qid, v); }
  function setName(qid, oid, val) { const v = choiceVal(qid); v.names = { ...(v.names || {}), [oid]: val }; stage(qid, v); }
  function setNote(qid, val) { const v = choiceVal(qid); v.note = val; stage(qid, v); }
  function toggleRole(qid, gid) { const v = { ...(ans(qid) || {}) }; if (gid in v) delete v[gid]; else v[gid] = ""; stage(qid, v); render(); }
  function setCount(qid, gid, val) { const v = { ...(ans(qid) || {}) }; v[gid] = val; stage(qid, v); }
  function toggleDevice(qid, gid, did) { const v = { ...(ans(qid) || {}) }; const cur = v[gid] || []; v[gid] = cur.includes(did) ? cur.filter((d) => d !== did) : [...cur, did]; stage(qid, v); render(); }
  function setItem(qid, i, val) { const v = (ans(qid) || []).slice(); while (v.length <= i) v.push(""); v[i] = val; stage(qid, v); }
  function addItem(qid, at) { const q = V.questions.find((x) => x.id === qid); const v = (ans(qid) || []).slice(); if (!v.length) v.push(""); if (v.length >= (q.max || 12)) return; if (at == null || at >= v.length) v.push(""); else v.splice(at, 0, ""); stage(qid, v); render(); const inputs = ROOT.querySelectorAll(".ik-row input[type=text]"); const target = inputs[at == null ? inputs.length - 1 : at]; if (target) target.focus(); }
  function removeItem(qid, i) { const v = (ans(qid) || []).slice(); v.splice(i, 1); stage(qid, v); render(); }
  function moveItem(qid, i, d) { const v = (ans(qid) || []).slice(); const j = i + d; if (j < 0 || j >= v.length) return; [v[i], v[j]] = [v[j], v[i]]; stage(qid, v); render(); }
  async function addFile(qid, input) {
    const f = input.files && input.files[0]; if (!f) return;
    if (f.size > 15 * 1024 * 1024) { ERR = "That file is bigger than 15 MB."; render(); return; }
    ERR = ""; const label = input.parentElement; if (label) label.textContent = "Uploading " + f.name + "...";
    try {
      await flush();
      const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = rej; r.readAsDataURL(f); });
      const j = await api(`/api/intakes/${ID}/attach`, { question_id: qid, filename: f.name, mime: f.type || "", data });
      V.attachments = j.view.attachments;
    } catch (e) { ERR = e.message; }
    render();
  }
  async function removeFile(aid) { try { const v = await api(`/api/intakes/${ID}/attach/${aid}`, undefined, "DELETE"); V.attachments = v.attachments; ERR = ""; } catch (e) { ERR = e.message; } render(); }
  async function next() { if (!(await flush())) return; if (IDX < qs().length - 1) { IDX++; ERR = ""; render(); } }
  async function prev() { await flush(); if (IDX > 0) { IDX--; ERR = ""; render(); } }
  async function finishRound() {
    if (!(await flush())) return;
    try {
      V = await api(`/api/intakes/${ID}/next`, {});
      MODE = "think"; ERR = ""; render(); poll();
    } catch (e) {
      if (e.missing && e.missing.length) { const list = qs(); const i = list.findIndex((q) => q.id === e.missing[0].id); if (i >= 0) IDX = i; ERR = `Still needed: ${e.missing.map((m) => m.text).join(" / ")}`; }
      else ERR = e.message;
      render();
    }
  }
  function go(i) { flush(); if (i >= 0 && i < qs().length) { IDX = i; ERR = ""; render(); } }
  // the confirm screen
  function editorText() { const t = document.getElementById("ik-ed"); return t ? t.value.trim() : ""; }
  function changePoint(which) { if (EDITPT && editorText()) saveChange(); EDITPT = which; render(); }
  function cancelChange() { EDITPT = null; render(); }
  function saveChange() {
    const text = editorText();
    if (EDITPT === "add") { if (text) ADDS.push(text); }
    else if (EDITPT) { if (text) CHANGES.set(EDITPT, text); else CHANGES.delete(EDITPT); }
    EDITPT = null; READ = false; keepChanges(); render();
  }
  function dropChange(id) { CHANGES.delete(id); keepChanges(); render(); }
  function dropAdd(i) { ADDS.splice(i, 1); keepChanges(); render(); }
  function readAll(on) { READ = Boolean(on); const b = document.getElementById("ik-approve"); if (b) b.disabled = !READ; const g = ROOT && ROOT.querySelector(".ik-foot .ik-gate"); if (g) g.textContent = READ ? "Approving starts the build." : "Tick the box above when you have read every point."; }
  async function sendChanges() {
    if (EDITPT && editorText()) saveChange();
    const changes = [...[...CHANGES].map(([point, text]) => ({ point, text })), ...ADDS.map((text) => ({ point: null, text }))];
    if (!changes.length) return;
    const b = document.getElementById("ik-send"); if (b) { b.disabled = true; b.textContent = "Sending..."; }
    try { V = await api(`/api/intakes/${ID}/revise`, { changes }); MODE = "think"; ERR = ""; render(); poll(); }
    catch (e) { ERR = e.message; render(); }
  }
  async function approve() {
    try { V = await api(`/api/intakes/${ID}/confirm`, {}); CHANGES = new Map(); ADDS = []; keepChanges(); MODE = "confirmed"; ERR = ""; render(); }
    catch (e) { ERR = e.message; render(); }
  }
  async function restart() {
    if (!confirm("Start over? Your answers to the fixed questions are kept; the agent's questions and the requirements are dropped.")) return;
    try { V = await api(`/api/intakes/${ID}/restart`, {}); MODE = "q"; IDX = firstOpen(); CHANGES = new Map(); ADDS = []; keepChanges(); DESIGN_AT = null; ERR = ""; render(); }
    catch (e) { ERR = e.message; render(); }
  }
  async function tryAgain() { await finishRound(); }

  return { start, open, close, next, prev, go, finishRound, setText, setAttachNote, pick, pickOther, setOther, setName, setNote, toggleRole, setCount, toggleDevice, setItem, addItem, removeItem, moveItem, addFile, removeFile, changePoint, cancelChange, saveChange, dropChange, dropAdd, readAll, sendChanges, approve, restart, tryAgain, current: () => ID };
})();
