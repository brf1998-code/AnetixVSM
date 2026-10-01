#!/usr/bin/env bash
# Every end to end suite, each on the database it asks for, against a server this script starts and stops.
# Sandbox use (2026-09-24): Postgres 16 running locally as sos/sos, playwright installed. Prints one line per suite.
#   bash scripts/e2e/run-all.sh            everything
#   bash scripts/e2e/run-all.sh quick      no browser suites
# Run it from a command line that does not itself contain the words "node server.js": stop() kills every process
# whose command line matches, the calling shell included (found 2026-09-24: an orphaned run kept going and fought the
# next one for the port and the database).
set -u
cd "$(dirname "$0")/../.."
export DATABASE_URL=postgres://sos:sos@127.0.0.1:5432/sos_e2e SESSION_SECRET=e2e SOS_CONNECTION_KEY=e2e-connection-key
export SOS_FLOOR_PASSWORD=floorpw SOS_MANAGER_PASSWORD=mgrpw SOS_ADMIN_PASSWORD=adminpw SOS_INTERNAL_TOKEN=e2e-internal
export SOS_FAKE_AGENT=1 SOS_FAKE_DELAY_MS=300 PORT=3999 SOS_AUTO_PROPOSE_PER_HOUR=500
# the suites below press Fix themselves and count the rounds; the automatic loop (pipeline.autoFix) has its own suite
export SOS_AUTO_FIX_ROUNDS=0
# each service watches the other where alerts can go (src/uptime.js); the suites that stub ntfy are not about that
export SOS_UPTIME_WATCH=0
LOG=${SOS_E2E_LOG:-/tmp/sos-e2e}; mkdir -p "$LOG"
QUICK=${1:-}

fresh() { stop; su postgres -c "psql -qc 'DROP DATABASE IF EXISTS sos_e2e;' -c 'CREATE DATABASE sos_e2e OWNER sos;'" >/dev/null 2>&1; }
# a server lets its requests finish before it exits (src/restart.js), so wait until it has gone, not a fixed second
stop() { for p in $(pgrep -f "node server.js"); do kill "$p" 2>/dev/null; done; for _ in $(seq 60); do pgrep -f "node server.js" >/dev/null || break; sleep 0.5; done; sleep 0.3; }
start() {   # start "<extra env>"
  stop
  ( env $1 nohup node server.js > "$LOG/server.log" 2>&1 & )
  for i in $(seq 1 60); do curl -sf localhost:3999/health >/dev/null 2>&1 && return 0; sleep 0.5; done
  echo "server did not come up"; tail -20 "$LOG/server.log"; return 1
}
run() {   # run <name> <command...>
  local name=$1; shift
  local out; out=$(timeout 900 "$@" 2>&1); local code=$?
  echo "$out" > "$LOG/$name.log"
  local line; line=$(echo "$out" | grep -E "passed, [0-9]+ failed|checks passed" | tail -1)
  printf "%-28s %s%s\n" "$name" "${line:-NO SUMMARY (exit $code)}" "$( [ $code -ne 0 ] && echo '   <-- FAILED' )"
}

fresh; start "SOS_BROWSER=off"
run accounts               node scripts/e2e/accounts.js
stop; ( env SOS_BROWSER=off nohup bash -c 'while true; do node server.js; sleep 1; done' > "$LOG/server-loop.log" 2>&1 & ); sleep 6
run accounts-restore       node scripts/e2e/accounts.js restore
for p in $(pgrep -f "while true; do node server.js"); do kill "$p" 2>/dev/null; done; stop
start "SOS_BROWSER=off SOS_ADMIN_2FA=off"
run accounts-breakglass    node scripts/e2e/accounts.js breakglass
stop; ( env -u SOS_ADMIN_PASSWORD SOS_BROWSER=off nohup node server.js > "$LOG/server.log" 2>&1 & ); sleep 6
run accounts-noadminvar    env -u SOS_ADMIN_PASSWORD node scripts/e2e/accounts.js noadminvar
[ -z "$QUICK" ] && { fresh; start "SOS_BROWSER=off"; run accounts-browser node scripts/e2e/accounts-browser.js; }

# requests, models and chamber walk the requirement gate, which is off by default since 2026-10-01: they turn it on
fresh; start "SOS_BROWSER=off SOS_REQUIREMENT_GATE=on"
run requests               node scripts/e2e/requests.js
[ -z "$QUICK" ] && run requests-browser node scripts/e2e/requests-browser.js

fresh; start "SOS_BROWSER=off"
run closeout               node scripts/e2e/closeout.js
[ -z "$QUICK" ] && run closeout-browser node scripts/e2e/closeout-browser.js

