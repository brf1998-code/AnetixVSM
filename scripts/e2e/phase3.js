// End to end: the launch audit's Phase 3 on the product's side (2026-09-28). Runs against a server that is ALREADY
// UP in fake-agent mode on a FRESH database, with the www key and a Stripe read key pointed at the fake Stripe this
// script runs on 4555:
//
//   SOS_WWW_KEY=e2e-www-key-0123456789abcdef SOS_WWW_URL=https://anetix.test STRIPE_READ_KEY=rk_test_phase3 \
//     STRIPE_API_BASE=http://127.0.0.1:4555 SOS_FAKE_AGENT=1 PORT=3999 node server.js &
//   SOS_WWW_KEY=e2e-www-key-0123456789abcdef node scripts/e2e/phase3.js
//
// What it proves:
//   3.8 (src/tickets.js): a demo made for a browser comes back with one sign-in ticket, kept only as a hash; the ticket
//   opens the enrollment-only session once; used, expired, from before Sign out everywhere, for an account that has a
//   second factor, switched off, or an admin's, it is the sign-in page and no session; each is on the sign-in log.
//   3.7 (src/stripecheck.js): a refill is added only when Stripe itself backs it (paid, a refill, this company, these
//   dollars, this credit, never more credit than dollars); a replay is "already done" without asking Stripe; Stripe
//   out of reach is a 503 and adds nothing; the Sites tab says refills are checked.
const http = require("http");
const crypto = require("crypto");
const { runner, login, PW } = require("./lib");
const { q } = require("../../src/db");
const tickets = require("../../src/tickets");
const R = runner(), t = R.t;
const BASE = process.env.SOS_BASE || `http://127.0.0.1:${process.env.PORT || 3999}`;
const KEY = process.env.SOS_WWW_KEY;
if (!KEY) { console.error("SOS_WWW_KEY must be set in this shell and the server's"); process.exit(2); }

async function www(method, path, body) {
  const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", "X-SOS-WWW-Key": KEY }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch (e) {}
  return { status: res.status, json, text };
}
// a browser that does not follow redirects and keeps cookies
function browser() {
  const jar = new Map();
  const get = async (p) => {
    const res = await fetch(BASE + p, { redirect: "manual", headers: { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } });
    for (const c of res.headers.getSetCookie ? res.headers.getSetCookie() : []) { const [kv] = c.split(";"); const i = kv.indexOf("="); if (kv.slice(i + 1)) jar.set(kv.slice(0, i), kv.slice(i + 1)); else jar.delete(kv.slice(0, i)); }
    return { status: res.status, location: res.headers.get("location"), referrer: res.headers.get("referrer-policy"), cache: res.headers.get("cache-control") };
  };
  return { get, jar };
}
const events = async (ev) => (await q("SELECT * FROM platform.auth_events WHERE event=$1 ORDER BY id", [ev])).rows;

// the fake Stripe the product reads (STRIPE_API_BASE): sessions by id, the restricted key checked
const STRIPE = new Map();
let stripeUp = true;
const fake = http.createServer((req, res) => {
  const m = /^\/v1\/checkout\/sessions\/([^/?]+)/.exec(req.url);
  if (!stripeUp) { req.socket.destroy(); return; }
  if (req.headers.authorization !== "Bearer rk_test_phase3") { res.writeHead(401, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: { message: "Invalid API Key provided" } })); }
  const s = m && STRIPE.get(decodeURIComponent(m[1]));
  res.writeHead(s ? 200 : 404, { "Content-Type": "application/json" });
  res.end(JSON.stringify(s || { error: { message: "No such checkout.session", code: "resource_missing" } }));
});
const session = (over = {}) => {
  const id = `cs_test_${crypto.randomBytes(8).toString("hex")}`;
  const s = { id, object: "checkout.session", mode: "payment", status: "complete", payment_status: "paid", amount_total: 3000, metadata: { kind: "topup", slug: "acme-wire", credit_usd: "10" }, ...over };
  if (over.metadata) s.metadata = { kind: "topup", slug: "acme-wire", credit_usd: "10", ...over.metadata };
  STRIPE.set(id, s); return s;
};

