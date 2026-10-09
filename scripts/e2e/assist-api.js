// End to end: Ask Anetix's calls to the model, in the shape the real API takes (src/assist.js callModel), without a key.
// The fake agent (assist.js, assist-browser.js) never builds a real request; this suite runs the server with the
// fake agent OFF and the SDK pointed at a stand-in for the Messages API that this script serves itself, and checks
// every request the turn sends: the tools, the cached system text, the cache mark on the last block, roles that
// alternate, every tool call answered by a tool result in the next turn, no empty text, no model or cost words back
// to the manager. On a FRESH database, with the server started like this:
//
//   export DATABASE_URL=postgres://sos:sos@127.0.0.1:5432/sos_e2e SESSION_SECRET=e2e SOS_CONNECTION_KEY=e2e-connection-key \
//     SOS_FLOOR_PASSWORD=floorpw SOS_MANAGER_PASSWORD=mgrpw SOS_ADMIN_PASSWORD=adminpw
//   SOS_FAKE_AGENT=0 ANTHROPIC_API_KEY=stand-in ANTHROPIC_BASE_URL=http://127.0.0.1:3998 SOS_BROWSER=off PORT=3999 node server.js &
//   node scripts/e2e/assist-api.js
const http = require("http");
const { PW, runner, login, waitFor } = require("./lib");
const { q, pool } = require("../../src/db");
const R = runner(), t = R.t;
const seen = [];

// The stand-in: an assistant request (it offers list_tools) gets, in turn, two tool calls, then a step that asks for
// one more, then words. Anything else on the instance (a diagram after a deploy) gets a plain answer.
const server = http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => { body += c; });
  req.on("end", () => {
    let j = {}; try { j = JSON.parse(body); } catch (e) {}
    const names = (j.tools || []).map((x) => x.name);
    const reply = (content, stop) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ id: `msg_${seen.length}`, type: "message", role: "assistant", model: j.model, content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 } })); };
    if (!names.includes("list_tools")) return reply([{ type: "text", text: "{}" }], "end_turn");
    if (/FAILCALL/.test(JSON.stringify(j.messages[0]))) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "stand-in refusal" } })); }
    seen.push(j);
    const lastUser = j.messages[j.messages.length - 1];
    const results = Array.isArray(lastUser.content) ? lastUser.content.filter((b) => b.type === "tool_result").length : 0;
    const asked = String(typeof lastUser.content === "string" ? lastUser.content : (lastUser.content.find((b) => b.type === "text") || {}).text || "");
    if (/STEPS/.test(JSON.stringify(j.messages[0])) && !/every step/.test(JSON.stringify(lastUser))) return reply([{ type: "text", text: "" }, { type: "tool_use", id: `toolu_${seen.length}`, name: "list_tools", input: {} }], "tool_use");
    if (!results && !/every step/.test(asked)) return reply([{ type: "text", text: "Looking." }, { type: "tool_use", id: `toolu_${seen.length}a`, name: "list_tools", input: {} }, { type: "tool_use", id: `toolu_${seen.length}b`, name: "describe_tool", input: { tool: "paperline" } }], "tool_use");
    return reply([{ type: "text", text: "You have two tools: Paper Airplane Line and Plant KPIs. Claude Opus 5.5 by Anthropic says hi \u2014 really." }], "end_turn");
  });
});

function checkRequest(j, label) {
  const problems = [];
  if (!Array.isArray(j.system) || !j.system[0] || !j.system[0].cache_control) problems.push("the fixed system text carries no cache mark");
  if (!j.system[0] || !/Anetix's AI engineer/.test(j.system[0].text) || !/How Anetix works/.test(j.system[0].text)) problems.push("the fixed system text is not the rules and HELP.md");
  if (j.system[1] && j.system[1].cache_control) problems.push("the company's part is cached (it changes)");
  if (!j.max_tokens || j.max_tokens > 4000) problems.push("no sensible max_tokens");
  const last = j.messages[j.messages.length - 1];
  const lastBlock = Array.isArray(last.content) ? last.content[last.content.length - 1] : null;
  if (!lastBlock || !lastBlock.cache_control) problems.push("the last block carries no cache mark");
  if (j.messages[0].role !== "user") problems.push("the first message is not the person's");
  for (let i = 1; i < j.messages.length; i++) if (j.messages[i].role === j.messages[i - 1].role) problems.push(`two ${j.messages[i].role} messages in a row at ${i}`);
  for (let i = 0; i < j.messages.length; i++) {
    const m = j.messages[i];
    const blocks = Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }];
    for (const b of blocks) if (b.type === "text" && !String(b.text || "").trim()) problems.push(`an empty text block at ${i}`);
    const uses = blocks.filter((b) => b.type === "tool_use").map((b) => b.id);
    if (uses.length) {
      const next = j.messages[i + 1];
      const nb = next && Array.isArray(next.content) ? next.content : [];
      const firstResults = []; for (const b of nb) { if (b.type !== "tool_result") break; firstResults.push(b.tool_use_id); }
      if (uses.some((id) => !firstResults.includes(id))) problems.push(`a tool call at ${i} is not answered first thing in the next turn`);
    }
    for (const b of blocks) for (const k of Object.keys(b)) if (!["type", "text", "id", "name", "input", "tool_use_id", "content", "is_error", "cache_control"].includes(k)) problems.push(`an extra key ${k} at ${i}`);
  }
  const names = (j.tools || []).map((x) => x.name);
  if (names.some((n) => !/^[a-z_]+$/.test(n))) problems.push("a tool name the API refuses");
  return problems.length ? `${label}: ${problems.join("; ")}` : null;
}

