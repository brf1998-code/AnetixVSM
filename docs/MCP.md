# MCP: a connector to each company's own data and processes, and one for Anetix

*Brendan, 2026-10-05: "adding MCP functionality, so each company can have an MCP to their own data and processes then I can also have an admin MCP." Customers asked for it, for Claude. **Phase 1 (the sign-in and the admin MCP) is built, 2026-10-05**: the bullet "Connector sign-in and the admin MCP" in `docs/FEATURES.md` is what was built and how it is tested. **Phase 2 (the company MCP) is designed here and not built.** **The admin MCP's write tools for new tool requests are built, 2026-10-06** (the section "Write tools" below).*

## Decisions (Brendan, 2026-10-05)

1. **Admin first.** Anetix is the only user, so sign-in and transport get proven with no customer promise at risk.
2. **A company's MCP reads, and files requests.** It reads the company's tools, records, board and request status. It can file a request into the CI loop, which goes through the manager like any other. It never edits a row.
3. **Records through the MCP are their own switch, off by default, set by the manager.** Independent of the data wall: the wall is about Anetix's AI, the MCP is the company's own AI app.
4. **The admin MCP is operations, read only.** No row from any company's tools, no actions. *Changed 2026-10-06 (Brendan): it also starts and fills in new tool requests, on a connection that was allowed to write. Still no row from a company's tools, and nothing that confirms, builds or deploys.*
5. **A request filed through the MCP waits for the manager's tap.** It never proposes on arrival.
6. **Anetix can lock the records switch off for a company,** managed from Anetix's side (/admin), over the manager's own setting.
7. **Paying sites only.** A demo has no MCP.
8. **No added cost.** It is part of the site price.
9. **Claude first.** The customers who asked use Claude.

## Phase 1, as built

- **Address:** `https://app.anetix.ai/mcp/admin`. Off (every connector path a 404) until `SOS_PUBLIC_URL=https://app.anetix.ai` is set in Railway.
- **Sign-in:** OAuth 2.1 on the named admin accounts, the MCP SDK's handlers under `/oauth/`, `src/mcpauth.js` behind them. The consent page (`public/connect.html`) takes a fresh passkey or code before anything is allowed.
- **Tools** (`src/mcp-admin.js`), all read only:

| Tool | Reads | From |
|---|---|---|
| `list_companies` | every company: paying site or trial, tools, open requests, builds, this month's AI spend, walled or not | its own short queries, `kind.isSite`, `agent.spendSince` |
| `list_demos`, `get_demo` | the Demos tab: paid, spent, built, stuck; one demo in full | `demos.list`, `demos.detail` |
| `list_sites` | the pipeline from demo to paying site, and the price book | `sites.pipeline` |
| `loop_health` | the Health tab's numbers, fleet and per company | `health.forAdmin` |
| `ai_spend` | the last hour, day and month, by company, alerts, the AI key's balance | `spendwatch`, `agent.spendSince`, `credit.status` |
| `list_requests_to_anetix` | the Requests tab | `requests.list` |
| `list_stopped_builds` | demo builds that stopped before a preview | `demostops.list` |
| `list_runs` | build runs: status, cost, the change in plain words, each stop as a kind | `platform.build_runs`, `health.runTimes` |
| `activity_since` | every line of the interaction record since a time, every company (2026-10-12, for the audit) | `platform.record` |
| `list_assistant_conversations` | Ask Anetix questions and answers since a time, with tools used, cards and thumbs | `platform.assist_*` |
| `list_board_requests` | the requests on the boards, open ones oldest first | `platform.feedback` |

- **The audit tools (2026-10-12).** Brendan wanted to "stay very close on what inputs are being made and immediately
  address any challenges", so a scheduled review reads the last few hours every four hours through the last three
  tools above. The same lines hold: a check's, a system review's and a saved agent doc's words stay out (kind and who
  only), a chat persona's lines stay out, and an Ask Anetix answer that called `read_records` or `summarize_records`
  is withheld (the question, the tools it used and the thumbs still show). A paying site with no learning opt-in stops
  at the day it went live, as on the Demos tab.
- **What never leaves:** a row from a company's tool, an upload, a photo, a diff, a tool's code, an access pin, a Stripe id, a card, a billing contact, a street address, and the words of a failed check or a stopped build (its kind only, because a failed check can quote the record it choked on).
- **What changed from the first draft of this design:** the tool names; one variable is the whole switch; the redirect list is known, not guessed (below); a connection ends after 30 days whatever its use, like the admin's own browser session; the SDK needed no bump; why a build stopped is a kind, not a line.

