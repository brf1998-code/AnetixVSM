// End to end for round 3 of the VSM audit (docs/FEATURES.md, "The VSM audit's round 3", 2026-11-03). What it proves:
// a draft is never claimed, made or declined by a page that only opens; a request from the agent board or the map is
// read on arrival only as the company has it set; a paused agent's flags neither raise nor climb, and their clock starts
// again when it is turned on; a reopened flag can climb again; a walk asked to start "from" something that is not a walk
// and a map file with an empty entry are refused in words; a draft someone opened and never made expires.
// Against a server ALREADY UP in fake-agent mode on a fresh database, with SOS_WATCH_MS=0; this script also calls the
// drafts and climbing functions in its own process, on the same database.
const { PW, runner, login } = require("./lib");
const { q } = require("../../src/db");
const R = runner(), t = R.t;
const A = "/api/c/demo/vsm";
const MAP = { format: "anetix-map-1", stages: [], maps: [{ key: "planes", family: "Planes", title: "Planes",
  nodes: [
    { key: "plan", kind: "control", label: "Plan the day", x: 500, y: 40 },
    { key: "asm", kind: "process", label: "Assembly", modules: ["paperline"], record_kind: "anetix", x: 500, y: 240, detail: { agent_name: "Line agent" } },
    { key: "cus", kind: "customer", label: "Customers", x: 800, y: 20 } ],
  edges: [{ from: "plan", to: "asm", kind: "info_system" }, { from: "asm", to: "cus", kind: "ship" }], kaizen: [] }] };

