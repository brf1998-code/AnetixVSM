// Shop Schedule: module routes.
//
// A job shop's schedule with real limits. Every job has a routing (its operations, in order, each at a work
// center with planned hours). The plan places every operation that is not done on its work center's hours, day
// by day, highest priority first, so a work center can never be booked past what it has (the "infinite capacity"
// schedule is the problem this replaces). Outside processing (black oxide, heat treat) takes calendar days and
// no hours. From the plan:
//   - each job's projected date at the customer's dock (last operation + ship days) against its commit date
//   - each operation's start date, LOCKED when the job is released: the plan moves, the locked date does not, so a
//     missed start shows red the day it is missed, weeks before the commit date is in danger
//   - each work center's queue (running, here and ready, held here, coming) and its load by week
//   - the wait between operations, measured from the floor's Start and Done taps
// The example shop is put in on first use, dated from that day, and comes out with one button.
module.exports = function makeRouter(ctx) {
  const { express, db, requireManager } = ctx;
  const router = express.Router();
  router.use(express.json());

  // ---- dates: plain YYYY-MM-DD strings, worked in UTC so a day is a day ------------------------------------
  const DAY = 86400000;
  const ymd = (d) => new Date(d).toISOString().slice(0, 10);
  const parse = (s) => Date.parse(String(s).slice(0, 10) + "T00:00:00Z");
  const addDays = (s, n) => ymd(parse(s) + n * DAY);
  const dow = (s) => new Date(parse(s)).getUTCDay();
  const isWork = (s) => dow(s) >= 1 && dow(s) <= 5;
  const nextWork = (s) => { let d = s; for (let i = 0; i < 7 && !isWork(d); i++) d = addDays(d, 1); return d; };
  const addWork = (s, n) => { let d = s, k = 0; const step = n < 0 ? -1 : 1; while (k < Math.abs(n)) { d = addDays(d, step); if (isWork(d)) k++; } return d; };
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / DAY);   // b minus a, calendar days
  const weekOf = (s) => addDays(s, -((dow(s) + 6) % 7));                   // the Monday of that week
  const asDate = (v) => (v == null ? null : v instanceof Date ? ymd(v) : String(v).slice(0, 10));
  const num = (v) => Number(v) || 0;
  // the screen sends its own today (the plant's calendar day); the tool takes it when it is within a day of its own
  function todayOf(req) {
    const mine = ymd(Date.now());
    const asked = String((req.query && req.query.today) || "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(asked) && Math.abs(daysBetween(mine, asked)) <= 1) return asked;
    return mine;
  }
  // an id from an address: digits only, or 0 (which matches nothing), never a number the tables cannot hold
  const idOf = (v) => (/^\d{1,9}$/.test(String(v)) ? Number(v) : 0);
  const who = (req) => String((req.body && req.body.who) || "").trim().slice(0, 60) || null;
  const fail = (res, status, msg) => res.status(status).json({ error: msg });

  async function settings() {
    const rows = (await db("SELECT key, value FROM settings")).rows;
    const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return { ship_days: Math.max(0, Math.min(30, Number(s.ship_days) || 0)), seeded: s.seeded || null };
  }
  async function note(jobId, opId, what, by) {
    await db("INSERT INTO log (job_id, op_id, what, who) VALUES ($1,$2,$3,$4)", [jobId, opId, what, by]);
  }

  // ---- the plan ---------------------------------------------------------------------------------------------
  // Pure: rows in, a plan out. Jobs in priority order (hot first, then priority, then commit date). Each operation
  // that is not done goes on its work center's open hours from the earliest day it can start: today, the day the
  // operation before it ends, or the day a hold is expected to clear. A running operation is counted as half done.
  function plan({ centers, jobs, ops, today, shipDays }) {
    const C = new Map(centers.map((c) => [c.id, c]));
    const left = new Map();                       // "center|day" -> hours still open
    const load = new Map();                       // center -> Map(week -> hours)
    const open = (c, day) => { const k = `${c.id}|${day}`; if (!left.has(k)) left.set(k, Math.max(0, num(c.hours_per_day))); return k; };
    const book = (cid, day, h) => { if (!load.has(cid)) load.set(cid, new Map()); const w = load.get(cid); const wk = weekOf(day); w.set(wk, (w.get(wk) || 0) + h); };
    const byJob = new Map();
    for (const o of ops) { if (!byJob.has(o.job_id)) byJob.set(o.job_id, []); byJob.get(o.job_id).push(o); }
    for (const list of byJob.values()) list.sort((a, b) => a.seq - b.seq);
    const order = jobs.filter((j) => j.status === "released").sort((a, b) =>
      (b.hot ? 1 : 0) - (a.hot ? 1 : 0) || a.priority - b.priority || String(a.commit_date).localeCompare(String(b.commit_date)) || a.id - b.id);
    const out = new Map();
    for (const j of order) {
      let t = nextWork(today);
      const until = asDate(j.hold_until);
      if (j.hold && until && until > t) t = nextWork(until);
      const ps = new Map();
      let finish = null;
      for (const o of byJob.get(j.id) || []) {
        if (o.status === "done") continue;
        const c = C.get(o.center_id);
        if (!c) continue;
        let start, end;
        if (c.kind === "outside") {
          let days = Math.max(0, num(c.outside_days));
          if (o.status === "running" && o.started_at) {
            start = ymd(o.started_at);
            days = Math.max(1, days - daysBetween(start, today));
            end = nextWork(addDays(today, days));
          } else { start = t; end = nextWork(addDays(t, days)); }
          t = end;
        } else {
          let rem = num(o.hours); if (o.status === "running") rem = Math.max(0.25, rem / 2);
          let day = t, guard = 0;
          if (num(c.hours_per_day) <= 0 || rem <= 0) { start = t; end = t; }
          else {
            while (rem > 1e-6 && guard++ < 800) {
              if (isWork(day)) {
                const k = open(c, day), avail = left.get(k);
                if (avail > 1e-6) { const take = Math.min(avail, rem); left.set(k, avail - take); rem -= take; book(c.id, day, take); if (!start) start = day; }
              }
              if (rem > 1e-6) day = addDays(day, 1);
            }
            end = day; if (!start) start = day;
          }
          if (o.status === "running" && o.started_at) start = ymd(o.started_at);
          t = end;
        }
        ps.set(o.id, { start, end });
        finish = end;
      }
      const done = !finish;
      if (!finish) finish = nextWork(today);
      out.set(j.id, { ops: ps, finish, dock: nextWork(addDays(finish, shipDays)), done });
    }
    return { jobs: out, load };
  }

  // Everything the screens draw, worked out once.
  async function board(today) {
    const s = await settings();
    const centers = (await db("SELECT * FROM centers WHERE active ORDER BY sort, id")).rows;
    const jobs = (await db("SELECT * FROM jobs WHERE status='released' OR (status='shipped' AND shipped_at > now() - interval '45 days') ORDER BY priority, id")).rows;
    const ops = jobs.length ? (await db("SELECT * FROM ops WHERE job_id = ANY($1::int[]) ORDER BY job_id, seq", [jobs.map((j) => j.id)])).rows : [];
    const P = plan({ centers, jobs, ops, today, shipDays: s.ship_days });
    const C = new Map(centers.map((c) => [c.id, c]));
    const opsOf = new Map();
    for (const o of ops) { if (!opsOf.has(o.job_id)) opsOf.set(o.job_id, []); opsOf.get(o.job_id).push(o); }
    const waitDays = (from, to) => (from && to ? Math.max(0, (new Date(to) - new Date(from)) / DAY) : null);
    const out = [];
    for (const j of jobs) {
      const list = opsOf.get(j.id) || [];
      const p = P.jobs.get(j.id);
      const view = list.map((o, i) => {
        const c = C.get(o.center_id) || { name: "(work center gone)", kind: "machine" };
        const pl = p && p.ops.get(o.id);
        const prev = list[i - 1];
        const ready = !prev || prev.status === "done";
        return {
          id: o.id, seq: o.seq, center_id: o.center_id, center: c.name, outside: c.kind === "outside", what: o.what, hours: num(o.hours),
          status: o.status, locked_start: asDate(o.locked_start), plan_start: pl ? pl.start : null, plan_end: pl ? pl.end : null,
          arrived_at: o.arrived_at, started_at: o.started_at, done_at: o.done_at, done_by: o.done_by, ready,
          waited_days: o.started_at ? waitDays(o.arrived_at, o.started_at) : (ready && o.status === "waiting" && o.arrived_at ? waitDays(o.arrived_at, Date.now()) : null),
        };
      });
      const cur = view.find((o) => o.status !== "done") || null;
      const last = [...view].reverse().find((o) => o.status === "done") || null;
      const nxt = cur ? view.find((o) => o.seq > cur.seq && o.status !== "done") || null : null;
      const commit = asDate(j.commit_date);
      const row = {
        id: j.id, job_no: j.job_no, part_no: j.part_no, description: j.description, qty: j.qty, customer: j.customer,
        commit_date: commit, priority: j.priority, hot: j.hot, status: j.status, example: j.example,
        hold: j.hold, hold_owner: j.hold_owner, hold_until: asDate(j.hold_until), hold_at: j.hold_at,
        locked_finish: asDate(j.locked_finish), shipped_at: j.shipped_at, ops: view,
        current: cur, last_done: last, next: nxt,
      };
      if (j.status === "released" && p) {
        row.projected_dock = p.dock;
        row.slack_days = daysBetween(p.dock, commit);
        row.missed_start = Boolean(cur && cur.status === "waiting" && cur.locked_start && cur.locked_start < today);
        row.missed_by = row.missed_start ? daysBetween(cur.locked_start, today) : 0;
        row.drift_days = row.locked_finish ? daysBetween(row.locked_finish, p.dock) : 0;
        row.state = p.dock > commit ? "late" : (j.hold || row.missed_start || row.slack_days < 3) ? "risk" : "ok";
        row.hours_left = view.filter((o) => o.status !== "done" && !o.outside).reduce((a, o) => a + (o.status === "running" ? o.hours / 2 : o.hours), 0);
        row.outside_left = view.filter((o) => o.status !== "done" && o.outside).length;
        row.ops_left = view.filter((o) => o.status !== "done").length;
        row.where = !cur ? "All operations done" : cur.status === "running" ? `Running at ${cur.center}` : cur.ready ? `Waiting at ${cur.center}` : `Not started`;
      } else {
        row.state = "shipped";
        row.on_time = j.shipped_at ? addDays(ymd(j.shipped_at), s.ship_days) <= commit : null;
      }
      out.push(row);
    }
    // the work centers: queue and load
    const weeks = []; for (let i = 0; i < 8; i++) weeks.push(addDays(weekOf(today), 7 * i));
    const live = out.filter((j) => j.status === "released");
    const centerView = centers.map((c) => {
      const mine = [];
      for (const j of live) for (const o of j.ops) if (o.center_id === c.id && o.status !== "done") mine.push({ j, o });
      const item = ({ j, o }) => ({ op_id: o.id, job_id: j.id, job_no: j.job_no, part_no: j.part_no, description: j.description, qty: j.qty, what: o.what,
        hours: o.hours, status: o.status, locked_start: o.locked_start, plan_start: o.plan_start, plan_end: o.plan_end, commit_date: j.commit_date,
        state: j.state, hot: j.hot, hold: j.hold, priority: j.priority, waited_days: o.waited_days, started_at: o.started_at, arrived_at: o.arrived_at,
        missed: Boolean(o.status === "waiting" && o.locked_start && o.locked_start < today),
        from: (() => { const prev = j.ops.find((x) => x.seq < o.seq && x.status !== "done"); return prev ? `${prev.center} (${prev.status === "running" ? "running" : "waiting"})` : null; })() });
      const byPlan = (a, b) => String(a.plan_start || "").localeCompare(String(b.plan_start || "")) || (b.hot ? 1 : 0) - (a.hot ? 1 : 0) || a.priority - b.priority;
      const running = mine.filter((x) => x.o.status === "running").map(item);
      const here = mine.filter((x) => x.o.status === "waiting" && x.o.ready && !x.j.hold).map(item).sort(byPlan);
      const held = mine.filter((x) => x.o.status === "waiting" && x.o.ready && x.j.hold).map(item).sort(byPlan);
      const coming = mine.filter((x) => x.o.status === "waiting" && !x.o.ready).map(item).sort(byPlan);
      const wl = P.load.get(c.id) || new Map();
      const perDay = num(c.hours_per_day);
      const loadWeeks = weeks.map((w, i) => {
        let days = 5;
        if (i === 0) { days = 0; for (let d = today; weekOf(d) === w; d = addDays(d, 1)) if (isWork(d)) days++; }
        return { week: w, hours: Math.round((wl.get(w) || 0) * 10) / 10, capacity: perDay * days };
      });
      const booked = here.reduce((a, x) => a + x.hours, 0) + running.reduce((a, x) => a + x.hours / 2, 0);
      return { id: c.id, name: c.name, kind: c.kind, hours_per_day: perDay, outside_days: c.outside_days, sort: c.sort,
        running, here, held, coming, load: c.kind === "outside" ? [] : loadWeeks,
        days_of_work_here: perDay > 0 ? Math.round((booked / perDay) * 10) / 10 : null };
    });
    // the numbers on the board
    const shipped = out.filter((j) => j.status === "shipped");
    const recent = shipped.filter((j) => j.shipped_at && new Date(j.shipped_at) > new Date(Date.now() - 30 * DAY));
    const waits = [];
    for (const j of out) for (const o of j.ops) if (o.started_at && o.arrived_at && new Date(o.started_at) > new Date(Date.now() - 30 * DAY)) waits.push(waitDays(o.arrived_at, o.started_at));
    const kpis = {
      open: live.length,
      late: live.filter((j) => j.state === "late").length,
      risk: live.filter((j) => j.state === "risk").length,
      missed_starts: live.filter((j) => j.missed_start).length,
      held: live.filter((j) => j.hold).length,
      shipped_week: shipped.filter((j) => j.shipped_at && ymd(j.shipped_at) >= weekOf(today)).length,
      on_time_30: recent.length ? Math.round((100 * recent.filter((j) => j.on_time).length) / recent.length) : null,
      shipped_30: recent.length,
      avg_wait_days: waits.length ? Math.round((waits.reduce((a, b) => a + b, 0) / waits.length) * 10) / 10 : null,
      // booked full from now on: the plan can never put a work center past its hours, so "full" (95% or more) week
      // after week is how a constraint shows; every job behind it waits
      full: centerView.map((c) => { let n = 0; while (n < c.load.length && c.load[n].capacity > 0 && c.load[n].hours >= c.load[n].capacity * 0.95) n++; return n ? { id: c.id, name: c.name, weeks: n, through: c.load[n - 1].week } : null; }).filter(Boolean),
    };
    const order = (a, b) => (b.hot ? 1 : 0) - (a.hot ? 1 : 0) || a.priority - b.priority || String(a.commit_date).localeCompare(String(b.commit_date));
    return { today, settings: { ship_days: s.ship_days }, example: s.seeded === "example" && out.some((j) => j.example),
      kpis, jobs: live.sort(order), shipped: shipped.sort((a, b) => new Date(b.shipped_at) - new Date(a.shipped_at)), centers: centerView, weeks };
  }

  // Lock the start dates of a job's operations that have none yet (or all of them, when re-locking), and its
  // finish, from the plan as it stands now.
  async function lockDates(jobId, today, { all = false } = {}) {
    const b = await board(today);
    const j = b.jobs.find((x) => x.id === jobId);
    if (!j) return;
    for (const o of j.ops) {
      if (o.status === "done") continue;
      if (all || !o.locked_start) await db("UPDATE ops SET locked_start=$2 WHERE id=$1", [o.id, o.status === "running" ? (o.locked_start || o.plan_start) : o.plan_start]);
    }
    if (all || !j.locked_finish) await db("UPDATE jobs SET locked_finish=$2 WHERE id=$1", [jobId, j.projected_dock]);
  }

  // ---- the example shop -------------------------------------------------------------------------------------
  // A small machining and fabrication job shop: one lathe that is over-booked, two outside processes, a few jobs
  // held for material or a drawing, a few already late. Dated from the day it is put in.
  const EX_CENTERS = [
    ["Saw", "machine", 8, 0], ["Mill 1", "machine", 10, 0], ["Mill 2", "machine", 10, 0], ["Lathe", "machine", 8, 0],
    ["Weld", "machine", 16, 0], ["Paint", "machine", 8, 0], ["Black oxide (outside)", "outside", 0, 10], ["Heat treat (outside)", "outside", 0, 14],
    ["Assembly", "machine", 16, 0], ["Inspection", "machine", 8, 0], ["Shipping", "machine", 8, 0],
  ];
  const ROUTES = {
    "TB-200": ["Tow bar assembly", [["Saw", "Cut tube and plate", 1.5], ["Weld", "Weld frame", 6], ["Paint", "Prime and paint", 3], ["Assembly", "Hitch and casters", 4], ["Inspection", "Final inspection", 1], ["Shipping", "Pack and ship", 0.5]]],
    "AX-410": ["Axle shaft", [["Saw", "Cut bar stock", 0.5], ["Lathe", "Rough turn", 8], ["Heat treat (outside)", "Heat treat", 0], ["Lathe", "Finish turn", 3], ["Black oxide (outside)", "Black oxide", 0], ["Inspection", "Final inspection", 1], ["Shipping", "Pack and ship", 0.5]]],
    "AB-118": ["Adapter bracket", [["Saw", "Cut plate", 0.5], ["Mill 1", "Mill and drill", 4], ["Black oxide (outside)", "Black oxide", 0], ["Inspection", "Final inspection", 0.5], ["Shipping", "Pack and ship", 0.5]]],
    "HC-900": ["Hydraulic cart frame", [["Saw", "Cut tube", 3], ["Weld", "Weld frame", 12], ["Paint", "Prime and paint", 4], ["Assembly", "Pump, hoses and wheels", 10], ["Inspection", "Pressure test and inspection", 2], ["Shipping", "Crate and ship", 1]]],
    "HP-050": ["Hitch pin set", [["Lathe", "Turn pins", 4], ["Heat treat (outside)", "Heat treat", 0], ["Black oxide (outside)", "Black oxide", 0], ["Inspection", "Final inspection", 0.5], ["Shipping", "Pack and ship", 0.5]]],
    "PM-330": ["Pump mount plate", [["Mill 2", "Mill profile", 5], ["Mill 1", "Drill and tap", 2], ["Paint", "Paint", 2], ["Inspection", "Final inspection", 0.5], ["Shipping", "Pack and ship", 0.5]]],
    "WH-620": ["Wheel hub", [["Saw", "Cut bar stock", 0.5], ["Lathe", "Turn hub", 10], ["Mill 2", "Bolt pattern", 3], ["Inspection", "Final inspection", 1], ["Shipping", "Pack and ship", 0.5]]],
    "JS-150": ["Jack stand assembly", [["Saw", "Cut tube", 1], ["Weld", "Weld stand", 5], ["Paint", "Paint", 2], ["Assembly", "Screw and pad", 3], ["Inspection", "Final inspection", 1], ["Shipping", "Pack and ship", 0.5]]],
  };
  const CUSTOMERS = ["Coastal Air Services", "Northfield Aviation", "Bayline MRO", "Summit Field Services", "Harbor Point Airlines", "Ridgeway Aero"];
  // [job, part, qty, customer, ops done, current op running?, waited days at the current op, slack days vs plan, hold, missed start days, hot]
  const EX_JOBS = [
    ["J-24101", "HC-900", 2, 0, 3, true, 1, 9, null, 0, false],
    ["J-24104", "AX-410", 6, 1, 1, false, 4, -6, null, 5, true],
    ["J-24107", "TB-200", 4, 2, 2, false, 6, 4, null, 3, false],
    ["J-24109", "AB-118", 20, 3, 2, true, 0, 12, null, 0, false],
    ["J-24112", "WH-620", 8, 4, 1, false, 3, -3, null, 2, false],
    ["J-24115", "HP-050", 50, 5, 0, false, 0, 2, null, 0, false],
    ["J-24116", "PM-330", 12, 0, 0, false, 0, 15, ["Waiting on 1 inch 6061 plate from the vendor. No confirmed ship date.", "Purchasing", null], 0, false],
    ["J-24118", "JS-150", 10, 1, 4, false, 2, 6, null, 0, false],
    ["J-24120", "AX-410", 4, 2, 0, false, 0, 1, null, 4, false],
    ["J-24121", "TB-200", 2, 3, 0, false, 0, 18, ["Drawing rev C not released yet.", "Engineering", 3], 0, false],
    ["J-24123", "WH-620", 10, 4, 0, false, 0, 7, null, 0, false],
    ["J-24125", "HC-900", 1, 5, 1, false, 5, -9, ["Missing 1 of 11 purchased fittings.", "Purchasing", 6], 0, false],
    ["J-24126", "AB-118", 40, 0, 0, false, 0, 22, null, 0, false],
    ["J-24128", "JS-150", 6, 1, 0, false, 0, 26, null, 0, false],
    ["J-24130", "HP-050", 60, 2, 0, false, 0, 30, null, 0, false],
    ["J-24131", "PM-330", 8, 3, 3, true, 2, 5, null, 0, false],
  ];
  // shipped in the last weeks: [job, part, qty, customer, shipped days ago, days late at the dock (0 or less is on time)]
  const EX_SHIPPED = [
    ["J-24088", "AB-118", 25, 0, 1, -3], ["J-24091", "JS-150", 8, 1, 4, 5], ["J-24093", "TB-200", 3, 2, 7, -1],
    ["J-24094", "WH-620", 4, 3, 9, 12], ["J-24096", "PM-330", 10, 4, 12, -4], ["J-24098", "HP-050", 40, 5, 15, 2],
  ];

  async function loadExample(today) {
    const ids = {};
    const have = (await db("SELECT id, name FROM centers")).rows;
    for (const [i, [name, kind, hours, outside]] of EX_CENTERS.entries()) {
      const found = have.find((c) => c.name.toLowerCase() === name.toLowerCase());
      ids[name] = found ? found.id : (await db("INSERT INTO centers (name, kind, hours_per_day, outside_days, sort, example) VALUES ($1,$2,$3,$4,$5,true) RETURNING id", [name, kind, hours, outside, (i + 1) * 10])).rows[0].id;
    }
    const at = (daysAgo, hour = 9) => new Date(parse(today) - daysAgo * DAY + hour * 3600000).toISOString();
    const made = [];
    let prio = 10;
    for (const [jobNo, part, qty, cust, done, running, waited, , hold, , hot] of EX_JOBS) {
      const [desc, route] = ROUTES[part];
      const holdUntil = hold && hold[2] != null ? addWork(today, hold[2]) : null;
      const j = (await db(`INSERT INTO jobs (job_no, part_no, description, qty, customer, commit_date, priority, hot, hold, hold_owner, hold_until, hold_at, example)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true) ON CONFLICT (job_no) DO NOTHING RETURNING id`,
      [jobNo, part, desc, qty, CUSTOMERS[cust], addDays(today, 60), prio, hot, hold ? hold[0] : null, hold ? hold[1] : null, holdUntil, hold ? at(3) : null])).rows[0];
      prio += 10;
      if (!j) continue;
      // operations done walk back from today: each took a day, with a wait before it; the current one arrived
      // `waited` days ago (and started today, if running)
      // the current operation arrived when the one before it was done, `waited` days ago
      let cursor = waited;
      const stamps = [];
      for (let k = done - 1; k >= 0; k--) { const startAgo = cursor + 1; const arriveAgo = startAgo + 1 + (k % 3); stamps[k] = { arrived: at(arriveAgo, 14), started: at(startAgo, 8), done: at(cursor, 14) }; cursor = arriveAgo; }
      for (const [s, [center, what, hours]] of route.entries()) {
        const status = s < done ? "done" : s === done && running ? "running" : "waiting";
        const st = stamps[s] || {};
        const arrived = s < done ? st.arrived : s === done ? at(waited, waited === 0 ? 6 : 14) : null;
        await db(`INSERT INTO ops (job_id, seq, center_id, what, hours, status, arrived_at, started_at, done_at, done_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [j.id, s + 1, ids[center], what, Math.round(hours * Math.max(1, Math.sqrt(qty) / 2) * 10) / 10, status, arrived,
            status === "done" ? st.started : status === "running" ? at(0, 7) : null, status === "done" ? st.done : null, status === "done" ? "Example" : null]);
      }
      made.push(j.id);
    }
    // lock every job's dates from the plan as it stands, then set each commit date from its projected dock and the
    // slack the example wants, and move the locked start back on the jobs that missed one
    for (const id of made) await lockDates(id, today, { all: true });
    const b = await board(today);
    for (const [jobNo, , , , , , , slack, , missed] of EX_JOBS) {
      const j = b.jobs.find((x) => x.job_no === jobNo); if (!j) continue;
      await db("UPDATE jobs SET commit_date=$2, locked_finish=$3 WHERE id=$1", [j.id, nextWork(addDays(j.projected_dock, slack)), missed ? addWork(j.projected_dock, -missed) : j.projected_dock]);
      if (missed && j.current) await db("UPDATE ops SET locked_start=$2 WHERE id=$1", [j.current.id, addWork(today, -missed)]);
    }
    for (const [jobNo, part, qty, cust, ago, late] of EX_SHIPPED) {
      const [desc, route] = ROUTES[part];
      const shippedDay = addWork(today, -ago);
      const s = await settings();
      const j = (await db(`INSERT INTO jobs (job_no, part_no, description, qty, customer, commit_date, priority, status, shipped_at, locked_finish, example)
        VALUES ($1,$2,$3,$4,$5,$6,999,'shipped',$7,$6,true) ON CONFLICT (job_no) DO NOTHING RETURNING id`,
      [jobNo, part, desc, qty, CUSTOMERS[cust], addWork(nextWork(addDays(shippedDay, s.ship_days)), -late), at(daysBetween(shippedDay, today), 15)])).rows[0];
      if (!j) continue;
      let back = daysBetween(shippedDay, today) + route.length * 3;
      for (const [k, [center, what, hours]] of route.entries()) {
        await db(`INSERT INTO ops (job_id, seq, center_id, what, hours, status, arrived_at, started_at, done_at, done_by, locked_start) VALUES ($1,$2,$3,$4,$5,'done',$6,$7,$8,'Example',$9)`,
          [j.id, k + 1, ids[center], what, hours, at(back, 8), at(back - 1 - (k % 2), 10), at(back - 2, 14), ymd(at(back, 8))]);
        back -= 3;
      }
    }
    await db("INSERT INTO settings (key, value) VALUES ('seeded','example') ON CONFLICT (key) DO UPDATE SET value='example'");
  }
  // On first use: the example goes in once, by whichever request gets there first.
  async function firstUse(today) {
    const won = (await db("INSERT INTO settings (key, value) VALUES ('seeded','loading') ON CONFLICT (key) DO NOTHING RETURNING key")).rows[0];
    if (!won) return;
    try { await loadExample(today); }
    catch (e) { await db("UPDATE settings SET value='failed' WHERE key='seeded'"); throw e; }
  }

  // ---- reads ------------------------------------------------------------------------------------------------
  router.get("/api/board", async (req, res) => {
    const today = todayOf(req);
    await firstUse(today);
    res.json(await board(today));
  });
  router.get("/api/centers", async (req, res) => {
    const today = todayOf(req);
    await firstUse(today);
    const b = await board(today);
    res.json({ today, centers: b.centers.map((c) => ({ id: c.id, name: c.name, kind: c.kind, hours_per_day: c.hours_per_day, outside_days: c.outside_days, sort: c.sort,
      running: c.running.length, here: c.here.length, held: c.held.length, coming: c.coming.length, days_of_work_here: c.days_of_work_here })) });
  });
  router.get("/api/center/:id", async (req, res) => {
    const today = todayOf(req);
    await firstUse(today);
    const b = await board(today);
    const c = b.centers.find((x) => x.id === idOf(req.params.id));
    if (!c) return fail(res, 404, "No such work center.");
    res.json({ today, center: c });
  });
  router.get("/api/jobs/:id", async (req, res) => {
    const today = todayOf(req);
    const b = await board(today);
    let j = b.jobs.find((x) => x.id === idOf(req.params.id)) || b.shipped.find((x) => x.id === idOf(req.params.id));
    if (!j) {
      const row = (await db("SELECT id, job_no, part_no, description, qty, customer, commit_date, status FROM jobs WHERE id=$1", [idOf(req.params.id)])).rows[0];
      if (!row) return fail(res, 404, "No such job.");
      j = { ...row, commit_date: asDate(row.commit_date), ops: [], state: row.status };
    }
    const log = (await db("SELECT at, what, who FROM log WHERE job_id=$1 ORDER BY at DESC, id DESC LIMIT 60", [j.id])).rows;
    res.json({ today, job: j, log, ship_days: b.settings.ship_days, centers: b.centers.map((c) => ({ id: c.id, name: c.name, kind: c.kind })) });
  });

  // ---- the floor: start, done, can't run it ------------------------------------------------------------------
  async function opRow(id) {
    return (await db("SELECT o.*, j.status AS job_status, j.job_no FROM ops o JOIN jobs j ON j.id=o.job_id WHERE o.id=$1", [idOf(id)])).rows[0];
  }
  router.post("/api/ops/:id/start", async (req, res) => {
    const o = await opRow(req.params.id);
    if (!o || o.job_status !== "released") return fail(res, 404, "That operation is not on an open job.");
    if (o.status !== "waiting") return fail(res, 409, o.status === "running" ? "It is already running." : "It is already done.");
    const prev = (await db("SELECT status FROM ops WHERE job_id=$1 AND seq<$2 AND status<>'done' LIMIT 1", [o.job_id, o.seq])).rows[0];
    if (prev) return fail(res, 409, "The operation before this one is not done yet, so the job is not here.");
    await db("UPDATE ops SET status='running', started_at=now(), arrived_at=COALESCE(arrived_at, now()) WHERE id=$1", [o.id]);
    await note(o.job_id, o.id, `Started operation ${o.seq}`, who(req));
    res.json({ ok: true });
  });
  router.post("/api/ops/:id/done", async (req, res) => {
    const o = await opRow(req.params.id);
    if (!o || o.job_status !== "released") return fail(res, 404, "That operation is not on an open job.");
    if (o.status === "done") return fail(res, 409, "It is already done.");
    const prev = (await db("SELECT status FROM ops WHERE job_id=$1 AND seq<$2 AND status<>'done' LIMIT 1", [o.job_id, o.seq])).rows[0];
    if (prev) return fail(res, 409, "The operation before this one is not done yet.");
    await db("UPDATE ops SET status='done', started_at=COALESCE(started_at, now()), arrived_at=COALESCE(arrived_at, now()), done_at=now(), done_by=$2 WHERE id=$1", [o.id, who(req)]);
    const next = (await db("SELECT id FROM ops WHERE job_id=$1 AND seq>$2 ORDER BY seq LIMIT 1", [o.job_id, o.seq])).rows[0];
    if (next) await db("UPDATE ops SET arrived_at=now() WHERE id=$1", [next.id]);
    else await db("UPDATE jobs SET status='shipped', shipped_at=now() WHERE id=$1", [o.job_id]);
    await note(o.job_id, o.id, next ? `Finished operation ${o.seq}` : `Finished the last operation: shipped`, who(req));
    res.json({ ok: true, shipped: !next });
  });
  // anyone on the floor can say a job cannot run, and why; the manager sets who owns it and by when
  router.post("/api/jobs/:id/hold", async (req, res) => {
    const reason = String((req.body || {}).reason || "").trim().slice(0, 300);
    if (reason.length < 3) return fail(res, 400, "Say what is in the way.");
    const j = (await db("SELECT * FROM jobs WHERE id=$1 AND status='released'", [idOf(req.params.id)])).rows[0];
    if (!j) return fail(res, 404, "No such open job.");
    const owner = String((req.body || {}).owner || "").trim().slice(0, 60) || null;
    const until = /^\d{4}-\d{2}-\d{2}$/.test(String((req.body || {}).until || "")) ? req.body.until : null;
    await db("UPDATE jobs SET hold=$2, hold_owner=COALESCE($3, hold_owner), hold_until=$4, hold_at=now() WHERE id=$1", [j.id, reason, owner, until]);
    await note(j.id, null, `Held: ${reason}${owner ? ` (owner ${owner})` : ""}${until ? `, expected clear ${until}` : ""}`, who(req));
    res.json({ ok: true });
  });
  router.post("/api/jobs/:id/clear-hold", async (req, res) => {
    const j = (await db("SELECT * FROM jobs WHERE id=$1 AND status='released' AND hold IS NOT NULL", [idOf(req.params.id)])).rows[0];
    if (!j) return fail(res, 404, "That job is not held.");
    await db("UPDATE jobs SET hold=NULL, hold_owner=NULL, hold_until=NULL, hold_at=NULL WHERE id=$1", [j.id]);
    await note(j.id, null, `Cleared the hold: ${j.hold}`, who(req));
    res.json({ ok: true });
  });

  // ---- the manager: jobs, priority, dates ----------------------------------------------------------------------
  function cleanOps(list, centers) {
    if (!Array.isArray(list) || !list.length) return "Add at least one operation.";
    if (list.length > 40) return "Forty operations at most.";
    const out = [];
    for (const [i, o] of list.entries()) {
      const c = centers.find((x) => x.id === Number(o && o.center_id));
      if (!c) return `Operation ${i + 1}: pick a work center.`;
      const h = Number(o.hours);
      if (c.kind !== "outside" && !(h > 0 && h <= 2000)) return `Operation ${i + 1}: give the hours (more than 0).`;
      out.push({ center_id: c.id, what: String(o.what || "").trim().slice(0, 120) || null, hours: c.kind === "outside" ? 0 : Math.round(h * 100) / 100 });
    }
    return out;
  }
  router.post("/api/jobs", requireManager, async (req, res) => {
    const b = req.body || {};
    const jobNo = String(b.job_no || "").trim().slice(0, 40);
    if (!jobNo) return fail(res, 400, "Give the job number.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.commit_date || ""))) return fail(res, 400, "Give the commit date (the day it is due at the customer's dock).");
    const qty = Math.round(Number(b.qty) || 0);
    if (!(qty > 0)) return fail(res, 400, "Give the quantity.");
    if ((await db("SELECT 1 FROM jobs WHERE job_no=$1", [jobNo])).rows[0]) return fail(res, 409, `There is already a job ${jobNo}.`);
    const centers = (await db("SELECT * FROM centers WHERE active")).rows;
    const ops = cleanOps(b.ops, centers);
    if (typeof ops === "string") return fail(res, 400, ops);
    const prio = Number((await db("SELECT COALESCE(MAX(priority),0)+10 AS p FROM jobs WHERE status='released'")).rows[0].p);
    const j = (await db(`INSERT INTO jobs (job_no, part_no, description, qty, customer, commit_date, priority, hot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [jobNo, String(b.part_no || "").trim().slice(0, 60) || null, String(b.description || "").trim().slice(0, 200) || null, qty,
        String(b.customer || "").trim().slice(0, 80) || null, b.commit_date, prio, Boolean(b.hot)])).rows[0];
    for (const [i, o] of ops.entries()) await db("INSERT INTO ops (job_id, seq, center_id, what, hours, arrived_at) VALUES ($1,$2,$3,$4,$5,$6)", [j.id, i + 1, o.center_id, o.what, o.hours, i === 0 ? new Date().toISOString() : null]);
    await lockDates(j.id, todayOf(req), { all: true });
    await note(j.id, null, `Released with ${ops.length} operations, commit ${b.commit_date}`, who(req));
    res.json({ ok: true, id: j.id });
  });
  router.post("/api/jobs/:id", requireManager, async (req, res) => {
    const j = (await db("SELECT * FROM jobs WHERE id=$1", [idOf(req.params.id)])).rows[0];
    if (!j) return fail(res, 404, "No such job.");
    const b = req.body || {}, said = [];
    if (b.commit_date != null) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.commit_date))) return fail(res, 400, "The commit date is a day, like 2026-11-20.");
      if (!String(b.reason || "").trim()) return fail(res, 400, "Say why the commit date moves: the customer will hear about it.");
      await db("UPDATE jobs SET commit_date=$2 WHERE id=$1", [j.id, b.commit_date]);
      said.push(`Commit date ${asDate(j.commit_date)} to ${b.commit_date}: ${String(b.reason).trim().slice(0, 200)}`);
    }
    if (b.hot != null) { await db("UPDATE jobs SET hot=$2 WHERE id=$1", [j.id, Boolean(b.hot)]); said.push(b.hot ? "Marked hot" : "No longer hot"); }
    if (b.qty != null) { const q = Math.round(Number(b.qty)); if (!(q > 0)) return fail(res, 400, "The quantity is more than 0."); await db("UPDATE jobs SET qty=$2 WHERE id=$1", [j.id, q]); said.push(`Quantity ${j.qty} to ${q}`); }
    if (b.hold_owner != null || b.hold_until != null) {
      if (!j.hold) return fail(res, 400, "The job is not held.");
      const until = b.hold_until === "" ? null : /^\d{4}-\d{2}-\d{2}$/.test(String(b.hold_until || "")) ? b.hold_until : asDate(j.hold_until);
      await db("UPDATE jobs SET hold_owner=$2, hold_until=$3 WHERE id=$1", [j.id, b.hold_owner != null ? String(b.hold_owner).trim().slice(0, 60) || null : j.hold_owner, until]);
      said.push(`Hold owner ${b.hold_owner != null ? b.hold_owner || "none" : j.hold_owner || "none"}, expected clear ${until || "not set"}`);
    }
    if (b.status === "cancelled") { await db("UPDATE jobs SET status='cancelled' WHERE id=$1", [j.id]); said.push("Cancelled"); }
    if (!said.length) return fail(res, 400, "Nothing to change.");
    for (const s of said) await note(j.id, null, s, who(req));
    res.json({ ok: true });
  });
  // one place up or down the priority list (hot jobs stay on top whatever their place)
  router.post("/api/jobs/:id/move", requireManager, async (req, res) => {
    const dir = (req.body || {}).dir === "up" ? -1 : 1;
    const list = (await db("SELECT id, priority, job_no FROM jobs WHERE status='released' ORDER BY priority, id")).rows;
    const i = list.findIndex((x) => x.id === idOf(req.params.id));
    if (i < 0) return fail(res, 404, "No such open job.");
    const k = i + dir;
    if (k < 0 || k >= list.length) return res.json({ ok: true, moved: false });
    [list[i], list[k]] = [list[k], list[i]];
    for (const [n, x] of list.entries()) await db("UPDATE jobs SET priority=$2 WHERE id=$1", [x.id, (n + 1) * 10]);
    await note(idOf(req.params.id), null, `Moved ${dir < 0 ? "up" : "down"} the priority list, past ${list[i].job_no}`, who(req));
    res.json({ ok: true, moved: true });
  });
  // moving the locked dates is a decision, on the record with its reason; the plan alone never moves them
  router.post("/api/jobs/:id/relock", requireManager, async (req, res) => {
    const reason = String((req.body || {}).reason || "").trim().slice(0, 200);
    if (reason.length < 3) return fail(res, 400, "Say why the dates move.");
    const j = (await db("SELECT * FROM jobs WHERE id=$1 AND status='released'", [idOf(req.params.id)])).rows[0];
    if (!j) return fail(res, 404, "No such open job.");
    const before = asDate(j.locked_finish);
    await lockDates(j.id, todayOf(req), { all: true });
    const after = asDate((await db("SELECT locked_finish FROM jobs WHERE id=$1", [j.id])).rows[0].locked_finish);
    await note(j.id, null, `Dates locked again (finish ${before || "none"} to ${after}): ${reason}`, who(req));
    res.json({ ok: true, locked_finish: after });
  });
  router.post("/api/ops/:id/undo", requireManager, async (req, res) => {
    const o = await opRow(req.params.id);
    if (!o) return fail(res, 404, "No such operation.");
    if (o.status === "waiting") return fail(res, 409, "It has not started.");
    const later = (await db("SELECT 1 FROM ops WHERE job_id=$1 AND seq>$2 AND status<>'waiting' LIMIT 1", [o.job_id, o.seq])).rows[0];
    if (later) return fail(res, 409, "A later operation has started; undo that one first.");
    if (o.status === "done") {
      await db("UPDATE ops SET status='running', done_at=NULL, done_by=NULL WHERE id=$1", [o.id]);
      await db("UPDATE jobs SET status='released', shipped_at=NULL WHERE id=$1 AND status='shipped'", [o.job_id]);
    } else await db("UPDATE ops SET status='waiting', started_at=NULL WHERE id=$1", [o.id]);
    await note(o.job_id, o.id, `Undid ${o.status === "done" ? "the finish" : "the start"} of operation ${o.seq}`, who(req));
    res.json({ ok: true });
  });

  // ---- the manager: work centers, settings, the example -------------------------------------------------------
  router.post("/api/centers", requireManager, async (req, res) => {
    const b = req.body || {};
    const name = String(b.name || "").trim().slice(0, 60);
    if (name.length < 2) return fail(res, 400, "Give the work center a name.");
    const kind = b.kind === "outside" ? "outside" : "machine";
    const hours = kind === "outside" ? 0 : Number(b.hours_per_day);
    if (kind !== "outside" && !(hours >= 0 && hours <= 24 * 6)) return fail(res, 400, "Hours a day: 0 to 144 (several machines or shifts add up).");
    const days = kind === "outside" ? Math.round(Number(b.outside_days)) : 0;
    if (kind === "outside" && !(days >= 0 && days <= 365)) return fail(res, 400, "Days out: 0 to 365.");
    if (b.id) {
      const r = await db("UPDATE centers SET name=$2, kind=$3, hours_per_day=$4, outside_days=$5 WHERE id=$1 AND active RETURNING id", [idOf(b.id), name, kind, hours, days]);
      if (!r.rows[0]) return fail(res, 404, "No such work center.");
      return res.json({ ok: true, id: r.rows[0].id });
    }
    if ((await db("SELECT 1 FROM centers WHERE active AND lower(name)=lower($1)", [name])).rows[0]) return fail(res, 409, `There is already a work center called ${name}.`);
    const sort = Number((await db("SELECT COALESCE(MAX(sort),0)+10 AS s FROM centers")).rows[0].s);
    const r = await db("INSERT INTO centers (name, kind, hours_per_day, outside_days, sort) VALUES ($1,$2,$3,$4,$5) RETURNING id", [name, kind, hours, days, sort]);
    res.json({ ok: true, id: r.rows[0].id });
  });
  router.post("/api/centers/:id/retire", requireManager, async (req, res) => {
    const busy = (await db("SELECT count(*)::int AS n FROM ops o JOIN jobs j ON j.id=o.job_id WHERE o.center_id=$1 AND o.status<>'done' AND j.status='released'", [idOf(req.params.id)])).rows[0].n;
    if (busy) return fail(res, 409, `${busy} open operation${busy === 1 ? " is" : "s are"} still routed here. Finish or move them first.`);
    await db("UPDATE centers SET active=false WHERE id=$1", [idOf(req.params.id)]);
    res.json({ ok: true });
  });
  router.post("/api/settings", requireManager, async (req, res) => {
    const d = Math.round(Number((req.body || {}).ship_days));
    if (!(d >= 0 && d <= 30)) return fail(res, 400, "Days from the shipping door to the customer's dock: 0 to 30.");
    await db("INSERT INTO settings (key, value) VALUES ('ship_days',$1) ON CONFLICT (key) DO UPDATE SET value=$1", [String(d)]);
    res.json({ ok: true });
  });
  router.post("/api/example/clear", requireManager, async (req, res) => {
    const jobs = (await db("SELECT id FROM jobs WHERE example")).rows.map((r) => r.id);
    if (jobs.length) {
      await db("DELETE FROM log WHERE job_id = ANY($1::int[])", [jobs]);
      await db("DELETE FROM ops WHERE job_id = ANY($1::int[])", [jobs]);
      await db("DELETE FROM jobs WHERE id = ANY($1::int[])", [jobs]);
    }
    if ((req.body || {}).centers) {
      const used = (await db("SELECT DISTINCT center_id FROM ops")).rows.map((r) => r.center_id);
      await db("UPDATE centers SET active=false WHERE example AND NOT (id = ANY($1::int[]))", [used]);
    }
    await db("INSERT INTO settings (key, value) VALUES ('seeded','cleared') ON CONFLICT (key) DO UPDATE SET value='cleared'");
    res.json({ ok: true, removed: jobs.length });
  });
  router.post("/api/example/load", requireManager, async (req, res) => {
    if ((await db("SELECT 1 FROM jobs WHERE example LIMIT 1")).rows[0]) return fail(res, 409, "The example is already in.");
    await db("UPDATE centers SET active=true WHERE example");
    await loadExample(todayOf(req));
    res.json({ ok: true });
  });

  router.plan = plan;   // for the reference tests
  return router;
};
