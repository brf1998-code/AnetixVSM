// End to end for a company's safeguards (src/safeguards.js) and the upload scanner (src/scan.js), 2026-10-08.
// The scanner: every way a file comes in (a photo with a request, an attachment to a new tool's questions, a
// spreadsheet for a tool) is scanned before it is kept; a flagged file is refused, on the record and alerted; a
// scanner that is away keeps files unscanned for most companies and refuses them for one whose uploads must be
// scanned; the look-behind scans what was left, scans again what is old, and removes a stored file a later scan
// flags. The switches: the mic, label previews, the plant's network for the shared sign-ins (the same answer
// whether the password was right or wrong, a device back on the wifi is still signed in, a named account and the
// platform's own checks pass), and taking a shared manager password away.
// Against a server ALREADY UP in fake-agent mode on a fresh database (run-all.sh has the line). This script plays the
// scanner on SOS_SCAN_PORT and, on one more port, ntfy and the public label renderer.
//   node scripts/e2e/safeguards.js noscanner   against a server started with NO scanner (SOS_SCAN_HOST unset): files are
//                                              kept unscanned as before, and refused for a company whose uploads must be scanned
const http = require("http");
const { runner, login, PW, sleep, waitFor, ship } = require("./lib");
const { q } = require("../../src/db");
const totp = require("../../src/totp");
const fakeClamd = require("./fake-clamd");
const R = runner(), t = R.t;
const BASE = process.env.SOS_E2E_BASE || "http://127.0.0.1:3999";
const SCAN_PORT = Number(process.env.SOS_SCAN_PORT || 4666);
const STUB_PORT = Number(new URL(process.env.NTFY_URL || "http://127.0.0.1:4667").port);
const PAGE = "/c/demo/m/paperline/";
const INSIDE = "203.0.113.9", OUTSIDE = "198.51.100.9";
const b64 = (s) => Buffer.from(s).toString("base64");

// a client that keeps every cookie and says which address it comes from (X-Real-IP is what the edge hands the product,
// src/edge.js); at: null sends none, which is how the platform's own calls over loopback look
function clientAt(at) {
  const jar = new Map();
  const c = { at };
  const call = async (method, path, body) => {
    const res = await fetch(BASE + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), ...(c.at ? { "X-Real-IP": c.at } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const ck of res.headers.getSetCookie ? res.headers.getSetCookie() : []) { const [kv] = ck.split(";"); const i = kv.indexOf("="); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v) jar.set(k, v); else jar.delete(k); }
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch (e) {}
    return { status: res.status, json, text, headers: res.headers };
  };
  c.get = (p) => call("GET", p); c.post = (p, body) => call("POST", p, body || {});
  return c;
}
async function codeFor(secretText) {
  const into = (Date.now() / 1000) % 30;
  if (into > 27.5) await sleep((30 - into) * 1000 + 300);
  return totp.hotp(totp.base32Decode(secretText), totp.stepAt());
}
// a manager account with an authenticator, made the way an admin makes one: invite, the link, a password, the code
async function namedManager(admin, slug, name, email, at) {
  const inv = await admin.post(`/api/c/${slug}/managers/invite`, { name, email });
  if (inv.status !== 200) throw new Error(`invite failed: ${inv.text}`);
  const c = clientAt(at || null);
  const joined = await c.post("/join", { t: new URL(inv.json.link, BASE).searchParams.get("t"), password: "brass-gear-4471-chime" });
  if (joined.status !== 200) throw new Error(`join failed: ${joined.text}`);
  const es = await c.post(`/api/c/${slug}/me/enroll/start`, {});
  const ev = await c.post(`/api/c/${slug}/me/enroll/verify`, { code: await codeFor(es.json.secret.replace(/\s/g, "")) });
  if (ev.status !== 200) throw new Error(`enroll failed: ${ev.text}`);
  return c;
}

