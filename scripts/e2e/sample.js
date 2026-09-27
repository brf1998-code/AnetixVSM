// End to end: sample data for a demo's tools (src/sample.js), against a server ALREADY UP in fake-agent mode on a
// FRESH database with SOS_WWW_KEY set in both shells (the header of scripts/e2e/selfserve.js has the command).
// What it proves: only a demo company has it, and only a manager; a fill writes rows the tables take, with the keys
// the database made and every <thing>_id pointing at them; it costs the demo's credit and stops when the credit is
// gone; one fill at a time; Clear takes out exactly the sample rows and leaves the person's own; with a build waiting
// the same rows, same keys, go into the preview too; a column or a table only the waiting build has is filled in the
// preview and carried into the live tables at deploy; the record has both.
const { runner, login, waitFor, ship, sleep } = require("./lib");
const { q } = require("../../src/db");
const migrate = require("../../src/migrate");
const R = runner(), t = R.t;
const BASE = process.env.SOS_BASE || `http://127.0.0.1:${process.env.PORT || 3999}`;
const KEY = process.env.SOS_WWW_KEY;
if (!KEY) { console.error("SOS_WWW_KEY must be set in this shell and the server's"); process.exit(2); }
const www = async (p, b) => (await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", "X-SOS-WWW-Key": KEY }, body: JSON.stringify(b) })).json();
const count = async (schema, table) => Number((await q(`SELECT count(*)::int AS n FROM ${schema}.${table}`)).rows[0].n);

(async () => {
  const admin = await login(process.env.SOS_ADMIN_PASSWORD || "adminpw");
  const pin = (await admin.post("/api/admin/pins", { label: "Dana at Riverside", email: "dana@riverside.test", max_uses: 1, days: 30 })).json.pin.shown;
  const A = (await www("/api/www/companies", { pin, email: "dana@riverside.test", name: "Riverside Wire", contact: "Dana", ref: `demo:${pin}`, paid_usd: 0, credit_usd: 10, password: "copper-oak-2201-press", demo: true, collect: true })).company.slug;
  await admin.post(`/api/admin/companies/${A}/modules`, { module: "paperline" });
  const LIVE = migrate.liveSchema(A, "paperline"), STG = migrate.stagingSchema(A, "paperline");
  const url = `/api/c/${A}/modules/paperline/sample`;

  // ---- who has it
  t("a company that is not a demo has no sample data", (await admin.get("/api/c/demo/modules/paperline/sample")).status === 404 && (await admin.post("/api/c/demo/modules/paperline/sample", {})).status === 404);
  const floor = await login(process.env.SOS_FLOOR_PASSWORD || "floorpw", "demo");
  t("a floor login cannot fill", (await floor.post(url, {})).status === 403);
  const s0 = await admin.get(url);
  t("the demo's tool can be filled, nothing in yet", s0.status === 200 && s0.json.can_fill && !s0.json.fill && s0.json.live_version === 1, s0.json);

  // the person's own row before any sample: it must survive every clear
  const before = { travelers: await count(LIVE, "travelers"), stations: await count(LIVE, "stations"), traveler_log: await count(LIVE, "traveler_log") };
  const mine = (await q(`INSERT INTO ${LIVE}.travelers (job_num, color, fold_type, clip_pos) VALUES ('MINE-1','white','dart','top') RETURNING id`)).rows[0].id;
  const seedStations = new Set((await q(`SELECT id FROM ${LIVE}.stations`)).rows.map((r) => r.id));

  // ---- fill
  const f1 = await admin.post(url, {});
  t("a fill starts and answers at once", f1.status === 200 && f1.json.fill && ["writing", "in"].includes(f1.json.fill.status), f1.json);
  const done = await waitFor("the fill", async () => { const x = (await admin.get(url)).json; return x.fill && x.fill.status !== "writing" ? x : null; });
  t("the fill is in: rows in the live tool, a story, no preview", done.fill.status === "in" && done.fill.rows > 0 && done.fill.in_live && !done.fill.in_preview && /Fake mode/.test(done.fill.story), done.fill);
  t("travelers, stations and their log got rows", done.fill.tables.travelers > 0 && done.fill.tables.stations > 0 && done.fill.tables.traveler_log > 0, done.fill.tables);
  t("the live tables have them", await count(LIVE, "travelers") === before.travelers + 1 + done.fill.tables.travelers && await count(LIVE, "traveler_log") === before.traveler_log + done.fill.tables.traveler_log);
  const fill = (await q("SELECT * FROM platform.sample_fills WHERE company=$1 ORDER BY id DESC LIMIT 1", [A])).rows[0];
  const tIds = new Set(fill.rows.travelers.map((r) => r.id)), sIds = new Set(fill.rows.stations.map((r) => r.id));
  t("the keys are the ones the database made, never the placeholders (which the seed stations and my row hold)", !tIds.has(mine) && [...sIds].every((id) => !seedStations.has(id)), { t: [...tIds], s: [...sIds] });
  t("every traveler_id in the sample log points at a sample traveler, every station_id at a sample station", fill.rows.traveler_log.every((r) => tIds.has(r.traveler_id)) && fill.rows.travelers.filter((r) => r.station_id != null).every((r) => sIds.has(r.station_id)), fill.rows.traveler_log.slice(0, 3));
  const use = (await q("SELECT kind, detail FROM platform.ai_usage WHERE company=$1 AND kind='sample_data'", [A])).rows;
  t("the spend is filed against the demo (its credit pays)", use.length === 1 && use[0].detail.fill === fill.id, use);
  const rec = (await q("SELECT kind, module FROM platform.record WHERE company=$1 AND kind LIKE 'sample_%'", [A])).rows;
  t("the record has the fill", rec.length === 1 && rec[0].kind === "sample_filled" && rec[0].module === "paperline", rec);

  // ---- one at a time
  const again = await admin.post(url, {});
  t("a second fill without replace is refused", again.status === 409 && /Clear it first/.test(again.json.error), again.json);

  // ---- clear keeps what the person added
  await q(`INSERT INTO ${LIVE}.traveler_log (traveler_id, event, operator) VALUES ($1, 'note', 'Dana')`, [[...tIds][0]]);
  const cl = await admin.post(`${url}/clear`, {});
  t("clear takes out exactly the sample rows", cl.status === 200 && cl.json.fill.status === "cleared" && cl.json.cleared.deleted === done.fill.rows, cl.json);
  t("my own traveler and my own log line are still there", await count(LIVE, "travelers") === before.travelers + 1 && Boolean((await q(`SELECT 1 FROM ${LIVE}.travelers WHERE id=$1`, [mine])).rows[0]) && await count(LIVE, "traveler_log") === before.traveler_log + 1 && await count(LIVE, "stations") === before.stations);
  t("clearing again is refused", (await admin.post(`${url}/clear`, {})).status === 409);
  t("the record has the clear", (await q("SELECT 1 FROM platform.record WHERE company=$1 AND kind='sample_cleared'", [A])).rows.length === 1);

  // ---- the credit gate
  await q("INSERT INTO platform.ai_usage (company, module, kind, model, cost_usd, detail) VALUES ($1,'paperline','test','x',11,'{}')", [A]);
  const broke = await admin.post(url, {});
  t("out of credit, no fill", broke.status >= 400 && /credit is used up/.test(broke.json.error), broke.json);
  t("and the panel says why", (await admin.get(url)).json.why_not === "Your AI credit is used up.");
  await admin.post(`/api/admin/companies/${A}/credit`, { usd: 20, note: "e2e" });

  // ---- a build waiting at the gate: the preview gets the same rows; a column and a table only the build has follow at deploy
  const fb = await admin.post("/api/feedback", { company: A, module: "paperline", page: "/", message: "make the timer bigger", name: "Dana" });
  const prop = await waitFor("the proposal", async () => { const b = (await admin.get(`/api/c/${A}/board`)).json; const f = b.feedback.find((x) => x.id === fb.json.id); return f && f.arrival !== "proposing" && f.proposal_id ? f : null; });
  const run = (await admin.post(`/api/proposals/${prop.proposal_id}/decide`, { decision: "approve" })).json;
  const runId = (run.run || run).id;
  await waitFor("the gate", async () => {
    const x = (await admin.get(`/api/c/${A}/board`)).json.runs.find((y) => y.id === runId);
    if (x && x.step === "confirm_requirement" && x.status === "waiting") { await admin.post(`/api/runs/${runId}/confirm`, {}); return false; }
    return x && x.step === "await_deploy" && x.status === "waiting";
  });
  // as if the waiting build's migration added a column and a table: the preview has them, live does not yet
  await q(`ALTER TABLE ${STG}.travelers ADD COLUMN IF NOT EXISTS priority TEXT`);
  await q(`CREATE TABLE IF NOT EXISTS ${STG}.bins (id SERIAL PRIMARY KEY, traveler_id INTEGER, label TEXT NOT NULL)`);
  const f2 = await admin.post(url, {});
  t("with a build waiting, a fill starts", f2.status === 200, f2.json);
  const d2 = await waitFor("the second fill", async () => { const x = (await admin.get(url)).json; return x.fill && x.fill.status !== "writing" ? x : null; });
  t("the rows are in the live tool and the preview", d2.fill.status === "in" && d2.fill.in_live && d2.fill.in_preview && d2.fill.tables.bins > 0, d2.fill);
  const fill2 = (await q("SELECT * FROM platform.sample_fills WHERE company=$1 ORDER BY id DESC LIMIT 1", [A])).rows[0];
  const ids2 = fill2.rows.travelers.map((r) => r.id);
  const inStg = (await q(`SELECT id FROM ${STG}.travelers WHERE id = ANY($1)`, [ids2])).rows.length;
  const inLive = (await q(`SELECT id FROM ${LIVE}.travelers WHERE id = ANY($1)`, [ids2])).rows.length;
  t("the same travelers, same keys, in both", inStg === ids2.length && inLive === ids2.length, { inStg, inLive, n: ids2.length });
  t("the bins are in the preview only, pointing at the sample travelers", (await count(STG, "bins")) === d2.fill.tables.bins && fill2.rows.bins.every((b) => ids2.includes(b.traveler_id)) && fill2.plan.pending.includes("bins"), fill2.plan);
  // the deploy's migration, done by hand to match the preview; then the deploy carries the rest across
  await q(`ALTER TABLE ${LIVE}.travelers ADD COLUMN IF NOT EXISTS priority TEXT`);
  await q(`CREATE TABLE IF NOT EXISTS ${LIVE}.bins (id SERIAL PRIMARY KEY, traveler_id INTEGER, label TEXT NOT NULL)`);
  // an admin putting a customer's change live says why, and the manager is told (the Terms, 9.1; src/feedback.js adminChange)
  const noWhy = await admin.post(`/api/runs/${runId}/deploy`);
  t("an admin's deploy on a customer's tool without a reason is refused", noWhy.status === 400 && noWhy.json.code === "admin_reason", noWhy.json);
  await admin.post(`/api/runs/${runId}/deploy`, { admin_reason: "asked", admin_note: "the manager asked on a call" });
  const told = (await q("SELECT text FROM platform.notices WHERE company=$1 AND kind='tool_changed' ORDER BY id DESC LIMIT 1", [A])).rows[0];
  t("and the manager gets a notice saying Anetix put it live because they asked", told && /because your manager asked Anetix to: the manager asked on a call/.test(told.text), told);
  await waitFor("the carry to live", async () => (await q("SELECT in_live, plan FROM platform.sample_fills WHERE id=$1", [fill2.id])).rows[0].plan.pending.length === 0, 15000);
  t("at deploy the bins went live with their keys", (await q(`SELECT id, traveler_id FROM ${LIVE}.bins ORDER BY id`)).rows.map((r) => r.id).join() === fill2.rows.bins.map((b) => b.id).sort((a, b) => a - b).join());
  t("and the new column was filled on the sample travelers", (await q(`SELECT count(*)::int AS n FROM ${LIVE}.travelers WHERE id = ANY($1) AND priority IS NOT NULL`, [ids2])).rows[0].n === ids2.length);
  const nextBin = (await q(`INSERT INTO ${LIVE}.bins (label) VALUES ('mine') RETURNING id`)).rows[0].id;
  t("a new row after them gets a fresh key", nextBin > Math.max(...fill2.rows.bins.map((b) => b.id)), nextBin);
  const cl2 = await admin.post(`${url}/clear`, {});
  t("clear after the deploy takes out every sample row, live and preview, and leaves mine", cl2.status === 200 && await count(LIVE, "bins") === 1 && (await q(`SELECT id FROM ${LIVE}.travelers WHERE id = ANY($1)`, [ids2])).rows.length === 0 && Boolean((await q(`SELECT 1 FROM ${LIVE}.travelers WHERE id=$1`, [mine])).rows[0]), cl2.json);

  // ---- a revision that adds rules, and a clear that has to keep a row (2026-09-26, seancorp: the first fill worked, every
  // fill after the tool's revision was refused as "none of the sample rows fit")
  await q(`CREATE UNIQUE INDEX stations_name_uq ON ${LIVE}.stations (name)`);
  await q(`ALTER TABLE ${LIVE}.inventory ADD CONSTRAINT inventory_named CHECK (item NOT LIKE 'Sample%')`);
  await q(`ALTER TABLE ${LIVE}.traveler_log ADD COLUMN IF NOT EXISTS detail JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await q(`CREATE TABLE ${LIVE}.readings (id SERIAL PRIMARY KEY, station_id INTEGER NOT NULL REFERENCES ${LIVE}.stations(id), value NUMERIC)`);
  const f3 = await admin.post(url, {});
  const d3 = await waitFor("the third fill", async () => { const x = (await admin.get(url)).json; return x.fill && x.fill.id !== d2.fill.id && x.fill.status !== "writing" ? x : null; });
  const fill3 = (await q("SELECT * FROM platform.sample_fills WHERE id=$1", [d3.fill.id])).rows[0];
  t("after the revision the fill still goes in", f3.status === 200 && d3.fill.status === "in" && d3.fill.tables.stations > 0 && d3.fill.tables.readings > 0, d3.fill);
  t("a JSON column takes its values", fill3.rows.traveler_log.length > 0 && fill3.rows.traveler_log.every((r) => r.detail && typeof r.detail === "object"), fill3.rows.traveler_log[0]);
  t("the rows a check refused are left out, and the database's reason is kept", !fill3.rows.inventory || fill3.rows.inventory.length === 0 ? /inventory_named/.test(fill3.error || "") : false, fill3.error);
  const rec3 = (await q("SELECT detail FROM platform.record WHERE company=$1 AND kind='sample_filled' ORDER BY id DESC LIMIT 1", [A])).rows[0];
  t("the record says why rows were left out", rec3 && rec3.detail.left_out_because.some((x) => /inventory_named/.test(x)), rec3 && rec3.detail);
  // something that is not the sample points at one sample station: a clear has to keep that station
  const keptStation = fill3.rows.stations[0].id;
  await q(`INSERT INTO ${LIVE}.readings (station_id, value) VALUES ($1, 42)`, [keptStation]);
  const cl3 = await admin.post(`${url}/clear`, {});
  t("the clear keeps the station something points at, and says so", cl3.status === 200 && cl3.json.cleared.kept >= 1 && Boolean((await q(`SELECT 1 FROM ${LIVE}.stations WHERE id=$1`, [keptStation])).rows[0]), cl3.json.cleared);
  // the next fill writes the same station names (fake mode always does; the AI often does): the kept one is taken over
  const f4 = await admin.post(url, {});
  const d4 = await waitFor("the fourth fill", async () => { const x = (await admin.get(url)).json; return x.fill && x.fill.id !== d3.fill.id && x.fill.status !== "writing" ? x : null; });
  const fill4 = (await q("SELECT * FROM platform.sample_fills WHERE id=$1", [d4.fill.id])).rows[0];
  const rec4 = (await q("SELECT detail FROM platform.record WHERE company=$1 AND kind='sample_filled' ORDER BY id DESC LIMIT 1", [A])).rows[0];
  t("a fill after a kept row goes in: the clashing station is taken over, not a reason to drop everything", f4.status === 200 && d4.fill.status === "in" && rec4.detail.reused >= 1 && fill4.rows.stations.some((r) => r.id === keptStation) && d4.fill.tables.travelers > 0, { fill: d4.fill, reused: rec4 && rec4.detail.reused });
  t("its travelers point at stations that exist", (await q(`SELECT count(*)::int AS n FROM ${LIVE}.travelers tr WHERE tr.id = ANY($1) AND tr.station_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${LIVE}.stations s WHERE s.id = tr.station_id)`, [fill4.rows.travelers.map((r) => r.id)])).rows[0].n === 0);
  const cl4 = await admin.post(`${url}/clear`, {});
  t("and it clears again, the reading's station still kept", cl4.status === 200 && Boolean((await q(`SELECT 1 FROM ${LIVE}.stations WHERE id=$1`, [keptStation])).rows[0]) && (await q(`SELECT count(*)::int AS n FROM ${LIVE}.stations WHERE name LIKE 'Sample%'`)).rows[0].n === 1, cl4.json.cleared);

  // ---- a fill that does not work is on the record (and would be handed back had it cost anything)
  await q(`ALTER SCHEMA ${LIVE} RENAME TO hold_sample_e2e`);
  await admin.post(url, {});
  const bad = await waitFor("the failed fill", async () => { const x = (await admin.get(url)).json; return x.fill && x.fill.id !== d4.fill.id && x.fill.status !== "writing" ? x : null; });
  await q(`ALTER SCHEMA hold_sample_e2e RENAME TO ${LIVE}`);
  t("a fill that cannot work fails and says why", bad.fill.status === "failed" && /not there yet/.test(bad.fill.error), bad.fill);
  const failRec = (await q("SELECT after, detail FROM platform.record WHERE company=$1 AND kind='sample_failed' ORDER BY id DESC LIMIT 1", [A])).rows[0];
  t("the failure is on the record, for the Demos export", failRec && /not there yet/.test(failRec.after) && failRec.detail.fill === bad.fill.id, failRec);
  const lastOk = (await q("SELECT detail FROM platform.record WHERE company=$1 AND kind='sample_filled' ORDER BY id DESC LIMIT 1", [A])).rows[0].detail;
  const genT = Object.keys(lastOk.series || {}).find((t) => lastOk.series[t] > 0);
  t("the bulk came from the recipe, generated by the platform: a day of the timed table and a child row for each", genT && lastOk.series[genT] >= 5 && Object.values(lastOk.series).filter((n) => n > 0).length >= 2, { series: lastOk.series, rows: lastOk.rows });
  const ans = (await q("SELECT answer FROM platform.sample_fills WHERE company=$1 AND status IN ('in','cleared') ORDER BY id DESC LIMIT 1", [A])).rows[0];
  t("the agent's answer is kept for when something looks wrong", ans && ans.answer && ans.answer.series && ans.answer.rows, ans && Object.keys(ans.answer || {}));

  // ---- nothing built yet
  const nosuch = await admin.get(`/api/c/${A}/modules/nosuch/sample`);
  t("a tool that does not exist cannot be filled", nosuch.status === 200 && nosuch.json.can_fill === false && (await admin.post(`/api/c/${A}/modules/nosuch/sample`, {})).status === 404, nosuch.json);
  await sleep(200);
  R.done();
})().catch((e) => { console.error(e); process.exit(1); });
