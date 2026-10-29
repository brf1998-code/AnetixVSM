// End to end for Sign in with Google or Microsoft (src/oidc.js, 2026-10-29). This script plays both providers on
// SOS_OIDC_STUB's port. What it proves: nothing signs in by an email; a Google or Microsoft account signs in only once a
// named account with a full session has connected it, and then it is the whole sign-in; the state, the PKCE verifier,
// the nonce, the issuer and the audience are each checked; one provider account cannot be connected to two Anetix
// accounts; disconnecting ends it; a switched-off account cannot use it; the floor never can.
// Against a server ALREADY UP in fake-agent mode, started with (run-all.sh has the line):
//   SOS_PUBLIC_URL=<its own address> SOS_OIDC_STUB=http://127.0.0.1:4777 SOS_GOOGLE_CLIENT_ID=g-client
//   SOS_GOOGLE_CLIENT_SECRET=g-secret SOS_MS_CLIENT_ID=m-client SOS_MS_CLIENT_SECRET=m-secret
const http = require("http");
const crypto = require("crypto");
const { BASE, PW, runner, login, client, sleep } = require("./lib");
const { q } = require("../../src/db");
const totp = require("../../src/totp");
const R = runner(), t = R.t;
const STUB_PORT = Number(new URL(process.env.SOS_OIDC_STUB || "http://127.0.0.1:4777").port);
const STUB = `http://127.0.0.1:${STUB_PORT}`;
const TID = "11111111-2222-3333-4444-555555555555";

// ---- the stand-in providers ----
const stub = { user: { sub: "g-alice-001", email: "alice@gmail.test" }, ms: { oid: "aaaaaaaa-0000-0000-0000-000000000001", tid: TID, email: "bob@contoso.test" }, codes: new Map(), break: null, tokenCalls: 0 };
const jwt = (claims) => `${Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.c2lnbmF0dXJl`;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, STUB);
  const m = /^\/(google|microsoft)\/(authorize|token)$/.exec(u.pathname);
  if (!m) { res.writeHead(404); return res.end(); }
  const [, prov, step] = m;
  if (step === "authorize") {
    const code = crypto.randomBytes(12).toString("hex");
    stub.codes.set(code, { prov, client_id: u.searchParams.get("client_id"), redirect_uri: u.searchParams.get("redirect_uri"), nonce: u.searchParams.get("nonce"), challenge: u.searchParams.get("code_challenge"), method: u.searchParams.get("code_challenge_method"), scope: u.searchParams.get("scope"), user: { ...stub.user }, ms: { ...stub.ms } });
    const back = new URL(u.searchParams.get("redirect_uri"));
    if (stub.break === "deny") back.searchParams.set("error", "access_denied"); else back.searchParams.set("code", code);
    back.searchParams.set("state", u.searchParams.get("state"));
    res.writeHead(302, { Location: back.toString() }); return res.end();
  }
  let body = ""; req.on("data", (c) => { body += c; }); req.on("end", () => {
    stub.tokenCalls++;
    const f = new URLSearchParams(body), c = stub.codes.get(f.get("code"));
    const fail = (s) => { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: s })); };
    if (!c || c.prov !== prov) return fail("invalid_grant");
    stub.codes.delete(f.get("code"));
    const secret = prov === "google" ? "g-secret" : "m-secret";
    if (f.get("client_id") !== c.client_id || f.get("client_secret") !== secret || f.get("redirect_uri") !== c.redirect_uri || f.get("grant_type") !== "authorization_code") return fail("invalid_client");
    const pkce = crypto.createHash("sha256").update(f.get("code_verifier") || "").digest("base64url");
    if (c.method !== "S256" || pkce !== c.challenge) return fail("invalid_grant: pkce");
    const now = Math.floor(Date.now() / 1000);
    const claims = prov === "google"
      ? { iss: `${STUB}/google`, aud: c.client_id, sub: c.user.sub, email: c.user.email, email_verified: true, nonce: c.nonce, iat: now, exp: now + 3600 }
      : { iss: `${STUB}/microsoft/${c.ms.tid}/v2.0`, aud: c.client_id, tid: c.ms.tid, oid: c.ms.oid, sub: "pairwise-" + c.ms.oid, preferred_username: c.ms.email, nonce: c.nonce, iat: now, exp: now + 3600 };
    if (stub.break === "nonce") claims.nonce = "not-the-nonce";
    if (stub.break === "aud") claims.aud = "someone-else";
    if (stub.break === "iss") claims.iss = "https://evil.example/";
    if (stub.break === "exp") { claims.exp = now - 3600; claims.iat = now - 7200; }
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ access_token: "at", token_type: "Bearer", id_token: jwt(claims) }));
  });
});

