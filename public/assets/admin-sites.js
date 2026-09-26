// The Sites tab of /admin (src/sites.js, docs/PAID-SITES.md): the price book with a quick quote for a call, the
// count at each stage from a demo to a paying site, and one row per site with the fields from the pricing strategy.
// A row opens a form for what Brendan learns (the site, its legal name and address, the plant manager, its size, what
// they asked for, the master agreement, the plant manager's approval limit, a note); the band and the price follow
// the size. Stage 2 (src/golive.js): the switch that opens Go live on anetix.ai to customers, each site's order (the
// draft, who signs, the signed text, the card), and a link to walk through going live as the site's manager. Nothing
// here charges anyone yet. Mounted by admin.html (AdminShell onShow "sites"). No secret lives here: /assets is served
// before the login, and every call it makes is an admin-only route.
(function () {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const usd = (x) => `$${Number(x || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const num = (x) => Number(x || 0).toLocaleString("en-US");
  const cap = (x) => String(x || "").replace(/^./, (c) => c.toUpperCase());
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
      #sites-root .glswitch { display:flex; flex-wrap:wrap; gap:8px 12px; align-items:center; padding:10px 12px; border:1px solid var(--line); border-radius:10px; margin:8px 0 4px; background:var(--fog); }
      #sites-root .glswitch.on { border-color:var(--green); background:#eef7f1; } #sites-root .glswitch .grow { flex:1; min-width:240px; font-size:13px; }
      #sites-root .glswitch button { margin:0; }
      #sites-modal .order { border:1px solid var(--line); border-radius:10px; padding:10px 12px; font-size:13px; line-height:1.5; }
      #sites-modal .order pre { white-space:pre-wrap; font-family:inherit; font-size:12.5px; background:var(--fog); border-radius:8px; padding:10px; margin:8px 0 0; max-height:320px; overflow:auto; }
      #sites-modal .order .hash { font-family:ui-monospace,Menlo,monospace; font-size:11px; word-break:break-all; color:var(--steel); }
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

  // One line for a site's latest order under its stage (src/golive.js).
  function orderLine(o) {
    if (!o) return "";
    const pre = o.kind === "preview" ? "your preview: " : "";
    if (o.state === "draft") return `${pre}order being filled in, version ${o.version}${o.approver ? `, waiting on ${o.approver.name}` : ""}`;
    if (o.state === "signed") return `${pre}signed by ${o.signer ? o.signer.name : "someone"}${o.signed_at ? ` ${day(o.signed_at)}` : ""}${o.card_saved ? `, ${cap(o.card && o.card.brand ? o.card.brand : "card")} ${o.card && o.card.last4 ? o.card.last4 : ""}`.trimEnd() : ", no card yet"}`;
    if (o.state === "void") return `last order voided${o.note ? `: ${o.note}` : ""}`;
    return `order ${o.state}`;
  }
  // The switch that opens Go live to customers. Off: only an admin's link works (Open go-live on a site).
  function switchHtml(g) {
    if (!g) return "";
    if (!g.key_set) return `<div class="glswitch"><div class="grow"><b>Go live on anetix.ai is not available:</b> SOS_WWW_KEY is not set on this instance.</div></div>`;
    return g.open
      ? `<div class="glswitch on"><div class="grow"><b>Go live is on.</b> Every demo's manager sees Go live on their board and in Settings, and can sign an order form on anetix.ai. A signed site is promised it is switched on within 24 hours.</div><button class="quiet" id="gl-toggle" onclick="AdminSites.toggle(false)">Switch it off</button></div>`
      : `<div class="glswitch"><div class="grow"><b>Go live is off for customers.</b> No manager sees it and their links do not open. Yours do: open a site and press Open go-live to walk through it as its manager.${g.terms_draft ? ` The terms are ${esc(g.terms_version)}, a draft for counsel.` : ""}</div><button class="go" id="gl-toggle" onclick="AdminSites.toggle(true)">Switch it on</button></div>`;
  }
  async function toggle(open) {
    const g = (DATA && DATA.golive) || {};
    if (open) {
      const gaps = [
        g.terms_draft ? `The Terms of Service are ${g.terms_version}, a draft counsel has not reviewed. Customers who sign now sign the draft.` : "",
        "Activate is not built yet (stage 3), and a signed site is promised it is switched on within 24 hours.",
        (DATA.book.bands || []).some((b) => b.proposed) ? "Large and Very large prices are still marked proposed." : "",
      ].filter(Boolean);
      if (!confirm(`Switch Go live on for customers?\n\n${gaps.map((x) => `- ${x}`).join("\n")}\n\nEvery demo's manager will see Go live and can sign an order form and save a card.`)) return;
    } else if (!confirm("Switch Go live off? Managers stop seeing it and their links stop opening. Orders already started stay as they are.")) return;
    const r = await send("/api/admin/golive", { open });
    if (!r.ok) { alert(r.json.error || "that did not change"); return; }
    await show();
  }

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
        <td><b>${esc(r.stage_label)}</b>${r.standing_label ? `<small>${esc(r.standing_label)}</small>` : ""}${orderLine(r.order) ? `<small>${esc(orderLine(r.order))}</small>` : ""}</td></tr>`;
    }).join("");
    root().innerHTML = `
      <div class="card"><h2>Price book <small>version ${esc(B.version)} · full price from month one</small></h2>
        <div style="overflow-x:auto"><table class="list"><tr><th>Band</th><th>People at the site, all shifts</th><th>Monthly</th><th>Annual</th><th>Fair-use line</th><th>Floor space that moves a site into it</th></tr>${bands}</table></div>
        <p class="sub" style="margin:8px 0 0">Floor space moves a site up one band at most.${B.sqft_proposed ? " The floor-space thresholds are proposed: 1,500 square feet a person at each edge." : ""} The fair-use line is ${Math.round(B.fair_use_share * 100)}% of the fee: past it, new AI work waits for the next billing month and the floor's tools keep working. You hear at ${Math.round(B.alert_share * 100)}% of the fee; the customer never sees a meter.</p>
        <div class="quote"><label>People at the site, all shifts<input id="sq-head" inputmode="numeric" placeholder="e.g. 120" autocomplete="off"></label><label>Floor space, square feet<input id="sq-sqft" inputmode="numeric" placeholder="optional" autocomplete="off"></label><span class="sub" style="padding-bottom:9px">Quick quote for a call</span></div>
        <div class="qline" id="sq-line"></div></div>
      <div class="card"><h2>Pipeline <small>from a demo to a paying site</small></h2>
        <div class="stages">${stages}</div>
        ${switchHtml(D.golive)}
        ${D.golive && D.golive.cards_to_remove && D.golive.cards_to_remove.length ? `<p class="note amber" id="gl-cards">${D.golive.cards_to_remove.length} card${D.golive.cards_to_remove.length === 1 ? "" : "s"} saved at Stripe for withdrawn orders wait to be removed (${D.golive.cards_to_remove.map((c) => `${esc(c.company)}: ${esc(c.payment_method)}`).join(", ")}). Nothing charges them; stage 3 removes them, or remove them in the Stripe dashboard.</p>` : ""}
        <p class="sub" style="margin:6px 0 0">Every company that came in from anetix.ai is a row. Open one to fill in what you learn; its band and price follow the size, and its order shows as the customer goes. Activate comes in the next stage.</p>
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
    const openOrder = r.order_open && !locked;   // the customer is filling it in on anetix.ai: the facts are theirs
    const factsLocked = locked || openOrder;
    const o = r.order;
    document.getElementById("sites-mcard").innerHTML = `
      <h2>${esc(r.name)}${r.demo ? ' <span class="chip demo">DEMO</span>' : ""}</h2>
      <div class="sub">Stage: ${esc(r.stage_label)}${r.demo_holder ? ` · came in on the pin for ${esc(r.demo_holder)}${r.demo_email ? ` (${esc(r.demo_email)})` : ""}` : ""} · <a href="#demos/${esc(r.slug)}" onclick="AdminSites.close()">Demos tab</a> · <a href="/c/${esc(r.slug)}/" target="_blank" rel="noopener">their board</a></div>
      ${locked ? '<p class="note amber">This site has a signed order: its facts are the ones signed. The note, the approval limit and the master agreement can still change.</p>' : ""}
      ${openOrder ? '<p class="note amber">An order is being filled in on anetix.ai, so the facts are the customer\'s until it is signed. The note, the approval limit and the master agreement can still change.</p>' : ""}
      <h3>Order</h3><div class="order" id="sf-order">${o ? orderHtml(o) : '<span class="sub">No order yet.</span>'}
        <div class="foot" style="margin-top:8px">${o && o.state !== "draft" ? '<button class="quiet" id="sf-text" onclick="AdminSites.orders()">Show the signed order form</button>' : ""}<button class="quiet" id="sf-golive" onclick="AdminSites.openGoLive()">${r.order_open && o.kind !== "preview" ? "Look at their order on anetix.ai" : "Open go-live as their manager"}</button>${r.order_open && ["draft", "signed"].includes(o.state) ? `<button class="quiet" id="sf-void" onclick="AdminSites.voidOrder()">${o.kind === "preview" ? "Void your preview" : "Withdraw this order"}</button>` : ""}</div>
        <div id="sf-orders"></div></div>
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
      <div class="foot"><button class="go" id="sf-save">Save</button><button class="quiet" onclick="AdminSites.close()">Cancel</button></div>`;
    document.getElementById("sites-modal").classList.add("on");
    if (factsLocked) for (const id of ["sf-site", "sf-legal", "sf-l1", "sf-l2", "sf-city", "sf-state", "sf-zip", "sf-pmname", "sf-pmtitle", "sf-pmemail", "sf-head", "sf-sqft", "sf-int", "sf-hw"]) document.getElementById(id).disabled = true;
    const again = () => quote(val("sf-head"), val("sf-sqft"), document.getElementById("sf-band"));
    document.getElementById("sf-head").addEventListener("input", again);
    document.getElementById("sf-sqft").addEventListener("input", again);
    document.getElementById("sf-save").onclick = save;
    (factsLocked ? document.getElementById("sf-note") : document.getElementById("sf-site")).focus();
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
  // A site's latest order in its form: where it stands, who signs, the band and price it was signed at, the card.
  function orderHtml(o) {
    const bits = [`<b>${esc({ draft: "Being filled in", signed: o.card_saved ? "Signed, card saved" : "Signed, no card yet", void: "Voided", activating: "Switching on", activated: "Activated", declined: "Declined" }[o.state] || o.state)}</b>${o.kind === "preview" ? ' <span class="chip prop">YOUR PREVIEW</span>' : ""}`];
    if (o.state === "draft") bits.push(`version ${esc(o.version)}${o.approver ? `, waiting on ${esc(o.approver.name)} (${esc(o.approver.email)})` : ""}`);
    if (o.band) bits.push(`${esc(o.band.name)} at ${usd(o.price_usd)} a month`);
    if (o.signer) bits.push(`signed by ${esc(o.signer.name)}${o.signer.title ? `, ${esc(o.signer.title)}` : ""} (${esc(o.signer.email)}${o.signer.via === "approver" ? ", on the approver's link" : ""})${o.signed_at ? ` on ${esc(new Date(o.signed_at).toLocaleString())}` : ""}`);
    if (o.card_saved) bits.push(`card: ${esc(cap((o.card && o.card.brand) || "card"))} ending ${esc((o.card && o.card.last4) || "")}`);
    if (o.note) bits.push(esc(o.note));
    return bits.join("<br>");
  }
  // every order of the open site, with the signed text and its hash (the record of what was signed)
  async function orders() {
    const into = document.getElementById("sf-orders"); if (!into || !EDIT) return;
    try {
      const d = await get(`/api/admin/sites/${encodeURIComponent(EDIT)}/orders`);
      into.innerHTML = d.orders.filter((o) => o.text).map((o) => `<div style="margin-top:10px"><b>${esc(o.state)}</b> · terms ${esc(o.terms_version)} · price book ${esc(o.price_book)}${o.signed_ip ? ` · from ${esc(o.signed_ip)}` : ""}${o.learning_opt_in ? " · learning opted in" : " · learning not opted in"}
        <pre>${esc(o.text)}</pre><div class="hash">SHA-256 ${esc(o.text_sha256)}${o.signed_ua ? `<br>${esc(o.signed_ua)}` : ""}</div></div>`).join("") || '<span class="sub">No signed order form yet.</span>';
    } catch (e) { into.innerHTML = `<span class="fail">${esc(e.message)}</span>`; }
  }
  // Withdraw the site's open order: a preview, or a customer's order that will not be activated. The manager is shown
  // the reason; a card Stripe holds for it is listed for removal.
  async function voidOrder() {
    const r = DATA && DATA.rows.find((x) => x.slug === EDIT); const o = r && r.order; if (!o) return;
    const customer = o.kind !== "preview";
    const note = prompt(customer ? `Withdraw ${r.name}'s order? Their site goes back to a demo, and the manager sees this reason the next time they open Go live. Why?` : "Void your preview? A reason is optional.", "");
    if (note === null) return;
    const res = await send(`/api/admin/sites/${encodeURIComponent(EDIT)}/void-order`, { note });
    if (!res.ok) { alert(res.json.error || "that did not work"); return; }
    close(); await show();
  }
  // an admin's go-live link (24 hours), opened in a new tab: works while Go live is switched off
  async function openGoLive() {
    const win = window.open("about:blank", "_blank");
    try { const d = await get(`/api/admin/sites/${encodeURIComponent(EDIT)}/golive-link`); if (win) win.location = d.url; else location.href = d.url; }
    catch (e) { if (win) win.close(); alert(e.message); }
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
  window.AdminSites = { show, badge, edit, close, toggle, orders, openGoLive, voidOrder };
})();