fresh; start "SOS_BROWSER=off"
run arrival                node scripts/e2e/arrival.js
[ -z "$QUICK" ] && run arrival-browser node scripts/e2e/arrival-browser.js
fresh; start "SOS_BROWSER=off SOS_AUTO_PROPOSE_PER_HOUR=2"
run arrival-guard          env SOS_E2E_EXPECT=guard node scripts/e2e/arrival.js

fresh; start "SOS_BROWSER=off"
run board-browser          node scripts/e2e/board-browser.js

CHROME=${SOS_CHROMIUM_PATH:-/opt/pw-browsers/chromium-1194/chrome-linux/chrome}   # the sandbox's Chromium, for the suites that want a browser on the instance
fresh; start "SOS_CHROMIUM_PATH=$CHROME"
run checks                 node scripts/e2e/checks.js
[ -z "$QUICK" ] && { fresh; start "SOS_CHROMIUM_PATH=$CHROME"; run checks-browser node scripts/e2e/checks-browser.js; }
fresh; start "SOS_BROWSER=off"
run checks-nobrowser-off   env SOS_E2E_EXPECT=off node scripts/e2e/checks-nobrowser.js
fresh; start "SOS_CHROMIUM_PATH=$CHROME SOS_AUTO_FIX_ROUNDS=2"
run autofix                node scripts/e2e/autofix.js

fresh; start "SOS_BROWSER=off SOS_MODEL_PROPOSE=claude-sonnet-5 SOS_REQUIREMENT_GATE=on"
run models                 node scripts/e2e/models.js
[ -z "$QUICK" ] && run models-browser node scripts/e2e/models-browser.js

fresh; start "SOS_BROWSER=off"
run testfloor              node scripts/e2e/testfloor.js
[ -z "$QUICK" ] && run testfloor-browser node scripts/e2e/testfloor-browser.js
fresh; start "SOS_BROWSER=off SOS_CAMPAIGN_WATCH_MS=1500"
run campaign               node scripts/e2e/campaign.js
[ -z "$QUICK" ] && run campaign-browser node scripts/e2e/campaign-browser.js

fresh; rm -f "$LOG/prompts.jsonl"; start "SOS_BROWSER=off SOS_CAMPAIGN_WATCH_MS=1500 SOS_PROMPT_LOG=$LOG/prompts.jsonl"
run datawall               env SOS_PROMPT_LOG=$LOG/prompts.jsonl node scripts/e2e/datawall.js

# changes join the preview (2026-09-28): a change approved while a preview waits is built on top of it, Discard takes
# out the newest, one deploy puts them all live, a new tool's preview takes changes before it has ever been live
fresh; start "SOS_BROWSER=off SOS_REQUIREMENT_GATE=on"
run chamber                node scripts/e2e/chamber.js
# outside connections are off until Anetix turns them on per tool; "connect Epicor" goes to the integration team
fresh; rm -f "$LOG/outside-prompts.jsonl"; start "SOS_BROWSER=off SOS_PROMPT_LOG=$LOG/outside-prompts.jsonl"
run outside                env SOS_PROMPT_LOG=$LOG/outside-prompts.jsonl node scripts/e2e/outside.js
# every company that is not a paid site gets the trial features, however it was made; a boot standardizes the rest
fresh; start "SOS_BROWSER=off"
run standardize            node scripts/e2e/standardize.js

fresh; start "SOS_BROWSER=off SOS_WWW_KEY=e2e-www-key-0123456789abcdef SOS_WWW_URL=https://anetix.test"
run selfserve              env SOS_WWW_KEY=e2e-www-key-0123456789abcdef SOS_WWW_URL=https://anetix.test node scripts/e2e/selfserve.js

fresh; start "SOS_BROWSER=off SOS_WWW_KEY=e2e-www-key-0123456789abcdef SOS_WWW_URL=https://anetix.test"
run demos                  env SOS_WWW_KEY=e2e-www-key-0123456789abcdef node scripts/e2e/demos.js

fresh; start "SOS_BROWSER=off SOS_WWW_KEY=e2e-www-key-0123456789abcdef SOS_WWW_URL=https://anetix.test"
run sample                 env SOS_WWW_KEY=e2e-www-key-0123456789abcdef node scripts/e2e/sample.js

fresh; start "SOS_BROWSER=off SOS_WWW_KEY=e2e-www-key-0123456789abcdef SOS_WWW_URL=https://anetix.test"
run sites                  env SOS_WWW_KEY=e2e-www-key-0123456789abcdef node scripts/e2e/sites.js
[ -z "$QUICK" ] && run sites-browser env SOS_WWW_KEY=e2e-www-key-0123456789abcdef node scripts/e2e/sites-browser.js

