> **Anetix VSM dev copy.** Development only, not app.anetix.ai. See the top of CLAUDE.md and docs/VSM.md.

# Symbiotic OS — factory instance

One application per factory. It hosts the improvement board, every module (live
and staged versions), and the agent build service that turns approved floor
feedback into deployed changes. First module: the Paper Airplane Line demo.

`CLAUDE.md` is the working guide (revision paths, deploy procedure, rules).
`docs/FEATURES.md` is what is built, piece by piece, with the tests for each.
`docs/DEMO-RUNBOOK.md` is the facilitator script. `docs/ROADMAP.md` is the vision.

## Run locally

Needs Node 20+, Postgres, and (for the AI parts) an Anthropic API key.

```bash
createdb sos                      # or set DATABASE_URL
npm install
SOS_OPEN=1 SOS_FAKE_AGENT=1 npm start   # whole loop, zero API cost, no sign-in
# or: SOS_OPEN=1 ANTHROPIC_API_KEY=sk-... npm start
```

Open http://localhost:3000 (lands on the Demo Company board at `/c/demo/`),
http://localhost:3000/c/demo/m/paperline/ for the line, `/c/demo/agents` for
models and agent docs, `/admin` for companies. Modules under `modules/` are
imported into the database on first boot; no seed step.

`SOS_OPEN=1` makes every request an admin with no sign-in (local work only). A
hosted instance (Railway, or `NODE_ENV=production`) ignores it; since 2026-09-28
no password variables at all no longer means open.

## Env vars

| var | purpose |
|---|---|
| `DATABASE_URL` | Postgres connection (default `postgres://sos:sos@localhost:5432/sos`) |
| `ANTHROPIC_API_KEY` | enables real proposals and builds |
| `SOS_MODEL_BASELINE` | the first baseline model (`claude-fable-5-1` or `claude-opus-5-5`, default Fable) until one is saved on `/admin#models`; every job runs on one of those two (`src/agent.js`). `SOS_MODEL_PROPOSE`, `SOS_MODEL_BUILD`, `SOS_MODEL_REVIEW`, `SOS_MODEL`, `SOS_MODEL_INTAKE` are no longer read (since 2026-09-22) |
| `SOS_MODEL_SUMMARY` | the first model for the short text jobs (plain summaries, plain-words rewrites), Sonnet 5 by default, until one is saved on `/admin#models` |
| `SOS_FLOOR_PASSWORD`, `SOS_MANAGER_PASSWORD`, `SOS_ADMIN_PASSWORD` | the old shared passwords: floor and manager only for a company still on `legacy_login`; admin only until the first named admin account has set up its authenticator (`src/accounts.js`), then take `SOS_ADMIN_PASSWORD` out |
| `SOS_CONNECTION_KEY` | REQUIRED: the key stored secrets are encrypted under (ERP logins, every authenticator secret, the per-company database passwords); an authenticator cannot be set up without it; never change it |
| `SOS_EDGE_SECRET`, `SOS_EDGE_MODE` | the value Cloudflare's Transform Rule puts in `X-SOS-Edge`; requests without it are refused (`report` = count only) (`src/edge.js`) |
| `SOS_PUBLIC_URL` | the instance's own address (https://app.anetix.ai); switches on the MCP addresses and the connector sign-in. Unset = every connector path is a 404 (`src/mcpauth.js`, `docs/MCP.md`) |
| `SESSION_SECRET` | signs the session cookie |
| `SOS_OPEN` | `1` = no sign-in, every request an admin; local only, a hosted instance ignores it |
| `SOS_MAX_RUN_USD`, `SOS_MAX_BATCH_USD` | per build run and per batch caps; unset or 0 = no cap (the default) |
| `SOS_MONTHLY_CAP_USD` | the instance's monthly ceiling; unset or 0 = none (the default; `src/spendwatch.js` sends alerts instead) |
| `SOS_FAKE_AGENT` | `1` = scripted agent, no API calls |
| `PORT` | default 3000 |

## The loop (what to demo)

1. On a module page, hit "Something in the way?" and report friction.
2. On the improvement board the card appears under Feedback. Manager clicks **Review with AI**.
3. The proposal card shows the change and its class (UI or functionality). Approve, adjust, or decline.
4. UI lane: agent builds into a new draft version, visual check runs, staged demo link appears.
   Functionality lane: the agent first restates the requirement and waits for confirmation,
   then builds, then an independent cross-check agent reviews the diff, then smoke tests run on staging.
5. Deploy gate: view the staged demo, then **Deploy to floor**. Rollback is one click on the done card.

Feedback filed from the board itself goes to the Platform column and is shipped
through the repo, not the in-app agent.

## Architecture map

- `server.js` — boot, auth, static, route mounting
- `src/auth.js` — floor/manager passwords, signed cookie
- `src/db.js` — platform schema (modules, versions with files, feedback, proposals, build_runs, events, snapshots)
- `src/registry.js` — module versions in the DB, materialized to disk; repo import; live/staged mounts; deploy/rollback
- `src/migrate.js` — additive-only migration validator, staging clone, in-database snapshots and restore
- `src/proposals.js` — feedback -> proposal + UI/functionality classification
- `src/pipeline.js` — the two lanes as a state machine over build_runs
- `src/agent.js` — Claude Agent SDK runner (cwd = draft version dir, file tools only), model roles and prices, guidance docs, cost caps, fake mode
- `src/review.js` — whole-module system review by a frontier model, filed as held proposals
- `src/diagrams.js` — Mermaid data-flow and workflow diagrams drawn after every deploy, per version
- `src/mcpauth.js`, `src/mcp.js`, `src/mcp-admin.js`: connector sign-in (OAuth on the named accounts), the MCP address, and the admin tools (`docs/MCP.md`)
- `src/mcp-intake.js`: the admin MCP's new tool request tools, four of which write (start, answer, send to the agent, change the design); confirm stays on the board
- `public/index.html` — the improvement board (module strip, KPIs, four columns, platform requests)
- `public/agents.html`, `public/admin.html`, `public/diagrams.html` — per-company agent settings, instance admin, diagram viewer
- `principles/` — PRINCIPLES, GUARDRAILS, STYLE, DIAGRAMS + per-module reference formats (fed to every agent run)
- `modules/<name>/` — seed source for each module (manifest, routes, pages, migrations)

## Security posture

Two shared passwords and a signed cookie. Single tenant. Agents write only to a
draft version directory and never run shell commands. Migrations are validated
additive-only. Snapshots before every deploy, rollback restores schema and data.
Real accounts, per-module DB roles, and multi-tenant provisioning are the next
layers.
