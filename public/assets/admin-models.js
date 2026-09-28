// The Models tab of /admin (src/assess.js, src/agent.js). Three cards, one decision: which of the two models is
// the baseline. (1) The baseline and a job's own model, the companies that pin a job, retired env variables.
// (2) The head-to-head: start one, watch it, pick blind, read the scorecard, make the other model the baseline.
// (3) The live A/B: switch it on for proposals, builds and new modules, and read the split per model.
// Mounted by admin.html (AdminShell onShow "models"). No secret lives here: /assets is served before the login.
(function () {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let M = null, OPEN = null, A = null, OPTS = null, TIMER = null, PICK = null;
  const JOB_TEXT = {
    propose: "Reading a request and drafting the proposal; the requirement before a functionality build, the diagrams, ERP lookups, a module's chat",
    build: "The build agent: edits the module files, most of the spend",
    review: "The independent check of a build's diff",
    design: "New modules (the questions, the design, the first build and its check), system reviews, brand guides",
  };
  const AB_TEXT = { propose: "proposals", build: "builds (and their requirement and review)", design: "new modules" };
  const label = (id) => ((M && (M.labels || M.models)) || []).find((m) => m.id === id)?.label || id || "";
  const money = (x) => (x == null ? "none" : `$${Number(x).toFixed(Number(x) < 1 ? 3 : 2)}`);
  const pctOf = (s) => (s && s.of ? `${Math.round((100 * s.n) / s.of)}% <small>(${s.n} of ${s.of})</small>` : "<small>none yet</small>");
  const when = (t) => (t ? new Date(t).toLocaleString() : "");
  async function api(url, body) {
    const r = await fetch(url, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { alert(j.error || `failed (${r.status})`); return null; }
    return j;
  }
  function style() {
    if (document.getElementById("am-style")) return;
    const s = document.createElement("style"); s.id = "am-style";
    s.textContent = `
      #models-root .big { font-size:22px; font-weight:800; margin:4px 0 2px; }
      #models-root table.am { border-collapse:collapse; width:100%; font-size:13px; margin-top:8px; }
      #models-root table.am th, #models-root table.am td { text-align:left; padding:6px 8px 6px 0; border-bottom:1px solid var(--line); vertical-align:top; line-height:1.45; }
      #models-root table.am th { font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:var(--steel); font-weight:600; }
      #models-root table.am td small { color:var(--steel); }
      #models-root .row2 { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:8px; }
      #models-root input[type=number] { width:70px; }
      #models-root .verdict { font-size:15px; font-weight:700; margin:6px 0; }
      #am-over { display:none; position:fixed; inset:0; background:rgba(28,36,46,.55); z-index:30; overflow:auto; padding:18px 12px; }
      #am-over.on { display:block; }
      #am-card { background:#fff; border-radius:14px; padding:18px; max-width:1180px; margin:0 auto; font-size:13px; line-height:1.5; }
      #am-card h2 { font-size:17px; margin-bottom:4px; }
      #am-card .sides { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin-top:10px; }
      #am-card .side { border:1px solid var(--line); border-radius:10px; padding:12px; min-width:0; }
      #am-card .side h3 { font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:var(--steel); margin:0 0 6px; }
      #am-card pre { white-space:pre-wrap; word-break:break-word; font-size:12px; background:var(--fog); border-radius:8px; padding:8px; max-height:420px; overflow:auto; }
      #am-card .ctx { background:var(--fog); border-radius:10px; padding:10px 12px; margin-top:8px; }
      #am-card .choose { display:flex; flex-wrap:wrap; gap:6px; margin-top:12px; }
      #am-card textarea { width:100%; min-height:48px; font-family:inherit; font-size:13px; border:1px solid var(--line); border-radius:7px; padding:7px; margin-top:8px; }
      @media (max-width:820px) { #am-card .sides { grid-template-columns:minmax(0,1fr); } }`;
    document.head.appendChild(s);
    const o = document.createElement("div"); o.id = "am-over"; o.innerHTML = `<div id="am-card"></div>`;
    o.addEventListener("click", (e) => { if (e.target === o) closePick(); });
    document.body.appendChild(o);
  }

  async function load() {
    const r = await fetch("/api/admin/models", { cache: "no-store" });
    if (!r.ok) { document.getElementById("models-root").innerHTML = `<div class="card sub">Could not load the models (${r.status}).</div>`; return; }
    M = await r.json();
    if (!OPTS) OPTS = await fetch("/api/admin/assess/options", { cache: "no-store" }).then((x) => x.json()).catch(() => null);
    draw();
    const id = OPEN || (M.assessments[0] && M.assessments[0].id);
    if (id) await openAssessment(id, true);
  }

  // ---- card 1: the baseline ----
  function baselineCard() {
    const s = M.settings, d = M.defaults;
    const opt = (sel, withBase) => (withBase ? `<option value="" ${sel ? "" : "selected"}>The baseline (${esc(label(s.baseline))})</option>` : "") +
      M.models.map((m) => `<option value="${m.id}" ${m.id === sel ? "selected" : ""}>${esc(m.label)} ($${m.in} / $${m.out})</option>`).join("");
    const jobRows = M.jobs.map((j) => `<tr><td><b>${esc(j)}</b></td><td class="sub">${esc(JOB_TEXT[j])}</td><td><select id="am-job-${j}">${opt(s.jobs[j] || "", true)}</select></td><td>${esc(label(d[j]))}</td></tr>`).join("");
    const pins = M.pins.length
      ? M.pins.map((c) => `<tr><td>${esc(c.name)}</td><td>${Object.entries(c.pins).filter(([, v]) => v).map(([j, v]) => `${esc(j)} ${esc(label(v))}`).join(", ")}</td><td><button class="quiet" style="margin:0" onclick="AdminModels.unpin('${esc(c.slug)}')">Follow the platform</button></td></tr>`).join("")
      : "";
    return `<div class="card" id="am-baseline">
      <h2>Baseline <small>what every job runs on unless it has its own model below or a company pins it</small></h2>
      <div class="big">${esc(label(s.baseline))}</div>
      <div class="sub">${s.set_at ? `Set ${esc(when(s.set_at))}${s.set_by ? ` by ${esc(s.set_by)}` : ""}.` : "The first baseline (nobody has changed it yet)."} ${M.models.map((m) => `${esc(m.label)}: $${m.in} in, $${m.out} out per million tokens.`).join(" ")}</div>
      <div class="row2"><select id="am-base">${opt(s.baseline, false)}</select><button class="primary" style="margin:0" onclick="AdminModels.saveBaseline()">Make it the baseline</button></div>
      <h3 style="margin-top:14px">Short text jobs</h3>
      <p class="sub">The plain summary after every build (the title and the "what changed" the floor reads on the Done card and in "New here") and the plain-words rewrites of the intake's questions and design. Short calls, a fraction of a cent each; they have a model of their own.</p>
      <div class="row2"><select id="am-summary">${(M.summary_choices || []).map((m) => `<option value="${m.id}" ${m.id === s.summary ? "selected" : ""}>${esc(m.label)} ($${m.in} / $${m.out})</option>`).join("")}</select><button class="quiet" style="margin:0" onclick="AdminModels.saveSummary()">Save</button></div>
      <details style="margin-top:12px" ${Object.keys(s.jobs).length ? "open" : ""}><summary>A job of its own <span class="sub">(only when the assessment says one job wants the other model)</span></summary>
        <div class="hwrap"><table class="am"><tr><th>Job</th><th>What it covers</th><th>Runs on</th><th>Now</th></tr>${jobRows}</table></div>
        <button class="quiet" onclick="AdminModels.saveJobs()">Save the jobs</button>
      </details>
      <h3 style="margin-top:14px">Companies that pin a job</h3>
      ${pins ? `<p class="sub">A pinned job stays on that model whatever the baseline is, and stays out of the live A/B.</p><div class="hwrap"><table class="am"><tr><th>Company</th><th>Pinned</th><th></th></tr>${pins}</table></div>` : `<div class="sub">None: every company follows the platform.</div>`}
      ${M.retired_env.length ? `<div class="note amber"><b>${M.retired_env.map(esc).join(", ")}</b> ${M.retired_env.length === 1 ? "is" : "are"} set in Railway and no longer read (the models are set here now). Delete ${M.retired_env.length === 1 ? "it" : "them"} from the SymbioticOS service's variables.</div>` : ""}
    </div>`;
  }

  // ---- card 2: the head-to-head ----
  function estimateLine() {
    if (!OPTS) return "";
    let total = 0;
    for (const [k, o] of Object.entries(OPTS.kinds)) {
      const n = Number((document.getElementById(`am-n-${k}`) || {}).value || 0);
      total += Math.min(n, o.available) * Object.values(o.per_case_usd).reduce((a, b) => a + b, 0);
    }
    return `About $${total.toFixed(2)} for both models, rough.`;
  }
  function startForm() {
    if (!OPTS) return `<div class="sub">Loading what can be assessed…</div>`;
    const deflt = { crosscheck: 10, proposal: 8, design: 3, build: 3 };
    const rows = Object.entries(OPTS.kinds).map(([k, o]) => `<tr><td><b>${esc(o.label)}</b>${o.picked ? "" : ' <small class="sub">(scored against the labels, no blind pick)</small>'}</td>
      <td>${o.available} stored</td>
      <td><input type="number" min="0" max="${Math.min(o.available, OPTS.max_cases)}" id="am-n-${k}" value="${Math.min(deflt[k] || 0, o.available)}" oninput="AdminModels.estimate()"></td>
      <td class="sub">${Object.entries(o.per_case_usd).map(([m, usd]) => `${esc(label(m))} about $${usd.toFixed(2)}`).join(" · ")} a case</td></tr>`).join("");
    return `<div class="hwrap"><table class="am"><tr><th>Kind of case</th><th>Available</th><th>Cases</th><th>Cost per case</th></tr>${rows}</table></div>
      <div class="row2"><span class="sub">Stop at</span> $<input type="number" min="1" step="1" id="am-budget" value="25"> <span class="sub" id="am-est">${estimateLine()}</span>
      <button class="go" style="margin:0" onclick="AdminModels.start()">Start the head-to-head</button></div>
      <p class="sub" style="margin-top:6px">Each case is done again by both models with the brief a real call gets, one at a time, in the background; nothing reaches a board or the floor. Builds run in a scratch folder and are checked by both models. The spend counts against the company budgets and shows on the credit line as "assess". A build case is the costly one.</p>`;
  }
  function listRows() {
    if (!M.assessments.length) return `<div class="sub">None yet.</div>`;
    return `<div class="hwrap"><table class="am"><tr><th>#</th><th>Started</th><th>Status</th><th>Trials</th><th>Picks</th><th>Spent</th><th></th></tr>${M.assessments.map((a) => `<tr>
      <td>${a.id}</td><td>${esc(when(a.created_at))}${a.created_by ? `<br><small>${esc(a.created_by)}</small>` : ""}</td>
      <td>${a.status === "running" ? '<span class="pulse"></span>' : ""}${esc(a.status)}${a.note ? `<br><small>${esc(a.note)}</small>` : ""}</td>
      <td>${a.finished} of ${a.trials}</td><td>${a.picks}</td><td>$${Number(a.cost_usd).toFixed(2)}${a.budget_usd ? ` <small>of $${Number(a.budget_usd).toFixed(0)}</small>` : ""}</td>
      <td><button class="quiet" style="margin:0" onclick="AdminModels.open(${a.id})">${OPEN === a.id ? "Showing" : "Open"}</button></td></tr>`).join("")}</table></div>`;
  }
  function kindCell(kind, row) {
    const lines = [`${row.done} done${row.failed ? `, <span class="warn">${row.failed} failed</span>` : ""}${row.waiting ? `, ${row.waiting} to go` : ""}`];
    if (kind === "crosscheck") lines.push(`agrees with your label ${pctOf(row.label)}`);
    if (kind === "proposal") { lines.push(`same kind of change as approved ${pctOf(row.class)}`); lines.push(`same screen as approved ${pctOf(row.target)}`); }
    if (kind === "design") lines.push(`plain-words flags ${row.flags_avg == null ? "<small>none yet</small>" : row.flags_avg.toFixed(1)} a design · ${row.screens_avg == null ? "" : row.screens_avg.toFixed(1)} screens`);
    if (kind === "build") { lines.push(`passed the module gate ${pctOf(row.gate)}`); lines.push(`passed the OTHER model's check ${pctOf(row.other)}`); lines.push(`passed its own check ${pctOf(row.self)}`); if (row.unchanged) lines.push(`<span class="warn">${row.unchanged} changed nothing</span>`); }
    if (row.wins || row.losses) lines.push(`blind: won ${row.wins}, lost ${row.losses}`);
    lines.push(`<small>${money(row.cost_avg)} a case · ${row.secs_avg == null ? "" : `${row.secs_avg} s`}</small>`);
    return lines.join("<br>");
  }
  function assessmentCard() {
    if (!A) return "";
    const a = A.assessment, c = A.card, r = c.reading;
    const models = a.models;
    const rows = Object.entries(c.kinds).map(([k, kc]) => `<tr><td><b>${esc(kc.label)}</b><br><small>${kc.cases} case${kc.cases === 1 ? "" : "s"}${kc.blind ? ` · ${kc.picked} picked${kc.same ? `, ${kc.same} about the same` : ""}${kc.neither ? `, ${kc.neither} both missed` : ""}` : ""}</small></td>${models.map((m) => `<td>${kindCell(k, kc.models[m])}</td>`).join("")}</tr>`).join("");
    const totals = models.map((m) => `<td><b>$${c.totals[m].cost_usd.toFixed(2)}</b> <small>over ${c.totals[m].done} trials</small></td>`).join("");
    const waiting = A.pickable;
    const suggest = r.suggest && r.suggest !== M.settings.baseline;
    return `<div class="card" id="am-assess">
      <h2>Head-to-head #${a.id} <small>${esc(a.status)}${a.status === "running" ? ` · ${A.progress.finished} of ${A.progress.trials} trials` : ""} · $${Number(a.cost_usd).toFixed(2)} spent${a.company ? ` · ${esc(a.company)} only` : ""}</small></h2>
      <div class="verdict">${esc(r.verdict)}</div>
      ${r.lines.length ? `<ul>${r.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
      <div class="row2">
        ${waiting ? `<button class="primary" style="margin:0" onclick="AdminModels.pick()">Pick blind (${waiting} waiting)</button>` : `<span class="sub">No case waiting for a blind pick.</span>`}
        ${suggest ? `<button class="go" style="margin:0" onclick="AdminModels.adopt('${esc(r.suggest)}', ${a.id})">Make ${esc(label(r.suggest))} the baseline</button>` : ""}
        ${a.status === "running" ? `<button class="danger" style="margin:0" onclick="AdminModels.stop(${a.id})">Stop</button>` : ""}
      </div>
      <div class="hwrap"><table class="am"><tr><th>Kind</th>${models.map((m) => `<th>${esc(label(m))}${m === M.settings.baseline ? " <small>(baseline)</small>" : ""}</th>`).join("")}</tr>${rows}<tr><td><b>Spent</b></td>${totals}</tr></table></div>
      <details style="margin-top:10px"><summary>The rules the reading uses</summary><p class="sub" style="margin-top:6px">${esc(r.rules)}</p></details>
      ${A.trials.some((t) => t.status === "failed") ? `<details style="margin-top:6px"><summary>Trials that failed</summary><ul>${A.trials.filter((t) => t.status === "failed").map((t) => `<li>${esc(t.kind)} #${t.source_id} on ${esc(label(t.model))}: ${esc(t.error || "")}</li>`).join("")}</ul></details>` : ""}
    </div>`;
  }

  // ---- card 3: the live A/B ----
  function abCard() {
    const ab = M.ab || {}, s = ab.settings || {}, split = ab.split;
    const on = Boolean(s.on);
    const jobs = M.ab_jobs.map((j) => `<label style="margin-right:12px"><input type="checkbox" id="am-ab-${j}" ${!on || s.jobs.includes(j) ? "checked" : ""}> ${esc(AB_TEXT[j])}</label>`).join("");
    let table = "";
    if (split) {
      const ms = Object.keys(split);
      const line = (name, f) => `<tr><td>${name}</td>${ms.map((m) => `<td>${f(split[m])}</td>`).join("")}</tr>`;
      const share = (x) => (x == null ? "<small>none yet</small>" : `${Math.round(100 * x)}%`);
      table = `<div class="hwrap"><table class="am"><tr><th></th>${ms.map((m) => `<th>${esc(label(m))}</th>`).join("")}</tr>
        ${line("Builds started", (x) => x.builds.started + (x.builds.in_flight ? ` <small>(${x.builds.in_flight} in flight)</small>` : ""))}
        ${line("Shipped", (x) => x.builds.shipped)}
        ${line("Rolled back", (x) => x.builds.rolled_back ? `<span class="warn">${x.builds.rolled_back}</span>` : 0)}
        ${line("Stopped by the reviewer / tests / gate", (x) => `${x.builds.stops.reviewer} / ${x.builds.stops.tests} / ${x.builds.stops.gate}${x.builds.stops.other ? ` <small>(${x.builds.stops.other} other)</small>` : ""}`)}
        ${line("Fix rounds · overrides", (x) => `${x.builds.fix_rounds} · ${x.builds.overrides}`)}
        ${line("Met, once live (floor and manager)", (x) => `${share(x.answers.met_share)} <small>(${x.answers.met} met, ${x.answers.missed} missed, ${x.answers.unanswered} not said)</small>`)}
        ${line("Start to the deploy gate, median", (x) => (x.builds.to_gate_median_minutes == null ? "<small>none yet</small>" : `${x.builds.to_gate_median_minutes} min`))}
        ${line("Build spend · per run · per shipped", (x) => `$${x.builds.cost_usd.toFixed(2)} · ${money(x.builds.cost_per_run)} · ${money(x.builds.per_shipped_usd)}`)}
        ${line("Proposals drafted · approved · edited first · declined", (x) => `${x.proposals.drafted} · ${x.proposals.approved} · ${x.proposals.edited} · ${x.proposals.declined} <small>(${share(x.proposals.approved_share)} approved, $${x.proposals.cost_usd.toFixed(2)})</small>`)}
        ${line("New modules started · confirmed · on the floor · withdrawn", (x) => `${x.intakes.started} · ${x.intakes.confirmed} · ${x.intakes.done} · ${x.intakes.abandoned}`)}
      </table></div>`;
      const fewest = Math.min(...ms.map((m) => split[m].builds.started));
      table += `<p class="sub" style="margin-top:6px">${fewest < ab.min_runs ? `Too few builds to read yet: ${fewest} on the thinner arm, ${ab.min_runs} each is where the numbers start to mean something.` : "Read the misses (not quite, a little left), rollbacks and reviewer stops first; the spend second."} A build's reviewer is on the same arm, so its stop count is builder and reviewer together; the head-to-head's label agreement is the reviewer alone.</p>`;
    }
    return `<div class="card" id="am-ab">
      <h2>Live A/B <small>new work split between the two, counted on the floor</small></h2>
      <div class="sub">${on ? `<span class="pulse"></span><b>Running</b> since ${esc(when(s.since))}${s.by ? ` (${esc(s.by)})` : ""} for ${s.jobs.map((j) => esc(AB_TEXT[j])).join(", ")}.` : s.since ? `Off. The last test ran from ${esc(when(s.since))}${s.ended ? ` to ${esc(when(s.ended))}` : ""}; its numbers are below.` : "Off."} Each new ${on ? "item" : "item, once on,"} goes to whichever model has had fewer of that job since the start (a coin decides a tie). A company that pins a job keeps it.</div>
      <div style="margin-top:8px">${jobs}</div>
      <div class="row2">${on ? `<button class="quiet" style="margin:0" onclick="AdminModels.ab(true)">Save the jobs</button><button class="danger" style="margin:0" onclick="AdminModels.ab(false)">Stop the A/B</button>` : `<button class="go" style="margin:0" onclick="AdminModels.ab(true)">Start the A/B</button>`}</div>
      ${table}
    </div>`;
  }

  // The head-to-head and the live A/B are how the baseline was decided; with it decided they wait behind More (the
  // launch audit 2.4), open again once opened (kept across a redraw).
  let MORE_OPEN = false;
  function draw() {
    style();
    const running = (M && M.settings && M.settings.ab && M.settings.ab.on) || (A && A.assessment && A.assessment.status === "running");
    document.getElementById("models-root").innerHTML = baselineCard() +
      `<details id="am-more" ${MORE_OPEN || running ? "open" : ""} ontoggle="AdminModels.more(this.open)"><summary style="font-weight:700;margin:12px 0 4px">More: the head-to-head and the live A/B <span class="sub">(how the baseline was decided)</span></summary>` +
      `<div class="card" id="am-h2h"><h2>Head-to-head <small>stored work done again by both models, scored against what happened, picked blind</small></h2>${startForm()}<h3 style="margin-top:14px">Assessments</h3><div id="am-list">${listRows()}</div></div>` +
      `<div id="am-open">${assessmentCard()}</div>` + abCard() + `</details>`;
    window.AdminModels.estimate();   // the start form's estimate needs its inputs on the page first
  }

  async function openAssessment(id, quiet) {
    OPEN = id;
    const j = await fetch(`/api/admin/assess/${id}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!j) return;
    A = j;
    const next = await fetch(`/api/admin/assess/${id}/pick`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    A.pickable = next && !next.done ? next.left_to_pick : 0;
    const box = document.getElementById("am-open"); if (box) box.innerHTML = assessmentCard();
    const list = document.getElementById("am-list"); if (list) list.innerHTML = listRows();
    clearTimeout(TIMER);
    if (A.assessment.status === "running") TIMER = setTimeout(() => { if (AdminShell.current().id === "models" && OPEN === id) refresh(id); }, 5000);
    if (!quiet) document.getElementById("am-open").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function refresh(id) {
    const r = await fetch("/api/admin/models", { cache: "no-store" }); if (r.ok) M = await r.json();
    const list = document.getElementById("am-list"); if (list) list.innerHTML = listRows();
    await openAssessment(id, true);
  }

  // ---- blind picks ----
  function sideHtml(kind, v) {
    if (kind === "proposal") return `<p>${esc(v.proposal)}</p><p class="sub">${v.class === "ui" ? "Look and feel" : "How it works"} · ${esc(v.target_file || "no screen named")}</p><details><summary>Why</summary><p class="sub">${esc(v.rationale)}</p></details>`;
    if (kind === "design") return `<p><b>${esc(v.bluf)}</b></p><ul>${(v.items || []).map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
      <p class="sub">${(v.screens || []).length} screen${(v.screens || []).length === 1 ? "" : "s"}: ${(v.screens || []).map((s) => esc(`${s.title} (${s.role})`)).join("; ")}${v.flags ? ` · <span class="warn">${v.flags} plain-words flag${v.flags === 1 ? "" : "s"}</span>` : ""}</p>
      <details><summary>Leaves out</summary><ul>${(v.leaves_out || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details><details><summary>The full reference</summary><pre>${esc(v.reference_md)}</pre></details>`;
    if (kind === "build") return `<pre>${esc(v.summary)}</pre>
      <p class="sub">${(v.files || []).length} file${(v.files || []).length === 1 ? "" : "s"}: ${(v.files || []).map(esc).join(", ") || "none"}</p>
      <p>${v.gate && v.gate.ok === false ? `<span class="warn">The module gate stopped it: ${esc(v.gate.line)}</span>` : "Passed the module gate."} ${v.reviews ? `${v.reviews_passed} of ${v.reviews} reviewers passed it.` : "Nothing changed, so nothing to review."}</p>
      ${(v.blocking || []).length ? `<details open><summary>What the reviewers blocked on</summary><ul>${v.blocking.map((b) => `<li>${esc(b)}</li>`).join("")}</ul></details>` : ""}
      <details><summary>The diff</summary><pre>${esc(v.diff)}</pre></details>`;
    return "";
  }
  function contextHtml(kind, c) {
    const then = c.then;
    if (kind === "proposal") return `<div class="ctx"><b>The request</b>${c.screen ? ` <span class="sub">(from ${esc(c.screen)}${c.by ? `, ${esc(c.by)}` : ""})</span>` : ""}<p>"${esc(c.words)}"</p>
      ${then ? `<details><summary>What you approved then</summary><p>${esc(then.proposal)}</p><p class="sub">${then.class === "ui" ? "Look and feel" : "How it works"} · ${esc(then.target_file || "")}${then.edited ? " · you edited it before approving" : ""}</p></details>` : ""}</div>`;
    if (kind === "design") return `<div class="ctx">Both read the same answers the manager gave and wrote a first design.${then ? `<details><summary>The design confirmed then</summary><p><b>${esc(then.bluf)}</b></p><ul>${(then.items || []).map((i) => `<li>${esc(i)}</li>`).join("")}</ul></details>` : ""}</div>`;
    if (kind === "build") return `<div class="ctx"><b>What the build had to do</b><pre>${esc(c.requirement)}</pre>${then && then.what_changed ? `<details><summary>What shipped then (v${esc(then.version)})</summary><p>${esc(then.what_changed)}</p></details>` : ""}</div>`;
    return "";
  }
  async function pickNext() {
    if (!OPEN) return;
    const p = await fetch(`/api/admin/assess/${OPEN}/pick`, { cache: "no-store" }).then((r) => r.json());
    PICK = p;
    const card = document.getElementById("am-card");
    if (p.done) { card.innerHTML = `<h2>Nothing left to pick</h2><p class="sub">Every case with both answers in has a pick. More appear as the trials finish.</p><button class="primary" onclick="AdminModels.closePick()">Close</button>`; }
    else card.innerHTML = `<h2>${esc(p.context.title)} <small class="sub">${esc(p.kind_label)} · ${p.left_to_pick} waiting</small></h2>
      <p class="sub">Two answers to the same case. Which one would you rather have had? No model, cost or time is shown.</p>
      ${contextHtml(p.kind, p.context)}
      <div class="sides"><div class="side"><h3>Left</h3>${sideHtml(p.kind, p.left)}</div><div class="side"><h3>Right</h3>${sideHtml(p.kind, p.right)}</div></div>
      <textarea id="am-note" placeholder="A note on why (optional; it is kept with the pick)"></textarea>
      <div class="choose"><button class="primary" onclick="AdminModels.choose('left')">Left is better</button><button class="primary" onclick="AdminModels.choose('right')">Right is better</button><button class="quiet" onclick="AdminModels.choose('same')">About the same</button><button class="quiet" onclick="AdminModels.choose('neither')">Both miss</button><span style="flex:1"></span><button class="quiet" onclick="AdminModels.closePick()">Close</button></div>
      <div id="am-revealed" class="sub" style="margin-top:8px"></div>`;
    document.getElementById("am-over").classList.add("on");
    document.getElementById("am-over").scrollTop = 0;
  }
  async function choose(which) {
    if (!PICK || PICK.done) return;
    const note = (document.getElementById("am-note") || {}).value || "";
    const j = await api(`/api/admin/assess/${OPEN}/pick`, { kind: PICK.kind, source_id: PICK.source_id, pick: which, note });
    if (!j) return;
    const el = document.getElementById("am-revealed");
    if (el) el.innerHTML = `Left was <b>${esc(label(j.revealed.left))}</b>, right was <b>${esc(label(j.revealed.right))}</b>.`;
    setTimeout(pickNext, 1400);
  }
  function closePick() { document.getElementById("am-over").classList.remove("on"); if (OPEN) openAssessment(OPEN, true); }

  window.AdminModels = {
    show() { load().catch((e) => console.error("models:", e)); },
    more(open) { MORE_OPEN = Boolean(open); },
    estimate() { const el = document.getElementById("am-est"); if (el) el.textContent = estimateLine(); },
    async saveBaseline() {
      const v = document.getElementById("am-base").value;
      if (v === M.settings.baseline) return;
      if (!confirm(`Make ${label(v)} the baseline? Every job that is not pinned and has no model of its own runs on it from the next call.`)) return;
      if (await api("/api/admin/models", { baseline: v })) load();
    },
    async saveSummary() {
      const v = document.getElementById("am-summary").value;
      if (v !== M.settings.summary && (await api("/api/admin/models", { summary: v }))) load();
    },
    async saveJobs() {
      const jobs = {}; for (const j of M.jobs) jobs[j] = document.getElementById(`am-job-${j}`).value || null;
      if (await api("/api/admin/models", { jobs })) load();
    },
    async adopt(model, assessment) {
      if (!confirm(`Make ${label(model)} the baseline, as head-to-head #${assessment} suggests? Every job that is not pinned and has no model of its own runs on it from the next call.`)) return;
      if (await api("/api/admin/models", { baseline: model, assessment })) load();
    },
    async unpin(slug) { if (confirm("Put this company's jobs back on the platform's models?") && (await api("/api/admin/models/unpin", { slug }))) load(); },
    async start() {
      const plan = {}; for (const k of Object.keys(OPTS.kinds)) plan[k] = Number(document.getElementById(`am-n-${k}`).value || 0);
      const budget_usd = Number(document.getElementById("am-budget").value || 0);
      if (!Object.values(plan).some((n) => n > 0)) return alert("Ask for at least one case.");
      if (!confirm(`Start a head-to-head? ${estimateLine()} It stops by itself at $${budget_usd || "no limit"}.`)) return;
      const j = await api("/api/admin/assess", { plan, budget_usd });
      if (j) { OPEN = j.id; OPTS = null; load(); }
    },
    open(id) { openAssessment(id); },
    async stop(id) { if (confirm("Stop this head-to-head? The trial in flight finishes; what is done is kept.") && (await api(`/api/admin/assess/${id}/stop`, {}))) load(); },
    pick() { pickNext(); },
    choose, closePick,
    async ab(on) {
      const jobs = M.ab_jobs.filter((j) => (document.getElementById(`am-ab-${j}`) || {}).checked);
      if (on && !jobs.length) return alert("Pick at least one kind of work to split.");
      if (!on && !confirm("Stop the live A/B? New work goes back to the baseline; the numbers so far stay here.")) return;
      if (await api("/api/admin/models/ab", { on, jobs })) load();
    },
  };
})();