// a browser in miniature: follows each redirect by hand through the product and the stub, keeping the product's cookies
async function walk(c, path, { follow = 6 } = {}) {
  let url = BASE + path, last = null;
  const seen = [];
  for (let i = 0; i < follow; i++) {
    const onStub = url.startsWith(STUB);
    const res = await fetch(url, { redirect: "manual", headers: onStub ? {} : { Cookie: c.jar() } });
    if (!onStub) c.take(res);
    seen.push({ url, status: res.status });
    last = res;
    const loc = res.headers.get("location");
    if (!(res.status >= 300 && res.status < 400 && loc)) break;
    url = new URL(loc, url).toString();
    if (!url.startsWith(STUB) && !url.startsWith(BASE + "/login/oidc/")) { seen.push({ url, status: "stop" }); break; }   // landed back in the product's pages
  }
  return { seen, final: seen[seen.length - 1].url, res: last };
}
function jarClient(base) {
  const jar = new Map(base ? base.cookies().map((x) => [x.name, x.value]) : []);
  const c = {
    jar: () => [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
    take: (res) => { for (const ck of res.headers.getSetCookie ? res.headers.getSetCookie() : []) { const [kv] = ck.split(";"); const i = kv.indexOf("="); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v) jar.set(k, v); else jar.delete(k); } },
    get: async (p) => { const r = await fetch(BASE + p, { redirect: "manual", headers: { Cookie: c.jar() } }); c.take(r); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) {} return { status: r.status, json, text }; },
    post: async (p, b) => { const r = await fetch(BASE + p, { method: "POST", redirect: "manual", headers: { Cookie: c.jar(), "Content-Type": "application/json" }, body: JSON.stringify(b || {}) }); c.take(r); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) {} return { status: r.status, json, text }; },
    has: (k) => jar.has(k),
  };
  return c;
}
async function codeFor(secretText) {
  const into = (Date.now() / 1000) % 30;
  if (into > 27.5) await sleep((30 - into) * 1000 + 300);
  return totp.hotp(totp.base32Decode(secretText), totp.stepAt());
}
// a manager account with an authenticator, the way an admin makes one: invite, the link, a password, the code
async function namedManager(admin, slug, name, email) {
  const inv = await admin.post(`/api/c/${slug}/managers/invite`, { name, email });
  if (inv.status !== 200) throw new Error(`invite failed: ${inv.text}`);
  const c = jarClient();
  const joined = await c.post("/join", { t: new URL(inv.json.link, BASE).searchParams.get("t"), password: "brass-gear-4471-chime" });
  if (joined.status !== 200) throw new Error(`join failed: ${joined.text}`);
  const es = await c.post(`/api/c/${slug}/me/enroll/start`, {});
  const ev = await c.post(`/api/c/${slug}/me/enroll/verify`, { code: await codeFor(es.json.secret.replace(/\s/g, "")) });
  if (ev.status !== 200) throw new Error(`enroll failed: ${ev.text}`);
  return c;
}