(async () => {
  await new Promise((r) => server.listen(3998, "127.0.0.1", r));
  const admin = await login(PW.admin, "demo");
  const made = await admin.post("/api/admin/companies", { slug: "apico", name: "Api Co" });
  await q("INSERT INTO platform.sites (id, company, stage, standing, rollover) VALUES ($1,'apico','subscribed','good', jsonb_build_object('done_at', now()))", [require("crypto").randomUUID()]);
  for (const m of ["paperline", "kpis"]) await admin.post("/api/admin/companies/apico/modules", { module: m });
  const mgr = await login(made.json.passwords.manager, "apico");

  const run = async (scope, text) => {
    const conv = (await mgr.post("/api/c/apico/assist/conversations", { scope })).json.conversation;
    const sent = await mgr.post(`/api/c/apico/assist/conversations/${conv.id}/messages`, { text });
    const id = sent.json.assistant.id;
    return { conv, answer: await waitFor("the answer", async () => { const m = (await mgr.get(`/api/c/apico/assist/conversations/${conv.id}`)).json.messages.find((x) => x.id === id); return m && m.status !== "running" ? m : null; }, 30000) };
  };
  const a = await run({ kind: "company" }, "What tools do we have?");
  t("a real-shaped turn: two tool calls, then words", a.answer.status === "done" && /two tools/.test(a.answer.text), a.answer);
  t("the model's name, its maker and the dash never reach the manager", !/Claude|Opus|Anthropic/.test(a.answer.text) && !/[\u2013\u2014]/.test(a.answer.text) && /hi, really/.test(a.answer.text), a.answer.text);
  t("each request offered the tools of the scope, records included with the wall down", seen.length >= 2 && seen.every((j) => j.tools.some((x) => x.name === "read_records")));
  const bad = seen.map((j, i) => checkRequest(j, `request ${i + 1}`)).filter(Boolean);
  t("every request is in the shape the API takes", !bad.length, bad);
  const cost = Number((await q("SELECT COALESCE(sum(cost_usd),0) AS c FROM platform.ai_usage WHERE company='apico' AND kind='assistant'")).rows[0].c);
  t("the spend is filed for the company as assistant", cost > 0, cost);
  t("and on the meter", Number((await q("SELECT count(*) FROM platform.ai_calls WHERE company='apico' AND kind='assistant'")).rows[0].count) >= 2);

  // a second question in the same conversation carries the first as words, roles still alternating
  seen.length = 0;
  const conv = a.conv;
  const s2 = await mgr.post(`/api/c/apico/assist/conversations/${conv.id}/messages`, { text: "And the KPIs one?" });
  await waitFor("the second answer", async () => { const m = (await mgr.get(`/api/c/apico/assist/conversations/${conv.id}`)).json.messages.find((x) => x.id === s2.json.assistant.id); return m && m.status !== "running"; }, 30000);
  t("a follow-up sends the earlier exchange as words", seen.length && seen[0].messages.length === 3 && seen[0].messages[1].role === "assistant");
  const bad2 = seen.map((j, i) => checkRequest(j, `follow-up ${i + 1}`)).filter(Boolean);
  t("and is in the shape the API takes", !bad2.length, bad2);

  // a model that keeps calling tools is stopped at the step limit and still answers
  seen.length = 0;
  const loop = await run({ kind: "company" }, "STEPS: keep looking");
  t("a model that never stops calling tools is cut off at the step limit", seen.length === require("../../src/assist").MAX_STEPS, seen.length);
  t("the last step asks for an answer in the same turn as the results", /every step/.test(JSON.stringify(seen[seen.length - 1].messages[seen[seen.length - 1].messages.length - 1])));
  t("and the person still gets words", loop.answer.status === "done" && loop.answer.text.length > 0, loop.answer);
  const bad3 = seen.map((j, i) => checkRequest(j, `loop ${i + 1}`)).filter(Boolean);
  t("every step of the long turn is in the shape the API takes", !bad3.length, bad3.slice(0, 3));

  // the API refuses a call: the person reads plain words, and the failure goes to the phones like any caller's
  const failed = await run({ kind: "company" }, "FAILCALL please");
  t("a refused call: the answer says to ask again, in plain words", failed.answer.status === "failed" && /did not work just now/.test(failed.answer.text) && !/stand-in|invalid_request/.test(failed.answer.text), failed.answer);
  t("and the failure is noted for the phones (agent.noteApi)", await waitFor("the noted failure", async () => (await q("SELECT 1 FROM platform.events WHERE kind='ai_unavailable' AND detail->>'where' LIKE '%assistant, apico%'")).rows.length > 0, 10000).catch(() => false));

  server.close();
  await pool.end();
  R.done();
})().catch(R.abort);
