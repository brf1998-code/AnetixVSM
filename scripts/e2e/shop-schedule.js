// End to end for the Shop Schedule library tool (modules/shop-schedule): the example shop on first use, the plan's
// numbers, the floor's Start and Done and Can't run it, the manager's release, priority, locked dates and the example
// coming out and going back. Against a server ALREADY UP in fake-agent mode on a fresh database (run-all.sh):
//   node scripts/e2e/shop-schedule.js
const { runner, login, PW } = require("./lib");
const R = runner(), t = R.t;
const M = "/c/demo/m/shop-schedule";

(async () => {
  const mgr = await login(PW.manager, "demo");
  const floor = await login(PW.floor, "demo");
  const b = (await mgr.get(`${M}/api/board`)).json;
  t("the example shop is in on first use", b && b.example === true && b.jobs.length === 16 && b.shipped.length === 6, b && { example: b.example, jobs: b.jobs.length });
  t("it shows late jobs, missed starts, held jobs and a full work center", b.kpis.late >= 1 && b.kpis.missed_starts >= 3 && b.kpis.held === 3 && b.kpis.full.some((f) => f.name === "Lathe"), b.kpis);
  t("on time at the dock is counted from what shipped", b.kpis.shipped_30 === 6 && b.kpis.on_time_30 === 50, b.kpis);
  t("every open job has a projected dock date, a state and where it is", b.jobs.every((j) => j.projected_dock && ["ok", "risk", "late"].includes(j.state) && j.where));
  t("a late job is projected past its commit date", b.jobs.filter((j) => j.state === "late").every((j) => j.projected_dock > j.commit_date));
  t("no work center is booked past its hours in any week", b.centers.every((c) => c.load.every((w) => w.hours <= w.capacity + 0.01)), b.centers.map((c) => c.load.map((w) => `${w.hours}/${w.capacity}`)));
  t("hot jobs come first", b.jobs[0].hot === true);
  const again = (await mgr.get(`${M}/api/board`)).json;
  t("a second look does not add the example twice", again.jobs.length === 16);

  // ---- the floor at the lathe: the first job here is next up; Start, then Done sends it on
  const lathe = b.centers.find((c) => c.name === "Lathe");
  const q = (await floor.get(`${M}/api/center/${lathe.id}`)).json.center;
  t("the lathe has work here and coming", q.here.length >= 2 && q.coming.length >= 1, { here: q.here.length, coming: q.coming.length });
  const first = q.here[0];
  const coming = q.coming[0];
  t("the floor cannot start work that is not here yet", (await floor.post(`${M}/api/ops/${coming.op_id}/start`, {})).status === 409);
  t("the floor starts the next one up", (await floor.post(`${M}/api/ops/${first.op_id}/start`, { who: "Dana" })).json.ok === true);
  t("and cannot start it twice", (await floor.post(`${M}/api/ops/${first.op_id}/start`, {})).status === 409);
  const done = await floor.post(`${M}/api/ops/${first.op_id}/done`, { who: "Dana" });
  t("Done sends it on", done.json && done.json.ok === true && done.json.shipped === false, done.json);
  const job = (await mgr.get(`${M}/api/jobs/${first.job_id}`)).json;
  const sent = job.job.ops.find((o) => o.id === first.op_id);
  t("the operation is done, by the name typed, and the next one has arrived", sent.status === "done" && sent.done_by === "Dana" && job.job.current.arrived_at && job.job.current.seq === sent.seq + 1, job.job.current);
  t("the job's history says so", job.log.some((l) => /Finished operation/.test(l.what) && l.who === "Dana"));

  // ---- Can't run it, then the manager gives it an owner and a date, then it clears
  const other = b.jobs.find((j) => !j.hold && j.id !== first.job_id);
  t("a hold needs a reason", (await floor.post(`${M}/api/jobs/${other.id}/hold`, { reason: "" })).status === 400);
  t("the floor holds a job with a reason", (await floor.post(`${M}/api/jobs/${other.id}/hold`, { reason: "No fixture for this part" })).json.ok === true);
  t("the floor cannot set the owner", [401, 403].includes((await floor.post(`${M}/api/jobs/${other.id}`, { hold_owner: "Tooling" })).status));
  t("the manager sets the owner and the date", (await mgr.post(`${M}/api/jobs/${other.id}`, { hold_owner: "Tooling", hold_until: "2099-01-04" })).json.ok === true);
  let o = (await mgr.get(`${M}/api/jobs/${other.id}`)).json.job;
  t("held, with owner and date, and it is at risk", o.hold === "No fixture for this part" && o.hold_owner === "Tooling" && o.hold_until === "2099-01-04" && o.state !== "ok", o);
  t("a hold expected to clear far out pushes the projection out", o.projected_dock > "2099-01-04");
  t("cleared", (await floor.post(`${M}/api/jobs/${other.id}/clear-hold`, {})).json.ok === true);

  // ---- the manager: release a job, its dates lock, priority, re-lock with a reason, commit date with a reason
  const saw = b.centers.find((c) => c.name === "Saw"), weld = b.centers.find((c) => c.name === "Weld"), ox = b.centers.find((c) => c.name.startsWith("Black oxide"));
  const rel = { job_no: "J-E2E-1", part_no: "TB-201", description: "Tow bar", qty: 3, customer: "E2E Air", commit_date: "2099-02-01", ops: [{ center_id: saw.id, hours: 1, what: "Cut" }, { center_id: weld.id, hours: 4 }, { center_id: ox.id }] };
  t("the floor cannot release a job", [401, 403].includes((await floor.post(`${M}/api/jobs`, rel)).status));
  t("a job with no operations is refused in words", /at least one operation/.test((await mgr.post(`${M}/api/jobs`, { ...rel, ops: [] })).json.error));
  t("a job with no commit date is refused in words", /commit date/.test((await mgr.post(`${M}/api/jobs`, { ...rel, commit_date: "" })).json.error));
  const made = (await mgr.post(`${M}/api/jobs`, rel)).json;
  t("released", made.ok === true && made.id);
  t("the same job number twice is refused", (await mgr.post(`${M}/api/jobs`, rel)).status === 409);
  const nj = (await mgr.get(`${M}/api/jobs/${made.id}`)).json.job;
  t("every operation has a locked start and the job a locked finish", nj.ops.every((x) => x.locked_start) && nj.locked_finish && nj.state === "ok", nj);
  t("the outside operation takes days, not hours", nj.ops[2].outside === true && nj.ops[2].hours === 0 && nj.ops[2].plan_end > nj.ops[2].plan_start);
  const before = (await mgr.get(`${M}/api/board`)).json.jobs.map((j) => j.id);
  t("a new job goes to the bottom of the list", before[before.length - 1] === made.id);
  t("moved up one", (await mgr.post(`${M}/api/jobs/${made.id}/move`, { dir: "up" })).json.moved === true);
  const after = (await mgr.get(`${M}/api/board`)).json.jobs.map((j) => j.id);
  t("and it is one place higher", after.indexOf(made.id) === before.indexOf(made.id) - 1, { before: before.indexOf(made.id), after: after.indexOf(made.id) });
  t("the floor cannot move the priority", [401, 403].includes((await floor.post(`${M}/api/jobs/${made.id}/move`, { dir: "up" })).status));
  t("locking the dates again needs a reason", (await mgr.post(`${M}/api/jobs/${made.id}/relock`, {})).status === 400);
  t("with one it is on the history", (await mgr.post(`${M}/api/jobs/${made.id}/relock`, { reason: "Weld down a day" })).json.ok === true
    && (await mgr.get(`${M}/api/jobs/${made.id}`)).json.log.some((l) => /Dates locked again.*Weld down a day/.test(l.what)));
  t("moving the commit date needs a reason", (await mgr.post(`${M}/api/jobs/${made.id}`, { commit_date: "2099-03-01" })).status === 400);
  t("with one it moves", (await mgr.post(`${M}/api/jobs/${made.id}`, { commit_date: "2099-03-01", reason: "Customer moved it" })).json.ok === true
    && (await mgr.get(`${M}/api/jobs/${made.id}`)).json.job.commit_date === "2099-03-01");

  // ---- a missed start shows the day it is missed, and the plan does not hide it
  const missed = (await mgr.get(`${M}/api/board`)).json.jobs.filter((j) => j.missed_start);
  t("a missed start keeps its locked date in the past while the plan moves on", missed.length >= 3 && missed.every((j) => j.current.locked_start < (j.current.plan_start || "9999")), missed.map((j) => [j.current.locked_start, j.current.plan_start]));

  // ---- running the whole job through ships it
  const all = (await mgr.get(`${M}/api/jobs/${made.id}`)).json.job.ops;
  for (const x of all) { await floor.post(`${M}/api/ops/${x.id}/start`, {}); await floor.post(`${M}/api/ops/${x.id}/done`, {}); }
  const shipped = (await mgr.get(`${M}/api/jobs/${made.id}`)).json.job;
  t("the last Done ships it, on time at the dock", shipped.status === "shipped" && shipped.on_time === true, shipped);
  t("undo takes the last finish back and reopens it", (await mgr.post(`${M}/api/ops/${all[2].id}/undo`, {})).json.ok === true
    && (await mgr.get(`${M}/api/jobs/${made.id}`)).json.job.status === "released");

  // ---- work centers
  t("a work center needs a name", (await mgr.post(`${M}/api/centers`, { name: "" })).status === 400);
  const cell = (await mgr.post(`${M}/api/centers`, { name: "Laser", kind: "machine", hours_per_day: 20 })).json;
  t("a work center is added", cell.ok === true);
  t("the same name twice is refused", (await mgr.post(`${M}/api/centers`, { name: "laser", hours_per_day: 8 })).status === 409);
  t("a work center with open work cannot be retired", (await mgr.post(`${M}/api/centers/${b.centers.find((c) => c.name === "Lathe").id}/retire`, {})).status === 409);
  t("an unused one can", (await mgr.post(`${M}/api/centers/${cell.id}/retire`, {})).json.ok === true);

  // ---- the example comes out, stays out, and goes back
  const cleared = (await mgr.post(`${M}/api/example/clear`, { centers: true })).json;
  t("the example comes out: 22 jobs", cleared.ok && cleared.removed === 22, cleared);
  const empty = (await mgr.get(`${M}/api/board`)).json;
  t("the job released here stays, and the example does not come back on its own", empty.example === false && empty.jobs.length === 1 && empty.jobs[0].id === made.id && empty.shipped.length === 0, empty.jobs.length);
  t("the example work centers in use stay", empty.centers.some((c) => c.name === "Saw") && !empty.centers.some((c) => c.name === "Paint"), empty.centers.map((c) => c.name));
  t("the floor cannot put it back", [401, 403].includes((await floor.post(`${M}/api/example/load`, {})).status));
  t("the manager can", (await mgr.post(`${M}/api/example/load`, {})).json.ok === true && (await mgr.get(`${M}/api/board`)).json.jobs.length === 17);

  // ---- every screen answers
  for (const p of ["/", `/job/${made.id}`, "/centers", `/center/${lathe.id}`, "/load", "/meeting", "/setup"]) {
    const r = await floor.get(`${M}${p}`);
    t(`the screen ${p} answers`, r.status === 200 && /feedback-widget/.test(r.text), r.status);
  }
  R.done();
})().catch(R.abort);