fresh; start "SOS_BROWSER=off SOS_WWW_KEY=e2e-www-key-0123456789abcdef SOS_WWW_URL=https://anetix.test"
run golive                 env SOS_WWW_KEY=e2e-www-key-0123456789abcdef SOS_WWW_URL=https://anetix.test node scripts/e2e/golive.js

fresh; start "SOS_BROWSER=off SOS_WWW_KEY=e2e-www-key-0123456789abcdef SOS_WWW_URL=https://anetix.test"
run dataexport             env SOS_WWW_KEY=e2e-www-key-0123456789abcdef node scripts/e2e/dataexport.js

# stage 3: anetix.ai's private channel is a stub inside the test (every answer Stripe could give is the test's to choose)
S3="SOS_WWW_KEY=e2e-www-key-0123456789abcdef SOS_WWW_URL=https://anetix.test WWW_INTERNAL_URL=http://127.0.0.1:4011 WWW_INTERNAL_KEY=e2e-internal-key-0123456789abcdef"
fresh; start "SOS_BROWSER=off $S3"
run stage3                 env $S3 node scripts/e2e/stage3.js

# stage 4 (src/billing.js) and the phone alerts (src/notify.js): one stub plays anetix.ai's private channel and ntfy
S4="SOS_WWW_KEY=e2e-www-key-0123456789abcdef SOS_WWW_URL=https://anetix.test WWW_INTERNAL_URL=http://127.0.0.1:4012 WWW_INTERNAL_KEY=e2e-internal-key-0123456789abcdef NTFY_URL=http://127.0.0.1:4012 NTFY_TOPIC=e2e-topic"
fresh; start "SOS_BROWSER=off $S4"
run billing                env $S4 node scripts/e2e/billing.js

# the launch audit 0.1: bad values in every route's parameters, and another company by every spelling (no restart loop,
# so a crash shows as a dead server)
fresh; start "SOS_BROWSER=off"
run badids                 node scripts/e2e/badids.js
# the launch audit 0.5: what a company reads at an AI cap
fresh; start "SOS_BROWSER=off SOS_MONTHLY_CAP_USD=5"
run caps                   node scripts/e2e/caps.js
# the launch audit 0.5, Brendan's call: alerts when spend climbs fast, never a limit
fresh; start "SOS_BROWSER=off SOS_ALERT_MONTH_STEP_USD=25"
run spendwatch             node scripts/e2e/spendwatch.js

# the launch audit, Phase 1 on the server side: one new-tool request at a time, what a restart leaves, the fence, the
# phone alerts, a hung tool process, trials off a demo's credit, a demo's diagrams when asked, a demo's stopped builds
fresh; start "SOS_BROWSER=off"
run phase1                 node scripts/e2e/phase1.js
[ -z "$QUICK" ] && { fresh; start "SOS_BROWSER=off"; run phase1-browser node scripts/e2e/phase1-browser.js; }
# Phase 2's first item: nothing a manager or the floor reads from /api/ names a model or carries an AI cost
fresh; start "SOS_BROWSER=off"
run leaks                  node scripts/e2e/leaks.js
# the rest of Phase 2: one spend formula, who is stuck, one pin message, tools never on another company's tables, and
# the admin page with Demos first and the experiments behind More
fresh; start "SOS_BROWSER=off"
run phase2                 node scripts/e2e/phase2.js
[ -z "$QUICK" ] && { fresh; start "SOS_BROWSER=off"; run phase2-browser node scripts/e2e/phase2-browser.js; }
# Phase 3: a new demo's one sign-in from setup (3.8), and a refill added only when Stripe backs it (3.7; the script
# runs the fake Stripe the server reads on 4555)
P3="SOS_WWW_KEY=e2e-www-key-0123456789abcdef SOS_WWW_URL=https://anetix.test STRIPE_READ_KEY=rk_test_phase3 STRIPE_API_BASE=http://127.0.0.1:4555"
fresh; start "SOS_BROWSER=off $P3"
run phase3                 env $P3 node scripts/e2e/phase3.js

# the first-time user round (2026-10-01): the requirements screen and its changes, no second stop for a requirement,
# Review all with AI, 402 when the credit is out, "still signed in" for anetix.ai, every screen of a tool
fresh; start "SOS_BROWSER=off SOS_WWW_KEY=e2e-www-key-0123456789abcdef SOS_WWW_URL=https://anetix.test"
run firstrun               env SOS_WWW_KEY=e2e-www-key-0123456789abcdef SOS_WWW_URL=https://anetix.test node scripts/e2e/firstrun.js
[ -z "$QUICK" ] && { fresh; start "SOS_BROWSER=off"; run firstrun-browser node scripts/e2e/firstrun-browser.js; }

fresh; start "SOS_BROWSER=off"
run runner-hostile         node scripts/e2e/runner-hostile.js
stop
echo "logs in $LOG"
