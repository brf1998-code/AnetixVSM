# Outside check

A Cloudflare Worker that checks app.anetix.ai and anetix.ai every minute from Cloudflare, outside Railway, and sends to
the same ntfy topic as every other Anetix alert. The two services already watch each other (`src/uptime.js`,
`www/uptime.js`), but both run on Railway, so a Railway outage silences both. This covers that case. It also confirms
a push from outside: after a deploy your phone says "app.anetix.ai is on c6cdc40 now".

What it checks, what it sends, and the limits are at the top of `worker.mjs`. The tests are
`node scripts/test-outside-check.js` (no network).

## Set it up (about five minutes, Cloudflare dashboard, free plan)

1. **Make the Worker.** Cloudflare dashboard, Workers & Pages, Create, "Start with Hello World". Name it
   `anetix-outside-check` and press Deploy.
2. **Put the code in.** On the new Worker press "Edit code", select everything in `worker.js`, paste the whole of
   `worker.mjs` from this folder, and press Deploy.
3. **Somewhere to remember what it saw.** Storage & Databases, KV, Create a namespace called `anetix-outside-check`.
   Back on the Worker: Bindings, Add binding, KV namespace. Variable name `STATE`, the namespace you just made. Deploy.
4. **Where to send.** On the Worker: Settings, Variables and Secrets, Add. Type Secret, name `NTFY_TOPIC`, value the
   same topic as `NTFY_TOPIC` on the SymbioticOS service in Railway. Deploy.
5. **Every minute.** On the Worker: Settings, Trigger events (Triggers on older screens), Add, Cron Triggers, every
   minute (`* * * * *`). Save.

Within two minutes both phones get **"Outside check is running"** with what it saw: each of the four things "answers",
and the two versions. That message is the proof it is set up. If something reads "answered 403" on that first message,
Cloudflare is challenging the checker (Bot Fight Mode or a WAF rule): allow requests whose user agent is
`anetix-outside-check`, or tell Claude what it said.

If no message comes: the Worker's Logs tab shows lines starting `[outside-check]` (a missing `STATE` binding or
`NTFY_TOPIC` says so there).

## Optional settings (Variables, plain text)

- `SUMMARY_HOUR_UTC`: the hour of the quiet morning line, 12 by default (8am in Boston in summer, 7am in winter).
  `off` sends none. If the morning line does not come one day, the checker itself has stopped.
- `REMIND_MIN`: how often something still down is said again, 60 by default.
- `PRODUCT_URL`, `WWW_URL`: only if the addresses change.

## Updating it

Paste the new `worker.mjs` over the old one in "Edit code" and Deploy. What it remembers stays in KV.
