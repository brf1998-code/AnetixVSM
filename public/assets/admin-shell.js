// The standard header for Anetix's own pages: band, who is signed in, status pills, tabs. Goes with
// admin-shell.css. The page gives <header id="shell"></header> and one <section class="tabpanel" id="tab-<id>">
// per tab; the tab in view is the address's hash (#companies, or #companies/acme: what follows the slash is handed
// to the page), so a tab can be linked to, reloaded and reached with the back button.
//
//   AdminShell.mount({ title: "Admin", tabs: [{ id: "health", label: "Health" }, ...], onShow(id, rest) {} })
//   AdminShell.setWho("Brendan Finn")                 the right side of the band (sign out is always there)
//   AdminShell.setPills([{ id, label, value, level, href, title }])   level: ok | amber | red | (none: grey)
//   AdminShell.setBadge("companies", { n: 3 })        a count after the tab's name
//   AdminShell.setBadge("instance", { level: "red" }) a dot: something on that tab wants looking at
//   AdminShell.go("companies/acme")
(function () {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let cfg = null; const badges = {};
  function parse() {
    const h = decodeURIComponent((location.hash || "").replace(/^#/, ""));
    const i = h.indexOf("/"), id = i < 0 ? h : h.slice(0, i), rest = i < 0 ? "" : h.slice(i + 1);
    return cfg.tabs.some((t) => t.id === id) ? { id, rest } : { id: cfg.tabs[0].id, rest: "" };
  }
  function drawTabs() {
    const cur = parse().id;
    document.querySelector("#shell nav").innerHTML = cfg.tabs.map((t) => {
      const b = badges[t.id] || {};
      return `<a href="#${t.id}" data-tab="${t.id}" class="${t.id === cur ? "on" : ""}" ${t.id === cur ? 'aria-current="page"' : ""}>${esc(t.label)}${b.n != null ? `<span class="n">${esc(b.n)}</span>` : ""}${b.level ? `<span class="dot ${esc(b.level)}" title="${esc(b.title || "something here wants looking at")}"></span>` : ""}</a>`;
    }).join("");
  }
  function show() {
    const { id, rest } = parse();
    for (const t of cfg.tabs) { const el = document.getElementById("tab-" + t.id); if (el) el.classList.toggle("on", t.id === id); }
    drawTabs();
    document.title = `${cfg.product || "Symbiotic OS"} · ${cfg.title} · ${(cfg.tabs.find((t) => t.id === id) || {}).label || ""}`;
    if (cfg.onShow) cfg.onShow(id, rest);
  }
  window.AdminShell = {
    mount(c) {
      cfg = c;
      document.getElementById("shell").innerHTML = `<div class="inner">
        <div class="top"><h1>${esc(c.product || "Symbiotic OS")}<small>${esc(c.title)}</small></h1><div class="who"><span id="shell-who"></span><a href="/logout">sign out</a></div></div>
        <div class="pills" id="shell-pills"></div>
        <nav aria-label="${esc(c.title)} sections"></nav></div>`;
      window.addEventListener("hashchange", show);
      show();
    },
    current: () => parse(),
    go(hash) { if (location.hash === "#" + hash) show(); else location.hash = hash; },
    setWho(text) { document.getElementById("shell-who").textContent = text || ""; },
    setPills(pills) {
      document.getElementById("shell-pills").innerHTML = pills.filter(Boolean).map((p) =>
        `<a class="pill ${esc(p.level || "")}" id="pill-${esc(p.id)}" href="${esc(p.href || "#")}" title="${esc(p.title || "")}"><i></i><b>${esc(p.label)}</b> ${esc(p.value)}</a>`).join("");
    },
    setBadge(tab, b) { badges[tab] = { ...(badges[tab] || {}), ...b }; if (cfg) drawTabs(); },
  };
})();