(async () => {
  const mgr = await login(PW.manager, "demo"), admin = await login(PW.admin, "");
  await admin.post(`${A}/import`, MAP);
  await mgr.post(`${A}/agents`, { key: "line-agent" });
  const la = (await mgr.get(`${A}/agents`)).json.agents.find((a) => a.key === "line-agent");
  const D = require("../../src/vsm-drafts"), W = require("../../src/vsm-agents");

  // ---- a draft is made with a tap, never by a page that only opens
  const dr = (await q(`INSERT INTO platform.vsm_record_drafts (company, module, kind, fields, why, agent_id, agent_name) VALUES ('demo','paperline','order','{"qty":5}'::jsonb,'Low on paper',$1,'Line agent') RETURNING id`, [la.id])).rows[0];
  const tryAs = async (method, fn) => { try { await fn(D.whoOf({ sosRole: "manager", sosMethod: method })); return "made"; } catch (e) { return e.status; } };
  t("a page that only opens cannot claim, make or decline a draft", (await tryAs("GET", (who) => D.claim("demo", "paperline", who, dr.id, "live"))) === 405
    && (await tryAs("GET", (who) => D.finish("demo", "paperline", who, dr.id, {}, "live"))) === 405 && (await tryAs("HEAD", (who) => D.decline("demo", "paperline", who, dr.id, { note: "no" }, "live"))) === 405);
  t("a tap can", (await tryAs("POST", (who) => D.claim("demo", "paperline", who, dr.id, "live"))) === "made" && (await q("SELECT state FROM platform.vsm_record_drafts WHERE id=$1", [dr.id])).rows[0].state === "taking");
  const S = require("../../src/vsm-stages");
  await S.event("demo", "paperline", "live", { name: "Kai", method: "GET" }, { step: "Fold", ref: "R-1", kind: "start" });
  await S.event("demo", "paperline", "live", { name: "Kai", method: "POST" }, { step: "Fold", ref: "R-1", kind: "finish" });
  const evs = (await q("SELECT kind, person FROM platform.vsm_stage_events WHERE company='demo' AND ref='R-1' ORDER BY id")).rows;
  t("a stage event from a page that only opens is kept with no one's name; a tap's has the name", evs.length === 2 && evs[0].person === null && evs[1].person === "Kai", evs);

  // ---- a lapsed claim expires with the drafts nobody made
  await q("UPDATE platform.vsm_record_drafts SET held_until = now() - interval '1 hour', created_at = now() - interval '8 days' WHERE id=$1", [dr.id]);
  await D.sweep();
  t("a draft someone opened and never made expires after the week", (await q("SELECT state FROM platform.vsm_record_drafts WHERE id=$1", [dr.id])).rows[0].state === "expired");

  // ---- a request from the board is read on arrival only as the company has it set
  const flag = async (words, extra = {}) => {
    const m = (await q(`INSERT INTO platform.vsm_messages (company, channel, kind, severity, from_kind, from_name, agent_id, words) VALUES ('demo',$1,'flag','look','agent','Line agent',$2,$3) RETURNING id`, [`a:${la.key}`, la.id, words])).rows[0];
    await q(`INSERT INTO platform.vsm_flags (thread_id, company, agent_id, channel, status, severity, count, evidence, boxes, opened_at, raised_at, climbed_at, closed_at)
             VALUES ($1,'demo',$2,$3,$4,$5,1,'{"tool":"paperline","shape":"review","count":1}'::jsonb,'["planes/asm"]'::jsonb, now() - ($6::int * interval '1 minute'), $7, $8, $9)`,
      [m.id, la.id, `a:${la.key}`, extra.status || "open", extra.severity || "look", extra.ago || 0, extra.raised || null, extra.climbed || null, extra.closed || null]);
    return m.id;
  };
  await q("UPDATE platform.companies SET auto_propose=false WHERE slug='demo'");
  const f1 = await flag("The first station waited all shift");
  const r1 = await mgr.post(`${A}/board/flags/${f1}/request`, { note: "" });
  const fb1 = (await q("SELECT arrival FROM platform.feedback WHERE id=$1", [r1.json.result.feedback_id])).rows[0];
  t("with reading on arrival switched off, a request from a flag waits for Review with AI", r1.status === 200 && r1.json.result.proposing === false && /switched off/.test(fb1.arrival || ""), fb1);
  await q("UPDATE platform.companies SET auto_propose=true WHERE slug='demo'");
  const f2 = await flag("The second station waited all shift");
  const r2 = await mgr.post(`${A}/board/flags/${f2}/request`, { note: "" });
  t("switched on, it is read on arrival as before", r2.status === 200 && r2.json.result.proposing === true);

  // ---- a paused agent's flags wait; turned on again, their clock starts again
  const old = await flag("Old and unseen", { ago: 13 * 60 });
  await mgr.post(`${A}/agents/${la.id}`, { status: "paused" });
  await W.climb();
  t("a paused agent's flag nobody saw is not raised", (await q("SELECT severity, raised_at FROM platform.vsm_flags WHERE thread_id=$1", [old])).rows[0].raised_at === null);
  await mgr.post(`${A}/agents/${la.id}`, { status: "on" });
  await W.climb();
  t("turned on again, its clock starts from then", (await q("SELECT raised_at FROM platform.vsm_flags WHERE thread_id=$1", [old])).rows[0].raised_at === null && (await q("SELECT on_since FROM platform.vsm_agents WHERE id=$1", [la.id])).rows[0].on_since);
  await q("UPDATE platform.vsm_agents SET on_since = now() - interval '13 hours' WHERE id=$1", [la.id]);
  await W.climb();
  t("and a shift on, it is raised as any flag is", (await q("SELECT severity FROM platform.vsm_flags WHERE thread_id=$1", [old])).rows[0].severity === "act");

  // ---- a reopened flag can climb again
  const done = await flag("Climbed once, then resolved", { status: "resolved", severity: "act", ago: 20 * 60, raised: new Date(Date.now() - 18 * 3600e3), climbed: new Date(Date.now() - 14 * 3600e3), closed: new Date() });
  const ro = await mgr.post(`${A}/board/flags/${done}/reopen`, { words: "" });
  const rf = (await q("SELECT status, climbed_at, reopened_at FROM platform.vsm_flags WHERE thread_id=$1", [done])).rows[0];
  t("a reopened flag starts its clock again and has not climbed", ro.status === 200 && rf.status === "open" && rf.climbed_at === null && rf.reopened_at, rf);
  await W.climb();
  t("so it does not climb at once", (await q("SELECT climbed_at FROM platform.vsm_flags WHERE thread_id=$1", [done])).rows[0].climbed_at === null);
  await q("UPDATE platform.vsm_flags SET reopened_at = now() - interval '5 hours' WHERE thread_id=$1", [done]);
  await W.climb();
  t("and when nobody picks it up again, it climbs again", (await q("SELECT climbed_at FROM platform.vsm_flags WHERE thread_id=$1", [done])).rows[0].climbed_at !== null);

  // ---- refused in words, not a 500
  const fw = await mgr.post(`${A}/walks`, { from_walk: "abc" });
  t("a walk from something that is not a walk is refused in words", fw.status === 400 && /walk's number/.test(fw.json.error), fw.status);
  const bad1 = await admin.post(`${A}/import`, { ...MAP, maps: [{ ...MAP.maps[0], nodes: [null, ...MAP.maps[0].nodes] }] });
  const bad2 = await admin.post(`${A}/import`, { ...MAP, stages: "none" });
  t("a map file with an empty entry, or a list that is not one, is refused in words", bad1.status === 400 && /entry 1 is empty/.test(bad1.json.error) && bad2.status === 400 && /stages is a list/.test(bad2.json.error), [bad1.json, bad2.json]);
  t("and the map in use is untouched", (await mgr.get(A)).json.maps.some((m) => m.key === "planes"));
})().then(() => R.done()).catch(R.abort);
