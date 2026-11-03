// End to end for round 1 of the VSM audit (docs/FEATURES.md, "The VSM audit's round 1", 2026-11-03). What it proves:
// one review of an agent runs at a time, however many flags wake it at once; a flag an agent's review raised can be made a
// request, on its tool and its box; under the data wall a request from a flag carries the watch's name and count, not the
// rows, and waits for the manager, and an agent's draft card is not sent to the proposer; a watch that clears and comes
// back within the hour opens again in its own thread; a finished review moves the inbox's clock, a failed one does not;
// two taps on Draft the future state start one draft; a filed burst stays filed through an export and import; a walk
// photo keeps the type of its name, not the type the browser said; a stored file is served so it runs no script.
// Against a server ALREADY UP in fake-agent mode on a fresh database, with SOS_WATCH_MS=0 and SOS_AGENT_EARLY_MIN=0;
// this script also calls the review and future-state functions in its own process, on the same database.
const { PW, runner, login } = require("./lib");
const { q } = require("../../src/db");
const R = runner(), t = R.t;
const A = "/api/c/demo/vsm", P = "/c/demo/m/paperline";
const MAP = { format: "anetix-map-1", stages: [], maps: [{ key: "planes", family: "Planes", title: "Planes",
  nodes: [
    { key: "plan", kind: "control", label: "Plan the day", x: 500, y: 40 },
    { key: "kit", kind: "process", label: "Kitting", record_kind: "paper", x: 280, y: 240 },
    { key: "asm", kind: "process", label: "Assembly", modules: ["paperline"], record_kind: "anetix", x: 500, y: 240, detail: { agent_name: "Line agent" } },
    { key: "cus", kind: "customer", label: "Customers", x: 800, y: 20 } ],
  edges: [{ from: "plan", to: "kit", kind: "info_word" }, { from: "kit", to: "asm", kind: "push" }, { from: "asm", to: "cus", kind: "ship" }],
  kaizen: [{ node: "kit", n: 1, title: "A kit cart", why: "Kai walks." }] }] };

