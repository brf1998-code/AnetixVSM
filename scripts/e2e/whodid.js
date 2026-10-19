// End to end for "The record says which account acted" (2026-10-15, docs/FEATURES.md): every row made from a named
// manager account carries that account's name and id, a person signed in on the device still wins the name (the account
// id stays), and a shared manager password leaves both empty so it reads apart from a named sign-in.
// Against a server ALREADY UP in fake-agent mode on a fresh database (run-all.sh, after managers).
const { runner, client, login, PW, sleep } = require("./lib");
const { q } = require("../../src/db");
const totp = require("../../src/totp");
const R = runner(), t = R.t;
const BASE = process.env.SOS_E2E_BASE || "http://127.0.0.1:3999";
async function codeFor(secretText) {
  const into = (Date.now() / 1000) % 30;
  if (into > 27.5) await sleep((30 - into) * 1000 + 300);
  return totp.hotp(totp.base32Decode(secretText), totp.stepAt());
}
const tokenOf = (link) => new URL(link, BASE).searchParams.get("t");
const rows = async (where, vals) => (await q(`SELECT * FROM platform.record WHERE company='tickworks' AND ${where} ORDER BY id`, vals)).rows;

(async () => {
  const admin = await login(PW.admin);
  const made = await admin.post("/api/admin/companies", { slug: "tickworks", name: "Tickworks" });
  t("setup: a company added by hand", made.status === 200, made.json);
  const inv = await admin.post("/api/c/tickworks/managers/invite", { name: "Jay Hand", email: "jay@tickworks.test" });
  const jay = client();
  await jay.post("/join", { t: tokenOf(inv.json.link), password: "escapement-5521-pendulum" });
  const es = await jay.post("/api/c/tickworks/me/enroll/start", {});
  await jay.post("/api/c/tickworks/me/enroll/verify", { code: await codeFor(es.json.secret.replace(/\s/g, "")) });
  const acct = (await q("SELECT id FROM platform.accounts WHERE login='jay@tickworks.test'")).rows[0];
  t("setup: Jay is a manager with an account of his own", (await jay.get("/api/c/tickworks/board")).status === 200 && Boolean(acct));
  const shared = await login(made.json.passwords.manager, "tickworks");

  // ---- a new tool request from Jay's account: every answer, and the withdrawal, say it was Jay
  const it1 = (await jay.post("/api/c/tickworks/intakes", {})).json;
  t("Jay starts a new tool request", Boolean(it1 && it1.id), it1);
  await jay.post(`/api/intakes/${it1.id}/answer`, { id: "name", value: "Parts list" });
  await jay.post(`/api/intakes/${it1.id}/answer`, { id: "purpose", value: "look up a part and its count" });
  const a1 = await rows("intake_id=$1 AND kind='intake_answered'", [it1.id]);
  t("each answer is on the record under Jay's name and account", a1.length === 2 && a1.every((r) => r.actor_role === "manager" && r.actor_name === "Jay Hand" && r.actor_account === acct.id), a1.map((r) => [r.actor_name, r.actor_account]));
  const fb1 = (await q("SELECT name FROM platform.feedback WHERE id=$1", [it1.feedback_id])).rows[0];
  t("the request's tile carries his name, not \"manager\"", fb1 && fb1.name === "Jay Hand", fb1);
  await jay.post(`/api/intakes/${it1.id}/abandon`, {});
  const ab = (await rows("intake_id=$1 AND kind='intake_abandoned'", [it1.id]))[0];
  t("withdrawing it says it was Jay", ab && ab.actor_name === "Jay Hand" && ab.actor_account === acct.id, ab);

  // ---- the shared manager password: no name, no account, so it reads apart from a named sign-in
  const it2 = (await shared.post("/api/c/tickworks/intakes", {})).json;
  await shared.post(`/api/intakes/${it2.id}/answer`, { id: "name", value: "Shelf map" });
  const a2 = (await rows("intake_id=$1 AND kind='intake_answered'", [it2.id]))[0];
  t("an answer from the shared password has a role but no name and no account", a2 && a2.actor_role === "manager" && a2.actor_name === null && a2.actor_account === null, a2);
  t("its tile still says manager", (await q("SELECT name FROM platform.feedback WHERE id=$1", [it2.feedback_id])).rows[0].name === "manager");
  await shared.post(`/api/intakes/${it2.id}/abandon`, {});

  // ---- a person signed in on Jay's screen: the person's name wins, Jay's account stays on the row
  const pat = (await jay.post("/api/c/tickworks/people", { name: "Pat Quill", role: "manager" })).json;
  t("setup: Pat signs in on Jay's screen", (await jay.post("/api/c/tickworks/who/sign-in", { id: pat.person.id, pin: pat.pin })).status === 200);
  const it3 = (await jay.post("/api/c/tickworks/intakes", {})).json;
  await jay.post(`/api/intakes/${it3.id}/answer`, { id: "name", value: "Bench board" });
  const a3 = (await rows("intake_id=$1 AND kind='intake_answered'", [it3.id]))[0];
  t("the person's name wins and the account is kept", a3 && a3.actor_name === "Pat Quill" && a3.actor_person === pat.person.id && a3.actor_account === acct.id, a3);
  await jay.post(`/api/intakes/${it3.id}/abandon`, {});
  await jay.post("/api/c/tickworks/who/sign-out", {});

  // ---- record.actor(req), the path approvals, declines, deploys and close-outs all take: adding Pat went through it
  // before anyone was signed in on Jay's screen
  const added = (await rows("kind='person_added'", [])).find((r) => r.detail.person_id === pat.person.id);
  t("adding a person says it was Jay, by name and account", added && added.actor_role === "manager" && added.actor_name === "Jay Hand" && added.actor_account === acct.id, added);
  const shan = (await shared.post("/api/c/tickworks/people", { name: "Shan Bell", role: "floor" })).json;
  const added2 = (await rows("kind='person_added'", [])).find((r) => r.detail.person_id === shan.person.id);
  t("the same from the shared password has no name and no account", added2 && added2.actor_name === null && added2.actor_account === null, added2);
  // a filed request keeps the name it has carried since 2026-09-26, and now the account too
  const fb = (await jay.post("/api/feedback", { company: "tickworks", module: "platform", page: "/c/tickworks/", message: "make the board title bigger" })).json;
  const filed = (await rows("feedback_id=$1 AND kind='feedback_filed'", [fb.id]))[0];
  t("a filed request carries Jay's name and account", filed && filed.actor_name === "Jay Hand" && filed.actor_account === acct.id, filed);

  // ---- an older row shape still reads: the agent and the platform have no account
  const agentRows = await rows("actor_role IN ('agent','platform')", []);
  t("the agent's and the platform's rows carry no account", agentRows.every((r) => r.actor_account === null));

  R.done();
})().catch(R.abort);
