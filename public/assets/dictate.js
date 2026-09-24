// Talk instead of typing: a mic button under a text box that turns speech into
// words in that box. Used by the module creation popout (intake.js) and the
// feedback widget (feedback-widget.js), on the board and on module pages.
//
// Version 1 uses the browser's own speech recognition (Web Speech API), so it
// costs nothing and needs no server route. Limits that come with that choice
// (Brendan, 2026-09-24, "try it first, then iterate"):
//   - Chrome, Edge and Safari (iPad and iPhone included) have it; Firefox does
//     not, and there the button simply does not appear.
//   - Chrome sends the audio to Google and Safari to Apple for recognition.
//     Fine for demos and first pilots; before a defense or CMMC customer this
//     file is the one place to swap for a record-and-transcribe-on-our-server
//     version. Callers only use attach / scan / stop, so nothing else changes.
//
// Words land in the box as they are heard and fire an ordinary "input" event,
// so whatever the page already does on typing (saving an answer, a character
// counter) happens for spoken words too. Typing while it listens stops it, so
// the two never fight over the box. Platform code: the in-app build agent
// never touches this file.
window.Dictate = (() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const supported = Boolean(SR);
  const MAX_MS = 3 * 60 * 1000;   // one tap listens at most this long, so a forgotten mic does not stay open
  let active = null;               // the one box listening right now

  const MIC = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v4"/></svg>';
  const IDLE_LABEL = "Talk instead of typing";
  const ON_LABEL = "Listening. Tap to stop";
  const SAY = {
    "not-allowed": "The microphone is blocked for this site. Allow it in the browser, then tap again.",
    "service-not-allowed": "Talking is turned off on this device. Type it instead.",
    "audio-capture": "No microphone was found on this device.",
    "network": "Talking needs the internet right now. Type it instead.",
    "no-speech": "Did not hear anything. Tap to try again.",
    "language-not-supported": "Talking does not work in this language yet. Type it instead.",
  };

  // !important throughout: module pages are agent-written and often style every button (width:100%, min-height)
  const BASE = "display:inline-flex!important;align-items:center!important;gap:6px!important;width:auto!important;min-height:0!important;height:auto!important;margin:0!important;padding:6px 10px!important;border-radius:16px!important;font:700 12.5px/1.2 system-ui,sans-serif!important;cursor:pointer;box-shadow:none!important;text-transform:none!important;letter-spacing:normal!important;";
  const IDLE = BASE + "background:#fff!important;color:#1f3a5f!important;border:1px solid #1f3a5f!important;";
  const ON = BASE + "background:#b3261e!important;color:#fff!important;border:1px solid #b3261e!important;";

  function css() {
    if (document.getElementById("sos-dictate-css")) return;
    const s = document.createElement("style"); s.id = "sos-dictate-css";
    s.textContent = "@keyframes sosDictatePulse{0%,100%{opacity:1}50%{opacity:.35}} .sos-dictate-dot{width:8px;height:8px;border-radius:50%;background:#fff;animation:sosDictatePulse 1s infinite;flex:none}";
    document.head.appendChild(s);
  }

  // spoken words arrive lowercase and unpunctuated; start a sentence with a capital
  function joinSaid(base, said) {
    said = String(said || "").replace(/\s+/g, " ").trim();
    if (!said) return base;
    const tail = base.replace(/\s+$/, "");
    if (!tail || /[.!?]$/.test(tail)) said = said.charAt(0).toUpperCase() + said.slice(1);
    if (!tail) return said;
    return base + (/\s$/.test(base) ? "" : " ") + said;
  }

  function put(s) {
    const el = s.el;
    let text = joinSaid(s.base, [s.prior, s.session, s.interim].join(" "));
    const max = Number(el.getAttribute("maxlength")) || 0;
    if (max && text.length > max) text = text.slice(0, max);
    if (el.value === text) return;
    el.value = text;
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event("input", { bubbles: true }));   // untrusted, so it does not count as the person typing
  }

  function show(s, on) {
    s.btn.style.cssText = on ? ON : IDLE;
    s.btn.innerHTML = on ? '<span class="sos-dictate-dot"></span>' + ON_LABEL : MIC + IDLE_LABEL;
    s.btn.setAttribute("aria-pressed", on ? "true" : "false");
  }
  function note(wrap, text) {
    const n = wrap.querySelector("[data-dictate-note]");
    if (!n) return;
    n.textContent = text || "";
    n.style.display = text ? "block" : "none";
  }

  // Stop listening. gentle: the person tapped stop, so let the browser finish the
  // last few words. Otherwise (the box is going away, or Send was tapped) keep
  // what is on screen now and cut the microphone at once.
  function stop(gentle) {
    const s = active; if (!s) return;
    active = null;
    s.done = true;
    clearTimeout(s.timer); clearInterval(s.watch);
    show(s, false);
    if (gentle) { s.finishing = true; try { s.rec.stop(); } catch (e) {} return; }
    s.prior = [s.prior, s.session, s.interim].join(" "); s.session = ""; s.interim = "";
    if (s.el.isConnected) put(s);
    try { s.rec.abort(); } catch (e) {}
  }

  function listen(el, btn, wrap) {
    const s = { el, btn, wrap, base: el.value, prior: "", session: "", interim: "", done: false, finishing: false, rec: null, quickEnds: 0, started: 0, timer: null, watch: null };
    active = s;
    note(wrap, "");
    show(s, true);
    s.timer = setTimeout(() => { if (active === s) stop(true); }, MAX_MS);
    // the page may take the box away (Back, a card redrawn): let go of the microphone then too
    s.watch = setInterval(() => { if (active === s && !el.isConnected) stop(); }, 1000);
    const begin = () => {
      const rec = new SR();
      rec.lang = navigator.language || "en-US";
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (e) => {
        if (s.rec !== rec || (s.done && !s.finishing)) return;
        if (!el.isConnected) { stop(); return; }
        let fin = "", mid = "";
        for (let i = 0; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) fin += " " + t; else mid += " " + t; }
        s.session = fin; s.interim = s.finishing ? "" : mid;
        if (s.finishing) s.session += " " + mid;
        put(s);
      };
      rec.onerror = (e) => {
        if (s.rec !== rec || e.error === "aborted") return;
        if (SAY[e.error]) note(wrap, SAY[e.error]);
        s.fatal = true;
        if (active === s) stop();
      };
      rec.onend = () => {
        if (s.rec !== rec) return;
        // keep whatever was heard in this stretch, including words still in flight
        s.prior = [s.prior, s.session, s.interim].join(" "); s.session = ""; s.interim = "";
        if (el.isConnected) put(s);
        if (active !== s || s.fatal || !el.isConnected) { if (active === s) stop(); return; }
        // Safari (and Chrome after a pause) ends a stretch on its own: pick up again,
        // unless it keeps ending the moment it starts (then something is wrong; stop)
        s.quickEnds = Date.now() - s.started < 1500 ? s.quickEnds + 1 : 0;
        if (s.quickEnds >= 3) { note(wrap, SAY["no-speech"]); stop(); return; }
        begin();
      };
      s.rec = rec;
      s.started = Date.now();
      try { rec.start(); } catch (e) { note(wrap, "Talking could not start. Type it instead."); stop(); }
    };
    begin();
  }

  // Put a mic button under one text box. Safe to call again on the same box.
  function attach(el) {
    if (!supported || !el || el.getAttribute("data-dictate") === "on" || el.disabled || el.readOnly) return null;
    css();
    el.setAttribute("data-dictate", "on");
    const wrap = document.createElement("div");
    wrap.className = "sos-dictate";
    wrap.style.cssText = "margin:6px 0 0!important;padding:0!important;border:0!important;background:none!important;";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-dictate-btn", "1");
    btn.setAttribute("aria-label", "Talk instead of typing");
    const n = document.createElement("div");
    n.setAttribute("data-dictate-note", "1");
    n.style.cssText = "display:none;margin-top:4px;font:12.5px/1.35 system-ui,sans-serif;color:#b3261e;";
    wrap.appendChild(btn); wrap.appendChild(n);
    show({ btn }, false);
    btn.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      const mine = active && active.el === el;
      if (active) stop(mine);
      if (!mine) listen(el, btn, wrap);
    });
    // the person typing takes the box back
    el.addEventListener("input", (e) => { if (e.isTrusted && active && active.el === el) stop(); });
    el.insertAdjacentElement("afterend", wrap);
    return wrap;
  }
  function scan(root, selector) {
    if (!supported || !root) return;
    for (const el of root.querySelectorAll(selector || "textarea")) attach(el);
  }
  // a phone locked or a tab switched: stop listening
  document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); });

  // stop(within): stop only if the listening box is inside `within` (so the popout
  // redrawing does not cut off the feedback box, and the other way round)
  return {
    supported, attach, scan,
    stop: (within) => { if (active && (!within || within.contains(active.el))) stop(false); },
    isListening: () => Boolean(active),
  };
})();