(async () => {
  const mgr = await login(PW.manager, "demo"), admin = await login(PW.admin, "");
  await admin.post(`${A}/import`, MAP);
  const mapId = (await mgr.get(A)).json.maps.find((m) => m.key === "planes").id;
  await mgr.post(`${A}/agents`, { key: "line-agent" });
  const la = (await mgr.get(`${A}/agents`)).json.agents.find((a) => a.key === "line-agent");
  await mgr.post(`${A}/agents/${la.id}`, { reviews: true, brief: "Watch the line." });
  const RV = require("../../src/vsm-review");

  // ---- one review of an agent at a time
  const two = await Promise.allSettled([RV.start("demo", la.id, { reason: "manual" }), RV.start("demo", la.id, { reason: "manual" })]);
  const ok = two.filter((x) => x.status === "fulfilled" && x.value), refused = two.filter((x) => x.status === "rejected");
  t("two taps on Review now start one review; the other is told it is reviewing now", ok.length === 1 && refused.length === 1 && refused[0].reason.status === 409 && /reviewing now/.test(refused[0].reason.message), two.map((x) => x.status));
  await ok[0].value.done;
  const wakes = await Promise.all([1, 2, 3, 4, 5].map(() => RV.start("demo", la.id, { reason: "early" })));
  const started = wakes.filter(Boolean);
  t("five flags waking an agent at once start one early review", started.length === 1, wakes.map(Boolean));
  await started[0].done;
  const done = (await q("SELECT last_done_at, (SELECT started_at FROM platform.vsm_reviews WHERE agent_id=$1 AND status='done' ORDER BY id DESC LIMIT 1) AS s FROM platform.vsm_agents WHERE id=$1", [la.id])).rows[0];
  t("a finished review moves the inbox's clock to when it started", done.last_done_at && done.s && new Date(done.last_done_at).getTime() === new Date(done.s).getTime());
  await q("UPDATE platform.vsm_agents SET status='paused' WHERE id=$1", [la.id]);
  const clock = (await q("SELECT last_done_at FROM platform.vsm_agents WHERE id=$1", [la.id])).rows[0].last_done_at;
  await RV.start("demo", la.id, { reason: "early" });
  t("a review that does not run leaves the clock where it was", new Date((await q("SELECT last_done_at FROM platform.vsm_agents WHERE id=$1", [la.id])).rows[0].last_done_at).getTime() === new Date(clock).getTime());
  await q("UPDATE platform.vsm_agents SET status='on' WHERE id=$1", [la.id]);

  // ---- a flag a review raised can be made a request, on its tool and its box
  const flag = async (words, watchId, evidence) => {
    const m = (await q(`INSERT INTO platform.vsm_messages (company, channel, kind, severity, from_kind, from_name, agent_id, watch_id, words) VALUES ('demo',$1,'flag','look',$2,'Line agent',$3,$4,$5) RETURNING id`,
      [`a:${la.key}`, watchId ? "watch" : "agent", la.id, watchId, words])).rows[0];
    await q(`INSERT INTO platform.vsm_flags (thread_id, company, agent_id, watch_id, channel, status, severity, count, evidence, boxes) VALUES ($1,'demo',$2,$3,$4,'open','look',3,$5::jsonb,'["planes/asm"]'::jsonb)`,
      [m.id, la.id, watchId, `a:${la.key}`, JSON.stringify(evidence)]);
    return m.id;
  };
  const rf = await flag("Three travelers have waited all shift at the first station: J-1042, J-1051, J-1077", null, { tool: "paperline", shape: "review", count: 3 });
  const mr = await mgr.post(`${A}/board/flags/${rf}/request`, { note: "" });
  const mrf = mr.json && mr.json.result ? (await q("SELECT module, node_key, map_key, message FROM platform.feedback WHERE id=$1", [mr.json.result.feedback_id])).rows[0] : null;
  t("Make it a request works on a flag an agent's review raised: its tool, its box", mr.status === 200 && mrf && mrf.module === "paperline" && mrf.node_key === "asm" && mrf.map_key === "planes", mr.json);

  // ---- under the data wall: no rows to the proposer
  const w = (await q(`INSERT INTO platform.vsm_watches (company, agent_id, shape, tool, spec, title, severity, status) VALUES ('demo',$1,'stuck','paperline','{}'::jsonb,'Travelers stuck at one station','look','on') RETURNING id`, [la.id])).rows[0];
  const wf = await flag("Travelers stuck at one station (72 hours): 3 found (J-1042, J-1051, J-1077).", w.id, { tool: "paperline", shape: "stuck", count: 3, sample: [{ label: "J-1042" }] });
  await admin.post("/api/admin/companies/demo/data-wall", { walled: true });
  const wr = await mgr.post(`${A}/board/flags/${wf}/request`, { note: "" });
  const wrf = (await q("SELECT message, arrival FROM platform.feedback WHERE id=$1", [wr.json.result.feedback_id])).rows[0];
  t("under the data wall a request from a flag names the watch and its count, not the rows", /Travelers stuck at one station: 3 found/.test(wrf.message) && !/J-10/.test(wrf.message), wrf.message);
  t("and waits for the manager's Review with AI", wr.json.result.proposing === false && wrf.arrival === null);
  const dm = (await q(`INSERT INTO platform.vsm_messages (company, channel, kind, from_kind, from_name, agent_id, words) VALUES ('demo',$1,'draft','agent','Line agent',$2,'Drafted a request') RETURNING id`, [`a:${la.key}`, la.id])).rows[0];
  await q("INSERT INTO platform.vsm_drafts (message_id, company, agent_id, tool, what, why) VALUES ($1,'demo',$2,'paperline','Show J-1042 first','It waited longest')", [dm.id, la.id]);
  const ds = await mgr.post(`${A}/board/drafts/${dm.id}/send`);
  t("under the data wall an agent's card drafted from records is not sent to the proposer, and says why", ds.status === 409 && /walled off/.test(ds.json.error) && (await q("SELECT state FROM platform.vsm_drafts WHERE message_id=$1", [dm.id])).rows[0].state === "draft");
  await admin.post("/api/admin/companies/demo/data-wall", { walled: false });

  // ---- a watch that clears and comes back opens again in its own thread
  await q("UPDATE mod_demo_paperline.inventory SET qty=500");
  const lw = await mgr.post(`${A}/agents/${la.id}/watches`, { shape: "level", tool: "paperline", title: "Paper low", severity: "look", spec: { table: "inventory", column: "qty", op: "under", limit: 100 } });
  const lwid = lw.json.watch.id;
  const check = () => mgr.post(`${A}/agents/${la.id}/check`);
  const flagsOf = async () => (await q("SELECT thread_id, status FROM platform.vsm_flags WHERE watch_id=$1 ORDER BY thread_id", [lwid])).rows;
  await q("UPDATE mod_demo_paperline.inventory SET qty=50 WHERE id=(SELECT min(id) FROM mod_demo_paperline.inventory)"); await check();
  await q("UPDATE mod_demo_paperline.inventory SET qty=500"); await check();
  const cleared = await flagsOf();
  await q("UPDATE mod_demo_paperline.inventory SET qty=50 WHERE id=(SELECT min(id) FROM mod_demo_paperline.inventory)"); await check();
  const back = await flagsOf();
  t("a level watch that clears and comes back within the hour is the same flag, open again", lw.status === 200 && cleared.length === 1 && cleared[0].status === "cleared" && back.length === 1 && back[0].status === "open", { cleared, back });
  t("its thread says it is back", (await q("SELECT count(*)::int n FROM platform.vsm_messages WHERE thread_id=$1 AND words LIKE 'Back again%'", [back[0].thread_id])).rows[0].n === 1);
  const W = require("../../src/vsm-agents");
  await q("UPDATE platform.vsm_flags SET closed_at = now() - interval '2 hours', status='cleared' WHERE thread_id=$1", [back[0].thread_id]);
  await check();
  t("after the hour it is a new flag", (await flagsOf()).length === 2);

  // ---- two taps on Draft the future state start one draft
  const K = require("../../src/vsm-kaizen");
  const req = { sosRole: "manager", query: {} };
  const fd = await Promise.allSettled([K.startFuture(req, "demo", mapId), K.startFuture(req, "demo", mapId)]);
  t("two taps on Draft the future state start one draft", fd.filter((x) => x.status === "fulfilled").length === 1 && fd.some((x) => x.status === "rejected" && x.reason.status === 409), fd.map((x) => x.status));

  // ---- a filed burst stays filed through an export and import
  const mv = (await mgr.get(`${A}/maps/${mapId}`)).json;
  const z = mv.kaizen.find((x) => x.n === 1);
  const fz = await mgr.post(`${A}/kaizen/${z.id}/file`, { as: "plant" });
  const ex = (await mgr.get(`${A}/export`)).json;
  await admin.post(`${A}/import`, { ...ex, maps: ex.maps.filter((m) => m.state !== "future") });
  const mv2 = (await mgr.get(`${A}/maps/${(await mgr.get(A)).json.maps.find((m) => m.key === "planes").id}`)).json;
  const z2 = mv2.kaizen.find((x) => x.n === 1);
  t("a filed burst stays filed through an export and import, still pointing at its request", z2 && z2.status === "filed" && z2.feedback_id === fz.json.feedback_id && (await mgr.post(`${A}/kaizen/${z2.id}/file`, { as: "plant" })).status === 409, z2);
  const other = JSON.parse(JSON.stringify(ex)); other.maps[0].kaizen.find((x) => x.n === 1).feedback_id = 999999;
  await admin.post(`${A}/import`, { ...other, maps: other.maps.filter((m) => m.state !== "future") });
  const z3 = (await mgr.get(`${A}/maps/${(await mgr.get(A)).json.maps.find((m) => m.key === "planes").id}`)).json.kaizen.find((x) => x.n === 1);
  t("a link to a request that is not this company's is dropped; the burst stays filed", z3.status === "filed" && z3.feedback_id === null);

  // ---- files: a walk photo keeps the type of its name; a stored file runs no script
  const walk = (await mgr.post(`${A}/walks`, {})).json.walk;
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString("base64");
  const up = await mgr.post(`${A}/walks/${walk.id}/file`, { filename: "board.png", mime: "image/svg+xml", data: svg });
  const att = (await q("SELECT id, mime FROM platform.attachments WHERE walk_id=$1 ORDER BY id DESC LIMIT 1", [walk.id])).rows[0];
  t("a .png sent as an SVG is kept as a png", up.status === 200 && att && att.mime === "image/png", att);
  const got = await mgr.get(`/api/attachments/${att.id}`);
  t("a photo is shown, sandboxed, and never read as anything else", got.headers.get("content-type") === "image/png" && /^inline/.test(got.headers.get("content-disposition")) && /sandbox/.test(got.headers.get("content-security-policy") || "") && got.headers.get("x-content-type-options") === "nosniff");
  const html = (await q("INSERT INTO platform.attachments (company, filename, mime, size, bytes) VALUES ('demo','page.html','text/html',20,$1) RETURNING id", [Buffer.from("<script>alert(1)</script>")])).rows[0];
  const gh = await mgr.get(`/api/attachments/${html.id}`);
  t("a web page kept as an attachment is a download, sandboxed", /^attachment/.test(gh.headers.get("content-disposition")) && /sandbox/.test(gh.headers.get("content-security-policy") || ""));
  const pdf = (await q("INSERT INTO platform.attachments (company, filename, mime, size, bytes) VALUES ('demo','spec.pdf','application/pdf',8,$1) RETURNING id", [Buffer.from("%PDF-1.4")])).rows[0];
  const gp = await mgr.get(`/api/attachments/${pdf.id}`);
  t("a pdf is shown in the browser's own viewer", /^inline/.test(gp.headers.get("content-disposition")) && !gp.headers.get("content-security-policy"));
  void W;
})().then(() => R.done()).catch(R.abort);