## Write tools: a new tool request from a call or a plant walk (built 2026-10-06)

Brendan: "add much more write capability to the MCP so that we can write in a tooling request automatically from a call transcript or tour transcript like I have another chat with all the answers to questions and would like to ease that path quite a bit instead of going to handjam it all."

`src/mcp-intake.js`, on the same address. The app distills the transcript into the answers; the transcript itself is not stored.

| Tool | Does | Writes |
|---|---|---|
| `list_tool_requests` | new tool requests, one company or all: name, how far, who started it | no |
| `get_tool_request` | one request: each question with what it takes and its choices, the answers, what is missing, the agent's follow-up round, the design, the next step | no |
| `start_tool_request` | starts one for a company as Anetix; carries on with Anetix's own unfinished one; refuses when the manager has one open unless `use_open` (a trial only) | yes |
| `answer_tool_request` | any number of answers by question id; each is checked and saved on its own | yes |
| `send_tool_request` | sends the open round to the agent: a follow-up round or the design comes back | yes |
| `change_tool_request_design` | changes to named points, or additions, through the agent | yes |

How a session goes: `start_tool_request` -> `answer_tool_request` (until nothing is missing) -> `send_tool_request` -> `get_tool_request` (the agent's follow-up questions) -> answer and send again -> `get_tool_request` (the design) -> `change_tool_request_design` if needed -> the manager opens the board, reads the points and confirms.

- **A connection writes only when the person ticked it** on the consent page ("Let it start and fill in new tool requests", off by default). A connection made before 2026-10-06 reads only until it is disconnected and connected again.
- **Not here, on purpose:** confirm (it starts the build, and takes the manager's PIN), make it live, withdraw, files, anything that is not a new tool request.
- **Whose request:** an app writes only to one Anetix started through a connector (`module_intakes.via`). A paying site's own request (no learning opt-in) is status only and is never taken over.
- **The board** says "started by Anetix" and asks the manager to read the answers over before sending.
- **The record** carries the account's name on every answer, send and change.
- **The pace:** 30 sends or design changes an hour per account (`SOS_MCP_AI_STARTS_PER_HOUR`).
- **Not yet:** a file through the connector; a notes field that carries more of the conversation to the agent than the questions hold; filing a change request against an existing tool; making a company.

## What Claude needs, from Anthropic's own pages (read 2026-10-05)

- Every hosted Claude app (web, Desktop, mobile, Cowork) connects **from Anthropic's cloud**, range `160.79.104.0/21`, and sends the person back to exactly `https://claude.ai/api/mcp/auth_callback`. Claude Code runs the sign-in on the person's own computer and uses `http://localhost:<port>/callback`.
- Sign-in starts only from a **401** with a `resource_metadata` pointer, and the discovery document's `resource` must equal the address as the person typed it.
- Claude registers itself (dynamic registration) unless the server advertises client ID documents, which SDK 1.30.0's server side does not do. Registration is fresh for every new connection, so unused ones are swept daily.
- PKCE S256 on every request. Refresh tokens must rotate, and a dead one must answer `invalid_grant`. Claude refreshes up to five minutes early and on any 401.
- Discovery, registration and token calls get 10 seconds; a refresh gets 30.
- On Team and Enterprise only an owner adds a custom connector; each member then connects.
- **Not read from a first-party page:** ChatGPT and Copilot. Neither is on the redirect list.

## Phase 2: the company MCP (not built)

Address: `https://app.anetix.ai/mcp`, for a manager account of a **paying site** (`kind.isSite`). A manager's account belongs to one company, so the token does too: no company picker, no way to ask for another's.

| Tool | Reads or does | Needs the records switch |
|---|---|---|
| `list_tools` | each tool: name, screens, live version, last change | no |
| `describe_tool` | tables, columns, row counts, screens, the diagram, the tour | no |
| `whats_changed` | shipped changes in plain words | no |
| `list_requests`, `get_request` | the board: requests, status, who asked | no |
| `file_request` | files a request against a tool, as the signed-in manager | no |
| `read_records` | rows of one table: filter, sort, page | yes |
| `summarize_records` | counts and sums, grouped | yes |

- **Processes** means how the tools work: screens, the diagram, the tour, what changed. Not the tool's code (the Terms, 12.1, and the same line `dataexport.js` holds), not the agent docs.
- **Reads go through the company's read role**, `sos_<company>_read` (built 2026-10-08 for Ask Anetix, `dbroles.READ`): SELECT only, on the company's own live tables, nothing else. "Read only" and "its own company only" are held by Postgres, not just by the code in front of it. The tools themselves are mostly built too: `src/assist-tools.js` is the one registry (list_tools, describe_tool, whats_changed, list_requests, get_request, summarize_records, read_records, plus show_on_screen and draft_request, which are the board's own); phase 2 serves that list with `ctx` built from the token instead of the session, and `file_request` becomes the card's filing path with the MCP's wait-for-the-manager rule.
- **No free SQL in the first version.** Any role can read Postgres's own catalog, and the schema names in it are other companies' slugs. `read_records` and `summarize_records` build their query on the server from table and column names checked against the tool's own tables.
- **Every answer goes through `companyview.scrub`**: no model names, no AI costs.
- **A filed request** is marked (`platform.feedback.source = 'mcp'`, with the app's name), shows a small tag on the board, and **waits for the manager's tap**: the filing path skips `arrival.start`. A daily cap per company on top.
- **Every call is logged** in `platform.mcp_calls` (it has the `company` column already), and the record gets `mcp_connected`, `mcp_disconnected`, `mcp_records_on`, `mcp_records_off`.
- **Connected apps** on the manager's settings page, with Disconnect.

### The records switch and the data wall

`platform.companies.mcp_reads_records`, false by default, on the manager's settings page under "Your data", next to the export. Turning it on asks for the manager's passkey or code. Suggested words: "Let AI apps you connect read your records. This is your own AI app. It does not change what Anetix's AI can see." Beside it on the company's card on /admin, Anetix's lock: on, the switch is off and greyed for the manager, with the reason.

| | Wall down | Wall up |
|---|---|---|
| Switch off | The app sees structure, the board and requests. No rows. | The same. |
| Switch on | The app reads rows. | The app reads rows. Anetix's AI still does not. |

### Why a filed request waits

With the switch on, a company's AI app can read rows and then quote them in a request it files. The proposer reads every request on arrival, so a walled company's rows would land in a prompt. The wall's rule that typed words are accepted as shared was written for a person typing, not an app pasting. Waiting for the manager's tap means a person reads it first, and it also stops an app from running up AI spend by filing fifty requests.

### What phase 2 changes in what phase 1 built

- `mcpauth.SURFACES` gets `company`; `refusal` lets a manager account of a paying site connect to it; the consent page says what that address allows; `authorize` picks the surface from the address the app names (it is required once there are two).
- The consent page's Origin check and step-up already cover a manager. The login page sends a manager back to the consent page after sign-in (today a manager lands on the board and opens the link again).
- `mcp_grants.company` is filled; company delete ends its connections; `list_companies` on the admin side shows which companies have an app connected and whether the switch is on.

### Proof for phase 2

`scripts/e2e/mcp.js` adds: company A's token and A's database role both fail against company B; a marker row is in no answer with the switch off and is there with it on; Anetix's lock beats the manager's switch; no answer names a model or a cost; a write through the read role is refused by Postgres; a demo's manager cannot connect; and with the wall up a filed request reaches no prompt until the manager taps Review (the `SOS_PROMPT_LOG` canary from the wall's own test).

## Still open

1. **The first real connection.** Nothing here has met the real Claude. Cloudflare's bot rules may challenge calls that come from Anthropic's cloud; if so `/mcp`, `/oauth/*` and `/.well-known/*` need a skip rule (a Cloudflare dashboard change). The edge secret stays on.
2. **With the records switch off, the app can still read the board and request text.** Those are the company's own words and the loop reads them already. Recommended yes; not yet answered.
3. **The Terms.** A company's AI app is a Third-Party Service it connects, so most of this is covered. Worth one sentence saying data read through a connector goes to the customer's own AI provider and is outside the wall and outside Anetix's no-training terms. For whoever reviews the Terms. Brendan: fine to go ahead.
4. **Brendan's own Claude account.** The admin MCP puts words customers typed to Anetix in front of his Claude. The plan it runs on should not train on chats. Brendan: fine.
5. **Later, on ask:** client ID documents, more apps on the redirect list, a record tool for paying sites, writing records, admin actions (pins, credit, answering requests).
