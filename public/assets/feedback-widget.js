// Feedback widget: injected into every module page by the runtime, and used by
// the platform's own pages with data-module="platform".
// Posts to /api/feedback with the company, module name and page path (the page
// path is how the platform knows which screen the feedback is about).
// It also watches the module's version: when the manager deploys a new
// version, every open page reloads itself and shows a short "updated" banner.
// On a staged preview it pins an amber bar so nobody mistakes it for the floor.
(function () {
  const script = document.currentScript;
  const mod = script ? script.getAttribute("data-module") : null;
  const version = script ? script.getAttribute("data-version") : null;
  const mount = script ? script.getAttribute("data-mount") : null;
  const company = (script && script.getAttribute("data-company")) || ((/^\/c\/([^/]+)/.exec(location.pathname) || [])[1]) || "demo";
  const staged = mount === "staged";
  const onTest = mount === "test";   // the company's test floor (docs/TEST-ENVIRONMENT.md): a violet bar, nothing here is real
  // Every tool page, on every company, carries a way back to the improvement board, bottom left (Brendan, 2026-09-27:
  // "it is easy to get lost then struggle to get back to the improvement board"; 2026-10-05: every page, and every
  // preview page, a paid site's too. Until then only a trial's pages had it). The preview's amber bar and the test
  // floor's bar carry the same link in their own words. Not drawn inside a frame (the board's screen tiles).
  const boardHref = "/c/" + encodeURIComponent(company) + "/";
  if (script && mod && mod !== "platform" && window.top === window.self) {
    const back = document.createElement("a");
    back.id = "sos-board-link";
    back.href = boardHref;
    back.title = "Back to your improvement board";
    back.textContent = "\u2190 Improvement board";
    back.style.cssText = "position:fixed!important;left:12px!important;bottom:12px!important;right:auto!important;top:auto!important;z-index:9999;background:#fff!important;color:#1f3a5f!important;border:1px solid #1f3a5f!important;border-radius:18px!important;padding:8px 12px!important;font-size:12.5px!important;font-weight:700!important;line-height:1!important;text-decoration:none!important;box-shadow:0 2px 8px rgba(0,0,0,.2);font-family:system-ui,sans-serif!important;opacity:.95;";
    const put = () => document.body.appendChild(back);
    if (document.body) put(); else document.addEventListener("DOMContentLoaded", put);
  }

  // Small pill, bottom right, out of the way of the work. Opens a panel on tap.
  const btn = document.createElement("button");
  btn.id = "sos-fb-btn";
  btn.setAttribute("aria-label", "Something in the way? Send feedback");
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:6px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Feedback';
  // !important so a page's own button rules (width:100%, min-height) cannot resize it
  btn.style.cssText = "position:fixed!important;right:12px!important;bottom:12px!important;left:auto!important;top:auto!important;z-index:9999;width:auto!important;min-height:0!important;height:auto!important;margin:0!important;background:#1f3a5f!important;color:#fff!important;border:none!important;border-radius:18px!important;padding:8px 12px!important;font-size:12.5px!important;font-weight:700!important;line-height:1!important;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25);font-family:system-ui,sans-serif!important;opacity:.92;";

  // data-dock="<selector>": on a phone the button sits in that spot on the page instead of floating over it (the board
  // docks it in its band, so it no longer covers the bottom card's buttons; the launch audit 1.9)
  const dockSel = script ? script.getAttribute("data-dock") : null;
  const FLOAT_CSS = btn.style.cssText;
  const DOCK_CSS = "position:static!important;z-index:auto;width:auto!important;min-height:36px!important;height:auto!important;margin:0!important;background:rgba(255,255,255,.14)!important;color:#fff!important;border:1px solid rgba(255,255,255,.4)!important;border-radius:18px!important;padding:8px 12px!important;font-size:13px!important;font-weight:700!important;line-height:1!important;cursor:pointer;font-family:system-ui,sans-serif!important;display:inline-flex!important;align-items:center;";
  function dock() {
    const spot = dockSel && document.querySelector(dockSel);
    const narrow = Boolean(window.matchMedia && window.matchMedia("(max-width: 640px)").matches);
    if (spot && narrow) {
      if (btn.parentNode !== spot) spot.appendChild(btn);
      btn.style.cssText = DOCK_CSS;
      panel.style.top = "56px"; panel.style.bottom = "auto";
    } else {
      if (btn.parentNode !== document.body) document.body.appendChild(btn);
      btn.style.cssText = FLOAT_CSS;
      panel.style.top = ""; panel.style.bottom = "52px";
    }
  }

  const panel = document.createElement("div");
  panel.style.cssText = "position:fixed;right:12px;bottom:52px;z-index:9999;background:#fff;border:1px solid #d5dbe3;border-radius:10px;padding:14px;width:300px;max-width:calc(100vw - 24px);display:none;box-shadow:0 6px 20px rgba(0,0,0,.2);font-family:system-ui,sans-serif;";
  // On the platform's own pages (the board, settings, the admin page) the feedback is about the software itself,
  // so it goes to Anetix and not to the manager's build loop; say so before the person types (Brendan, 2026-09-24).
  const toAnetix = !mod || mod === "platform";
  panel.innerHTML =
    '<div style="font-weight:700;font-size:14px;color:#1c242e;margin-bottom:' + (toAnetix ? "4" : "8") + 'px">Something in the way?</div>' +
    (toAnetix ? '<div id="fbw-anetix" style="font-size:12.5px;color:#51606f;margin-bottom:8px;line-height:1.4">This page is part of the software itself, so this goes to <b>Brendan at Anetix</b>, who makes it, not to your manager. Tap your name and you can follow it under My requests.</div>' : "") +
    (onTest ? '<div style="font-size:12.5px;color:#51606f;margin-bottom:8px;line-height:1.4">You are on the <b>test floor</b>. This goes on the improvement board like any feedback, marked as sent from here.</div>' : "") +
    '<textarea id="fbw-msg" rows="3" placeholder="' + (toAnetix ? "What is in the way, or what would help?" : "What is slowing you down?") + '" style="width:100%;border:1px solid #d5dbe3;border-radius:6px;padding:8px;font-size:14px;font-family:inherit;box-sizing:border-box"></textarea>' +
    '<div id="fbw-extras" style="display:none;margin-top:6px;font-size:12.5px;color:#51606f"></div>' +
    '<div id="fbw-who" style="display:none;font-size:13px;color:#51606f;margin-top:8px"></div>' +
    '<div id="fbw-mine" style="display:none;font-size:13px;margin-top:6px"></div>' +
    '<input id="fbw-name" placeholder="Your name (optional)" style="width:100%;border:1px solid #d5dbe3;border-radius:6px;padding:8px;font-size:14px;margin-top:8px;font-family:inherit;box-sizing:border-box">' +
    '<button id="fbw-send" style="margin:10px 0 0!important;width:100%!important;min-height:0!important;background:#2e7d4f!important;color:#fff!important;border:none!important;border-radius:6px!important;padding:11px!important;font-size:14px!important;font-weight:700!important;cursor:pointer">Send</button>' +
    '<div id="fbw-done" style="display:none;color:#2e7d4f;font-size:13px;margin-top:8px">' + (toAnetix ? "Sent to Anetix. You can follow it under My requests." : "Sent. It goes straight on the improvement board.") + '</div>';

  btn.onclick = () => {
    const open = panel.style.display === "none";
    if (!open) stopTalk(panel);
    panel.style.display = open ? "block" : "none";
  };

  // Talk instead of typing (assets/dictate.js): a mic button under each box the
  // person writes in. The board loads dictate.js itself; module pages only get
  // this widget injected, so it fetches the helper (same origin, so the module
  // page policy's script-src 'self' allows it). Where the browser cannot do
  // speech (Firefox) no button appears.
  function withTalk(cb) {
    if (window.Dictate) return cb(window.Dictate);
    let s = document.querySelector("script[data-sos-dictate]");
    if (!s) { s = document.createElement("script"); s.src = "/assets/dictate.js"; s.setAttribute("data-sos-dictate", "1"); document.head.appendChild(s); }
    s.addEventListener("load", () => { if (window.Dictate) cb(window.Dictate); });
  }
  function talkInto(el) { if (el) withTalk((D) => D.attach(el)); }
  function stopTalk(within) { if (window.Dictate) window.Dictate.stop(within); }

  function banner(text, color) {
    const news = document.getElementById("sos-news"); if (news) news.remove();   // one message at the top at a time
    const el = document.createElement("div");
    el.textContent = text;
    el.style.cssText = "position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:10000;background:" + (color || "#2e7d4f") + ";color:#fff;border-radius:20px;padding:10px 18px;font-size:14px;font-weight:700;box-shadow:0 4px 14px rgba(0,0,0,.25);font-family:system-ui,sans-serif;max-width:calc(100vw - 32px);text-align:center;";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 7000);
  }

  // Staged preview: a bar that never goes away, with a live-version reminder,
  // a "What changed" panel (the run's plain summary plus which screens differ
  // from the floor version, a text compare that costs no tokens), and an
  // outline on every element the build agent marked with data-changed="vN".
  let changes = null, changesOpen = false;
  function stagedBar(liveVersion) {
    let bar = document.getElementById("sos-staged-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "sos-staged-bar";
      bar.style.cssText = "position:sticky;top:0;z-index:10001;background:#c2620a;color:#fff;padding:9px 14px;font-size:13.5px;font-weight:700;font-family:system-ui,sans-serif;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.25);";
      document.body.insertBefore(bar, document.body.firstChild);
      document.body.style.borderTop = "4px dashed #c2620a";
      const st = document.createElement("style");
      st.textContent = '[data-changed="v' + version + '"]{outline:3px solid #f2b134!important;outline-offset:3px;box-shadow:0 0 0 6px rgba(242,177,52,.25)!important;position:relative;}' +
        '[data-changed="v' + version + '"]::after{content:"NEW";position:absolute;top:-10px;right:-6px;background:#f2b134;color:#1c242e;font:800 9px/1 system-ui,sans-serif;padding:3px 5px;border-radius:6px;letter-spacing:.06em;z-index:10000;}' +
        '#sos-changes{display:none;background:#fff;color:#1c242e;text-align:left;font-weight:400;font-size:13px;line-height:1.45;border-radius:10px;padding:10px 12px;margin:8px auto 0;max-width:720px;box-shadow:0 4px 14px rgba(0,0,0,.2);}' +
        '#sos-changes b{display:block;margin-bottom:4px;} #sos-changes .scr{display:inline-block;background:#fbefe0;color:#c2620a;border-radius:10px;padding:2px 8px;font-size:11.5px;font-weight:700;margin:4px 4px 0 0;} #sos-changes .here{background:#f2b134;color:#1c242e;}';
      document.head.appendChild(st);
      fetch("/api/c/" + company + "/modules/" + mod + "/staged-changes", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((j) => { changes = j; renderChanges(); }).catch(() => {});
    }
    const back = location.pathname.replace("/staging/", "/");
    const marked = document.querySelectorAll('[data-changed="v' + version + '"]').length;
    bar.innerHTML = "PREVIEW of version " + version + " (not on the floor)" + (liveVersion ? " · the floor is on version " + liveVersion : "") +
      ' · <a href="#" id="sos-changes-toggle" style="color:#fff;text-decoration:underline">' + (changesOpen ? "hide what changed" : "what changed?") + "</a>" +
      (marked ? ' · <span style="background:#f2b134;color:#1c242e;border-radius:10px;padding:2px 8px;font-size:11.5px">' + marked + " highlighted on this screen</span>" : "") +
      ' · <a href="' + back + '" style="color:#fff;text-decoration:underline">open the live page</a>' +
      ' · <a href="' + boardHref + '" id="sos-bar-board" style="color:#fff;text-decoration:underline">back to the improvement board</a>' +
      '<div id="sos-changes"></div>';
    bar.querySelector("#sos-changes-toggle").onclick = (e) => { e.preventDefault(); changesOpen = !changesOpen; stagedBar(liveVersion); };
    renderChanges();
  }
  function renderChanges() {
    const box = document.getElementById("sos-changes");
    if (!box) return;
    box.style.display = changesOpen ? "block" : "none";
    if (!changesOpen) return;
    if (!changes) { box.innerHTML = "Loading what changed…"; return; }
    const rel = (location.pathname.match(/^\/c\/[^/]+\/staging\/m\/[^/]+(.*)$/) || [])[1] || "/";
    const files = changes.changed || [];
    let h = "<b>" + esc(changes.title || ("Version " + changes.staged_version + " against version " + changes.live_version)) + "</b>";
    h += "<div>" + esc(changes.what_changed || changes.build_summary || "No summary recorded for this build.").replace(/\n/g, "<br>") + "</div>";
    if ((changes.also || []).length) h += '<div style="margin-top:6px"><span style="color:#51606f;font-size:12px">Also in this preview, from earlier changes:</span>' + changes.also.map((x) => "<div>" + esc(x) + "</div>").join("") + "</div>";
    const here = rel.replace(/\/$/, "") || "/";
    const isHere = (route) => route && new RegExp("^" + route.replace(/\/$/, "").replace(/:[^/]+/g, "[^/]+") + "/?$").test(here);
    let onThis = false;
    if (files.length) {
      h += '<div style="margin-top:6px"><span style="color:#51606f;font-size:12px">Screens that differ from the floor version (tap to open):</span><br>' +
        files.map((f) => f.screens.map((sc) => {
          const hit = isHere(sc.route); if (hit) onThis = true;
          const label = esc(sc.label) + (f.added ? " (new)" : f.removed ? " (removed)" : "") + (hit ? " · this screen" : "");
          return sc.route && !hit ? '<a class="scr" style="text-decoration:none" href="' + modBase() + (sc.route === "/" ? "/" : sc.route.replace(/:[^/]+/g, "1")) + '">' + label + "</a>" : '<span class="scr' + (hit ? " here" : "") + '">' + label + "</span>";
        }).join("")).join("") + "</div>";
    } else h += '<div style="color:#51606f;font-size:12px;margin-top:6px">No file differs from the floor version.</div>';
    const marked = document.querySelectorAll('[data-changed="v' + version + '"]').length;
    h += '<div style="color:#51606f;font-size:12px;margin-top:6px">' + (onThis
      ? (marked ? (marked === 1 ? "1 element on this screen carries" : marked + " elements on this screen carry") + " a yellow outline and a NEW tag." : "This screen changed; the agent did not tag which elements, so compare against the live page.")
      : "This screen is the same as on the floor. The change is on the screens above.") + "</div>";
    // changes join the preview (src/pipeline.js): what is asked for here is built on top of it, and it all goes live together
    h += '<div style="color:#51606f;font-size:12px;margin-top:6px">Want something else changed? Ask with the feedback button on this preview. It is built on top of what is here, and everything goes live together.</div>';
    box.innerHTML = h;
  }

  // The test floor's bar: never goes away, says what is on the floor, offers the way back. The page reloads when
  // the test floor moves to another version or its data was put back, and leaves when the floor is switched off.
  let testBuilt = null;
  function testBar(j) {
    let bar = document.getElementById("sos-test-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "sos-test-bar";
      bar.style.cssText = "position:sticky;top:0;z-index:10001;background:#5b3fa0;color:#fff;padding:9px 14px;font-size:13.5px;font-weight:700;font-family:system-ui,sans-serif;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.25);";
      document.body.insertBefore(bar, document.body.firstChild);
      document.body.style.borderTop = "4px dashed #5b3fa0";
    }
    const back = location.pathname.replace("/test/", "/");
    const had = document.getElementById("sos-test-step");
    bar.innerHTML = "TEST FLOOR. Nothing here is real." + (j && j.live_version ? " The floor is on version " + j.live_version + (String(j.live_version) !== String(version) ? "; this is version " + version + " under test" : "") + "." : "") +
      ' · <a href="' + back + '" style="color:#fff;text-decoration:underline">open the live page</a>' +
      ' · <a href="' + boardHref + '" id="sos-bar-board" style="color:#fff;text-decoration:underline">back to the improvement board</a>' +
      '<div id="sos-test-step"></div>';
    if (had) document.getElementById("sos-test-step").innerHTML = had.innerHTML;
  }
  // The guided steps of a test campaign for THIS screen (src/campaign.js, GET /api/c/<co>/who/campaign): what to
  // do, and whether the platform has seen it. Done and Not right go straight from here, with the signed-in
  // person's name when there is one.
  let stepOpen = null;   // "campaign:case:n" whose "not right" box is open
  async function loadSteps() {
    const box = document.getElementById("sos-test-step");
    if (!box) return;
    let j = null;
    try { const r = await fetch("/api/c/" + company + "/who/campaign?module=" + encodeURIComponent(mod) + "&page=" + encodeURIComponent(location.pathname), { cache: "no-store" }); if (r.ok) j = await r.json(); } catch (e) {}
    const steps = (j && j.steps) || [];
    if (!steps.length) { box.innerHTML = ""; box.style.display = "none"; return; }
    box.style.display = "block";
    box.style.cssText = "display:block;background:#fff;color:#1c242e;text-align:left;font-weight:400;font-size:13.5px;line-height:1.45;border-radius:10px;padding:10px 12px;margin:8px auto 0;max-width:720px;box-shadow:0 4px 14px rgba(0,0,0,.2);";
    box.innerHTML = steps.map((s) => {
      const key = s.campaign_id + ":" + s.case + ":" + s.n;
      const state = s.state === "seen" ? '<span style="color:#2e7d4f;font-weight:700">&#10003; Seen by the platform' + (s.saw ? " (" + esc(s.saw) + ")" : "") + '. That is what should happen.</span>'
        : s.state === "done" ? '<span style="color:#2e7d4f;font-weight:700">&#10003; Done' + (s.by ? " (" + esc(s.by) + ")" : "") + '</span>'
        : s.state === "not_right" ? '<span style="color:#b3261e;font-weight:700">Not right' + (s.by ? " (" + esc(s.by) + ")" : "") + '</span>'
        : '<span style="color:#7a4a00;font-weight:700">' + (s.watched ? (s.timed_out ? "The platform stopped watching; tap Done when it is done." : "We are watching for it.") : "Tap Done when it is done.") + '</span>';
      let h = '<div style="margin-top:4px"><b style="color:#3e2a73">Test step ' + s.n + ':</b> ' + esc(s.do) + '<br>' + state;
      if (["waiting", "seen"].includes(s.state)) {
        if (stepOpen === key) h += '<div style="margin-top:4px"><textarea id="sos-nr" placeholder="What did you see?" style="width:100%;min-height:44px;font:inherit;font-size:13px;border:1px solid #d5dbe3;border-radius:6px;padding:6px;box-sizing:border-box"></textarea><button data-nr="' + key + '" style="margin-top:4px;background:#b3261e;color:#fff;border:none;border-radius:6px;padding:7px 10px;font-weight:700;cursor:pointer">Send: not right</button> <button data-nm="1" style="margin-top:4px;background:#e9edf2;color:#1c242e;border:none;border-radius:6px;padding:7px 10px;cursor:pointer">Never mind</button></div>';
        else h += '<div style="margin-top:4px">' + (s.state === "waiting" ? '<button data-done="' + key + '" style="background:#2e7d4f;color:#fff;border:none;border-radius:6px;padding:7px 12px;font-weight:700;cursor:pointer">Done</button> ' : "") + '<button data-open="' + key + '" style="background:#e9edf2;color:#1c242e;border:none;border-radius:6px;padding:7px 10px;cursor:pointer">Not right</button></div>';
      }
      return h + "</div>";
    }).join("");
    box.querySelectorAll("[data-done]").forEach((b) => { b.onclick = () => answerStep(b.getAttribute("data-done"), "done", ""); });
    box.querySelectorAll("[data-open]").forEach((b) => { b.onclick = () => { stepOpen = b.getAttribute("data-open"); loadSteps(); }; });
    box.querySelectorAll("[data-nm]").forEach((b) => { b.onclick = () => { stepOpen = null; loadSteps(); }; });
    box.querySelectorAll("[data-nr]").forEach((b) => { b.onclick = () => { const ta = document.getElementById("sos-nr"); const what = ta ? ta.value.trim() : ""; if (what.length < 3) { if (ta) ta.focus(); return; } answerStep(b.getAttribute("data-nr"), "not_right", what); }; });
  }
  async function answerStep(key, answer, what) {
    const [campaignId, caseId, n] = key.split(":");
    try {
      const r = await fetch("/api/c/" + company + "/who/campaign/steps/" + campaignId + "/" + encodeURIComponent(caseId) + "/" + n, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer, what }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); banner(j.error || "That did not go through.", "#b3261e"); }
    } catch (e) {}
    stepOpen = null;
    loadSteps();
  }
  let justUpdated = null;   // set when this load is the reload after a deploy; loadNews() turns it into a banner
  function watchVersion() {
    if (!mod || !version || mod === "platform") return;
    if (onTest) {
      testBar(null);
      const probe = async () => {
        try {
          const r = await fetch("/api/c/" + company + "/modules/" + mod + "/version?lane=test", { cache: "no-store" });
          if (!r.ok) return;
          const j = await r.json();
          if (!j.test_floor) { banner("The test floor was switched off. Opening the live page.", "#51606f"); setTimeout(() => location.href = location.pathname.replace("/test/", "/"), 2500); return; }
          testBar(j);
          if (j.test_version && String(j.test_version) !== String(version)) { location.reload(); return; }
          if (testBuilt === null) testBuilt = j.test_built_at || "";
          else if ((j.test_built_at || "") !== testBuilt) { banner("The test floor's data was put back. Reloading.", "#5b3fa0"); setTimeout(() => location.reload(), 1500); testBuilt = j.test_built_at || ""; }
        } catch (e) {}
        if (!stepOpen) loadSteps();   // the guided step for this screen, unless a person is typing in it
      };
      probe();
      setInterval(probe, 5000);
      return;
    }
    const key = "sos.updated." + company + "." + mod;
    try {
      const v = sessionStorage.getItem(key);
      if (v) { sessionStorage.removeItem(key); justUpdated = v; }
    } catch (e) {}
    const probe = async () => {
      try {
        const r = await fetch("/api/c/" + company + "/modules/" + mod + "/version", { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        if (staged) {
          stagedBar(j.live_version);
          if (!j.staged_version) { banner("This preview is gone (deployed or discarded). Opening the live page.", "#51606f"); setTimeout(() => location.href = location.pathname.replace("/staging/", "/"), 2500); }
          else if (String(j.staged_version) !== String(version)) location.reload();
          return;
        }
        if (j.live_version && String(j.live_version) !== String(version)) {
          try { sessionStorage.setItem(key, String(j.live_version)); } catch (e) {}
          location.reload();
        }
      } catch (e) {}
    };
    if (staged) stagedBar(null);
    probe();
    setInterval(probe, 5000);
  }

  // ---- guided tour ----------------------------------------------------------
  // Started with ?tour=1 on any page of the module (the admin library links
  // there). Steps come from the module's tour.json: { path, target, title, body }.
  // The step index lives in sessionStorage so the tour survives moving between
  // the module's pages; a step whose target is not on this page shows centered.
  const TOUR_KEY = "sos.tour." + company + "." + mod;
  function tourState() { try { return JSON.parse(sessionStorage.getItem(TOUR_KEY) || "null"); } catch (e) { return null; } }
  function setTour(st) { try { st ? sessionStorage.setItem(TOUR_KEY, JSON.stringify(st)) : sessionStorage.removeItem(TOUR_KEY); } catch (e) {} }
  function modBase() { return (location.pathname.match(/^\/c\/[^/]+\/(?:staging\/|test\/)?m\/[^/]+/) || [""])[0]; }
  function relPath() { return location.pathname.slice(modBase().length) || "/"; }

  async function maybeTour() {
    if (!mod || mod === "platform") return;
    const params = new URLSearchParams(location.search);
    let st = tourState();
    if (params.get("tour")) {
      // &step=N (1 based): Ask Anetix's Show me button opens the tour at the step that answers the question
      const n = Number(params.get("step"));
      st = { i: Number.isInteger(n) && n > 0 ? n - 1 : 0 };
      setTour(st);
      history.replaceState(null, "", location.pathname);
    }
    if (!st) return;
    let tour;
    try { const r = await fetch("/api/c/" + company + "/modules/" + mod + "/tour"); tour = r.ok ? await r.json() : null; } catch (e) {}
    if (!tour || !tour.steps || !tour.steps.length) { setTour(null); return; }
    showStep(tour, st.i);
  }

  function showStep(tour, i) {
    const steps = tour.steps;
    if (i < 0) i = 0;
    if (i >= steps.length) { endTour(true); return; }
    const step = steps[i];
    const here = relPath().replace(/\/$/, "") || "/";
    const want = (step.path || "/").replace(/\/$/, "") || "/";
    if (here !== want) { setTour({ i }); location.href = modBase() + (want === "/" ? "/" : want); return; }
    setTour({ i });
    let target = null;
    try { target = step.target ? document.querySelector(step.target) : null; } catch (e) {}
    if (target && target.getClientRects().length === 0) target = null;
    renderTour(tour, i, target);
  }

  let tourEls = [];
  function clearTour() { for (const el of tourEls) el.remove(); tourEls = []; window.removeEventListener("resize", tourReflow); window.removeEventListener("scroll", tourReflow, true); }
  let tourReflow = () => {};
  function renderTour(tour, i, target) {
    clearTour();
    const step = tour.steps[i], n = tour.steps.length;
    const dim = document.createElement("div");
    dim.style.cssText = "position:fixed;inset:0;z-index:10002;background:rgba(15,23,32,.55);";
    const ring = document.createElement("div");
    ring.style.cssText = "position:fixed;z-index:10003;border:3px solid #f2b134;border-radius:10px;box-shadow:0 0 0 9999px rgba(15,23,32,.55);pointer-events:none;display:none;";
    const card = document.createElement("div");
    card.style.cssText = "position:fixed;z-index:10004;background:#fff;color:#1c242e;border-radius:12px;padding:16px 18px;width:340px;max-width:calc(100vw - 24px);box-shadow:0 10px 30px rgba(0,0,0,.35);font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;";
    card.innerHTML =
      '<div style="font-size:11px;color:#51606f;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">' + (i === 0 && tour.title ? tour.title + " · " : "") + "step " + (i + 1) + " of " + n + "</div>" +
      '<div style="font-weight:800;font-size:16px;margin-bottom:6px">' + esc(step.title || "") + "</div>" +
      (i === 0 && tour.intro ? '<div style="color:#51606f;font-size:13px;margin-bottom:8px">' + esc(tour.intro) + "</div>" : "") +
      "<div>" + esc(step.body || "") + "</div>" +
      (target ? "" : '<div style="color:#51606f;font-size:12px;margin-top:6px">(This part is not on the screen right now, for example when there is no shift running.)</div>') +
      '<div style="display:flex;gap:8px;margin-top:14px;align-items:center">' +
      '<button id="sos-tour-back" style="all:unset;cursor:pointer;padding:8px 12px;border-radius:8px;background:#e5e9ee;font-weight:700;font-size:13px;' + (i === 0 ? "opacity:.4;pointer-events:none;" : "") + '">Back</button>' +
      '<button id="sos-tour-next" style="all:unset;cursor:pointer;padding:8px 14px;border-radius:8px;background:#1f3a5f;color:#fff;font-weight:700;font-size:13px">' + (i === n - 1 ? "Finish" : "Next") + "</button>" +
      '<button id="sos-tour-end" style="all:unset;cursor:pointer;margin-left:auto;color:#51606f;font-size:12.5px">End tour</button></div>';
    document.body.appendChild(target ? ring : dim);
    document.body.appendChild(card);
    tourEls = [target ? ring : dim, card];
    tourReflow = () => {
      // pages re-render themselves on a timer, so find the target again each time
      if (target) { try { const t2 = document.querySelector(step.target); if (t2 && t2.getClientRects().length) target = t2; } catch (e) {} }
      if (target) {
        const r = target.getBoundingClientRect();
        ring.style.display = "block";
        ring.style.left = (r.left - 6) + "px"; ring.style.top = (r.top - 6) + "px";
        ring.style.width = (r.width + 12) + "px"; ring.style.height = (r.height + 12) + "px";
        const below = r.bottom + 12 + card.offsetHeight < window.innerHeight;
        card.style.left = Math.max(12, Math.min(r.left, window.innerWidth - card.offsetWidth - 12)) + "px";
        card.style.top = (below ? r.bottom + 12 : Math.max(12, r.top - card.offsetHeight - 12)) + "px";
      } else {
        card.style.left = Math.max(12, (window.innerWidth - card.offsetWidth) / 2) + "px";
        card.style.top = Math.max(12, (window.innerHeight - card.offsetHeight) / 2) + "px";
      }
    };
    if (target) target.scrollIntoView({ block: "center", behavior: "instant" });
    tourReflow();
    window.addEventListener("resize", tourReflow);
    window.addEventListener("scroll", tourReflow, true);
    const tick = setInterval(tourReflow, 1000);
    tourEls.push({ remove: () => clearInterval(tick) });
    card.querySelector("#sos-tour-next").onclick = () => showStep(tour, i + 1);
    card.querySelector("#sos-tour-back").onclick = () => showStep(tour, i - 1);
    card.querySelector("#sos-tour-end").onclick = () => endTour(false);
  }
  function endTour(finished) {
    clearTour(); setTour(null);
    if (finished) banner("End of the tour. This is the live line: try the feedback button.", "#1f3a5f");
  }
  function esc(t) { return String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  // ---- who is standing here: a name and a PIN (src/people.js) ----------------------------
  // The device stays signed in with the company's password; the person is
  // picked from the company's names and proven with a short PIN. A shared
  // tablet changes hands from the chip in this panel. window.sosPerson lets
  // the platform's own pages (the board) show and switch the same person.
  const who = { people: [], me: null, listeners: [] };
  const peopleApi = (p, opts) => fetch("/api/c/" + encodeURIComponent(company) + "/who" + p, Object.assign({ credentials: "same-origin" }, opts || {}));
  async function loadWho() {
    try { const r = await peopleApi("", { cache: "no-store" }); if (r.ok) { const j = await r.json(); who.people = j.people || []; who.me = j.me || null; who.account = j.account || null; who.photos = j.photos !== false; drawExtras(); } } catch (e) { /* the list is a nicety; the button works without it */ }
    renderWho(); who.listeners.forEach((f) => { try { f(who.me); } catch (e) {} });
  }
  const BTN_ICON = btn.innerHTML;
  function renderWho() {
    // the button itself says who is signed in (a name can stay on a shared tablet for days now, so it is never hidden)
    const shown = who.me || who.account;
    btn.innerHTML = BTN_ICON + (shown ? ' <span id="sos-fb-me" style="opacity:.85;font-weight:600">\u00b7 ' + esc(shown.name) + "</span>" : "");
    const el = panel.querySelector("#fbw-who"), nameEl = panel.querySelector("#fbw-name"); if (!el) return;
    if (who.me) { el.style.display = "block"; nameEl.style.display = "none"; el.innerHTML = "Sending as <b>" + esc(who.me.name) + "</b> · <a href=\"#\" id=\"fbw-switch\" style=\"color:#1f3a5f\">not you?</a>"; }
    // a named account (signed in with a code): the server files under its name, so there is nothing to type
    else if (who.account) { el.style.display = "block"; nameEl.style.display = "none"; el.innerHTML = "Sending as <b>" + esc(who.account.name) + "</b>" + (who.people.length ? " · <a href=\"#\" id=\"fbw-switch\" style=\"color:#1f3a5f\">someone else?</a>" : ""); }
    else if (who.people.length) { el.style.display = "block"; nameEl.style.display = ""; el.innerHTML = "<a href=\"#\" id=\"fbw-switch\" style=\"color:#1f3a5f;font-weight:700\">Tap your name</a> so this comes back to you, or just type it below."; }
    else { el.style.display = "none"; nameEl.style.display = ""; }
    const sw = panel.querySelector("#fbw-switch"); if (sw) sw.onclick = (e) => { e.preventDefault(); openPicker(); };
  }
  let picker = null;
  // the PIN pad listens to the keyboard only while it is open, as a listener of its own:
  // it never touches a handler the page set, and digits typed for the PIN never land in a field behind it
  let keyHandler = null;
  function setKeys(h) { if (keyHandler) document.removeEventListener("keydown", keyHandler, true); keyHandler = h; if (h) document.addEventListener("keydown", h, true); }
  function closePicker() { setKeys(null); if (picker) { picker.remove(); picker = null; } }
  const bigBtn = "display:block;width:100%;text-align:left;margin:6px 0;padding:14px;border:1px solid #d5dbe3;border-radius:10px;background:#f2f4f7;font:700 16px system-ui,sans-serif;color:#1c242e;cursor:pointer;min-height:0";
  function openPicker() {
    closePicker();
    picker = document.createElement("div");
    picker.style.cssText = "position:fixed;inset:0;background:rgba(28,36,46,.55);z-index:10001;display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,sans-serif";
    const card = document.createElement("div");
    card.style.cssText = "background:#fff;color:#1c242e;border-radius:14px;padding:18px;width:100%;max-width:380px;max-height:90vh;overflow:auto";
    picker.appendChild(card); picker.onclick = (e) => { if (e.target === picker) closePicker(); };
    document.body.appendChild(picker);
    names(card);
  }
  function names(card) {
    setKeys(null);
    card.innerHTML = "<div style=\"font-size:18px;font-weight:700;margin-bottom:6px\">Who is this?</div>" + (who.people.length ? "" : "<div style=\"color:#51606f;font-size:14px\">No names yet. A manager adds people from the improvement board.</div>");
    who.people.forEach((p) => { const b = document.createElement("button"); b.style.cssText = bigBtn; b.textContent = p.name; b.onclick = () => pinPad(card, p); card.appendChild(b); });
    const row = document.createElement("div"); row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-top:8px";
    if (who.me) { const out = document.createElement("button"); out.textContent = "Nobody (sign " + who.me.name + " out)"; out.style.cssText = "padding:10px 12px;border:1px solid #d5dbe3;border-radius:8px;background:#fff;font:14px system-ui,sans-serif;cursor:pointer;min-height:0;width:auto"; out.onclick = async () => { await peopleApi("/sign-out", { method: "POST" }); closePicker(); loadWho(); }; row.appendChild(out); }
    const no = document.createElement("button"); no.textContent = "Cancel"; no.style.cssText = "padding:10px 12px;border:none;border-radius:8px;background:#e5e9ee;font:700 14px system-ui,sans-serif;cursor:pointer;min-height:0;width:auto"; no.onclick = closePicker; row.appendChild(no);
    card.appendChild(row);
  }
  // opened straight to one name's PIN pad, from the board's approval buttons: the same pad, a line saying why,
  // and `done` once the PIN is in (window.sosPerson.pin)
  let afterPin = null;
  function pinFor(person, done, why) {
    closePicker();
    picker = document.createElement("div");
    picker.style.cssText = "position:fixed;inset:0;background:rgba(28,36,46,.55);z-index:10001;display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,sans-serif";
    const card = document.createElement("div");
    card.style.cssText = "background:#fff;color:#1c242e;border-radius:14px;padding:18px;width:100%;max-width:380px;max-height:90vh;overflow:auto";
    picker.appendChild(card); picker.onclick = (e) => { if (e.target === picker) { afterPin = null; closePicker(); } };
    document.body.appendChild(picker);
    afterPin = done || null;
    pinPad(card, { id: person.id, name: person.name }, why);
  }
  function pinPad(card, p, why) {
    let pin = "";
    card.innerHTML = "<div style=\"font-size:18px;font-weight:700\">" + esc(p.name) + "</div>" + (why ? "<div style=\"color:#c2620a;font-size:13.5px;font-weight:700;margin:4px 0\">" + esc(why) + "</div>" : "") + "<div style=\"color:#51606f;font-size:14px;margin:2px 0 10px\">Your PIN</div><div id=\"fbw-dots\" style=\"font-size:30px;letter-spacing:10px;min-height:40px;text-align:center\"></div><div id=\"fbw-pinerr\" style=\"color:#b3261e;font-size:13px;min-height:18px;text-align:center\"></div><div id=\"fbw-pad\" style=\"display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:6px\"></div>";
    const dots = card.querySelector("#fbw-dots"), err = card.querySelector("#fbw-pinerr"), pad = card.querySelector("#fbw-pad");
    const draw = () => { dots.textContent = "\u2022".repeat(pin.length); };
    const go = async () => {
      if (pin.length < 4) { err.textContent = "A PIN is at least 4 digits."; return; }
      const r = await peopleApi("/sign-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id, pin }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { pin = ""; draw(); err.textContent = j.error || "That did not work."; return; }
      closePicker(); await loadWho();
      const then = afterPin; afterPin = null; if (then) { try { then(); } catch (e) {} }
    };
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "back", "0", "OK"].forEach((k) => {
      const b = document.createElement("button"); b.textContent = k === "back" ? "\u232b" : k;
      b.style.cssText = "padding:16px 0;border:1px solid #d5dbe3;border-radius:10px;background:" + (k === "OK" ? "#2e7d4f" : "#f2f4f7") + ";color:" + (k === "OK" ? "#fff" : "#1c242e") + ";font:700 20px system-ui,sans-serif;cursor:pointer;min-height:0;width:auto;margin:0";
      b.onclick = () => { err.textContent = ""; if (k === "back") pin = pin.slice(0, -1); else if (k === "OK") return go(); else if (pin.length < 8) pin += k; draw(); };
      pad.appendChild(b);
    });
    const back = document.createElement("button"); back.textContent = "Someone else"; back.style.cssText = "margin-top:10px;padding:10px 12px;border:none;border-radius:8px;background:#e5e9ee;font:700 14px system-ui,sans-serif;cursor:pointer;min-height:0;width:100%"; back.onclick = () => names(card); card.appendChild(back);
    setKeys((e) => {
      if (!picker) { setKeys(null); return; }
      const k = e.key; if (!/^\d$/.test(k) && !["Backspace", "Enter", "Escape"].includes(k)) return;
      e.preventDefault(); e.stopPropagation(); err.textContent = "";
      if (/^\d$/.test(k)) { if (pin.length < 8) pin += k; draw(); } else if (k === "Backspace") { pin = pin.slice(0, -1); draw(); } else if (k === "Enter") go(); else closePicker();
    });
  }
  // ---- close the loop (src/closeloop.js): my requests, what went live and who asked, fixed it / not quite ----
  const smallBtn = (bg, fg) => "padding:9px 12px;border:" + (bg === "#fff" ? "1px solid #d5dbe3" : "none") + ";border-radius:8px;background:" + bg + ";color:" + fg + ";font:700 13.5px system-ui,sans-serif;cursor:pointer;min-height:0;width:auto;margin:0";
  const mine = { requests: [], to_answer: 0 };
  async function loadMine() {
    const el = panel.querySelector("#fbw-mine"); if (!el) return;
    if (!who.me) { el.style.display = "none"; mine.requests = []; mine.to_answer = 0; checkQuestions(); return; }
    try { const r = await peopleApi("/requests", { cache: "no-store" }); if (r.ok) { const j = await r.json(); mine.requests = j.requests || []; mine.to_answer = j.to_answer || 0; } } catch (e) {}
    drawMineLink();
    checkQuestions();   // the proposer's one question, if one is waiting on this person
  }
  function drawMineLink() {
    const el = panel.querySelector("#fbw-mine"); if (!el || !who.me) return;
    el.style.display = "block";
    // a request the manager marked done since this device last opened My requests: a quiet green badge, never a pop-up
    const thankedNew = mine.requests.filter((r) => r.state === "thanked" && !thankedSeen().includes(r.id)).length;
    // a request to Anetix that Anetix touched (looked at it, a word back, fixed, not doing) since this device last opened the list
    const anetixNew = mine.requests.filter((r) => r.to_anetix && r.answered_at && anetixSeen()[r.id] !== r.answered_at).length;
    el.innerHTML = "<a href=\"#\" id=\"fbw-mine-open\" style=\"color:#1f3a5f;font-weight:700\">My requests</a>" + (mine.requests.length ? " <span style=\"color:#51606f\">(" + mine.requests.length + ")</span>" : "") +
      (mine.to_answer ? " <span style=\"background:#c2620a;color:#fff;border-radius:10px;padding:1px 8px;font-size:11.5px;font-weight:700\">" + mine.to_answer + " to check</span>" : "") +
      (thankedNew ? " <span id=\"fbw-thanked\" style=\"background:#2e7d4f;color:#fff;border-radius:10px;padding:1px 8px;font-size:11.5px;font-weight:700\">\u2713 " + thankedNew + " done</span>" : "") +
      (anetixNew ? " <span id=\"fbw-anetix-new\" style=\"background:#1f3a5f;color:#fff;border-radius:10px;padding:1px 8px;font-size:11.5px;font-weight:700\">Anetix answered" + (anetixNew > 1 ? " (" + anetixNew + ")" : "") + "</span>" : "");
    el.querySelector("#fbw-mine-open").onclick = (e) => { e.preventDefault(); openMine(); };
  }
  function sheet() {   // the same overlay the name picker uses
    closePicker();
    picker = document.createElement("div");
    picker.style.cssText = "position:fixed;inset:0;background:rgba(28,36,46,.55);z-index:10001;display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,sans-serif";
    const card = document.createElement("div");
    card.style.cssText = "background:#fff;color:#1c242e;border-radius:14px;padding:18px;width:100%;max-width:460px;max-height:90vh;overflow:auto;font-size:14px;line-height:1.45";
    picker.appendChild(card); picker.onclick = (e) => { if (e.target === picker) closePicker(); };
    document.body.appendChild(picker);
    return card;
  }
  const STATE_COLOR = { question: "#1f3a5f", live: "#c2620a", fixed: "#2e7d4f", thanked: "#2e7d4f", not_quite: "#c2620a", little_left: "#c2620a", declined: "#b3261e", rolled_back: "#b3261e",
    anetix_looking: "#1f3a5f", anetix_working: "#1f3a5f", anetix_fixed: "#2e7d4f", anetix_not_doing: "#b3261e" };
  // which touches by Anetix this device has already shown its person: request id -> the answered_at it saw
  const anetixKey = "sos.anetix." + company;
  function anetixSeen() { try { return JSON.parse(localStorage.getItem(anetixKey) || "{}") || {}; } catch (e) { return {}; } }
  function markAnetixSeen() {
    const seen = anetixSeen();
    for (const r of mine.requests) if (r.to_anetix && r.answered_at) seen[r.id] = r.answered_at;
    const ids = Object.keys(seen).map(Number).sort((a, b) => a - b).slice(-200);
    try { localStorage.setItem(anetixKey, JSON.stringify(Object.fromEntries(ids.map((id) => [id, seen[id]])))); } catch (e) {}
  }
  // which "marked done" requests this device has already shown its person (per company, so the badge shows once)
  const thankedKey = "sos.thanked." + company;
  function thankedSeen() { try { return JSON.parse(localStorage.getItem(thankedKey) || "[]") || []; } catch (e) { return []; } }
  function markThankedSeen() {
    const ids = mine.requests.filter((r) => r.state === "thanked").map((r) => r.id);
    try { localStorage.setItem(thankedKey, JSON.stringify([...new Set(thankedSeen().concat(ids))].slice(-200))); } catch (e) {}
  }
  const TICK = "<span style=\"display:inline-block;width:17px;height:17px;line-height:17px;border-radius:50%;background:#2e7d4f;color:#fff;text-align:center;font-size:11.5px;font-weight:700;margin-right:6px\">\u2713</span>";
  function openMine() {
    const card = sheet();
    markThankedSeen(); markAnetixSeen(); drawMineLink();
    const draw = () => {
      card.innerHTML = "<div style=\"display:flex;justify-content:space-between;align-items:center;margin-bottom:8px\"><div style=\"font-size:18px;font-weight:700\">My requests</div><button id=\"fbw-mine-close\" style=\"" + smallBtn("#e5e9ee", "#1c242e") + "\">Close</button></div>" +
        (mine.requests.length ? "" : "<div style=\"color:#51606f\">Nothing yet. When you send something from this button it shows up here, and you can see where it is.</div>");
      card.querySelector("#fbw-mine-close").onclick = closePicker;
      mine.requests.forEach((r) => {
        const row = document.createElement("div");
        row.setAttribute("data-request", r.id);
        row.style.cssText = "border:1px solid #d5dbe3;border-radius:10px;padding:10px 12px;margin:8px 0";
        row.innerHTML = "<div style=\"font-weight:700\">“" + esc(r.words) + "”</div>" +
          "<div style=\"color:#51606f;font-size:12px;margin:2px 0 6px\">#" + r.id + " · " + (r.to_anetix ? (r.integration ? "connecting " + esc(r.integration.system || "an outside system") + ", to Anetix's integration team" : "the software itself, to Anetix") : esc(r.module || "")) + (r.screen ? " · " + esc(r.screen) : "") + " · " + new Date(r.created_at).toLocaleDateString() + (r.follow_up_of ? " · follow-up to #" + r.follow_up_of : "") + "</div>" +
          "<div data-line style=\"color:" + (STATE_COLOR[r.state] || "#1c242e") + ";font-weight:" + (r.state === "live" || r.state === "thanked" || r.state === "question" || r.state === "anetix_fixed" ? 700 : 400) + "\">" + (r.state === "thanked" || r.state === "anetix_fixed" ? TICK : "") + esc(r.line) + (r.follow_up_id && (r.state === "not_quite" || r.state === "little_left") ? " (#" + r.follow_up_id + ")" : "") + "</div>" +
          (r.built ? "<div style=\"color:#51606f;font-size:12.5px;margin-top:4px\">What was built: " + esc(r.built) + "</div>" : "");
        if (r.can_answer) row.appendChild(answerButtons(r, async () => { await loadMine(); draw(); }));
        if (r.state === "question" && r.question) {
          const qt = document.createElement("div"); qt.setAttribute("data-qtext", "1"); qt.style.cssText = "font-weight:700;margin-top:6px"; qt.textContent = r.question.text; row.appendChild(qt);
          row.appendChild(questionButtons({ id: r.id, token: "", question: r.question }, async () => { await loadMine(); draw(); }));
        }
        card.appendChild(row);
      });
    };
    draw();
  }
  // [Fixed it] [Not quite]; not quite asks what is still off and sends that as a follow-up request
  function answerButtons(r, done) {
    const box = document.createElement("div"); box.style.cssText = "margin-top:8px";
    const send = async (body, errEl) => {
      const res = await peopleApi("/requests/" + r.id + "/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { errEl.textContent = j.error || "That did not go through."; return null; }
      return j;
    };
    const ask = () => {
      box.innerHTML = "<div data-err style=\"color:#b3261e;font-size:12.5px;min-height:0\"></div>";
      const row = document.createElement("div"); row.style.cssText = "display:flex;gap:8px;flex-wrap:wrap";
      const err = box.querySelector("[data-err]");
      const settled = r.state === "fixed" || r.state === "thanked";   // already closed (by them, or by the manager): only the quiet way back is left
      if (!settled) {
        const yes = document.createElement("button"); yes.textContent = "Fixed it"; yes.setAttribute("data-answer", "fixed"); yes.style.cssText = smallBtn("#2e7d4f", "#fff");
        yes.onclick = async () => { const j = await send({ answer: "fixed" }, err); if (j) { banner("Thanks. Good to know it worked."); done(j); } };
        row.appendChild(yes);
      }
      const no = document.createElement("button"); no.textContent = settled ? "Actually, not quite" : "Not quite"; no.setAttribute("data-answer", "not_quite"); no.style.cssText = settled ? smallBtn("#fff", "#51606f") : smallBtn("#c2620a", "#fff");
      no.onclick = still;
      row.appendChild(no); box.appendChild(row);
    };
    const still = () => {
      box.innerHTML = "<div style=\"font-weight:700;margin-bottom:4px\">What is still off?</div><textarea data-still rows=\"3\" placeholder=\"Say it the way you would tell the manager\" style=\"width:100%;border:1px solid #d5dbe3;border-radius:6px;padding:8px;font:14px system-ui,sans-serif;box-sizing:border-box\"></textarea><div data-err style=\"color:#b3261e;font-size:12.5px;min-height:16px\"></div>";
      const row = document.createElement("div"); row.style.cssText = "display:flex;gap:8px";
      const go = document.createElement("button"); go.textContent = "Send"; go.setAttribute("data-send", "1"); go.style.cssText = smallBtn("#2e7d4f", "#fff");
      const back = document.createElement("button"); back.textContent = "Back"; back.style.cssText = smallBtn("#e5e9ee", "#1c242e"); back.onclick = ask;
      go.onclick = async () => {
        stopTalk(box);
        const what = box.querySelector("[data-still]").value.trim(), err = box.querySelector("[data-err]");
        if (what.length < 3) { err.textContent = "A few words on what is still off."; return; }
        const j = await send({ answer: "not_quite", what }, err);
        if (j) { banner("Sent. It is back on the board as #" + j.follow_up.id + ", tied to your first request.", "#1f3a5f"); done(j); }
      };
      row.appendChild(go); row.appendChild(back); box.appendChild(row);
      talkInto(box.querySelector("[data-still]"));
      setTimeout(() => { const ta = box.querySelector("[data-still]"); if (ta) ta.focus(); }, 0);
    };
    ask();
    return box;
  }
  // ---- propose on arrival (src/arrival.js): point at it, add a photo, and the proposer's one question --------
  // What the person points at and a photo ride along with the words and go to the proposer, so "this number"
  // and "that button" mean something. Module pages only.
  const extra = { element: null, photo: null };
  const onModule = Boolean(mod && mod !== "platform");
  const linkBtn = "background:none!important;border:1px solid #d5dbe3!important;border-radius:14px!important;padding:4px 10px!important;margin:0 6px 0 0!important;width:auto!important;min-height:0!important;font:600 12.5px system-ui,sans-serif!important;color:#1f3a5f!important;cursor:pointer";
  function drawExtras() {
    const el = panel.querySelector("#fbw-extras"); if (!el) return;
    if (!onModule) { el.style.display = "none"; return; }
    el.style.display = "block";
    el.innerHTML =
      (extra.element ? "<span id=\"fbw-pointed\">Pointing at: <b>" + esc(String(extra.element.text || extra.element.label || "<" + extra.element.tag + ">").slice(0, 40)) + "</b> <a href=\"#\" id=\"fbw-unpoint\" style=\"color:#b3261e\">remove</a></span><br>" : "") +
      (extra.photo ? "<span id=\"fbw-photo-on\">Photo added <a href=\"#\" id=\"fbw-unphoto\" style=\"color:#b3261e\">remove</a></span><br>" : "") +
      (extra.element ? "" : "<button id=\"fbw-point\" style=\"" + linkBtn + "\">Point at it</button>") +
      (extra.photo || who.photos === false ? "" : "<button id=\"fbw-photo\" style=\"" + linkBtn + "\">Add a photo</button>") +
      "<input id=\"fbw-file\" type=\"file\" accept=\"image/*\" capture=\"environment\" style=\"display:none\"><span id=\"fbw-extra-err\" style=\"color:#b3261e\"></span>";
    const on = (id, f) => { const b = el.querySelector(id); if (b) b.onclick = (e) => { e.preventDefault(); f(); }; };
    on("#fbw-point", pickElement);
    on("#fbw-unpoint", () => { extra.element = null; drawExtras(); });
    on("#fbw-unphoto", () => { extra.photo = null; drawExtras(); });
    on("#fbw-photo", () => el.querySelector("#fbw-file").click());
    el.querySelector("#fbw-file").onchange = (e) => { const f = e.target.files && e.target.files[0]; if (f) takePhoto(f); };
  }
  // What an element is, cut down to what helps a reader who cannot see the screen.
  function describe(t) {
    const txt = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
    const name = (n) => n.tagName.toLowerCase() + (n.id ? "#" + n.id : "") + (n.classList && n.classList.length ? "." + [...n.classList].slice(0, 2).join(".") : "");
    const path = []; for (let n = t; n && n.nodeType === 1 && n !== document.body && path.length < 5; n = n.parentElement) path.unshift(name(n));
    const lab = t.getAttribute("aria-label") || t.getAttribute("title") || t.getAttribute("alt") || t.getAttribute("placeholder") || (t.id && document.querySelector("label[for=\"" + (window.CSS && CSS.escape ? CSS.escape(t.id) : t.id) + "\"]") || {}).textContent || "";
    const r = t.getBoundingClientRect();
    return { tag: t.tagName.toLowerCase(), id: t.id || "", classes: [...(t.classList || [])].slice(0, 6), text: txt(t.innerText || t.value || "").slice(0, 160), label: txt(lab).slice(0, 120), path: path.join(" > "), html: String(t.outerHTML || "").slice(0, 400), rect: { x: r.left, y: r.top, w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight } };
  }
  // A glass pane over the page takes the tap, so nothing on the page itself is pressed while pointing.
  function pickElement() {
    panel.style.display = "none";
    const pane = document.createElement("div"); pane.id = "sos-point";
    pane.style.cssText = "position:fixed;inset:0;z-index:10002;cursor:crosshair;background:rgba(31,58,95,.06)";
    const ring = document.createElement("div"); ring.style.cssText = "position:fixed;z-index:10003;border:3px solid #c2620a;border-radius:6px;pointer-events:none;display:none;box-sizing:border-box";
    const tip = document.createElement("div"); tip.textContent = "Tap the thing you mean."; tip.style.cssText = "position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:10004;background:#1f3a5f;color:#fff;border-radius:20px;padding:10px 16px;font:700 14px system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.25)";
    const cancel = document.createElement("button"); cancel.textContent = "Cancel"; cancel.style.cssText = "margin-left:12px;background:#fff;color:#1f3a5f;border:none;border-radius:12px;padding:4px 10px;font:700 12.5px system-ui,sans-serif;cursor:pointer;min-height:0;width:auto";
    tip.appendChild(cancel);
    const under = (x, y) => { pane.style.pointerEvents = "none"; let t = document.elementFromPoint(x, y); pane.style.pointerEvents = ""; while (t && (t === btn || panel.contains(t) || tip.contains(t))) t = null; return t && t !== document.documentElement && t !== document.body ? t : null; };
    const end = () => { pane.remove(); ring.remove(); tip.remove(); setKeys(null); panel.style.display = "block"; drawExtras(); };
    pane.onmousemove = (e) => { const t = under(e.clientX, e.clientY); if (!t) { ring.style.display = "none"; return; } const r = t.getBoundingClientRect(); ring.style.cssText += ";display:block;left:" + r.left + "px;top:" + r.top + "px;width:" + r.width + "px;height:" + r.height + "px"; };
    pane.onclick = (e) => { e.preventDefault(); e.stopPropagation(); const t = under(e.clientX, e.clientY); if (t) extra.element = describe(t); end(); };
    cancel.onclick = (e) => { e.stopPropagation(); end(); };
    setKeys((e) => { if (e.key === "Escape") { e.preventDefault(); end(); } });
    document.body.appendChild(pane); document.body.appendChild(ring); document.body.appendChild(tip);
  }
  // One photo, scaled down on the device (1600 px on the long side, JPEG) so it sends quickly from the floor's wifi.
  function takePhoto(file) {
    const err = panel.querySelector("#fbw-extra-err"), say = (m) => { if (err) err.textContent = m; };
    if (!/^image\//.test(file.type || "")) return say(" That is not a photo.");
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      try {
        const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight, 1));
        const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        const data = c.toDataURL("image/jpeg", 0.8);
        extra.photo = { mime: "image/jpeg", data: data.slice(data.indexOf(",") + 1) };
      } catch (e) { say(" The photo could not be read."); }
      URL.revokeObjectURL(url); drawExtras();
    };
    img.onerror = () => { URL.revokeObjectURL(url); say(" The photo could not be read."); };
    img.src = url;
  }

  // The proposer's ONE question: when the words could mean two different changes it asks the person instead of
  // guessing. It shows here, on the screen they are standing at, and in My requests. A request sent with nobody
  // signed in is answered from the device that sent it (it holds that request's token).
  const askKey = "sos.ask." + company;
  function sentList() { try { return (JSON.parse(localStorage.getItem(askKey) || "[]") || []).filter((x) => x && x.id && Date.now() - x.t < 48 * 3600000); } catch (e) { return []; } }
  function saveSent(list) { try { localStorage.setItem(askKey, JSON.stringify(list.slice(-5))); } catch (e) {} }
  let qCard = null, qTimer = null;
  const laterKey = (id) => "sos.q.later." + id;
  async function checkQuestions(until) {
    clearTimeout(qTimer);
    let open = null, reading = false;
    const list = sentList();
    for (const it of list.slice().reverse()) {
      let j = null;
      try { const r = await peopleApi("/question?id=" + it.id + "&token=" + encodeURIComponent(it.token || ""), { cache: "no-store" }); if (r.status === 404) { it.gone = true; continue; } if (r.ok) j = await r.json(); } catch (e) {}
      if (!j) continue;
      if (j.added_to && !it.told) { it.told = true; banner("Someone already asked for this. Yours was added to request #" + j.added_to + ", so you will hear back when it is done.", "#1f3a5f"); }
      if (j.reading) reading = true;
      if (j.question && !open) open = { id: it.id, token: it.token, words: it.words, question: j.question };
      if (j.proposed || j.added_to) it.gone = true;   // a proposal is drafted, or it was folded in: nothing more to ask this device
    }
    saveSent(list.filter((x) => !x.gone));
    // the signed-in person's own open question, wherever it was sent from
    if (!open) { const r = mine.requests.find((x) => x.state === "question" && x.question); if (r) open = { id: r.id, token: "", words: r.words, question: r.question }; }
    let later = false; try { later = open && sessionStorage.getItem(laterKey(open.id)) === "1"; } catch (e) {}
    if (open && !later) showQuestion(open); else if (qCard && (!open || later)) { qCard.remove(); qCard = null; }
    // look again every few seconds only while the proposer is reading something this device sent, and not for ever
    if (reading) { const cap = until || Date.now() + 120000; if (Date.now() < cap) qTimer = setTimeout(() => checkQuestions(cap), 3000); }
  }
  // Option buttons and a way to say it in their own words. done(j) runs after the answer is in.
  function questionButtons(item, done) {
    const box = document.createElement("div"); box.style.cssText = "margin-top:6px";
    const err = document.createElement("div"); err.style.cssText = "color:#b3261e;font-size:12.5px";
    const send = async (answer) => {
      const res = await peopleApi("/requests/" + item.id + "/reply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer, token: item.token || "" }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { err.textContent = j.error || "That did not go through."; if (res.status === 409) setTimeout(() => done(null), 1200); return; }
      banner("Thanks. That goes with your request."); done(j);
    };
    (item.question.options || []).forEach((o, i) => {
      const b = document.createElement("button"); b.textContent = o; b.setAttribute("data-option", String(i));
      b.style.cssText = "display:block;width:100%;text-align:left;margin:6px 0;padding:12px;border:1px solid #c9dcf0;border-radius:10px;background:#eef4fb;font:700 14.5px system-ui,sans-serif;color:#1c242e;cursor:pointer;min-height:0";
      b.onclick = () => send(o); box.appendChild(b);
    });
    const own = document.createElement("a"); own.href = "#"; own.textContent = "Say it in my own words"; own.setAttribute("data-own", "1"); own.style.cssText = "color:#1f3a5f;font-size:13px";
    own.onclick = (e) => {
      e.preventDefault(); own.remove();
      const ta = document.createElement("textarea"); ta.rows = 2; ta.maxLength = 500; ta.setAttribute("data-own-text", "1"); ta.style.cssText = "width:100%;border:1px solid #d5dbe3;border-radius:6px;padding:8px;font:14px system-ui,sans-serif;box-sizing:border-box;margin-top:4px";
      const go = document.createElement("button"); go.textContent = "Send"; go.setAttribute("data-own-send", "1"); go.style.cssText = smallBtn("#2e7d4f", "#fff") + ";margin-top:6px";
      go.onclick = () => { stopTalk(box); const v = ta.value.trim(); if (!v) { err.textContent = "A few words."; return; } send(v); };
      box.insertBefore(ta, err); box.insertBefore(go, err); talkInto(ta); ta.focus();
    };
    box.appendChild(own); box.appendChild(err);
    return box;
  }
  function showQuestion(item) {
    if (qCard && qCard.getAttribute("data-request") === String(item.id)) return;   // already up: do not redraw under a finger
    if (qCard) qCard.remove();
    qCard = document.createElement("div"); qCard.id = "sos-question"; qCard.setAttribute("data-request", item.id);
    qCard.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:9998;background:#fff;color:#1c242e;border:2px solid #1f3a5f;border-radius:12px;padding:12px 14px;width:340px;max-width:calc(100vw - 24px);box-shadow:0 6px 20px rgba(0,0,0,.25);font:14px/1.45 system-ui,sans-serif;box-sizing:border-box";
    qCard.innerHTML = "<div style=\"font-weight:700\">One quick question about what you sent</div>" + (item.words ? "<div style=\"color:#51606f;margin:4px 0\">“" + esc(item.words) + "”</div>" : "") + "<div data-qtext style=\"font-weight:700;margin-top:6px\">" + esc(item.question.text) + "</div>";
    qCard.appendChild(questionButtons(item, () => { if (qCard) { qCard.remove(); qCard = null; } saveSent(sentList().filter((x) => x.id !== item.id)); loadMine(); }));
    const lt = document.createElement("button"); lt.textContent = "Later"; lt.style.cssText = smallBtn("#fff", "#51606f") + ";margin-top:8px";
    lt.onclick = () => { try { sessionStorage.setItem(laterKey(item.id), "1"); } catch (e) {} qCard.remove(); qCard = null; };
    qCard.appendChild(lt);
    document.body.appendChild(qCard);
  }

  // What went live here lately. The person who asked gets the question back; everyone else reads what is new and who asked.
  let askCard = null;
  async function loadNews() {
    if (!mod || mod === "platform" || staged || onTest) return;   // nothing that went live is news on a preview or the test floor
    let j = null;
    try { const r = await peopleApi("/news?module=" + encodeURIComponent(mod), { cache: "no-store" }); if (r.ok) j = await r.json(); } catch (e) {}
    const changes = (j && j.changes) || [];
    // 1. the asker is asked back. The card opens once per sitting (the reload after the deploy is the natural
    //    moment); after that, or after "Later", it is a small pill beside the feedback button, so it never
    //    sits on top of the work. It goes away when they answer.
    if (askCard) { askCard.remove(); askCard = null; }
    const shownKey = (id) => "sos.asked." + id;
    const wasShown = (id) => { try { return sessionStorage.getItem(shownKey(id)) === "1"; } catch (e) { return false; } };
    const mineToAsk = changes.flatMap((c) => c.items.map((i) => Object.assign({ built: c.summary }, i))).find((i) => i.mine && i.can_answer && !i.floor_answer && !i.manager_answer);   // the manager closing it out stops the question coming back
    const showAsk = (item, open) => {
      if (askCard) { askCard.remove(); askCard = null; }
      if (!open) {
        askCard = document.createElement("button"); askCard.id = "sos-ask-pill"; askCard.textContent = "Did it fix it?";
        askCard.style.cssText = "position:fixed!important;right:132px!important;bottom:12px!important;left:auto!important;top:auto!important;z-index:9998;width:auto!important;min-height:0!important;height:auto!important;margin:0!important;background:#c2620a!important;color:#fff!important;border:none!important;border-radius:20px!important;padding:9px 14px!important;font:700 13px system-ui,sans-serif!important;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25)";
        askCard.onclick = () => showAsk(item, true);
        document.body.appendChild(askCard); return;
      }
      try { sessionStorage.setItem(shownKey(item.id), "1"); } catch (e) {}
      askCard = document.createElement("div"); askCard.id = "sos-ask";
      askCard.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:9998;background:#fff;color:#1c242e;border:2px solid #c2620a;border-radius:12px;padding:12px 14px;width:340px;max-width:calc(100vw - 24px);box-shadow:0 6px 20px rgba(0,0,0,.25);font:14px/1.45 system-ui,sans-serif;box-sizing:border-box";
      askCard.innerHTML = "<div style=\"font-weight:700\">You asked for this, and it is live now.</div><div style=\"color:#51606f;margin:4px 0\">\u201c" + esc(item.words) + "\u201d</div>" + (item.built ? "<div style=\"font-size:12.5px;margin-bottom:4px\">What was built: " + esc(item.built) + "</div>" : "") + "<div style=\"font-weight:700\">Did it fix it?</div>";
      askCard.appendChild(answerButtons({ id: item.id, state: "live" }, () => { loadMine(); loadNews(); }));
      const lt = document.createElement("button"); lt.textContent = "Later"; lt.style.cssText = smallBtn("#fff", "#51606f") + ";margin-top:8px";
      lt.onclick = () => showAsk(item, false);
      askCard.appendChild(lt);
      document.body.appendChild(askCard);
    };
    if (mineToAsk) showAsk(mineToAsk, !wasShown(mineToAsk.id));
    // 2. what is new, once per device per version; the reload after a deploy always says something
    const seenKey = "sos.seen." + company + "." + mod;
    let seen = null; try { seen = Number(localStorage.getItem(seenKey)) || null; } catch (e) {}
    const newest = changes[0];
    const show = newest && (justUpdated ? String(newest.version) === String(justUpdated) : (seen != null && newest.version > seen));
    if (show && mineToAsk && newest.items.some((i) => i.id === mineToAsk.id)) { /* the asker already has the card: it says the same thing, to them */ }
    else if (show) {
      const names = newest.asked_by || [];
      const whoAsked = names.length ? (names.length > 2 ? names.slice(0, 2).join(", ") + " and others" : names.join(" and ")) + " asked for this." : "";
      const what = String(newest.summary || "this page was updated"), short = what.length > 220 ? what.slice(0, 219).trimEnd() + "\u2026" : what;
      namedBanner("New here: " + short + (/[.!?\u2026]$/.test(short) ? "" : ".") + (whoAsked ? " " + whoAsked : ""));
    } else if (justUpdated) banner("This page was just updated (version " + justUpdated + ")");
    justUpdated = null;
    try { if (j && j.live_version) localStorage.setItem(seenKey, String(j.live_version)); } catch (e) {}
  }
  function namedBanner(text) {
    const el = document.createElement("div"); el.id = "sos-news";
    el.style.cssText = "position:fixed;left:12px;right:12px;top:12px;margin:0 auto;width:fit-content;max-width:640px;z-index:10000;background:#1f3a5f;color:#fff;border-radius:12px;padding:10px 14px 10px 16px;font:600 14px/1.4 system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.25);display:flex;gap:10px;align-items:flex-start;box-sizing:border-box";
    const span = document.createElement("span"); span.textContent = text; el.appendChild(span);
    const x = document.createElement("button"); x.textContent = "×"; x.setAttribute("aria-label", "Close"); x.style.cssText = "background:none;border:none;color:#fff;font:700 18px/1 system-ui,sans-serif;cursor:pointer;min-height:0;width:auto;margin:0;padding:0 2px";
    x.onclick = () => el.remove(); el.appendChild(x);
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 15000);
  }
  who.listeners.push(() => { loadMine(); loadNews(); });   // a different person at the device: their requests, their question

  window.sosPerson = { me: () => who.me, people: () => who.people, open: openPicker, pin: pinFor, refresh: loadWho, onChange: (f) => { who.listeners.push(f); } };

  document.addEventListener("DOMContentLoaded", init);
  if (document.readyState !== "loading") init();
  function init() {
    if (document.getElementById("fbw-send")) return;
    document.body.appendChild(btn);
    document.body.appendChild(panel);
    if (dockSel) {
      dock();
      try { window.matchMedia("(max-width: 640px)").addEventListener("change", dock); } catch (e) { /* an old browser: the first choice stays */ }
    }
    talkInto(panel.querySelector("#fbw-msg"));
    watchVersion();
    drawExtras();
    loadWho();
    setTimeout(maybeTour, 400); // give the page's own first render a moment so targets exist
    const nameEl = panel.querySelector("#fbw-name");
    try { nameEl.value = localStorage.getItem("sos.name") || ""; } catch (e) {}
    panel.querySelector("#fbw-send").onclick = async () => {
      stopTalk(panel);   // keep the words still being heard, and let go of the microphone before sending
      const msg = panel.querySelector("#fbw-msg").value.trim();
      if (!msg) return;
      try { localStorage.setItem("sos.name", nameEl.value); } catch (e) {}
      const res = await fetch("/api/feedback", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, module: mod, page: location.pathname, message: msg, name: who.me ? who.me.name : who.account ? who.account.name : nameEl.value, element: extra.element || undefined, photo: extra.photo || undefined }),
      });
      if (res.status === 401) { location.href = "/login?next=" + encodeURIComponent(location.pathname); return; }
      if (!res.ok) { const e = panel.querySelector("#fbw-extra-err"); if (e) e.textContent = res.status === 413 ? " The photo is too large to send. Remove it and send again." : " That did not send. Try again."; return; }
      // the proposer reads it at once and may have ONE question: keep this request's token on the device and look for it while the proposer reads
      const sent = await res.json().catch(() => null);
      if (sent && sent.id && onModule) { saveSent(sentList().concat([{ id: sent.id, token: sent.reply_token || "", words: msg.slice(0, 200), t: Date.now() }])); setTimeout(loadMine, 1200); }   // loadMine ends by looking for the question
      extra.element = null; extra.photo = null; drawExtras();
      panel.querySelector("#fbw-msg").value = "";
      panel.querySelector("#fbw-done").style.display = "block";
      setTimeout(() => { panel.style.display = "none"; panel.querySelector("#fbw-done").style.display = "none"; }, 1500);
    };
  }
})();