(async () => {
  await new Promise((ok) => server.listen(STUB_PORT, "127.0.0.1", ok));
  const admin = await login(PW.admin, ""), floor = await login(PW.floor, "demo");
  const pv = (await client().get("/login/oidc/providers")).json;
  t("both providers are on, by name only", pv.providers.map((p) => p.id).sort().join() === "google,microsoft" && !JSON.stringify(pv).includes("secret"), pv);

  // ---- not connected: nobody signs in by an email ----
  const anon = jarClient();
  const w0 = await walk(anon, "/login/oidc/google?next=/admin");
  const go = new URL(w0.seen[1].url);
  t("Sign in with Google goes to the provider with a code flow, PKCE S256, a state, a nonce and this instance's return address", go.origin === STUB && go.searchParams.get("response_type") === "code" && go.searchParams.get("code_challenge_method") === "S256" && go.searchParams.get("state") && go.searchParams.get("nonce") && go.searchParams.get("redirect_uri") === `${BASE}/login/oidc/google/callback` && go.searchParams.get("client_id") === "g-client" && /openid/.test(go.searchParams.get("scope")), w0.seen);
  t("a Google account connected to nobody signs nobody in, and the page says how to connect it", /\/login\?staff=1&oidc=unlinked_google$/.test(w0.final) && !anon.has("sos_session"), w0.final);

  // ---- connect it, from a named manager's full session ----
  const mgr = await namedManager(admin, "demo", "Alice Lopez", "alice@demo.test");
  const ids0 = await mgr.get("/api/me/identities");
  t("a named manager sees no connections yet, and the providers that are on", ids0.status === 200 && ids0.json.identities.length === 0 && ids0.json.providers.length === 2, ids0.text);
  const w1 = await walk(mgr, `/login/oidc/google?link=1&next=${encodeURIComponent("/c/demo/settings")}`);
  t("Connect Google comes back to Settings saying it is connected", w1.final === `${BASE}/c/demo/settings?oidc=linked_google`, w1.seen);
  const row = (await q("SELECT i.provider, i.subject, i.email, a.login FROM platform.account_identities i JOIN platform.accounts a ON a.id=i.account_id")).rows;
  t("the provider's own id is kept on that account (the email only to show)", row.length === 1 && row[0].provider === "google" && row[0].subject === "g-alice-001" && row[0].login === "alice@demo.test" && row[0].email === "alice@gmail.test", row);

  // ---- and now it signs in, the whole sign-in ----
  const fresh = jarClient();
  const w2 = await walk(fresh, "/login/oidc/google");
  t("Sign in with Google lands on the manager's board, signed in", w2.final === `${BASE}/c/demo/` && fresh.has("sos_session"), w2.seen);
  const me = await fresh.get("/api/c/demo/settings-view");
  t("as that manager, with a full session (no code asked)", me.status === 200 && me.json.me && me.json.me.login === "alice@demo.test", me.text.slice(0, 200));
  const fresh2 = jarClient();
  const w2b = await walk(fresh2, `/login/oidc/google?next=${encodeURIComponent("/c/demo/settings")}`);
  t("it goes to the page it was sent from inside the company", w2b.final === `${BASE}/c/demo/settings`, w2b.final);
  const fresh3 = jarClient();
  t("but never to another company's page", (await walk(fresh3, `/login/oidc/google?next=${encodeURIComponent("/c/other/")}`)).final === `${BASE}/c/demo/`);
  t("the sign-in is on the log", (await q("SELECT count(*)::int AS n FROM platform.auth_events WHERE event='login_oidc'")).rows[0].n >= 3);

  // ---- the checks ----
  const tamper = jarClient();
  const st = await fetch(`${BASE}/login/oidc/google`, { redirect: "manual" }); tamper.take(st);
  const loc = new URL(st.headers.get("location"));
  const bad = await fetch(`${BASE}/login/oidc/google/callback?code=x&state=${loc.searchParams.get("state")}x`, { redirect: "manual", headers: { Cookie: tamper.jar() } });
  t("a return whose state does not match the cookie is refused", bad.status === 303 && /oidc=expired/.test(bad.headers.get("location")));
  const noCookie = await fetch(`${BASE}/login/oidc/google/callback?code=x&state=${loc.searchParams.get("state")}`, { redirect: "manual" });
  t("and so is one with no state cookie at all", noCookie.status === 303 && /oidc=expired/.test(noCookie.headers.get("location")));
  for (const brk of ["nonce", "aud", "iss", "exp"]) {
    stub.break = brk; const c = jarClient();
    const w = await walk(c, "/login/oidc/google");
    t(`a token with the wrong ${brk} signs nobody in`, /oidc=failed$/.test(w.final) && !c.has("sos_session"), w.final);
  }
  stub.break = "deny"; const cd = jarClient();
  t("a person who says no at the provider is told nothing was signed in", /oidc=cancelled$/.test((await walk(cd, "/login/oidc/google")).final));
  stub.break = null;

  // ---- one provider account, one Anetix account ----
  const mgr2 = await namedManager(admin, "demo", "Ben Okafor", "ben@demo.test");
  const w3 = await walk(mgr2, `/login/oidc/google?link=1&next=${encodeURIComponent("/c/demo/settings")}`);
  t("the same Google account cannot be connected to a second Anetix account", w3.final === `${BASE}/c/demo/settings?oidc=taken`, w3.final);
  // ---- Microsoft ----
  const w4 = await walk(mgr2, `/login/oidc/microsoft?link=1&next=${encodeURIComponent("/c/demo/settings")}`);
  t("Ben connects Microsoft", w4.final === `${BASE}/c/demo/settings?oidc=linked_microsoft` && (await q("SELECT subject FROM platform.account_identities WHERE provider='microsoft'")).rows[0].subject === `${TID}:aaaaaaaa-0000-0000-0000-000000000001`, w4.final);
  const fm = jarClient();
  t("and signs in with it", (await walk(fm, "/login/oidc/microsoft")).final === `${BASE}/c/demo/` && (await fm.get("/api/c/demo/settings-view")).json.me.login === "ben@demo.test");
  stub.ms = { ...stub.ms, tid: "99999999-9999-9999-9999-999999999999" };
  const fm2 = jarClient();
  t("the same person id in another tenant is someone else", /oidc=unlinked_microsoft$/.test((await walk(fm2, "/login/oidc/microsoft")).final));
  stub.ms = { ...stub.ms, tid: TID };

  // ---- the floor never; disconnect; switched off ----
  const fl = jarClient(floor);
  t("the floor's session cannot connect one", /\/login\?staff=1&oidc=signin_first$/.test((await walk(fl, "/login/oidc/google?link=1")).final) && (await fl.get("/api/me/identities")).status === 403);
  const mine = (await mgr.get("/api/me/identities")).json.identities[0];
  t("Ben cannot disconnect Alice's", (await mgr2.post(`/api/me/identities/${mine.id}/remove`, {})).status === 404);
  t("Alice disconnects hers", (await mgr.post(`/api/me/identities/${mine.id}/remove`, {})).status === 200);
  const after = jarClient();
  t("and Google signs her in no more", /oidc=unlinked_google$/.test((await walk(after, "/login/oidc/google")).final));
  const benId = (await q("SELECT id FROM platform.accounts WHERE login='ben@demo.test'")).rows[0].id;
  await q("UPDATE platform.accounts SET status='disabled', generation=generation+1 WHERE id=$1", [benId]);
  require("../../src/accounts").forget(benId);
  await sleep(10500);   // the account's state is remembered ten seconds
  const off = jarClient();
  t("a switched-off account cannot sign in with it", /oidc=off$/.test((await walk(off, "/login/oidc/microsoft")).final) && !off.has("sos_session"));
  t("each refusal is on the log", (await q("SELECT count(*)::int AS n FROM platform.auth_events WHERE event='oidc_refused'")).rows[0].n >= 8);

  server.close();
  R.done();
})().catch((e) => { server.close(); R.abort(e); });