(async () => {
  await new Promise((r) => fake.listen(4555, "127.0.0.1", r));
  const admin = await login(PW.admin);

  // ---- 3.8: the ticket from demo setup ------------------------------------------------------------------------------
  const pin = (await admin.post("/api/admin/pins", { label: "Sam at Acme", email: "sam@acme.test", max_uses: 1, days: 30 })).json.pin.shown;
  const made = await www("POST", "/api/www/companies", { pin, email: "sam@acme.test", name: "Acme Wire", contact: "Sam Jones", ref: `demo:${pin}:acme-wire`, paid_usd: 0, credit_usd: 10, password: "forge-maple-809-long", demo: true, collect: true });
  const TK = made.json && made.json.signin_ticket;
  t("a demo made for a browser comes back with one sign-in ticket", made.status === 200 && made.json.created === true && /^\d{1,9}\.[A-Za-z0-9_-]{43}$/.test(TK || ""), made.json);
  const row = (await q("SELECT * FROM platform.signin_tickets WHERE id=$1", [Number(String(TK).split(".")[0])])).rows[0];
  t("only its hash is kept, with the account's generation and an hour to live", row && row.token_hash === crypto.createHash("sha256").update(String(TK).split(".")[1]).digest("hex") && !JSON.stringify(row).includes(String(TK).split(".")[1]) && Math.abs(new Date(row.expires_at) - Date.now() - 3600e3) < 120e3, row);
  const again = await www("POST", "/api/www/companies", { pin, email: "sam@acme.test", name: "Acme Wire", contact: "Sam Jones", ref: `demo:${pin}:acme-wire`, paid_usd: 0, credit_usd: 10, password: "forge-maple-809-long", demo: true, collect: true });
  t("the same form again makes no second ticket", !(again.json && again.json.signin_ticket), again.json);
  const noCollect = await www("GET", "/api/www/companies/acme-wire");
  t("and the company's own answer never carries one", noCollect.status === 200 && !/signin_ticket|ticket/.test(noCollect.text));

  const b = browser();
  const r1 = await b.get(`/login/ticket?t=${encodeURIComponent(TK)}`);
  t("the ticket signs the browser in and opens the authenticator setup, no Referer on, never cached", r1.status === 303 && r1.location === "/c/acme-wire/enroll" && b.jar.size > 0 && r1.referrer === "no-referrer" && /no-store/.test(r1.cache || ""), r1);
  t("the session is the enrollment-only one", (await b.get("/c/acme-wire/enroll")).status === 200 && (await b.get("/api/c/acme-wire/board")).status === 403);
  const r2 = await browser().get(`/login/ticket?t=${encodeURIComponent(TK)}`);
  t("twice: the sign-in page with the email filled, no session", r2.status === 303 && r2.location === "/login?account=sam%40acme.test");
  t("both are on the sign-in log: signin_ticket, then ticket_refused used", (await events("signin_ticket")).length === 1 && (await events("ticket_refused")).some((e) => e.detail.why === "used"));
  t("no ticket, or a made-up one, is the sign-in page naming no one", (await browser().get("/login/ticket")).location === "/login" && (await browser().get(`/login/ticket?t=${row.id}.${"A".repeat(43)}`)).location === "/login");

  const acct = (await q("SELECT * FROM platform.accounts WHERE login='sam@acme.test'")).rows[0];
  const refusedFor = async (tk) => { const r = await browser().get(`/login/ticket?t=${encodeURIComponent(tk)}`); return r.status === 303 && r.location === "/login?account=sam%40acme.test" ? ((await events("ticket_refused")).pop() || {}).detail.why : `let in: ${r.location}`; };
  const late = await tickets.mint(acct);
  await q("UPDATE platform.signin_tickets SET expires_at = now() - interval '1 second' WHERE id=$1", [Number(late.split(".")[0])]);
  t("an expired ticket does not open", (await refusedFor(late)) === "expired");
  const before = await tickets.mint(acct);
  await q("UPDATE platform.accounts SET generation = generation + 1 WHERE id=$1", [acct.id]);
  t("one from before Sign out everywhere does not open", (await refusedFor(before)) === "generation");
  const acct2 = (await q("SELECT * FROM platform.accounts WHERE id=$1", [acct.id])).rows[0];
  const enrolledTk = await tickets.mint(acct2);
  await q("INSERT INTO platform.account_factors (account_id, kind, secret_enc, verified_at) VALUES ($1, 'totp', '\\x00'::bytea, now())", [acct.id]);
  t("once the account has an authenticator, a ticket is not a sign-in", (await refusedFor(enrolledTk)) === "enrolled");
  await q("DELETE FROM platform.account_factors WHERE account_id=$1", [acct.id]);
  const offTk = await tickets.mint(acct2);
  await q("UPDATE platform.accounts SET status='disabled' WHERE id=$1", [acct.id]);
  t("a switched off account does not open", (await refusedFor(offTk)) === "account_off");
  await q("UPDATE platform.accounts SET status='active' WHERE id=$1", [acct.id]);
  const fresh = await tickets.mint((await q("SELECT * FROM platform.accounts WHERE id=$1", [acct.id])).rows[0]);
  t("a good one minted now still opens (the checks above left the account as it was)", (await browser().get(`/login/ticket?t=${encodeURIComponent(fresh)}`)).location === "/c/acme-wire/enroll");

  // ---- 3.7: the product reads the refill in Stripe itself -------------------------------------------------------------
  const creditNow = async () => (await www("GET", "/api/www/companies/acme-wire")).json.credit.credit_usd;
  const start = await creditNow();
  const add = (ref, over = {}) => www("POST", "/api/www/credit", { slug: "acme-wire", ref, paid_usd: 30, credit_usd: 10, ...over });
  const none = await add("cs_test_nosuchsession0000");
  t("a refill Stripe has never seen is refused, nothing added", none.status === 403 && none.json.code === "unverified" && (await creditNow()) === start, none.json);
  const good = session();
  const ok = await add(good.id);
  t("a paid refill for this company, these dollars and this credit is added", ok.status === 200 && ok.json.added === true && (await creditNow()) === start + 10, ok.json);
  good.payment_status = "unpaid";   // Stripe's answer changing afterwards does not matter: the ledger has it
  const replay = await add(good.id);
  t("the same payment again is 'already done' without asking Stripe", replay.status === 200 && replay.json.added === false && (await creditNow()) === start + 10, replay.json);
  const cases = [
    ["an unpaid session", session({ payment_status: "unpaid", status: "open" }), {}, /not paid/],
    ["another company's refill", session({ metadata: { slug: "someone-else" } }), {}, /another company/],
    ["fewer dollars than claimed", session({ amount_total: 2000 }), {}, /was for \$20/],
    ["more credit than the session names", session(), { credit_usd: 100 }, /credit asked for/],
    ["more credit than dollars paid", session({ metadata: { credit_usd: "40" } }), { credit_usd: 40 }, /more than was paid/],
    ["a saved card, not a payment", session({ mode: "setup" }), {}, /not a payment/],
    ["a payment that is not a refill", session({ metadata: { kind: "site_card" } }), {}, /not a refill/],
  ];
  for (const [name, s, over, why] of cases) {
    const r = await add(s.id, over);
    t(`refused: ${name}`, r.status === 403 && r.json.code === "unverified" && why.test(r.json.error || ""), r.json);
  }
  t("none of those added a cent", (await creditNow()) === start + 10);
  stripeUp = false;
  const down = await add(session().id);
  stripeUp = true;
  t("Stripe out of reach: a 503 that says to try again, nothing added", down.status === 503 && /Try again/.test(down.json.error || "") && (await creditNow()) === start + 10, down.json);
  const sites = (await admin.get("/api/admin/sites")).json;
  t("the Sites tab says refills are checked, and against which Stripe", sites.activation && sites.activation.refill_check && sites.activation.refill_check.on === true && sites.activation.refill_check.mode === "test", sites.activation);

  fake.close();
  R.done();
})().catch((e) => { fake.close(); R.abort(e); });
