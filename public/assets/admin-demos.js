// The Demos tab of /admin (src/demos.js): every company that came in from anetix.ai, what it paid, what its AI spent,
// what it built and how. The list: totals, one row per company, and the use cases (what each new-tool request was
// for). One company open (#demos/<slug>): the money, the tools and the requests for new ones with every answer, the
// requests on its board in the person's own words, the builds, and the process step by step from the record.
// Mounted by admin.html (AdminShell onShow "demos"). No secret lives here: /assets is served before the login, and
// every call it makes is an admin-only route.
(function () {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const usd = (x) => `$${Number(x || 0).toFixed(2)}`;
  const when = (t) => (t ? new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
  const day = (t) => (t ? new Date(t).toLocaleDateString([], { month: "short", day: "numeric" }) : "");
  const ago = (t) => {
    if (!t) return "never";
    const m = (Date.now() - new Date(t).getTime()) / 60000;
    return m < 2 ? "just now" : m < 90 ? `${Math.round(m)} min ago` : m < 36 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
  };
  const root = () => document.getElementById("demos-root");
  let LIST = null, OPEN = null;

  // the record's kinds in plain words, for the process view
  const KIND = {
    feedback_filed: "Filed a request", feedback_closed: "Closed a request", proposal_drafted: "AI drafted a proposal", proposal_edited: "Edited the proposal",
    proposal_approved: "Approved the build", proposal_declined: "Declined", requirement_drafted: "AI wrote the requirement", requirement_confirmed: "Confirmed the requirement",
    build_finished: "Build finished", build_summarized: "Build summarized", check_verdict: "Checks said", run_fixed: "Sent findings back", run_overridden: "Overrode a check",
    run_retried: "Retried the build", run_cancelled: "Cancelled the build", deployed: "Put it live", rolled_back: "Rolled back", version_switched: "Switched version",
    review_started: "Started a system review", review_findings: "System review findings", intake_answered: "Answered a new-tool question", intake_round: "AI asked more questions",
    intake_design: "AI wrote the design", intake_adjusted: "Adjusted the design", intake_confirmed: "Approved the new tool", intake_abandoned: "Withdrew the new tool",
    manager_done: "Marked done", manager_little_left: "Said a little is left", question_asked: "AI asked a question", question_answered: "Answered the AI's question",
    duplicate_linked: "Folded into an earlier request", chat_question: "Asked the chat", chat_answer: "Chat answered", doc_saved: "Edited an agent doc",
  };
  const kindLabel = (k) => KIND[k] || k.replace(/_/g, " ");
  const STATUS = { new: "on the board", reviewing: "proposal ready", in_progress: "being built", done: "shipped", declined: "declined" };

  function style() {
    if (document.getElementById("ad-style")) return;
    const s = document.createElement("style"); s.id = "ad-style";
    s.textContent = `
      #demos-root table.list td { vertical-align:top; }
      #demos-root tr.row { cursor:pointer; } #demos-root tr.row:hover td { background:var(--fog); }
      #demos-root .who b { display:block; font-size:14px; } #demos-root .who small { color:var(--steel); }
      #demos-root .pct { font-weight:800; } #demos-root .pct.red { color:var(--red); } #demos-root .pct.amber { color:#b26a00; } #demos-root .pct.ok { color:var(--green); }
      #demos-root .uc { border:1px solid var(--line); border-radius:9px; padding:10px 12px; margin:8px 0; background:#fff; }
      #demos-root .uc h4 { margin:0 0 3px; font-size:14px; } #demos-root .uc p { margin:3px 0; font-size:13px; line-height:1.45; }
      #demos-root .uc .meta { color:var(--steel); font-size:12px; }
      #demos-root .words { white-space:pre-wrap; line-height:1.45; }
      #demos-root .kpi b .pct { font-size:20px; } #demos-root .kpi b small { display:inline; font-size:12px; font-weight:400; }
      #demos-root .qa dt { font-weight:700; font-size:12.5px; margin-top:8px; color:var(--steel); } #demos-root .qa dd { margin:2px 0 0; white-space:pre-wrap; line-height:1.45; }
      #demos-root .tl { list-style:none; margin:6px 0 0; padding:0; } #demos-root .tl li { border-left:2px solid var(--line); padding:4px 0 8px 12px; margin:0; position:relative; }
      #demos-root .tl li::before { content:""; position:absolute; left:-5px; top:9px; width:8px; height:8px; border-radius:50%; background:var(--navy); }
      #demos-root .tl .t { color:var(--steel); font-size:11.5px; } #demos-root .tl .k { font-weight:700; }
      #demos-root .tl .snip { color:var(--steel); font-size:12.5px; white-space:pre-wrap; margin-top:2px; }
      #demos-root details summary { cursor:pointer; color:var(--navy); font-weight:600; font-size:12.5px; margin-top:4px; }
      #demos-root .back { display:inline-block; margin:6px 0 2px; font-weight:600; }
      #demos-root .chip.live { background:#e6f1ea; color:var(--green); } #demos-root .chip.demo { background:#dfeaf6; color:#1f5c99; }
    `;
    document.head.appendChild(s);
  }
  async function get(url) {
    const r = await fetch(url, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `failed (${r.status})`);
    return j;
  }
  const pct = (m) => `<strong class="pct ${m.level || ""}">${esc(m.percent)}%</strong> <small class="sub">(${usd(m.balance_usd)})</small>`;
  const kpi = (label, value, small) => `<div class="kpi"><span>${esc(label)}</span><b>${value}</b>${small ? `<small>${small}</small>` : ""}</div>`;

  // ---- the list -------------------------------------------------------------------------------------------------
  function drawList() {
    const L = LIST, T = L.totals;
    const rows = L.demos.map((d) => `<tr class="row" onclick="location.hash='demos/${esc(d.slug)}'">
      <td class="who"><b>${esc(d.name)}</b>${d.demo ? '<span class="chip demo">DEMO</span>' : ""}<small>${esc(d.contact || "")}${d.email ? ` · ${esc(d.email)}` : ""}</small></td>
      <td>${day(d.since)}<br><small class="sub">active ${esc(ago(d.last_activity))}</small></td>
      <td>${d.manager ? (d.manager.enrolled ? '<span class="ok">2FA set up</span>' : '<span class="warn">no 2FA yet</span>') : '<span class="sub">no account</span>'}<br><small class="sub">${d.manager && d.manager.last_sign_in ? `signed in ${esc(ago(d.manager.last_sign_in))}` : "never signed in"}</small></td>
      <td>${pct(d.money)}</td>
      <td>${usd(d.money.paid_usd)}<br><small class="sub">${d.money.purchases} refill${d.money.purchases === 1 ? "" : "s"}</small></td>
      <td>${usd(d.money.spent_usd)}</td>
      <td>${d.modules.length ? d.modules.map((m) => `${esc(m.title || m.name)}${m.live_version ? ` <small class="sub">v${m.live_version}</small>` : ' <small class="sub">(not live)</small>'}`).join("<br>") : '<span class="sub">nothing yet</span>'}${d.counts.intakes ? `<br><small class="sub">${d.counts.intakes} new-tool request${d.counts.intakes === 1 ? "" : "s"}</small>` : ""}</td>
      <td>${d.counts.requests} filed<br><small class="sub">${d.counts.requests_shipped} shipped${d.counts.to_anetix ? `, ${d.counts.to_anetix} to Anetix` : ""}</small></td>
      <td>${d.counts.deployed} live<br><small class="sub">${d.counts.builds} started${d.counts.stopped ? `, ${d.counts.stopped} stopped` : ""}</small></td>
    </tr>`).join("");
    const ucs = L.use_cases.map((u) => `<div class="uc"><h4>${esc(u.name || "(no name yet)")} <span class="chip ${u.live ? "live" : ""}">${u.live ? "LIVE" : esc((u.status || "").toUpperCase())}</span></h4>
      <div class="meta"><a href="#demos/${esc(u.company)}">${esc(u.company_name)}</a> · ${day(u.created_at)}</div>
      ${u.purpose ? `<p>${esc(u.purpose)}</p>` : ""}
      ${u.thing || u.today || u.who ? `<p class="meta">${u.thing ? `Tracks: ${esc(u.thing)}. ` : ""}${u.today ? `Today: ${esc(u.today)}. ` : ""}${u.who ? `Who: ${esc(u.who)}.` : ""}</p>` : ""}
      ${u.bluf ? `<p><b>Design:</b> ${esc(u.bluf)}</p>` : ""}</div>`).join("");
    root().innerHTML = `
      <div class="card"><div class="grid">
        ${kpi("Companies", T.companies, `${T.demos} demos · ${T.active_7d} active this week · ${T.enrolled} with 2FA`)}
        ${kpi("Paid us", usd(T.paid_usd), `${T.purchases} refill${T.purchases === 1 ? "" : "s"} through Stripe`)}
        ${kpi("AI spend", usd(T.spent_usd), `against ${usd(T.granted_usd)} of credit we gave`)}
        ${kpi("Paid minus AI spend", usd(T.margin_usd), "")}
        ${kpi("Tools live", T.modules_live, `${T.use_cases} new-tool request${T.use_cases === 1 ? "" : "s"}`)}
        ${kpi("Requests", T.requests, `${T.builds_deployed} changes put live`)}
      </div>
      <p style="margin:6px 0 0"><a class="btn" href="/api/admin/demos/export" download>Download everything (JSON)</a> <span class="sub">Every company in full: answers, requests, builds, money and the record, for reading the learnings offline.</span></p></div>
      ${(L.idle || []).length ? `<div class="card"><h2>Idle 11 months or more <small>a site back to a demo: its data may go after 12 months with no sign-in (the Terms, 6.3 and 10.7); a plain demo: Anetix may end it any time, refunding unused bought credit (4.1, 4.2). Tell the manager first, then delete from the company's card</small></h2>
        <table class="list"><tr><th>Company</th><th>Last sign-in</th><th>Can go after</th></tr>${L.idle.map((x) => `<tr><td><a href="#demos/${esc(x.slug)}">${esc(x.name)}</a></td><td>${esc(new Date(x.last_sign_in).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" }))}</td><td>${esc(new Date(x.delete_after).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" }))}</td></tr>`).join("")}</table></div>` : ""}
      <div class="card"><h2>Companies <small>newest first; open one for everything it did</small></h2>
        ${L.demos.length ? `<div style="overflow-x:auto"><table class="list"><tr><th>Company</th><th>Since</th><th>Sign-in</th><th>Credit left</th><th>Paid</th><th>AI spend</th><th>Built</th><th>Requests</th><th>Changes</th></tr>${rows}</table></div>` : '<p class="sub">Nobody has come in from anetix.ai yet. Make a pin on the Pins tab.</p>'}</div>
      <div class="card"><h2>Use cases <small>what each request for a new tool was for, newest first</small></h2>
        ${ucs || '<p class="sub">No new-tool requests yet.</p>'}</div>`;
    if (window.AdminShell && AdminShell.setBadge) AdminShell.setBadge("demos", { n: L.demos.length });
  }

  // ---- one company -----------------------------------------------------------------------------------------------
  function drawOne(d) {
    const m = d.money, lp = d.loop || {};
    const mods = d.modules.map((x) => `<tr><td><b>${esc(x.title || x.name)}</b><br><small class="sub">${esc(x.name)}</small></td><td>${x.live_version ? `v${x.live_version} live` : '<span class="sub">not live</span>'}${x.staged_version ? `<br><small class="sub">v${x.staged_version} in preview</small>` : ""}</td><td>${x.versions}</td><td>${esc(x.description || "")}</td><td><a href="/c/${esc(d.slug)}/m/${esc(x.name)}/" target="_blank" rel="noopener">open</a></td></tr>`).join("");
    const intakes = d.intakes.map((i) => `<div class="uc"><h4>${esc(i.use_case.name || i.name || "(no name yet)")} <span class="chip ${i.use_case.live ? "live" : ""}">${i.use_case.live ? "LIVE" : esc(i.status.toUpperCase())}</span></h4>
      <div class="meta">started ${when(i.created_at)} · last touched ${when(i.updated_at)}${i.cost_usd ? ` · ${usd(i.cost_usd)} of AI` : ""}</div>
      ${i.design && i.design.bluf ? `<p><b>Design:</b> ${esc(i.design.bluf)}</p>` : ""}
      ${i.design && i.design.items && i.design.items.length ? `<ul>${i.design.items.map((x) => `<li>${esc(typeof x === "string" ? x : x.text || JSON.stringify(x))}</li>`).join("")}</ul>` : ""}
      <details><summary>Their answers (${i.answers.length})</summary><dl class="qa">${i.answers.map((a) => `<dt>${esc(a.question)}</dt><dd>${esc(a.answer)}</dd>`).join("")}</dl></details>
      ${i.error ? `<p class="fail">${esc(i.error)}</p>` : ""}</div>`).join("");
    const reqs = d.feedback.filter((f) => f.kind !== "module_request").map((f) => `<tr><td>#${f.id}<br><small class="sub">${day(f.created_at)}</small></td>
      <td>${f.module === "platform" ? '<span class="chip">TO ANETIX</span>' : esc(f.module || "")}${f.screen ? `<br><small class="sub">${esc(f.screen)}</small>` : ""}</td>
      <td class="words">${esc(f.message)}${f.name ? `<br><small class="sub">${esc(f.name)}</small>` : ""}</td>
      <td>${esc(STATUS[f.status] || f.status)}${f.duplicate_of ? `<br><small class="sub">same as #${f.duplicate_of}</small>` : ""}${f.follow_up_of ? `<br><small class="sub">follow-up to #${f.follow_up_of}</small>` : ""}</td>
      <td>${f.outcome ? `<span class="words">${esc(f.outcome)}</span>` : f.proposal ? `<details><summary>proposal (${esc(f.proposal_status || "")})</summary><div class="words">${esc(f.proposal)}</div></details>` : ""}${f.manager_answer ? `<br><small class="sub">manager: ${esc(f.manager_answer)}</small>` : ""}</td></tr>`).join("");
    const runs = d.runs.slice().reverse().map((r) => `<tr><td>${when(r.created_at)}</td><td>${esc(r.module)}<br><small class="sub">${esc(r.lane)}</small></td>
      <td>${r.title ? `<b>${esc(r.title)}</b>` : ""}${r.what_changed ? `<div class="words">${esc(r.what_changed)}</div>` : ""}${r.error ? `<div class="fail">${esc(r.error)}</div>` : ""}</td>
      <td>${esc(r.status)}${r.status !== "deployed" ? `<br><small class="sub">at ${esc(r.step)}</small>` : ""}</td><td>${usd(r.cost_usd)}</td></tr>`).join("");
    const ledger = d.ledger.map((l) => `<tr><td>${when(l.created_at)}</td><td>${esc(l.kind)}</td><td>${l.delta_usd > 0 ? "+" : ""}${usd(l.delta_usd)} of credit</td><td>${l.paid_usd != null ? usd(l.paid_usd) + " paid" : ""}</td><td class="sub">${esc(l.note || "")}</td></tr>`).join("");
    const spend = d.spend.map((s) => `<tr><td>${esc(s.kind)}</td><td>${s.n}</td><td>${usd(s.usd)}</td></tr>`).join("");
    const tl = d.timeline.map((t) => `<li><div class="t">${when(t.created_at)} · ${esc(t.actor_name || t.actor_role || "")}${t.module ? ` · ${esc(t.module)}` : ""}</div>
      <div class="k">${esc(kindLabel(t.kind))}${t.feedback_id ? ` <small class="sub">#${t.feedback_id}</small>` : ""}${t.version ? ` <small class="sub">v${t.version}</small>` : ""}</div>
      ${t.after || t.before ? `<div class="snip">${t.before && t.after ? `<s>${esc(t.before)}</s>\n` : ""}${esc(t.after || t.before)}</div>` : ""}</li>`).join("");
    root().innerHTML = `
      <a class="back" href="#demos">← All demos</a>
      <div class="card"><div class="cohead"><h2>${esc(d.name)}${d.demo ? '<span class="chip demo">DEMO</span>' : ""}</h2>
        <div class="links"><a href="/c/${esc(d.slug)}/" target="_blank" rel="noopener">Open their board</a><a href="#companies/${esc(d.slug)}">Company card</a><a href="/api/c/${esc(d.slug)}/record/export">Download the record</a><a href="#" style="color:var(--red)" data-slug="${esc(d.slug)}" data-name="${esc(d.name)}" onclick="openDelete(this.dataset.slug, this.dataset.name);return false" title="Delete this demo company and everything in it (the slug typed back and your code)">Delete this demo</a></div></div>
        <p class="sub">${esc(d.contact || "")}${d.email ? ` · ${esc(d.email)}` : ""} · came in ${when(d.since)}${d.pin ? ` on pin ${esc(d.pin.shown)} (${esc(d.pin.label)})` : ""} · ${d.manager ? `${esc(d.manager.login)}, ${d.manager.enrolled ? "2FA set up" : "no 2FA yet"}, ${d.manager.last_sign_in ? `signed in ${esc(ago(d.manager.last_sign_in))}` : "never signed in"}` : "no account"} · active ${esc(ago(d.last_activity))}</p>
        <div class="grid">
          ${kpi("Credit left", pct(m), `${usd(m.bought_credit_usd + m.granted_usd + m.adjusted_usd)} of credit in all`)}
          ${kpi("Paid us", usd(m.paid_usd), `${m.purchases} refill${m.purchases === 1 ? "" : "s"}`)}
          ${kpi("AI spend", usd(m.spent_usd), `paid minus spend ${usd(m.margin_usd)}`)}
          ${kpi("Tools", d.modules.filter((x) => x.live_version).length + " live", `${d.counts.intakes} new-tool request${d.counts.intakes === 1 ? "" : "s"}, ${d.counts.intakes_done} built`)}
          ${kpi("Requests", d.counts.requests, `${d.counts.requests_shipped} shipped · ${lp.approved || 0} approved · ${lp.declined || 0} declined`)}
          ${kpi("Changes live", d.counts.deployed, `${d.counts.builds} builds · ${d.counts.stopped} stopped${lp.to_floor_median_hours != null ? ` · median ${lp.to_floor_median_hours} h to live` : ""}`)}
        </div></div>
      <div class="card"><h2>What they built</h2>
        ${mods ? `<table class="list"><tr><th>Tool</th><th>Version</th><th>Versions</th><th>What it is</th><th></th></tr>${mods}</table>` : '<p class="sub">No tools yet.</p>'}
        <h3 style="margin-top:14px">Requests for a new tool</h3>${intakes || '<p class="sub">None.</p>'}</div>
      <div class="card"><h2>Their board <small>every request, in their words</small></h2>
        ${reqs ? `<div style="overflow-x:auto"><table class="list"><tr><th>#</th><th>Tool</th><th>What they asked</th><th>Where it is</th><th>What happened</th></tr>${reqs}</table></div>` : '<p class="sub">Nothing filed yet.</p>'}</div>
      <div class="card"><h2>Builds</h2>
        ${runs ? `<div style="overflow-x:auto"><table class="list"><tr><th>When</th><th>Tool</th><th>What changed</th><th>Status</th><th>AI</th></tr>${runs}</table></div>` : '<p class="sub">No builds yet.</p>'}</div>
      <div class="secs">
        <div class="sec"><h3>Credit</h3>${ledger ? `<table class="list">${ledger}</table>` : '<p class="sub">No ledger rows.</p>'}</div>
        <div class="sec"><h3>Where the AI spend went</h3>${spend ? `<table class="list"><tr><th>What</th><th>Calls</th><th>Spend</th></tr>${spend}</table>` : '<p class="sub">Nothing spent yet.</p>'}</div>
      </div>
      <div class="card"><h2>The process <small>newest first, from the record${d.timeline.length >= 600 ? " (the last 600 steps; Download the record has them all)" : ""}</small></h2>
        ${tl ? `<ul class="tl">${tl}</ul>` : '<p class="sub">Nothing recorded yet.</p>'}</div>`;
  }

  async function show(rest) {
    style();
    const slug = String(rest || "").split("/")[0];
    try {
      if (slug) {
        if (!OPEN || OPEN.slug !== slug) root().innerHTML = '<div class="card sub">Loading…</div>';
        OPEN = await get(`/api/admin/demos/${encodeURIComponent(slug)}`);
        drawOne(OPEN);
      } else {
        if (!LIST) root().innerHTML = '<div class="card sub">Loading…</div>';
        LIST = await get("/api/admin/demos");
        drawList();
      }
    } catch (e) { root().innerHTML = `<div class="card"><p class="fail">${esc(e.message)}</p><p><a href="#demos">Back to all demos</a></p></div>`; }
  }
  // the tab's count in the header, without opening it
  async function badge() { try { LIST = await get("/api/admin/demos"); if (window.AdminShell && AdminShell.setBadge) AdminShell.setBadge("demos", { n: LIST.demos.length }); } catch (e) {} }
  window.AdminDemos = { show, badge };
})();
