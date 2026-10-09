// Unit cases for src/scan.js: what the scanner's answers mean, and the protocol itself against a stand-in scanner on a
// local port (scripts/e2e/fake-clamd.js). No database.
//   node scripts/test-scan.js
const path = require("path");
const PORT = 4699;
process.env.SOS_SCAN_HOST = "127.0.0.1"; process.env.SOS_SCAN_PORT = String(PORT); process.env.SOS_SCAN_TIMEOUT_MS = "1500";
const scan = require("../src/scan");
const { start, EICAR, MARK } = require("./e2e/fake-clamd");
let pass = 0, fail = 0;
function t(name, cond, detail) { if (cond) { pass++; } else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""}`); } }

(async () => {
  // ---- what one line means (pure)
  t("OK is clean", scan.readVerdict("stream: OK").verdict === "clean" && scan.readVerdict(" stream: OK \n").verdict === "clean");
  t("FOUND is flagged, with the signature's name", (() => { const r = scan.readVerdict("stream: Win.Test.EICAR_HDB-1 FOUND"); return r.verdict === "infected" && r.signature === "Win.Test.EICAR_HDB-1"; })());
  t("anything else is an error, never clean", ["INSTREAM size limit exceeded. ERROR", "", null, "stream: OK FOUND?", "OK", "stream: ok"].every((x) => scan.readVerdict(x).verdict === "error") && /size limit/.test(scan.readVerdict("INSTREAM size limit exceeded. ERROR").reason));
  t("a file past the scanner's own limits is an error, never a flag (the look-behind removes what is flagged)", scan.readVerdict("stream: Heuristics.Limits.Exceeded.MaxFileSize FOUND").verdict === "error" && scan.readVerdict("stream: Heuristics.Limits.Exceeded FOUND").verdict === "error" && scan.readVerdict("stream: Heuristics.Phishing.Email.SpoofedDomain FOUND").verdict === "infected" && scan.readVerdict("stream: Can't allocate memory ERROR").verdict === "error");
  const v = scan.readVersion("ClamAV 1.4.3/27784/Tue Oct  7 09:27:45 2026");
  t("the version line gives the engine, the signature set and its day", v && v.engine === "1.4.3" && v.signatures === 27784 && v.signatures_at === "2026-10-07T09:27:45.000Z", v);
  t("a line that is not a version is nothing", scan.readVersion("PONG") === null && scan.readVersion("") === null && scan.readVersion(null) === null);
  const bare = scan.readVersion("ClamAV 1.5.4");
  t("a scanner that names no signature set is there, and that is a fault", bare && bare.engine === "1.5.4" && bare.signatures === null && bare.signatures_at === null && scan.stale(bare, Date.now()) === true && /no signature set/.test(scan.sigLabel(bare)), bare);
  t("a signature set is named by its number and its day", scan.sigLabel(v) === "27784 of 2026-10-07" && scan.sigLabel(null) === null);
  const now = Date.parse("2026-10-08T12:00:00Z");
  t("signatures are old past three days, not before", scan.stale({ signatures_at: "2026-10-04T11:00:00.000Z" }, now) === true && scan.stale({ signatures_at: "2026-10-06T12:00:00.000Z" }, now) === false && scan.stale(null, now) === false);

  // ---- the protocol, against the stand-in
  const fake = await start(PORT);
  t("a scanner is configured", scan.configured());
  const clean = await scan.scanBuffer(Buffer.from("an ordinary spreadsheet,1,2\n"));
  t("an ordinary file is clean", clean.verdict === "clean" && fake.scans === 1 && fake.last.bytes === 28, { clean, last: fake.last });
  const flagged = await scan.scanBuffer(Buffer.from(`part,qty\n${MARK},4\n`));
  t("a file carrying the mark is flagged", flagged.verdict === "infected" && flagged.signature === "Test.Mark-1", flagged);
  const eicar = await scan.scanBuffer(Buffer.from(EICAR));
  t("the industry's test file is flagged", eicar.verdict === "infected" && /Eicar/.test(eicar.signature), eicar);
  // a file larger than one chunk arrives whole, in order, with the mark at its very end
  const big = Buffer.concat([Buffer.alloc(700 * 1024, 0x61), Buffer.from(MARK)]);
  const bigClean = await scan.scanBuffer(Buffer.alloc(700 * 1024, 0x61));
  const bigHit = await scan.scanBuffer(big);
  t("a file of several chunks arrives whole and in order", bigClean.verdict === "clean" && bigHit.verdict === "infected" && fake.last.bytes === big.length, { bigClean, bigHit, last: fake.last });
  t("an empty file is scanned too", (await scan.scanBuffer(Buffer.alloc(0))).verdict === "clean");
  const h = await scan.health(true);
  t("the scanner says who it is", h.configured && h.reachable && h.engine === "1.4.3" && h.signatures === 27784 && h.stale === false && h.error === null, h);
  fake.signaturesAt = new Date(Date.now() - 5 * 86400e3);
  const old = await scan.health(true);
  t("signatures five days old are called old", old.reachable && old.stale === true, old);
  fake.signaturesAt = new Date();

  // ---- a scanner that will not take the file, and one that is not there
  await fake.stop();
  const small = await start(PORT, { limit: 1024 });
  const over = await scan.scanBuffer(Buffer.alloc(300 * 1024, 0x62));
  t("a file over the scanner's limit is an error with the reason, not clean", over.verdict === "error" && /size limit/i.test(over.reason), over);
  small.down = true;
  const hung = await scan.scanBuffer(Buffer.from("x"));
  t("a scanner that hangs up is an error, not clean", hung.verdict === "error", hung);
  await small.stop();
  const gone = await scan.scanBuffer(Buffer.from("x"));
  t("no scanner on the port is an error that says so", gone.verdict === "error" && /could not be reached/.test(gone.reason), gone);
  const hd = await scan.health(true);
  t("and the health says not answering, since when", hd.configured && hd.reachable === false && hd.error && hd.down_since, hd);

  // ---- not configured at all
  delete process.env.SOS_SCAN_HOST;
  t("with no address there is no scanner", !scan.configured() && (await scan.scanBuffer(Buffer.from("x"))).verdict === "error" && (await scan.health(true)).configured === false);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("ABORTED:", e); console.log(`\n${pass} passed, ${fail + 1} failed`); process.exit(1); });
