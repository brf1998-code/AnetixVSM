// The Sites tab of /admin (src/sites.js, docs/PAID-SITES.md): the price book with a quick quote for a call, the
// count at each stage from a demo to a paying site, and one row per site with the fields from the pricing strategy.
// A row opens a form for what Brendan learns (the site, its legal name and address, the plant manager, its size, what
// they asked for, the master agreement, the plant manager's approval limit, a note); the band and the price follow
// the size. Stage 1: nothing here charges anyone. Mounted by admin.html (AdminShell onShow "sites"). No secret lives
// here: /assets is served before the login, and every call it makes is an admin-only route.
(function () {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const usd = (x) => `$${Number(x || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const num = (x) => Number(x || 0).toLocaleString("en-US");
  const day = (t) => (t ? new Date(t).toLocaleDateString([], { month: "short", day: "numeric" }) : "");
  const ago = (t) => {
    if (!t) return "never";
    const m = (Date.now() - new Date(t).getTime()) / 60000;
    return m < 2 ? "just now" : m < 90 ? `${Math.round(m)} min ago` : m < 36 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
  };
  const root = () => document.getElementById("sites-root");
  let DATA = null, EDIT = null, QUOTE_T = null;

  function style() {
    if (document.getElementById("as-style")) return;
    const s = document.createElement("style"); s.id = "as-style";
    s.textContent = `
      #sites-root table.list td { vertical-align:top; }
      #sites-root tr.row { cursor:pointer; } #sites-root tr.row:hover td { background:var(--fog); }
      #sites-root td b { display:block; } #sites-root td small { display:block; color:var(--steel); font-size:11.5px; line-height:1.4; }
      #sites-root td small.flag { color:#b26a00; } #sites-root td .none { color:var(--steel); font-style:italic; }
      #sites-root .chip.demo, #sites-modal .chip.demo { background:#dfeaf6; color:#1f5c99; } #sites-root .chip.prop, #sites-modal .chip.prop { background:#fff4e0; color:#b26a00; }
      #sites-root .stages { display:flex; flex-wrap:wrap; gap:6px; margin:6px 0 2px; }
      #sites-root .stages span { background:var(--fog); border:1px solid var(--line); border-radius:14px; padding:4px 11px; font-size:12.5px; }
      #sites-root .stages span b { margin-left:4px; } #sites-root .stages span.on { border-color:var(--navy); background:#fff; } #sites-root .stages span.amber { border-color:var(--amber); }
      #sites-root .quote { display:flex; flex-wrap:wrap; gap:8px; align-items:flex-end; margin-top:10px; }
      #sites-root .quote label { font-size:12px; color:var(--steel); }
      #sites-root .quote input { display:block; width:150px; margin-top:3px; }
      #sites-root .qline { margin-top:8px; }
      #sites-root td.price b { font-size:14px; }
      #sites-modal { display:none; position:fixed; inset:0; background:rgba(28,36,46,.55); z-index:30; align-items:flex-start; justify-content:center; padding:24px 16px; overflow-y:auto; }
      #sites-modal.on { display:flex; }
      #sites-modal .scard { background:#fff; border-radius:14px; padding:18px 20px; width:100%; max-width:640px; }
      #sites-modal h2 { font-size:17px; margin:0 0 2px; } #sites-modal h3 { font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:var(--steel); margin:14px 0 4px; }
      #sites-modal .fgrid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px 12px; }
      #sites-modal .fgrid .wide { grid-column:1 / -1; }
      #sites-modal label { font-size:12px; color:var(--steel); display:block; }
      #sites-modal input, #sites-modal textarea { width:100%; margin-top:3px; box-sizing:border-box; }
      #sites-modal textarea { font-family:inherit; font-size:13px; border:1px solid var(--line); border-radius:7px; padding:7px; min-height:64px; }
      #sites-modal .check { display:flex; align-items:center; gap:6px; color:var(--ink); font-size:13px; margin-top:18px; }
      #sites-modal .check input { width:auto; margin:0; }
      #sites-modal .err { color:var(--red); margin-top:8px; font-size:13px; }
      #sites-modal .foot { display:flex; gap:6px; flex-wrap:wrap; margin-top:12px; }
      @media (max-width:640px) {
        #sites-modal .fgrid { grid-template-columns:minmax(0,1fr); }
        #sites-modal input, #sites-modal textarea { font-size:16px; }
        #sites-modal .foot button { flex:1; }
        #sites-root .quote input { width:130px; font-size:16px; }
      }
    `;
    document.head.appendChild(s);
    const m = document.createElement("div"); m.id = "sites-modal"; m.innerHTML = '<div class="scard" id="sites-mcard" role="dialog" aria-modal="true"></div>';
    m.addEventListener("click", (e) => { if (e.target === m) close(); });
    document.body.appendChild(m);
  }
  async function get(url) {
    const r = await fetch(url, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `failed (${r.status})`);
    return j;
  }
  async function send(url, body) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, json: j };
  }
  const range = (b) => (b.max == null ? `${num(b.min)} and up` : `${num(b.min)} to ${num(b.max)}`);
  const bandLine = (band) => band
    ? `<b>${esc(band.name)} site: ${usd(band.monthly_usd)} a month</b>, ${usd(band.annual_usd)} a year${band.proposed ? ' <span class="chip prop">PRICE PROPOSED</span>' : ""}.
       <span class="sub">Fair-use line ${usd(band.fair_use_usd)}. ${esc(band.why)}.</span>${band.flags.map((f) => `<br><small class="sub" style="color:#b26a00">${esc(f.text)}.</small>`).join("")}`
    : "";

  // ---- the tab --------------------------------------------------------------------------------------------------------
  function draw() {
    const D = DATA, B = D.book;
    const bands = B.bands.map((b) => `<tr><td><b>${esc(b.name)}</b>${b.proposed ? '<span class="chip prop">PROPOSED</span>' : ""}</td><td>${esc(range(b))}</td><td>${usd(b.monthly_usd)}</td><td>${usd(b.annual_usd)}</td><td>${usd(b.fair_use_usd)}</td><td>${b.sqft_min ? `${num(b.sqft_min)} sq ft` : '<span class="sub">none</span>'}</td></tr>`).join("");
    const st = D.stages || {};
    const chip = (key, label, n, cls) => `<span class="${n ? cls || "on" : ""}">${esc(label)}<b>${n || 0}</b></span>`;
    const stages = [
      chip("demo", "Demo", st.demo), chip("ordering", "Ordering", st.ordering), chip("signed", "Signed, waiting on you", st.signed, "amber"),
      chip("activating", "Switching on", st.activating), chip("subscribed", "Subscribed", st.subscribed), chip("attention", "Needs attention", D.attention, "amber"),
      chip("cancelling", "Cancelling", D.cancelling), chip("back_to_demo", "Back to demo", st.back_to_demo),
    ].join("");
    const rows = D.rows.map((r) => {
      const d = r.deal || {}, pm = r.plant_manager || {}, ma = d.master_agreement || {};
      const dealBits = [
        d.integrations ? `ERP or other: ${esc(d.integrations)}` : "", d.hardware ? `Hardware: ${esc(d.hardware)}` : "",
        ma.yes ? `Master agreement${ma.signed_at ? ` signed ${esc(ma.signed_at)}` : ""}` : "", d.approval_limit_usd != null ? `Approves up to ${usd(d.approval_limit_usd)}` : "",
      ].filter(Boolean);
      return `<tr class="row" data-slug="${esc(r.slug)}" onclick="AdminSites.edit(this.dataset.slug)">
        <td><b>${esc(r.name)}${r.demo ? '<span class="chip demo">DEMO</span>' : ""}</b><small>${esc(r.legal_name || r.slug)}</small></td>
        <td>${r.site_name ? `<b>${esc(r.site_name)}</b>` : '<span class="none">not given</span>'}${r.address_line ? `<small>${esc(r.address_line)}</small>` : ""}</td>
        <td>${pm.name ? `<b>${esc(pm.name)}</b>` : '<span class="none">not given</span>'}${pm.title ? `<small>${esc(pm.title)}</small>` : ""}${pm.email ? `<small>${esc(pm.email)}</small>` : ""}</td>
        <td>${r.headcount ? `<b>${num(r.headcount)} people</b>` : '<span class="none">not known</span>'}${r.sqft ? `<small>${num(r.sqft)} sq ft</small>` : ""}</td>
        <td class="price">${r.band ? `<b>${esc(r.band.name)} · ${usd(r.band.monthly_usd)}/mo</b>${r.band.moved_up ? "<small>moved up for floor space</small>" : ""}${r.band.proposed ? "<small>price proposed</small>" : ""}${r.band.flags.map((f) => `<small class="flag">${esc(f.text)}</small>`).join("")}` : '<span class="none">needs a headcount</span>'}</td>
        <td>${r.demo_holder ? `<b>${esc(r.demo_holder)}</b>` : '<span class="none">no demo</span>'}${r.demo_since ? `<small>since ${esc(day(r.demo_since))}, ${r.last_activity ? `active ${esc(ago(r.last_activity))}` : "no activity yet"}</small>` : ""}${r.ai_spent_usd != null ? `<small>AI spent ${usd(r.ai_spent_usd)}${r.credit_percent != null ? `, ${esc(r.credit_percent)}% credit left` : ""}</small>` : ""}</td>
        <td>${r.tools_live ? `<b>${r.tools_live} live</b>` : '<span class="none">none live</span>'}${r.tools.length ? `<small>${r.tools.map((t) => esc(t.title || t.name)).join(", ")}</small>` : ""}</td>
        <td>${dealBits.length ? dealBits.map((x) => `<small>${x}</small>`).join("") : '<span class="none">nothing yet</span>'}</td>
        <td><b>${esc(r.stage_label)}</b>${r.standing_label ? `<small>${esc(r.standing_label)}</small>` : ""}</td></tr>`;
    }).join("");
    root().innerHTML = `
      <div class="card"><h2>Price book <small>version ${esc(B.version)} · full price from month one</small></h2>
        <div style="overflow-x:auto"><table class="list"><tr><th>Band</th><th>People at the site, all shifts</th><th>Monthly</th><th>Annual</th><th>Fair-use line</th><th>Floor space that moves a site into it</th></tr>${bands}</table></div>
        <p class="sub" style="margin:8px 0 0">Floor space moves a site up one band at most.${B.sqft_proposed ? " The floor-space thresholds are proposed: 1,500 square feet a person at each edge." : ""} The fair-use line is ${Math.round(B.fair_use_share * 100)}% of the fee: past it, new AI work waits for the next billing month and the floor's tools keep working. You hear at ${Math.round(B.alert_share * 100)}% of the fee; the customer never sees a meter.</p>
        <div class="quote"><label>People at the site, all shifts<input id="sq-head" inputmode="numeric" placeholder="e.g. 120" autocomplete="off"></label><label>Floor space, square feet<input id="sq-sqft" inputmode="numeric" placeholder="optional" autocomplete="off"></label><span class="sub" style="padding-bottom:9px">Quick quote for a call</span></div>
        <div class="qline" id="sq-line"></div></div>
      <div class="card"><h2>Pipeline <small>from a demo to a paying site</small></h2>
        <div class="stages">${stages}</div>
        <p class="sub" style="margin:6px 0 0">Every company that came in from anetix.ai is a row. Open one to fill in what you learn; its band and price follow the size. Going live from the board, the signed order form and Activate come in the next stages.</p>
        ${D.rows.length ? `<div style="overflow-x:auto;margin-top:8px"><table class="list" id="sites-table"><tr><th>Company</th><th>Site</th><th>Plant manager</th><th>Size</th><th>Band</th><th>Demo</th><th>Tools</th><th>Deal</th><th>Stage</th></tr>${rows}</table></div>` : '<p class="sub" style="margin-top:10px">Nobody has come in from anetix.ai yet. Make a pin on the Pins tab.</p>'}</div>`;
    const h = document.getElementById("sq-head"), s = document.getElementById("sq-sqft");
    const go = () => quote(h.value, s.value, document.getElementById("sq-line"));
    h.addEventListener("input", go); s.addEventListener("input", go);
    if (window.AdminShell && AdminShell.setBadge) AdminShell.setBadge("sites", (st.signed || 0) + (D.attention || 0) ? { n: (st.signed || 0) + (D.attention || 0), level: "amber" } : { n: undefined, level: null });
  }
  // the band for a headcount and a floor space, worked out by the server (the one place sizing lives)
  function quote(head, sqft, into) {
    clearTimeout(QUOTE_T);
    if (!String(head || "").trim()) { into.innerHTML = ""; return; }
    QUOTE_T = setTimeout(async () => {
      const r = await send("/api/admin/sites/quote", { headcount: head, sqft });
      into.innerHTML = r.ok ? bandLine(r.json.band) : `<span class="fail">${esc(r.json.error || "could not size that")}</span>`;
    }, 250);
  }

  // ---- one site's form --------------------------------------------------------------------------------------------------
  const val = (id) => (document.getElementById(id) || {}).value || "";
  const field = (id, label, value, opts = {}) => `<label class="${opts.wide ? "wide" : ""}">${esc(label)}<input id="${id}" value="${esc(value == null ? "" : value)}"${opts.type ? ` type="${opts.type}"` : ""}${opts.mode ? ` inputmode="${opts.mode}"` : ""}${opts.ph ? ` placeholder="${esc(opts.ph)}"` : ""} autocomplete="off"></label>`;
  function edit(slug) {
    const r = DATA && DATA.rows.find((x) => x.slug === slug); if (!r) return;
    EDIT = slug;
    const a = r.site_address || {}, pm = r.plant_manager || {}, d = r.deal || {}, ma = d.master_agreement || {};
    const locked = !["demo", "ordering", "back_to_demo"].includes(r.stage);
    document.getElementById("sites-mcard").innerHTML = `
      <h2>${esc(r.name)}${r.demo ? ' <span class="chip demo">DEMO</span>' : ""}</h2>
      <div class="sub">Stage: ${esc(r.stage_label)}${r.demo_holder ? ` · came in on the pin for ${esc(r.demo_holder)}${r.demo_email ? ` (${esc(r.demo_email)})` : ""}` : ""} · <a href="#demos/${esc(r.slug)}" onclick="AdminSites.close()">Demos tab</a> · <a href="/c/${esc(r.slug)}/" target="_blank" rel="noopener">their board</a></div>
      ${locked ? '<p class="note amber">This site has a signed order: its facts are the ones signed. Send the order back to change them.</p>' : ""}
      <h3>The site</h3><div class="fgrid">
        ${field("sf-site", "Site name (what their people call it)", r.site_name)}${field("sf-legal", "Company's legal name", r.legal_name)}
        ${field("sf-l1", "Address", a.line1, { wide: true })}${field("sf-l2", "Address, second line", a.line2, { wide: true })}
        ${field("sf-city", "City", a.city)}${field("sf-state", "State", a.state, { ph: "MA" })}${field("sf-zip", "ZIP", a.postal_code, { mode: "numeric" })}</div>
      <h3>Plant manager</h3><div class="fgrid">
        ${field("sf-pmname", "Name", pm.name)}${field("sf-pmtitle", "Title", pm.title)}${field("sf-pmemail", "Email", pm.email, { wide: true, type: "email" })}</div>
      <h3>Size</h3><div class="fgrid">
        ${field("sf-head", "People at the site, all shifts", r.headcount, { mode: "numeric" })}${field("sf-sqft", "Floor space, square feet", r.sqft, { mode: "numeric" })}
        <div class="wide" id="sf-band">${r.band ? bandLine(r.band) : '<span class="sub">The band and price follow the headcount.</span>'}</div></div>
      <h3>The deal</h3><div class="fgrid">
        ${field("sf-int", "ERP or other systems they want connected", d.integrations, { ph: "e.g. SAP" })}${field("sf-hw", "Hardware they asked for", d.hardware, { ph: "e.g. 4 tablets, a label printer" })}
        ${field("sf-limit", "Plant manager's approval limit ($)", d.approval_limit_usd, { mode: "decimal", ph: "what they can sign alone" })}
        <label class="check"><input type="checkbox" id="sf-ma"${ma.yes ? " checked" : ""}> Master agreement signed</label>
        ${field("sf-madate", "Master agreement signed on", ma.signed_at, { type: "date" })}</div>
      <h3>Note</h3><textarea id="sf-note" style="width:100%">${esc(r.note || "")}</textarea>
      <div class="err" id="sf-err"></div>
      <div class="foot"><button class="go" id="sf-save"${locked ? " disabled" : ""}>Save</button><button class="quiet" onclick="AdminSites.close()">Cancel</button></div>`;
    document.getElementById("sites-modal").classList.add("on");
    const again = () => quote(val("sf-head"), val("sf-sqft"), document.getElementById("sf-band"));
    document.getElementById("sf-head").addEventListener("input", again);
    document.getElementById("sf-sqft").addEventListener("input", again);
    document.getElementById("sf-save").onclick = save;
    document.getElementById("sf-site").focus();
  }
  async function save() {
    const btn = document.getElementById("sf-save"); btn.disabled = true;
    const body = {
      site_name: val("sf-site"), legal_name: val("sf-legal"),
      site_address: { line1: val("sf-l1"), line2: val("sf-l2"), city: val("sf-city"), state: val("sf-state"), postal_code: val("sf-zip") },
      plant_manager: { name: val("sf-pmname"), title: val("sf-pmtitle"), email: val("sf-pmemail") },
      headcount: val("sf-head"), sqft: val("sf-sqft"),
      deal: { integrations: val("sf-int"), hardware: val("sf-hw"), approval_limit_usd: val("sf-limit"), master_agreement: { yes: document.getElementById("sf-ma").checked, signed_at: val("sf-madate") } },
      note: val("sf-note"),
    };
    const r = await send(`/api/admin/sites/${encodeURIComponent(EDIT)}`, body);
    if (!r.ok) { document.getElementById("sf-err").textContent = r.json.error || "could not save"; btn.disabled = false; return; }
    close();
    await show();
  }
  function close() { EDIT = null; const m = document.getElementById("sites-modal"); if (m) m.classList.remove("on"); }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && EDIT) close(); });

  async function show() {
    style();
    try {
      if (!DATA) root().innerHTML = '<div class="card sub">Loading…</div>';
      DATA = await get("/api/admin/sites");
      draw();
    } catch (e) { root().innerHTML = `<div class="card"><p class="fail">${esc(e.message)}</p></div>`; }
  }
  // the tab's count in the header without opening it: only what waits on Brendan (a signed order, a site needing attention)
  async function badge() {
    try {
      const d = await get("/api/admin/sites"); DATA = d;
      const n = (d.stages.signed || 0) + (d.attention || 0);
      if (n && window.AdminShell && AdminShell.setBadge) AdminShell.setBadge("sites", { n, level: "amber" });
    } catch (e) {}
  }
  window.AdminSites = { show, badge, edit, close };
})();
