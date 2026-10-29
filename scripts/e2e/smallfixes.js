// End to end for the small fixes of 2026-10-29 (Chelsea Clock's and Pearlman LLC's requests to Anetix):
//   #290 the company's own icon on every tab: its initials on its color when it has no logo, a logo a manager uploads
//        on Settings, its company pages naming its icon in the HTML, the login page leading with its name;
//   #287 pointing at something (and a photo) on a request to Anetix, shown on the Requests tab, kept off the admin MCP;
//   #292 the Feedback button and the board link as small round icons with room left at the bottom of the page.
// (#288, several new tool drafts at once, is in phase1.js.) Against a server ALREADY UP in fake-agent mode.
const { BASE, PW, runner, login, client } = require("./lib");
const R = runner(), t = R.t;
// a 1x1 PNG and a 1x1 JPEG, as a browser would send them
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const JPG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

(async () => {
  const mgr = await login(PW.manager, "demo"), floor = await login(PW.floor, "demo"), admin = await login(PW.admin, "");
  const raw = async (c, path) => { const r = await fetch(BASE + path, { headers: { Cookie: c.cookies().map((x) => `${x.name}=${x.value}`).join("; ") } }); return { status: r.status, type: r.headers.get("content-type") || "", buf: Buffer.from(await r.arrayBuffer()), headers: r.headers }; };

  // ---- #290: the company's own icon ----
  const svg = await raw(mgr, "/api/c/demo/icon"), png = await raw(mgr, "/api/c/demo/icon.png");
  const svgText = svg.buf.toString("utf8");
  t("with no logo, the tab icon is the company's initials, not the Anetix mark", svg.status === 200 && /svg/.test(svg.type) && />DC</.test(svgText) && !/M468 146h87/.test(svgText), svgText.slice(0, 200));
  t("and the home screen icon is a PNG of its own, not Anetix's", png.status === 200 && /png/.test(png.type) && png.buf.slice(1, 4).toString() === "PNG" && png.buf.length > 200);
  t("the icon is served as a picture that cannot run anything", /nosniff/.test(svg.headers.get("x-content-type-options") || "") && /sandbox/.test(svg.headers.get("content-security-policy") || ""));
  const svgUp = await mgr.post("/api/c/demo/brand/icon", { data_url: "data:image/svg+xml;base64," + Buffer.from("<svg onload='alert(1)'/>").toString("base64") });
  const big = await mgr.post("/api/c/demo/brand/icon", { data_url: "data:image/png;base64," + Buffer.concat([Buffer.from(PNG, "base64"), Buffer.alloc(600 * 1024)]).toString("base64") });
  const notImg = await mgr.post("/api/c/demo/brand/icon", { data_url: "data:image/png;base64," + Buffer.from("not a picture at all, just words").toString("base64") });
  t("an SVG, a file over 512 KB and something that only says it is a PNG are refused in words", svgUp.status === 400 && big.status === 400 && /512 KB/.test(big.json.error) && notImg.status === 400 && /PNG or JPEG/.test(notImg.json.error), [svgUp.text, big.text, notImg.text]);
  t("the floor cannot change the logo", (await floor.post("/api/c/demo/brand/icon", { data_url: "data:image/png;base64," + PNG })).status === 403);
  const up = await mgr.post("/api/c/demo/brand/icon", { data_url: "data:image/png;base64," + PNG });
  t("a manager uploads a PNG logo", up.status === 200 && up.json.uploaded === true && up.json.icon_v, up.text);
  const png2 = await raw(mgr, "/api/c/demo/icon.png"), svg2 = await raw(mgr, "/api/c/demo/icon");
  t("and it is the icon now, on the tab and the home screen", png2.buf.equals(Buffer.from(PNG, "base64")) && svg2.buf.equals(Buffer.from(PNG, "base64")) && /png/.test(svg2.type));
  const sv = (await mgr.get("/api/c/demo/settings-view")).json;
  t("Settings knows it is an uploaded logo", sv.icon && sv.icon.uploaded === true && sv.icon.v === up.json.icon_v, sv.icon);
  const brd = (await mgr.get("/api/c/demo/board")).json;
  t("the board's icon address moves with it, and the logo itself never rides in the board's answer", brd.icon_v === up.json.icon_v && !JSON.stringify(brd).includes(PNG.slice(0, 40)));
  const jpg = await mgr.post("/api/c/demo/brand/icon", { data_url: "data:image/jpeg;base64," + JPG });
  t("a JPEG is taken too", jpg.status === 200 && /jpeg/.test((await raw(mgr, "/api/c/demo/icon.png")).type));
  const cleared = await mgr.post("/api/c/demo/brand/icon/clear", {});
  t("taking it off goes back to the initials", cleared.status === 200 && cleared.json.uploaded === false && />DC</.test((await raw(mgr, "/api/c/demo/icon")).buf.toString()));
  t("each change is on the record", await (async () => { const { q } = require("../../src/db"); const r = (await q("SELECT kind FROM platform.record WHERE company='demo' AND kind IN ('company_icon_set','company_icon_cleared')")).rows.map((x) => x.kind); return r.includes("company_icon_set") && r.includes("company_icon_cleared"); })().catch(() => false));
  for (const pg of ["/c/demo/settings", "/c/demo/people", "/c/demo/connections"]) {
    const h = (await raw(mgr, pg)).buf.toString();
    t(`${pg} names the company's icon in its HTML, and its title is not "Anetix · "`, h.includes('href="/api/c/demo/icon"') && h.includes('href="/api/c/demo/icon.png"') && !h.includes("/assets/anetix-mark.svg\" type") && !/<title>Anetix · /.test(h));
  }
  const lm = (await client().get("/login/mode?c=demo")).json, lx = (await client().get("/login/mode?c=nobody-here")).json;
  t("the login page is told the company's name, and nothing for a code that is not a company", lm.name === "Demo Company" && lx.name === null, [lm, lx]);

  // ---- #287: pointing at something on a request to Anetix ----
  const sent = await mgr.post("/api/feedback", { company: "demo", module: "platform", page: "/c/demo/settings", screen: "Settings", message: "this button is hard to find POINTCANARY",
    element: { tag: "button", text: "Upload a logo", label: "", path: "div.card > div > button", classes: ["primary"], html: "<button>Upload a logo</button>" },
    photo: { mime: "image/jpeg", data: JPG + JPG.slice(0, 120) } });
  t("a request to Anetix takes what was pointed at and a photo", sent.status === 200 && sent.json.id, sent.text);
  const reqs = (await admin.get("/api/admin/requests")).json.requests || [];
  const mine = reqs.find((r) => r.id === sent.json.id);
  t("the Requests tab shows what was pointed at, and the photo", mine && mine.pointed && mine.pointed.text === "Upload a logo" && mine.element && mine.element.path === "div.card > div > button" && mine.photo_id > 0, mine);
  const ph = mine && mine.photo_id ? await raw(admin, `/api/attachments/${mine.photo_id}`) : { status: 0 };
  t("and the photo opens for Anetix", ph.status === 200 && /image/.test(ph.type), ph.status);
  const mcp = require("../../src/mcp-admin");
  const tool = (mcp.tools || []).find((x) => x.name === "list_requests_to_anetix");
  if (tool) {
    const out = await tool.run({ status: "open" });
    const row = out.requests.find((r) => r.id === sent.json.id);
    t("the admin MCP says what was pointed at in words and that there is a photo, never the markup or the photo", row && row.pointed && row.pointed.text === "Upload a logo" && row.has_photo === true && row.element === undefined && row.photo_id === undefined, row);
  } else console.log("(the admin MCP's tools are not exported here: the MCP case is in mcp.js)");

  // ---- #292 and #287 in a browser ----
  const { chromium } = require("playwright");
  const browser = await chromium.launch(process.env.SOS_CHROMIUM_PATH ? { executablePath: process.env.SOS_CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } }); await ctx.addCookies(mgr.cookies());
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(BASE + "/c/demo/settings"); await p.waitForSelector("#sos-fb-btn"); await p.waitForTimeout(600);
  const b = await p.evaluate(() => { const r = document.getElementById("sos-fb-btn").getBoundingClientRect(); return { w: r.width, h: r.height, label: document.getElementById("sos-fb-btn").getAttribute("aria-label"), room: Boolean(document.getElementById("sos-fb-room")) }; });
  t("on a settings page the Feedback button is a small round icon, with room left at the bottom", b.w <= 46 && b.h <= 46 && /Send feedback/.test(b.label) && b.room, b);
  t("the logo card shows the icon the tabs show", await p.evaluate(() => { const i = document.getElementById("logo-now"); return i && i.complete && i.naturalWidth > 0; }));
  await p.click("#sos-fb-btn"); await p.waitForSelector("#fbw-extras");
  t("the panel there offers Point at it, on a page that sends to Anetix", await p.locator("#fbw-point").isVisible());
  await browser.close();
  t("no page errors", errors.length === 0, errors);
  R.done();
})().catch(R.abort);