(async () => {
  if (process.argv[2] === "noscanner") {
    const admin = await login(PW.admin, ""), mgr = await login(PW.manager, "demo"), floor = await login(PW.floor, "demo");
    const send = async (msg) => (await floor.post("/api/feedback", { company: "demo", module: "paperline", page: PAGE, message: msg, photo: { mime: "image/jpeg", data: b64("\xff\xd8\xff\xe0 a picture ".repeat(8)) } })).json;
    const rows = async (id) => (await q("SELECT scan, scanned_at FROM platform.attachments WHERE feedback_id=$1", [id])).rows;
    const st = (await admin.get("/api/admin/scan")).json;
    t("with no scanner on the instance the card says so, and nothing else changes", st.configured === false && st.reachable === false && st.host === null && st.companies_requiring === 0, st);
    t("the look-behind has nothing to run on", /no scanner/.test((await admin.post("/api/admin/scan/sweep", {})).json.sweep.skipped || ""));
    const f1 = await send("the label is too small");
    t("a photo is kept as it always was, marked unscanned", f1.photo_note === null && (await rows(f1.id))[0].scan === "unscanned" && (await rows(f1.id))[0].scanned_at === null, f1.photo_note);
    const it = (await mgr.post("/api/c/demo/intakes", {})).json;
    t("so is an attachment, and a spreadsheet is read", (await mgr.post(`/api/intakes/${it.id}/attach`, { question_id: "files", filename: "a.csv", mime: "text/csv", data: b64("a,b\n1,2\n") })).status === 200 && (await mgr.post("/api/c/demo/connections/paperline/stock/upload", { filename: "stock.csv", mime: "text/csv", data: b64("item,location,qty\npaper_white,stockroom,4\n") })).status === 200);
    await admin.post("/api/admin/companies/demo/safeguards", { require_scan: true });
    const f2 = await send("the timer is hard to read");
    const a2 = await mgr.post(`/api/intakes/${it.id}/attach`, { question_id: "files", filename: "b.csv", mime: "text/csv", data: b64("a,b\n1,2\n") });
    const s2 = await mgr.post("/api/c/demo/connections/paperline/stock/upload", { filename: "stock.csv", mime: "text/csv", data: b64("item,location,qty\npaper_white,stockroom,4\n") });
    t("a company whose uploads must be scanned gets every file refused, never kept unscanned, and the request's words still go", f2.id && /could not be scanned/.test(f2.photo_note || "") && (await rows(f2.id)).length === 0 && a2.status >= 400 && /could not be scanned/.test(a2.json.error) && s2.status === 400 && /could not be scanned/.test(s2.json.error), { f2: f2.photo_note, a2: a2.text, s2: s2.text });
    t("and the card says whose", (await admin.get("/api/admin/scan")).json.companies_requiring === 1);
    return R.done();
  }
  // ---- the stand-ins: the scanner, and one port that is both ntfy and the public label renderer
  const fake = await fakeClamd.start(SCAN_PORT);
  const alerts = [], labels = [];
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  const stub = http.createServer((req, res) => {
    let body = ""; req.on("data", (d) => { body += d; });
    req.on("end", () => {
      if (req.url.startsWith("/labelary")) { labels.push(body); res.writeHead(200, { "Content-Type": "image/png" }); return res.end(PNG); }
      try { alerts.push(JSON.parse(body)); } catch (e) {}
      res.writeHead(200, { "Content-Type": "application/json" }); res.end("{}");
    });
  });
  await new Promise((r) => stub.listen(STUB_PORT, "127.0.0.1", r));
  const alertWith = (re) => alerts.filter((a) => re.test(a.title));
  const waitAlert = (re, n = 1) => waitFor(`an alert like ${re}`, async () => alertWith(re).length >= n, 8000).catch(() => false);

  const admin = await login(PW.admin, ""), mgr = await login(PW.manager, "demo"), floor = await login(PW.floor, "demo");
  const overview = async (slug) => (await admin.get("/api/admin/overview")).json.companies.find((c) => c.slug === slug);
  const recordOf = async (company, kind) => (await q("SELECT * FROM platform.record WHERE company=$1 AND kind=$2 ORDER BY id", [company, kind])).rows;
  const photoRows = async (fbId) => (await q("SELECT id, scan, scanned_at, scan_sig, filename FROM platform.attachments WHERE feedback_id=$1", [fbId])).rows;
  const file = async (who, msg, bytes) => (await who.post("/api/feedback", { company: "demo", module: "paperline", page: PAGE, message: msg, ...(bytes ? { photo: { mime: "image/jpeg", data: b64(bytes) } } : {}) })).json;
  const JPEG = "\xff\xd8\xff\xe0 a picture of the scrap bin, as far as this test goes ".repeat(4);

  // ---- nothing is switched for a company until it is switched for that company
  const made = await admin.post("/api/admin/companies", { slug: "forgeco", name: "Forge Co" });
  t("setup: a second company, made by hand with its own passwords", made.status === 200 && made.json.passwords.floor && made.json.passwords.manager);
  const d0 = await overview("demo");
  t("by default the mic and label previews are on, uploads need no scan, and the shared sign-ins work from anywhere", d0.allow_talk === true && d0.allow_label_preview === true && d0.require_scan === false && Array.isArray(d0.access.networks) && d0.access.networks.length === 0, { allow_talk: d0.allow_talk, access: d0.access });
  t("the floor's page is told talking is on", (await floor.get("/api/c/demo/who")).json.talk === true);
  t("only Anetix sets them: a manager and the floor are refused, and cannot read them", (await mgr.post("/api/admin/companies/demo/safeguards", { talk: false })).status === 403 && (await floor.post("/api/admin/companies/demo/safeguards", { talk: false })).status === 403 && (await mgr.get("/api/admin/companies/demo/safeguards")).status === 403 && (await mgr.get("/api/admin/scan")).status === 403);
  t("a company that does not exist is not one", (await admin.get("/api/admin/companies/nope-co/safeguards")).status === 404 && (await admin.post("/api/admin/companies/nope-co/safeguards", { talk: false })).status === 404);

  // ---- the scanner answers
  const sw0 = await admin.post("/api/admin/scan/sweep", {});
  const st0 = (await admin.get("/api/admin/scan")).json;
  t("the Instance tab's card: the scanner answers, with its engine and the day of its signatures", sw0.status === 200 && st0.configured && st0.reachable && st0.engine === "1.4.3" && st0.signatures === 27784 && st0.stale === false && st0.host === "127.0.0.1", st0);

  // a photo with a request
  const before = fake.scans;
  const f1 = await file(floor, "the scrap bin label is too small to read", JPEG);
  const r1 = await photoRows(f1.id);
  t("a photo is scanned before it is kept, and marked clean with the signature set that said so", f1.photo_note === null && r1.length === 1 && r1[0].scan === "clean" && r1[0].scanned_at && /^27784 of \d{4}-\d\d-\d\d$/.test(r1[0].scan_sig) && fake.scans === before + 1, { note: f1.photo_note, r1 });
  const f2 = await file(floor, "the jam warning is hard to see", `${JPEG}${fakeClamd.MARK}`);
  const r2 = await photoRows(f2.id);
  t("a flagged photo is refused in plain words, and the words of the request still go", f2.id && /malware scan flagged/.test(f2.photo_note || "") && /words went through/.test(f2.photo_note || "") && r2.length === 0 && !/clam|Test\.Mark/i.test(f2.photo_note), f2.photo_note);
  const rec2 = await recordOf("demo", "file_refused_by_scan");
  t("it is on the company's record, tied to the request, with the signature", rec2.length === 1 && rec2[0].feedback_id === f2.id && rec2[0].actor_role === "platform" && rec2[0].detail.signature === "Test.Mark-1" && rec2[0].detail.what === "photo", rec2[0]);
  t("and in the event log", (await q("SELECT detail FROM platform.events WHERE kind='scan_refused' AND ref='demo'")).rows.length === 1);
  t("Anetix's phones are told: the company and the kind of file, never the file's name", (await waitAlert(/Malware scan refused a file/)) && (() => { const a = alertWith(/Malware scan refused a file/)[0]; return /Demo Company/.test(a.message) && /photo/.test(a.message) && !/request-\d+\.jpg/.test(a.message); })(), alerts);

  // an attachment to a new tool's questions
  const it = (await mgr.post("/api/c/demo/intakes", {})).json;
  const a1 = await mgr.post(`/api/intakes/${it.id}/attach`, { question_id: "files", filename: "tools.csv", mime: "text/csv", data: b64("name,shelf\ncaliper,A1\n") });
  const a2 = await mgr.post(`/api/intakes/${it.id}/attach`, { question_id: "files", filename: "drawing.pdf", mime: "application/pdf", data: b64(`%PDF-1.4 ${fakeClamd.MARK}`) });
  const arows = (await q("SELECT filename, scan FROM platform.attachments WHERE intake_id=$1 ORDER BY id", [it.id])).rows;
  t("an attachment is scanned and kept clean; a flagged one is refused and never stored", a1.status === 200 && a2.status >= 400 && /malware scan flagged/.test(a2.json.error) && arows.length === 1 && arows[0].filename === "tools.csv" && arows[0].scan === "clean", { a1: a1.status, a2: a2.text, arows });
  const a3 = await mgr.post(`/api/intakes/${it.id}/attach`, { question_id: "files", filename: "test.txt", mime: "text/plain", data: b64(fakeClamd.EICAR) });
  t("the industry's own test file is refused the same way", a3.status >= 400 && /malware scan flagged/.test(a3.json.error) && (await recordOf("demo", "file_refused_by_scan")).some((r) => /Eicar/.test(r.detail.signature) && r.intake_id === it.id));

  // a spreadsheet for a tool's table
  const ups = async () => (await q("SELECT count(*)::int AS n FROM platform.connection_uploads WHERE company='demo'")).rows[0].n;
  const u0 = await ups();
  const s1 = await mgr.post("/api/c/demo/connections/paperline/stock/upload", { filename: "stock.csv", mime: "text/csv", data: b64("item,location,qty\npaper_white,stockroom,4\n") });
  const s2 = await mgr.post("/api/c/demo/connections/paperline/stock/upload", { filename: "stock.csv", mime: "text/csv", data: b64(`item,location,qty\n${fakeClamd.MARK},stockroom,4\n`) });
  t("a spreadsheet is scanned before it is read; a flagged one is refused and none of it is kept", s1.status === 200 && s1.json.upload_id && s2.status === 400 && /malware scan flagged/.test(s2.json.error) && (await ups()) === u0 + 1, { s1: s1.status, s2: s2.text });

  // ---- the scanner goes away
  fake.down = true;
  const f3 = await file(floor, "the counter resets when the page reloads", JPEG);
  const r3 = await photoRows(f3.id);
  t("with the scanner away a photo is kept and marked unscanned (this company's uploads need no scan)", f3.photo_note === null && r3.length === 1 && r3[0].scan === "unscanned" && r3[0].scanned_at === null, { note: f3.photo_note, r3 });
  t("Anetix's phones are told the scanner is not answering", await waitAlert(/upload scanner is not answering/));
  const stDown = (await admin.get("/api/admin/scan")).json;
  t("the card says not answering, since when, and counts the file not scanned yet", stDown.reachable === false && stDown.down_since && stDown.files.unscanned === 1, stDown);
  const swDown = (await admin.post("/api/admin/scan/sweep", {})).json;
  t("the look-behind does nothing while it is away", swDown.sweep && /not answering/.test(swDown.sweep.skipped || ""), swDown.sweep);

  // a company whose uploads must be scanned
  const rs = await admin.post("/api/admin/companies/demo/safeguards", { require_scan: true });
  t("Anetix switches 'uploads must be scanned' on for one company, on its record", rs.status === 200 && rs.json.require_scan === true && (await overview("demo")).require_scan === true && (await overview("forgeco")).require_scan === false && (await recordOf("demo", "safeguards_changed")).length === 1);
  const f4 = await file(floor, "the tally sheet needs a date", JPEG);
  t("now a photo that cannot be scanned is refused, with words that say to try again", f4.id && /could not be scanned for malware just now/.test(f4.photo_note || "") && /words went through/.test(f4.photo_note) && (await photoRows(f4.id)).length === 0, f4.photo_note);
  const a4 = await mgr.post(`/api/intakes/${it.id}/attach`, { question_id: "files", filename: "more.csv", mime: "text/csv", data: b64("a,b\n1,2\n") });
  const s4 = await mgr.post("/api/c/demo/connections/paperline/stock/upload", { filename: "stock.csv", mime: "text/csv", data: b64("item,location,qty\npaper_white,stockroom,4\n") });
  t("so are an attachment and a spreadsheet", a4.status >= 400 && /could not be scanned/.test(a4.json.error) && s4.status === 400 && /could not be scanned/.test(s4.json.error), { a4: a4.text, s4: s4.text });
  t("the card says whose uploads are being refused", (await admin.get("/api/admin/scan")).json.companies_requiring === 1);

  // ---- and comes back
  fake.down = false;
  const f5 = await file(floor, "the station two button is too close to the edge", JPEG);
  t("back again: a photo is scanned and kept, and the card says answering without waiting", (await photoRows(f5.id))[0].scan === "clean" && (await admin.get("/api/admin/scan")).json.reachable === true);
  const swUp = (await admin.post("/api/admin/scan/sweep", {})).json;
  t("the look-behind scans the file that was kept unscanned", swUp.sweep.scanned === 1 && swUp.sweep.clean === 1 && (await photoRows(f3.id))[0].scan === "clean" && swUp.files.unscanned === 0, swUp.sweep);
  t("and has nothing more to do right after", (await admin.post("/api/admin/scan/sweep", {})).json.sweep.scanned === 0);

  // a file from before there was a scanner, a file whose scan is old, and a stored file a later scan flags
  await q("INSERT INTO platform.attachments (company, intake_id, filename, mime, size, bytes) VALUES ('demo',$1,'old.csv','text/csv',4,$2)", [it.id, Buffer.from("a,b\n")]);
  const f6 = await file(floor, "the scrap count should show per shift", `${JPEG} tomorrow-this-is-known-bad`);
  await q("UPDATE platform.attachments SET scanned_at = now() - interval '8 days' WHERE feedback_id = ANY($1::int[])", [[f1.id, f6.id]]);
  fake.marks.push("tomorrow-this-is-known-bad");   // today's signatures know something last week's did not
  const swOld = (await admin.post("/api/admin/scan/sweep", {})).json;
  t("the look-behind scans a file stored before there was a scanner, and again the ones whose scan is a week old", swOld.sweep.scanned === 3 && swOld.sweep.clean === 2 && (await q("SELECT scan FROM platform.attachments WHERE filename='old.csv'")).rows[0].scan === "clean", swOld.sweep);
  const rem = await recordOf("demo", "file_removed_by_scan");
  t("a stored file that today's scan flags is removed, on the record, and the request it came with stays", swOld.sweep.removed === 1 && (await photoRows(f6.id)).length === 0 && (await photoRows(f1.id)).length === 1 && rem.length === 1 && rem[0].feedback_id === f6.id && (await q("SELECT id FROM platform.feedback WHERE id=$1", [f6.id])).rows.length === 1, { sweep: swOld.sweep, rem });
  t("Anetix's phones are told a stored file was removed", await waitAlert(/Malware scan removed a stored file/));
  t("the card remembers the last file flagged", (() => { const l = swOld.last_flag; return l && l.company === "demo" && l.stored === true; })(), swOld.last_flag);
  // a file the scanner will not take (it gives up on that one file) must not hold up everything behind it
  await q("INSERT INTO platform.attachments (company, intake_id, filename, mime, size, bytes) VALUES ('demo',$1,'stubborn.pdf','application/pdf',20,$2), ('demo',$1,'behind-it.csv','text/csv',4,$3)", [it.id, Buffer.from("%PDF this-one-chokes-it"), Buffer.from("a,b\n")]);
  fake.wontTake.push("this-one-chokes-it");
  const swStuck = (await admin.post("/api/admin/scan/sweep", {})).json;
  const stubborn = (await q("SELECT scan, scanned_at, scan_sig FROM platform.attachments WHERE filename='stubborn.pdf'")).rows[0];
  t("a file the scanner gives up on is marked as tried, with why, and the file behind it is still scanned", swStuck.sweep.scanned === 2 && swStuck.sweep.clean === 1 && swStuck.sweep.left === 1 && swStuck.sweep.removed === 0 && stubborn.scan === "unscanned" && stubborn.scanned_at && /not taken by the scanner/.test(stubborn.scan_sig) && (await q("SELECT scan FROM platform.attachments WHERE filename='behind-it.csv'")).rows[0].scan === "clean", { sweep: swStuck.sweep, stubborn });
  t("the scanner is not called away for it, and it is not sent again every round (tomorrow)", swStuck.reachable === true && (await admin.post("/api/admin/scan/sweep", {})).json.sweep.scanned === 0 && alertWith(/upload scanner is not answering/).length === 1 && swStuck.files.not_taken === 1, { reachable: swStuck.reachable, files: swStuck.files });
  await q("UPDATE platform.attachments SET scanned_at = now() - interval '25 hours' WHERE filename='stubborn.pdf'");
  fake.wontTake.length = 0;
  t("a day later it is tried again, and taken", (await admin.post("/api/admin/scan/sweep", {})).json.sweep.clean === 1 && (await q("SELECT scan FROM platform.attachments WHERE filename='stubborn.pdf'")).rows[0].scan === "clean");
  fake.signaturesAt = new Date(Date.now() - 5 * 86400e3);
  const swStale = (await admin.post("/api/admin/scan/sweep", {})).json;
  t("signatures five days old are called old, on the card and on the phones", swStale.stale === true && (await waitAlert(/signatures are old/)), { stale: swStale.stale, signatures_at: swStale.signatures_at });
  fake.signaturesAt = new Date();
  await admin.post("/api/admin/companies/demo/safeguards", { require_scan: false });

  // ---- the mic
  const hdr = async (c, p) => (await c.get(p)).headers.get("permissions-policy");
  t("with talking on, a company's pages leave the microphone to this site, as a browser assumes anyway", (await hdr(floor, "/c/demo/")) === "microphone=(self)" && (await hdr(floor, PAGE)) === "microphone=(self)" && (await hdr(admin, "/admin")) === null);
  const tk = await admin.post("/api/admin/companies/demo/safeguards", { talk: false });
  t("Anetix switches talking off for one company", tk.status === 200 && tk.json.talk === false && (await overview("demo")).allow_talk === false && (await overview("forgeco")).allow_talk === true);
  t("its pages are told at once: no mic button, and the browser is told the microphone is not for them", (await floor.get("/api/c/demo/who")).json.talk === false && (await hdr(floor, "/c/demo/")) === "microphone=()" && (await hdr(floor, PAGE)) === "microphone=()" && (await hdr(mgr, "/c/demo/settings")) === "microphone=()");
  const forgeFloor = await login(made.json.passwords.floor, "forgeco");
  t("another company's pages are as they were", (await forgeFloor.get("/api/c/forgeco/who")).json.talk === true && (await hdr(forgeFloor, "/c/forgeco/")) === "microphone=(self)");
  await admin.post("/api/admin/companies/demo/safeguards", { talk: true });
  t("and back on, said in so many words (a page a browser already holds keeps the last header it was given)", (await floor.get("/api/c/demo/who")).json.talk === true && (await hdr(floor, "/c/demo/")) === "microphone=(self)");
  t("the script that listens asks first and takes no for an answer that never comes", await (async () => { const js = await (await fetch(`${BASE}/assets/dictate.js`)).text(); return /\/who/.test(js) && /allowed === false/.test(js) && /\.catch\(\(\) => false\)/.test(js); })());

  // ---- label previews (the function a tool's preview goes through, in this process, against the stand-in renderer)
  const connections = require("../../src/connections"), sg = require("../../src/safeguards");
  const ZPL = "^XA^FO50,50^FDPO 4471 lot 9^FS^XZ";
  const p1 = await connections.previewPng(ZPL, {}, "demo");
  t("with previews on, a label's contents go to the renderer and a picture comes back", Buffer.isBuffer(p1) && labels.length === 1 && labels[0].includes("PO 4471"), { labels: labels.length });
  const lp = await admin.post("/api/admin/companies/demo/safeguards", { label_preview: false });
  sg._forget("demo");
  const p2 = await connections.previewPng("^XA^FO50,50^FDPO 4472 lot 10^FS^XZ", {}, "demo");
  t("switched off, nothing is sent and the tool gets no picture (it shows the label's text)", lp.status === 200 && lp.json.label_preview === false && p2 === null && labels.length === 1);
  const p3 = await connections.previewPng("^XA^FO50,50^FDPO 4473^FS^XZ", {}, "forgeco");
  t("another company's previews are as they were", Buffer.isBuffer(p3) && labels.length === 2);
  t("the three switches are on the record, each change its own row", (await recordOf("demo", "safeguards_changed")).length === 5 && (await recordOf("forgeco", "safeguards_changed")).length === 0, (await recordOf("demo", "safeguards_changed")).map((r) => r.detail.changed));

  // ---- the plant's network
  const bad1 = await admin.post("/api/admin/companies/demo/safeguards", { networks: "the plant wifi" });
  const bad2 = await admin.post("/api/admin/companies/demo/safeguards", { networks: "0.0.0.0/0" });
  t("a list that is not addresses is refused in words, and so is 'everywhere'", bad1.status === 400 && /not an address/.test(bad1.json.error) && bad2.status === 400 && /clear the list/.test(bad2.json.error) && (await overview("demo")).access.networks.length === 0, { bad1: bad1.text, bad2: bad2.text });
  const adminIn = clientAt(INSIDE); await adminIn.post("/login", { password: PW.admin, company: "" });
  const seen = (await adminIn.get("/api/admin/companies/demo/safeguards")).json;
  t("standing in the plant, the admin is shown the address they come from and the network to add", seen.your_address === INSIDE && seen.your_network === `${INSIDE}/32` && seen.your_address_listed === false, seen);
  t("and is told the address is not proven here (no edge check in the tests), though a list may still be set off a hosted instance", seen.address_proven === false && seen.may_hold_to_network === true);
  // sessions from before the list: one in the plant, one that will be outside
  const dev = clientAt(INSIDE); const devIn = await dev.post("/login", { password: PW.floor, company: "demo" });
  const nw = await adminIn.post("/api/admin/companies/demo/safeguards", { networks: "203.0.113.0/24\n2001:db8:ab:cd::/64" });
  t("a tool's own code cannot take the microphone header away or put its own in (it is one of the locked ones)", /permissions-policy/.test(require("fs").readFileSync(require("path").join(__dirname, "../../src/registry.js"), "utf8").match(/const LOCKED_HEADER = (.+);/)[1]));
  t("the list is saved as typed, cleaned, and the admin's own address is on it", nw.status === 200 && JSON.stringify(nw.json.networks) === JSON.stringify(["203.0.113.0/24", "2001:db8:ab:cd::/64"]) && nw.json.your_address_listed === true && (await overview("demo")).access.networks.length === 2, nw.json);
  const out1 = await clientAt(OUTSIDE).post("/login", { password: PW.floor, company: "demo" });
  const out2 = await clientAt(OUTSIDE).post("/login", { password: "not-the-password-at-all", company: "demo" });
  t("outside the plant, the floor's password is refused, and a wrong password gets the very same answer", out1.status === 403 && out1.json.off_network === true && /plant's wifi/.test(out1.json.error) && out2.status === 403 && out2.text === out1.text, { out1: out1.text, out2: out2.text });
  t("so is the shared manager password", (await clientAt(OUTSIDE).post("/login", { password: PW.manager, company: "demo" })).status === 403);
  t("inside the plant both sign in, over v4 and over v6", (await clientAt(INSIDE).post("/login", { password: PW.floor, company: "demo" })).status === 200 && (await clientAt("2001:db8:ab:cd:1:2:3:4").post("/login", { password: PW.manager, company: "demo" })).status === 200 && (await clientAt("2001:db8:ab:ce::1").post("/login", { password: PW.floor, company: "demo" })).status === 403);
  t("a wrong password inside the plant is still just a wrong password", await (async () => { const r = await clientAt(INSIDE).post("/login", { password: "not-the-password-at-all", company: "demo" }); return r.status === 401 && !r.json.off_network; })());
  t("a device signed in at the plant works there", devIn.status === 200 && (await dev.get("/api/c/demo/board")).status === 200);
  dev.at = OUTSIDE;
  const offApi = await dev.get("/api/c/demo/board"), offPage = await dev.get("/c/demo/"), offTool = await dev.get(PAGE), offPost = await dev.post("/api/feedback", { company: "demo", module: "paperline", page: PAGE, message: "sent from the parking lot" });
  t("carried off the wifi it is refused everywhere: a page says why, a call says so in JSON, nothing is filed", offApi.status === 403 && offApi.json.off_network === true && offPage.status === 403 && /not on the plant's network/.test(offPage.text) && /still signed in/.test(offPage.text) && offTool.status === 403 && offPost.status === 403 && (await q("SELECT 1 FROM platform.feedback WHERE message='sent from the parking lot'")).rows.length === 0, { api: offApi.status, page: offPage.status, tool: offTool.status, post: offPost.status });
  dev.at = INSIDE;
  t("back on the wifi it works again without signing in", (await dev.get("/api/c/demo/board")).status === 200 && (await dev.get("/c/demo/")).status === 200);
  const adminOut = clientAt(OUTSIDE);
  t("Anetix signs in and works from anywhere", (await adminOut.post("/login", { password: PW.admin, company: "" })).status === 200 && (await adminOut.get("/api/c/demo/board")).status === 200);
  const named = await namedManager(admin, "demo", "Dana Reyes", "dana@demo.test", OUTSIDE);
  t("a manager with an account of their own and a second factor works from anywhere", (await named.get("/api/c/demo/board")).status === 200 && (await named.get("/c/demo/settings")).status === 200);
  // the platform's own checks of a staged build call it as the company's manager over loopback, with no forwarded
  // address: a change filed in the plant and approved from home still builds, is checked and goes live
  const own = clientAt(null); const ownIn = await own.post("/login", { password: PW.manager, company: "demo" });
  t("the platform's own calls (loopback, no forwarded address) are not held to the list", ownIn.status === 200 && (await own.get("/api/c/demo/board")).status === 200);
  const fb7 = await file(dev, "make the shift timer digits larger");
  const shipped = await ship(named, [fb7.id], "demo").then(() => true, (e) => String(e.message || e));
  t("a change filed in the plant and approved from home builds, passes its checks and goes live with the list on", shipped === true, shipped);
  t("the refusals at sign-in are in the sign-in log, with the address and the company", await (async () => { const rows = (await q("SELECT ip, detail FROM platform.auth_events WHERE event='off_network' ORDER BY id")).rows; return rows.length >= 4 && rows[0].ip === OUTSIDE && rows[0].detail.company === "demo"; })());
  t("the list travels in a backup, with the switches", await (async () => { const bk = (await admin.get("/api/admin/backup")).json; const a = bk.platform.company_access.find((x) => x.company === "demo"), c = bk.platform.companies.find((x) => x.slug === "demo"); return a && a.networks.length === 2 && c.allow_label_preview === false && c.allow_talk === true; })());
  // forgeco's floor signs in with a floor PIN since 2026-10-29, which works only from forgeco's own list (it has none);
  // its shared manager password shows demo's list does not reach it
  t("another company is not held to it", (await clientAt(OUTSIDE).post("/login", { password: made.json.passwords.manager, company: "forgeco" })).status === 200);
  const cleared = await admin.post("/api/admin/companies/demo/safeguards", { networks: "" });
  t("cleared, the shared sign-ins work from anywhere again", cleared.status === 200 && cleared.json.networks.length === 0 && (await clientAt(OUTSIDE).post("/login", { password: PW.floor, company: "demo" })).status === 200 && (dev.at = OUTSIDE) && (await dev.get("/api/c/demo/board")).status === 200);

  // ---- taking a shared manager password away
  const dropDemo = await admin.post("/api/admin/companies/demo/safeguards/drop-manager-password", {});
  t("a company still on the old shared passwords is told to get its own first", dropDemo.status === 409 && /its own floor PIN first/.test(dropDemo.json.error), dropDemo.text);
  t("a company that does not exist is not one", (await admin.post("/api/admin/companies/nope-co/safeguards/drop-manager-password", {})).status === 404);
  const drop0 = await admin.post("/api/admin/companies/forgeco/safeguards/drop-manager-password", {});
  t("it is refused while no manager at the company has an account that works", drop0.status === 409 && /Add a manager first/.test(drop0.json.error), drop0.text);
  t("a manager cannot do it", (await (await login(made.json.passwords.manager, "forgeco")).post("/api/admin/companies/forgeco/safeguards/drop-manager-password", {})).status === 403);
  const forgeNamed = await namedManager(admin, "forgeco", "Lee Okafor", "lee@forgeco.test");
  const forgeShared = await login(made.json.passwords.manager, "forgeco");
  const fv = (await admin.get("/api/admin/companies/forgeco/safeguards")).json;
  t("with one, the card shows a shared manager password beside the account", fv.shared_manager_password === true && fv.manager_accounts === 1 && (await overview("forgeco")).access.own_manager === true);
  const drop1 = await admin.post("/api/admin/companies/forgeco/safeguards/drop-manager-password", {});
  t("Anetix takes the shared manager password away", drop1.status === 200 && drop1.json.shared_manager_password === false && (await overview("forgeco")).access.own_manager === false && (await overview("forgeco")).access.own_floor === true, drop1.json);
  t("it no longer signs anyone in, and whoever was signed in with it is out", await (async () => { const r = await clientAt(null).post("/login", { password: made.json.passwords.manager, company: "forgeco" }); return r.status === 401 && (await forgeShared.get("/api/c/forgeco/board")).status === 401; })());
  t("the floor signs in again with the password it had", (await forgeFloor.get("/api/c/forgeco/board")).status === 401 && (await clientAt(null).post("/login", { password: made.json.passwords.floor, company: "forgeco" })).status === 200);
  t("the manager with an account of their own never noticed", (await forgeNamed.get("/api/c/forgeco/board")).status === 200);
  t("it is on the company's record, and a second time changes nothing", (await recordOf("forgeco", "manager_password_dropped")).length === 1 && (await admin.post("/api/admin/companies/forgeco/safeguards/drop-manager-password", {})).json.already === true && (await recordOf("forgeco", "manager_password_dropped")).length === 1);

  await fake.stop(); stub.close();
  R.done();
})().catch(R.abort);
