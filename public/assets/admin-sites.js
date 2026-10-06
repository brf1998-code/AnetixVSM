// The Sites tab of /admin (src/sites.js, docs/PAID-SITES.md): the price book with a quick quote for a call, the
// count at each stage from a demo to a paying site, and one row per site with the fields from the pricing strategy.
// A row opens a form for what Brendan learns (the site, its legal name and address, the plant manager, its size, what
// they asked for, the master agreement, the plant manager's approval limit, a note); the band and the price follow
// the size. Stage 2 (src/golive.js): the switch that opens Go live on anetix.ai to customers, each site's order (the
// draft, who signs, the signed text, the card), and a link to walk through going live as the site's manager. Stage 3
// (src/activate.js): Activate on a signed order (the checks, what the rollover does, a fresh authenticator code),
// Decline and Send back, a paying site's subscription and its fair-use line (with Lift), the Terms' switch
// (src/agreements.js), the private channel to anetix.ai, and removing the cards of withdrawn orders. Mounted by
// admin.html (AdminShell onShow "sites"). No secret lives here: /assets is served before the login, and every call it
// makes is an admin-only route.
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
      #sites-modal .act { border:1px solid var(--line); border-left:4px solid var(--green); border-radius:10px; padding:10px 12px; margin-top:10px; font-size:13px; line-height:1.5; }
      #sites-modal .act.stop { border-left-color:var(--amber); } #sites-modal .act ul { margin:6px 0; padding-left:18px; } #sites-modal .act li { margin:3px 0; }
      #sites-modal .act .ok { color:var(--green); font-weight:700; } #sites-modal .act .bad { color:var(--red); font-weight:700; }
      #sites-modal .act input[type=text], #sites-modal .act input[inputmode] { width:auto; min-width:140px; }
      #sites-root td small.over { color:var(--red); font-weight:700; }
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
  // price book 2 (2026-10-05): $300 a tool live on the floor, and the band's price is the cap
  const bandLine = (band) => band && band.per_tool_usd
    ? `<b>${esc(band.name)} site: ${usd(band.per_tool_usd)} a month for each tool live, never more than ${usd(band.monthly_usd)}</b> (the cap, reached at ${Math.ceil(band.monthly_usd / band.per_tool_usd)} tools)${band.proposed ? ' <span class="chip prop">CAP PROPOSED</span>' : ""}.
       <span class="sub">${esc(band.why)}. The fair-use line is 80% of the month's fee: ${usd(band.per_tool_usd * 0.8)} at one tool, ${usd(band.fair_use_usd)} at the cap.</span>${band.flags.map((f) => `<br><small class="sub" style="color:#b26a00">${esc(f.text)}.</small>`).join("")}`
    : band
    ? `<b>${esc(band.name)} site: ${usd(band.monthly_usd)} a month</b>, ${usd(band.annual_usd)} a year${band.proposed ? ' <span class="chip prop">PRICE PROPOSED</span>' : ""}.
       <span class="sub">Fair-use line ${usd(band.fair_use_usd)}. ${esc(band.why)}.</span>${band.flags.map((f) => `<br><small class="sub" style="color:#b26a00">${esc(f.text)}.</small>`).join("")}`
    : "";

  // A paying site's fair-use line this period (src/fairuse.js): its share, the alert at half the fee, the line itself.
  function fairLine(r) {
    const f = r.fair_use; if (!f) return "";
    const pct = Math.round((f.share_of_line || 0) * 100);
    const cls = f.over ? "over" : f.alert ? "flag" : "";
    return `<small class="${cls}">AI this period ${usd(f.spend_usd)}, ${pct}% of the fair-use line${f.lifted ? " (lifted)" : f.over ? ": paused" : f.alert ? ": past half the fee" : ""}</small>`;
  }
  // One line for a site's latest order under its stage (src/golive.js).
  function orderLine(o) {
    if (!o) return "";
    const pre = o.kind === "preview" ? "your preview: " : "";
    if (o.state === "draft") return `${pre}order being filled in, version ${o.version}${o.approver ? `, waiting on ${o.approver.name}` : ""}`;
    if (o.state === "signed") return `${pre}signed by ${o.signer ? o.signer.name : "someone"}${o.signed_at ? ` ${day(o.signed_at)}` : ""}${o.card_saved ? `, ${cap(o.card && o.card.brand ? o.card.brand : "card")} ${o.card && o.card.last4 ? o.card.last4 : ""}`.trimEnd() : ", no card yet"}`;
    if (o.state === "void") return `last order voided${o.note ? `: ${o.note}` : ""}`;
    if (o.state === "activating") return `switching on${o.activate && o.activate.last_error ? `, stopped: ${o.activate.last_error.message}` : ""}`;
    if (o.state === "declined") return `declined${o.note ? `: ${o.note.replace(/^Anetix declined this order: /, "")}` : ""}`;
    return `order ${o.state}`;
  }
  // The switch that opens Go live to customers. Off: only an admin's link works (Open go-live on a site).
  function switchHtml(g) {
    if (!g) return "";
    if (!g.key_set) return `<div class="glswitch" id="gl-switch"><div class="grow"><b>Go live on anetix.ai is not available:</b> SOS_WWW_KEY is not set on this instance.</div></div>`;
    return g.open
      ? `<div class="glswitch on" id="gl-switch"><div class="grow"><b>Go live is on.</b> Every demo's manager sees Go live on their board and in Settings, and can sign an order form on anetix.ai. The Terms say Anetix aims to switch a signed site on within 24 hours, and the customer may withdraw until then.</div><button class="quiet" id="gl-toggle" onclick="AdminSites.toggle(false)">Switch it off</button></div>`
      : `<div class="glswitch" id="gl-switch"><div class="grow"><b>Go live is off for customers.</b> No manager sees it and their links do not open. Yours do: open a site and press Open go-live to walk through it as its manager.${g.terms_draft ? ` The terms are ${esc(g.terms_version)}, a draft for counsel.` : ""}</div><button class="quiet" id="gl-toggle" onclick="AdminSites.toggle(true)" title="Opens Go live to every demo's manager; the confirm lists what is still open first">Switch it on for customers</button></div>`;
  }
  // The Terms' switch (src/agreements.js): off, demo set-up and refills ask nothing; on, both ask for the tick box, and
  // every demo manager who has not agreed sees the box on the board (new AI work waits for it).
  function termsHtml(t) {
    if (!t) return "";
    const brackets = t.placeholders && t.placeholders.length ? ` Still in brackets: ${esc(t.placeholders.join(", "))}.` : "";
    return t.live
      ? `<div class="glswitch on" id="terms-switch"><div class="grow"><b>The Terms of Service are switched on</b> (${esc(t.version)}${t.draft ? ", still a draft" : ""}). Demo set-up and refills ask for the tick box, and ${esc(t.demos_waiting)} demo${t.demos_waiting === 1 ? "" : "s"} still wait${t.demos_waiting === 1 ? "s" : ""} for the manager's tick on the board.${brackets}</div><button class="quiet" id="terms-toggle" onclick="AdminSites.termsToggle(false)">Switch them off</button></div>`
      : `<div class="glswitch" id="terms-switch"><div class="grow"><b>The Terms of Service are off</b> for demos and refills (${esc(t.version)}${t.draft ? ", a draft for counsel" : ""}). Go live's order form points to them either way.${brackets}</div><button class="go" id="terms-toggle" onclick="AdminSites.termsToggle(true)">Switch them on</button></div>`;
  }
  async function termsToggle(live) {
    const t = (DATA && DATA.terms) || {};
    if (live && !confirm(`Switch the Terms of Service on?\n\n- Demo set-up and refills on anetix.ai ask for the tick box from now on.\n- ${t.demos_waiting || 0} demo manager(s) who have not agreed see the box on their board, and their new AI work waits until they tick it.${t.draft ? `\n- The Terms are still ${t.version}, a draft counsel has not approved.` : ""}${t.placeholders && t.placeholders.length ? `\n- Still in brackets: ${t.placeholders.join(", ")}.` : ""}`)) return;
    if (!live && !confirm("Switch the Terms off for demos and refills? Acceptances already on record stay.")) return;
    const r = await send("/api/admin/terms", { live });
    if (!r.ok) { alert(r.json.error || "that did not change"); return; }
    await show();
  }
  function channelHtml(a) {
    if (!a || !a.channel) return "";
    const c = a.channel, key = a.ai_key, rc = a.refill_check;
    return `<p class="sub" style="margin:6px 0 0">Activate's channel to anetix.ai: ${c.ok ? `<b style="color:var(--green)">up</b>, Stripe in ${esc(c.stripe)} mode${c.tax ? ", Stripe Tax on" : ""}.` : `<b style="color:var(--red)">down</b>: ${esc(c.why)}.`} The AI key's auto reload: ${key && key.autofill ? "on" : '<b style="color:#b26a00">not noted as on</b> (Activate needs it: the Instance tab\'s AI credit note)'}. Refills checked with Stripe: ${rc && rc.on ? (c.ok && c.stripe && rc.mode !== c.stripe && c.stripe !== "fake" ? `<b style="color:#b26a00">yes, but the read key is ${esc(rc.mode)} and anetix.ai is ${esc(c.stripe)}</b>` : "yes") : '<b style="color:#b26a00">no</b> (STRIPE_READ_KEY on this service, a restricted key that can only read Checkout Sessions)'}.</p>`;
  }
  async function toggle(open) {
    const g = (DATA && DATA.golive) || {};
    if (open) {
      const t = DATA.terms || {}, a = DATA.activation || {};
      const gaps = [
        g.terms_draft ? `The Terms of Service are ${g.terms_version}, a draft counsel has not reviewed. Customers who sign now sign the draft.` : "",
        t.placeholders && t.placeholders.length ? `The Terms still have ${t.placeholders.join(", ")} to fill in.` : "",
        a.channel && !a.channel.ok ? `Activate cannot reach anetix.ai: ${a.channel.why}. The Terms say Anetix aims to switch a signed site on within 24 hours.` : "",
        a.channel && a.channel.ok && a.channel.stripe !== "live" ? `Stripe is in ${a.channel.stripe} mode on anetix.ai, so no real card can be charged yet.` : "",
        a.channel && a.channel.ok && a.channel.stripe === "live" && !a.channel.tax ? "Stripe Tax is off: a subscription made now carries no sales tax and does not pick it up if Tax is turned on later." : "",
        "Customers cancel, change the card and see invoices in Manage billing (Stripe's portal); a cancelled site goes back to a demo at the end of its paid month (stage 4). Not built yet: the yearly size check and the check against Stripe after a restore.",
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
    const bands = B.bands.map((b) => `<tr><td><b>${esc(b.name)}</b>${b.proposed ? '<span class="chip prop">PROPOSED</span>' : ""}</td><td>${esc(range(b))}</td><td>${usd(b.monthly_usd)}</td><td>${B.per_tool_usd ? `${esc(b.tools_at_cap)} tools` : usd(b.annual_usd)}</td><td>${usd(b.fair_use_usd)}</td><td>${b.sqft_min ? `${num(b.sqft_min)} sq ft` : '<span class="sub">none</span>'}</td></tr>`).join("");
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
        <td class="price">${r.pilot ? `<b>Pilot · ${usd(r.pilot.monthly_usd)}/mo</b><small>${esc(r.pilot.line)}${r.pilot.ends_at ? `, ends ${esc(day(r.pilot.ends_at))}` : ""}</small>` : ""}${r.offer ? `<small class="flag">pilot offered: ${esc(r.offer.line)}</small>` : ""}${r.pilot ? "" : r.band && r.band.per_tool_usd && r.fee ? `<b>${usd(r.fee.usd)}/mo${r.stage === "subscribed" ? "" : " today"}</b><small>${r.tools_live} live at ${usd(r.band.per_tool_usd)} a tool · ${esc(r.band.name)} cap ${usd(r.band.monthly_usd)}</small>${r.fee.due_usd != null && r.fee.due_usd !== r.fee.usd ? `<small class="flag">the tools live come to ${usd(r.fee.due_usd)}: the bill catches up within 15 minutes</small>` : ""}${r.band.moved_up ? "<small>moved up for floor space</small>" : ""}${r.band.proposed ? "<small>cap proposed</small>" : ""}${(r.band.flags || []).map((f) => `<small class="flag">${esc(f.text)}</small>`).join("")}` : r.band ? `<b>${esc(r.band.name)} · ${usd(r.band.monthly_usd)}/mo</b>${r.band.moved_up ? "<small>moved up for floor space</small>" : ""}${r.band.proposed ? "<small>price proposed</small>" : ""}${r.band.flags.map((f) => `<small class="flag">${esc(f.text)}</small>`).join("")}` : '<span class="none">needs a headcount</span>'}</td>
        <td>${r.demo_holder ? `<b>${esc(r.demo_holder)}</b>` : '<span class="none">no demo</span>'}${r.demo_since ? `<small>since ${esc(day(r.demo_since))}, ${r.last_activity ? `active ${esc(ago(r.last_activity))}` : "no activity yet"}</small>` : ""}${r.ai_spent_usd != null ? `<small>AI spent ${usd(r.ai_spent_usd)}${r.credit_percent != null ? `, ${esc(r.credit_percent)}% credit left` : ""}</small>` : ""}</td>
        <td>${r.tools_live ? `<b>${r.tools_live} live</b>` : '<span class="none">none live</span>'}${r.tools.length ? `<small>${r.tools.map((t) => esc(t.title || t.name)).join(", ")}</small>` : ""}</td>
        <td>${dealBits.length ? dealBits.map((x) => `<small>${x}</small>`).join("") : '<span class="none">nothing yet</span>'}</td>
        <td><b>${esc(r.stage_label)}</b>${r.standing_label ? `<small>${esc(r.standing_label)}</small>` : ""}${r.stage !== "subscribed" && orderLine(r.order) ? `<small>${esc(orderLine(r.order))}</small>` : ""}${fairLine(r)}</td></tr>`;
    }).join("");
    root().innerHTML = `
      <div class="card"><h2>Price book <small>version ${esc(B.version)} · ${B.per_tool_usd ? `${usd(B.per_tool_usd)} a month for each tool live on the floor, up to the site's cap` : "full price from month one"}</small></h2>
        <div style="overflow-x:auto"><table class="list"><tr><th>Band</th><th>People at the site, all shifts</th><th>${B.per_tool_usd ? "Cap, a month" : "Monthly"}</th><th>${B.per_tool_usd ? "Reached at" : "Annual"}</th><th>Fair-use line${B.per_tool_usd ? " at the cap" : ""}</th><th>Floor space that moves a site into it</th></tr>${bands}</table></div>
        <p class="sub" style="margin:8px 0 0">${B.per_tool_usd ? `A site pays ${usd(B.per_tool_usd)} a month for each tool live on its floor, for ${esc(B.min_tools)} at least, and never more than its band's cap. A tool counts from the bill after it is first made live; drafts and previews are free. A pilot offered from a site's row is its own fee and ignores this book. ` : ""}Floor space moves a site up one band at most.${B.sqft_proposed ? " The floor-space thresholds are proposed: 1,500 square feet a person at each edge." : ""} The fair-use line is ${Math.round(B.fair_use_share * 100)}% of the fee: past it, new AI work waits for the next billing month and the floor's tools keep working. You hear at ${Math.round(B.alert_share * 100)}% of the fee; the customer never sees a meter.</p>
        <div class="quote"><label>People at the site, all shifts<input id="sq-head" inputmode="numeric" placeholder="e.g. 120" autocomplete="off"></label><label>Floor space, square feet<input id="sq-sqft" inputmode="numeric" placeholder="optional" autocomplete="off"></label><span class="sub" style="padding-bottom:9px">Quick quote for a call</span></div>
        <div class="qline" id="sq-line"></div></div>
      <div class="card"><h2>Pipeline <small>from a demo to a paying site</small></h2>
        <div class="stages">${stages}</div>
        ${switchHtml(D.golive)}
        ${termsHtml(D.terms)}
        ${channelHtml(D.activation)}
        ${D.golive && D.golive.cards_to_remove && D.golive.cards_to_remove.length ? `<p class="note amber" id="gl-cards">${D.golive.cards_to_remove.length} card${D.golive.cards_to_remove.length === 1 ? "" : "s"} saved at Stripe for withdrawn orders wait to be removed (${D.golive.cards_to_remove.map((c) => `${esc(c.company)}: ${esc(c.payment_method)}`).join(", ")}). Nothing charges them. They are removed over the channel every 15 minutes. <button class="quiet" id="gl-sweep" onclick="AdminSites.sweep()">Remove them now</button></p>` : ""}
        <p class="sub" style="margin:6px 0 0">Every company that came in from anetix.ai is a row. Open one to fill in what you learn; its band and price follow the size, and its order shows as the customer goes. A signed order with its card is switched on from its row.</p>
        ${D.rows.length ? `<div style="overflow-x:auto;margin-top:8px"><table class="list" id="sites-table"><tr><th>Company</th><th>Site</th><th>Plant manager</th><th>Size</th><th>Band</th><th>Demo</th><th>Tools</th><th>Deal</th><th>Stage</th></tr>${rows}</table></div>` : '<p class="sub" style="margin-top:10px">Nobody has come in from anetix.ai yet. Make a pin on the Pins tab.</p>'}</div>`;
    const h = document.getElementById("sq-head"), s = document.getElementById("sq-sqft");
    const go = () => quote(h.value, s.value, document.getElementById("sq-line"));
    h.addEventListener("input", go); s.addEventListener("input", go);
    const waiting = (st.signed || 0) + (D.attention || 0) + (D.alerts || 0);   // what waits on Brendan: a signed order, a site needing attention, one past half its fee
    if (window.AdminShell && AdminShell.setBadge) AdminShell.setBadge("sites", waiting ? { n: waiting, level: "amber" } : { n: undefined, level: null });
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
  // a fresh code from the authenticator, or with the box left empty, the account's passkey (2026-09-27, Brendan)
  const hasPk = () => typeof ME !== "undefined" && ME && ME.me && ME.me.passkeys > 0 && window.Passkey && Passkey.supported();
  async function stepFrom(code, err) {
    if (code) return { code };
    if (!hasPk()) { err.textContent = "Type a fresh code from your authenticator."; return null; }
    const out = await Passkey.stepUp();
    if (out.passkey) return { passkey: out.passkey };
    err.textContent = out.cancelled ? "No passkey was used. Press again, or type a code from your authenticator." : (out.error || "the passkey did not work");
    return null;
  }
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
      <div id="sf-act"></div>
      <div id="sf-offer"></div>
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
    actPanel(r);
    offerPanel(r);
  }
  // ---- a pilot offer (src/pilot.js, 2026-10-05): a fixed fee for a fixed number of months that ends on its own, with
  // lines of its own, offered to this one company. Its manager sees "Start your pilot" on the board; the rest is the
  // same signature, card and Activate. One line of the box is one line of the order form: "Label: words".
  const linesText = (lines) => (lines || []).map((l) => `${l.label}: ${l.text}`).join("\n");
  function linesFrom(text) {
    return String(text || "").split("\n").map((x) => x.trim()).filter(Boolean).map((x) => { const i = x.indexOf(":"); return i < 0 ? { label: "", text: x } : { label: x.slice(0, i).trim(), text: x.slice(i + 1).trim() }; });
  }
  async function offerPanel(r) {
    const into = document.getElementById("sf-offer"); if (!into) return;
    if (r.stage === "subscribed" || r.stage === "activating") { into.innerHTML = ""; return; }
    let j;
    try { j = await get(`/api/admin/sites/${encodeURIComponent(r.slug)}/offer`); }
    catch (e) { into.innerHTML = ""; return; }
    if (EDIT !== r.slug) return;
    const of = j.offer, d = of || j.defaults;
    const signed = r.order && r.order.kind !== "preview" && ["signed"].includes(r.order.state);
    into.innerHTML = `<h3>Pilot offer</h3><div class="act${of ? "" : " stop"}" id="sf-offerbox">
      ${of ? `<b>Offered:</b> ${esc(r.offer ? r.offer.line : "")}${of.made_by ? ` <span class="sub">by ${esc(of.made_by)}, ${esc(day(of.made_at))}</span>` : ""}. Their manager sees <b>Start your pilot</b> on the board and in Settings, whether or not Go live is on for everyone. Activate charges the first month and Stripe ends it on its own after the last.`
        : `<span class="sub">A fixed fee for a fixed number of months that ends on its own, for this one company (an onsite pilot, say). It replaces the price book for them until it is signed, withdrawn or over. Nothing is charged until you press Activate on their signed order.</span>`}
      ${signed ? '<br><span class="bad">Their order is signed, so the offer cannot change.</span> Send the order back or withdraw it first.' : ""}</div>
      <div class="fgrid" style="margin-top:8px">${field("sf-of-usd", "Fee a month ($)", d.monthly_usd, { mode: "decimal" })}${field("sf-of-months", "Months (it ends on its own after the last)", d.months, { mode: "numeric" })}
        <label class="wide">The pilot's own lines on the order form, one a line, as Label: words<textarea id="sf-of-lines" style="min-height:150px">${esc(linesText(d.lines))}</textarea></label></div>
      <p class="sub" style="margin:6px 0 0">The order form adds the rest itself: what the fee is (a pilot fee, not a license or a subscription), the dates it is charged, that it ends on its own, cancelling, fair use, data, and the Terms. The site's facts below (legal name, address, plant manager) fill its top lines; the customer can correct them when they sign.</p>
      <div class="foot"><button class="go" id="sf-of-save" onclick="AdminSites.saveOffer()"${signed ? " disabled" : ""}>${of ? "Save the offer" : "Offer this pilot"}</button>${of ? `<button class="quiet" id="sf-of-clear" onclick="AdminSites.clearOffer()"${signed ? " disabled" : ""}>Withdraw the offer</button>` : ""}</div>
      <div class="err" id="sf-of-err"></div>
      ${j.preview ? `<details style="margin-top:8px"><summary class="sub" style="cursor:pointer">The order form they will sign</summary><div class="order" style="margin-top:6px"><pre id="sf-of-text">${esc(j.preview)}</pre></div></details>` : ""}`;
  }
  async function saveOffer() {
    const err = document.getElementById("sf-of-err"); err.textContent = "";
    const r = await send(`/api/admin/sites/${encodeURIComponent(EDIT)}/offer`, { monthly_usd: val("sf-of-usd"), months: Number(val("sf-of-months")), lines: linesFrom(val("sf-of-lines")) });
    if (!r.ok) { err.textContent = r.json.error || "that did not save"; return; }
    const slug = EDIT; await show(); edit(slug);
  }
  async function clearOffer() {
    if (!confirm("Withdraw the pilot offer? Their manager stops seeing Start your pilot, and an order they had started under it is asked to look again at the price book's terms.")) return;
    const r = await send(`/api/admin/sites/${encodeURIComponent(EDIT)}/offer`, { clear: true });
    if (!r.ok) { document.getElementById("sf-of-err").textContent = r.json.error || "that did not change"; return; }
    const slug = EDIT; await show(); edit(slug);
  }
  // ---- stage 3: switch it on, decline, send back; a paying site's line ------------------------------------------------
  async function actPanel(r) {
    const into = document.getElementById("sf-act"); if (!into) return;
    const o = r.order;
    if (r.stage === "subscribed") {
      const sub = r.subscription || {}, f = r.fair_use;
      into.innerHTML = `<div class="act"><b>Subscribed</b> since ${esc(day(sub.activated_at))}${sub.id ? ` · <span class="sub">${esc(sub.id)}</span>` : ""}${sub.period_end ? ` · this period ends ${esc(day(sub.period_end))}` : ""}.
        ${f ? `<br>AI this period: ${usd(f.spend_usd)} of a ${usd(f.line_usd)} fair-use line (${Math.round((f.share_of_line || 0) * 100)}%)${f.lifted ? `, <b>lifted</b> until ${esc(day(f.lift.until))} (${esc(f.lift.note)})` : f.over ? ', <span class="bad">reached: new AI work is paused</span>' : ""}.` : ""}
        <br>Learning: ${sub.learning_opt_in ? "opted in" : "not opted in (the Demos tab shows the demo period only)"}.${sub.tenancy_note ? `<br>Tenancy: ${esc(sub.tenancy_note)}` : ""}
        <br>Payment: ${sub.standing === "past_due" ? '<span class="bad">past due</span> (Stripe is retrying; the manager sees a line)' : sub.standing === "unpaid" ? '<span class="bad">unpaid</span> (retries ran out; new AI work is paused, the tools run)' : sub.standing === "canceled_at_stripe" ? '<span class="bad">Stripe cancelled the subscription</span> (the floor still works until you End it)' : "good"}.${r.pilot ? ` <b>A pilot</b>: ${esc(r.pilot.line)}. Stripe ends it on its own ${r.pilot.ends_at ? `on ${esc(day(r.pilot.ends_at))}` : "after the last month"}, and the site goes back to a demo that day.${sub.cancel_at && r.pilot.ends_at && Math.abs(new Date(sub.cancel_at) - new Date(r.pilot.ends_at)) > 36 * 3600e3 ? ` <b>Cancelled early by the customer</b>: ends ${esc(day(sub.cancel_at))}.` : ""}` : sub.cancel_at ? ` <b>Cancelled by the customer</b>: ends ${esc(day(sub.cancel_at))}, then back to a demo.` : ""}${!r.pilot && r.band && r.band.per_tool_usd && r.fee ? `<br>Fee: ${usd(r.fee.usd)} a month (${esc(r.tools_live)} live at ${usd(r.band.per_tool_usd)} a tool, cap ${usd(r.band.monthly_usd)}). It follows the tools live from each next bill.` : ""}
        ${f && !f.lifted ? `<div class="foot"><input type="text" id="sf-lift" placeholder="why lift the line (a big first month, say)" style="flex:1;min-width:200px"><button class="quiet" id="sf-liftgo" onclick="AdminSites.lift()">Lift the line for this period</button></div>` : ""}
        ${["unpaid", "canceled_at_stripe"].includes(sub.standing) ? `<div class="foot"><input type="text" id="sf-endnote" placeholder="why end it (the manager reads this)" style="flex:1;min-width:200px"><input inputmode="numeric" id="sf-endcode" placeholder="authenticator code, or empty for your passkey" autocomplete="one-time-code" maxlength="10"><button class="quiet" id="sf-end" onclick="AdminSites.endSite()">End: back to a demo</button></div><div class="err" id="sf-enderr"></div>` : ""}</div>`;
      return;
    }
    if (!o || !["signed", "activating"].includes(o.state) || (o.state === "signed" && !o.card_saved)) { into.innerHTML = ""; return; }
    into.innerHTML = '<div class="act"><span class="sub">Checking…</span></div>';
    let c;
    try { c = await get(`/api/admin/sites/${encodeURIComponent(r.slug)}/checks`); }
    catch (e) { into.innerHTML = `<div class="act stop"><span class="fail">${esc(e.message)}</span></div>`; return; }
    const ok = (b) => (b ? '<span class="ok">yes</span>' : '<span class="bad">no</span>');
    const stopped = c.order && c.order.stripe && c.order.stripe.last_error;
    const preview = c.preview;
    const ch = c.channel || {};
    into.innerHTML = `<div class="act${stopped ? " stop" : ""}">
      <b>${o.state === "activating" ? "Switching on" : preview ? "Switch your preview on (Stripe test mode)" : "Switch it on"}</b>${stopped ? `<br><span class="bad">It stopped: ${esc(stopped.message)}.</span> Activate again carries on from where it stopped, without charging twice.` : ""}
      <ul>
        <li>The channel to anetix.ai: ${ch.ok ? `${ok(true)}, Stripe in ${esc(ch.stripe)} mode${ch.tax ? ", Stripe Tax on" : ""}` : `${ok(false)}: ${esc(ch.why || "")}`}</li>
        ${c.tax_off ? `<li><span class="bad">Stripe Tax is off.</span> This subscription would carry no sales tax, and one made now does not pick it up if Tax is turned on later (PAID-SITES.md, sales tax).</li>` : ""}
        ${preview ? `<li>A preview runs the real Stripe calls on its own test Customer, then cancels the subscription at once. Nothing on the company changes.</li>` : `<li>The AI key's auto reload is on: ${ok(c.ai_key && c.ai_key.autofill)}</li>
        <li>Paying sites on this instance already: ${esc(c.tenancy.others)}. ${c.tenancy.isolation && c.tenancy.isolation.ok ? "Each company's tools run in a process of their own with their own database login." : `<span class="bad">Tools are not isolated on this instance</span>: ${esc((c.tenancy.isolation || {}).why || "unknown")}.${c.tenancy.others >= 1 ? " Activate refuses a second paying site until they are." : ""}`}</li>
        ${c.size.length ? `<li>Size: ${c.size.map((x) => esc(x.text)).join("; ")}.</li>` : ""}`}
      </ul>
      <b>What changes</b><ul>${c.plan.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      ${preview ? "" : `<label class="check" style="margin-top:6px"><input type="checkbox" id="sf-clear" checked> Take the sample data out of their tools</label>`}
      ${c.test_mode && o.state !== "activating" ? `<label class="check"><input type="checkbox" id="sf-testmode"> Stripe is in ${esc(ch.stripe)} mode: switch this company on with no real charge anyway (your own test company, say)</label>` : ""}
      <div class="foot"><input inputmode="numeric" id="sf-code" placeholder="authenticator code, or empty for your passkey" autocomplete="one-time-code" maxlength="10">
        <button class="go" id="sf-activate" onclick="AdminSites.activate()">${o.state === "activating" ? "Activate again" : preview ? "Run the preview" : "Activate"}</button>
        ${!preview && o.state === "signed" ? `<button class="quiet" id="sf-decline" onclick="AdminSites.decline()">Decline</button><button class="quiet" id="sf-sendback" onclick="AdminSites.sendBack()">Send back</button>` : ""}
        ${o.state === "activating" ? `<button class="quiet" id="sf-stop" onclick="AdminSites.stopActivating()">Stop switching on</button>` : ""}</div>
      ${o.state === "activating" ? `<p class="sub" style="margin:6px 0 0">Stuck? Stop switching on asks Stripe what it holds: a subscription that went through finishes the rollover; otherwise the credit is reversed, the card removed and ${preview ? "the preview ends" : "the manager is asked for a card again"}. Nothing is charged twice.</p>` : ""}
      <div class="err" id="sf-acterr"></div></div>`;
  }
  async function activate() {
    const btn = document.getElementById("sf-activate"), err = document.getElementById("sf-acterr");
    const step = await stepFrom(val("sf-code").trim(), err); if (!step) return;
    btn.disabled = true; btn.textContent = "Switching on…"; err.textContent = "";
    const body = { ...step, clear_sample: !document.getElementById("sf-clear") || document.getElementById("sf-clear").checked };
    const tm = document.getElementById("sf-testmode"); if (tm && tm.checked) body.test_mode_ok = true;
    const tn = document.getElementById("sf-tenancy"); if (tn) body.tenancy_note = tn.value;
    const r = await send(`/api/admin/sites/${encodeURIComponent(EDIT)}/activate`, body);
    if (!r.ok || r.json.declined) {
      err.textContent = r.json.error || r.json.message || "that did not work";
      btn.disabled = false; btn.textContent = "Activate";
      if (r.json.declined || r.json.code === "stopped") { await show(); edit(EDIT); document.getElementById("sf-acterr").textContent = r.json.error || r.json.message; }
      return;
    }
    if (r.json.preview) { alert(`The preview ran: ${r.json.subscription || "a subscription"} was made in Stripe test mode and cancelled at once.\n\nWhat it would change:\n- ${(r.json.plan || []).join("\n- ")}`); close(); await show(); return; }
    close(); await show();
  }
  async function decline() {
    const r = DATA && DATA.rows.find((x) => x.slug === EDIT); if (!r) return;
    const reason = prompt(`Decline ${r.name}'s order? Their site goes back to a demo and the card is removed. The manager sees this reason on the board. Why?`, "");
    if (reason === null) return;
    const res = await send(`/api/admin/sites/${encodeURIComponent(EDIT)}/decline`, { reason });
    if (!res.ok) { alert(res.json.error || "that did not work"); return; }
    close(); await show();
  }
  async function sendBack() {
    const r = DATA && DATA.rows.find((x) => x.slug === EDIT); if (!r) return;
    const note = prompt(`Send ${r.name}'s order back? It is voided, a new draft keeps their answers, and they check and sign again. The manager sees this note on the board. What should they look at?`, "");
    if (note === null) return;
    const res = await send(`/api/admin/sites/${encodeURIComponent(EDIT)}/send-back`, { note });
    if (!res.ok) { alert(res.json.error || "that did not work"); return; }
    close(); await show();
  }
  async function stopActivating() {
    const btn = document.getElementById("sf-stop"), err = document.getElementById("sf-acterr");
    const code = val("sf-code").trim();
    if (!code && !hasPk()) { err.textContent = "Type a fresh code from your authenticator."; return; }
    if (!confirm("Stop switching this site on? Stripe is asked what it holds first: a subscription that went through finishes the rollover, anything else is undone (credit reversed, card removed).")) return;
    const step = await stepFrom(code, err); if (!step) return;
    btn.disabled = true; btn.textContent = "Stopping…"; err.textContent = "";
    const r = await send(`/api/admin/sites/${encodeURIComponent(EDIT)}/stop-activating`, step);
    if (!r.ok) { err.textContent = r.json.error || "that did not work"; btn.disabled = false; btn.textContent = "Stop switching on"; return; }
    if (r.json.activated) alert("Stripe had the subscription after all, so the site finished switching on.");
    close(); await show();
  }
  // stage 4 (src/billing.js): End a site whose payment failed for good, or one Stripe cancelled: the subscription is cancelled
  // now with its open invoices voided, and the site goes back to a demo (tools and data kept, the floor signed out)
  async function endSite() {
    const err = document.getElementById("sf-enderr"), code = val("sf-endcode").trim(), note = val("sf-endnote").trim();
    if (!note) { err.textContent = "Say why, in a few words: the manager reads it."; return; }
    if (!code && !hasPk()) { err.textContent = "Type a fresh code from your authenticator."; return; }
    if (!confirm("End this site's subscription now? Stripe is asked to cancel it and void any invoice it left open, the floor is signed out, and the site goes back to a demo with its tools and data. The manager's notice carries your reason.\n\nThe Terms (5.8): only once fees are 30 days overdue, and on notice to the customer.")) return;
    const step = await stepFrom(code, err); if (!step) return;
    const res = await send(`/api/admin/sites/${encodeURIComponent(EDIT)}/end`, { ...step, note });
    if (!res.ok) { err.textContent = res.json.error || "that did not work"; return; }
    close(); await show();
  }
  async function lift() {
    const note = val("sf-lift");
    const res = await send(`/api/admin/sites/${encodeURIComponent(EDIT)}/lift`, { note });
    if (!res.ok) { alert(res.json.error || "that did not work"); return; }
    close(); await show();
  }
  async function sweep() {
    const b = document.getElementById("gl-sweep"); if (b) b.disabled = true;
    const r = await send("/api/admin/stripe-sweep", {});
    if (!r.ok) alert(r.json.error || "that did not work");
    else if (r.json.skipped) alert("The channel to anetix.ai is not set up, so nothing was removed.");
    await show();
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
    const bits = [`<b>${esc({ draft: "Being filled in", signed: o.card_saved ? "Signed, card saved" : o.activate && o.activate.declined ? "Signed, the card was declined" : "Signed, no card yet", void: "Voided", activating: "Switching on", activated: "Activated", declined: "Declined" }[o.state] || o.state)}</b>${o.kind === "preview" ? ' <span class="chip prop">YOUR PREVIEW</span>' : ""}`];
    if (o.state === "draft") bits.push(`version ${esc(o.version)}${o.approver ? `, waiting on ${esc(o.approver.name)} (${esc(o.approver.email)})` : ""}`);
    if (o.band) bits.push(`${esc(o.band.name)} at ${usd(o.price_usd)} a month`);
    if (o.signer) bits.push(`signed by ${esc(o.signer.name)}${o.signer.title ? `, ${esc(o.signer.title)}` : ""} (${esc(o.signer.email)}${o.signer.via === "approver" ? ", on the approver's link" : ""})${o.signed_at ? ` on ${esc(new Date(o.signed_at).toLocaleString())}` : ""}`);
    if (o.card_saved) bits.push(`card: ${esc(cap((o.card && o.card.brand) || "card"))} ending ${esc((o.card && o.card.last4) || "")}`);
    if (o.note) bits.push(esc(o.note));
    if (o.activate && o.activate.declined && o.activate.declined.length) bits.push(`declined card${o.activate.declined.length === 1 ? "" : "s"}: ${o.activate.declined.map((d) => `${esc(cap((d.card && d.card.brand) || "card"))} ${esc((d.card && d.card.last4) || "")} (${esc(d.message)})`).join("; ")}`);
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
      const n = (d.stages.signed || 0) + (d.attention || 0) + (d.alerts || 0);
      if (n && window.AdminShell && AdminShell.setBadge) AdminShell.setBadge("sites", { n, level: "amber" });
    } catch (e) {}
  }
  window.AdminSites = { show, badge, edit, close, toggle, orders, openGoLive, voidOrder, termsToggle, activate, decline, sendBack, stopActivating, lift, sweep, endSite, saveOffer, clearOffer };
})();
