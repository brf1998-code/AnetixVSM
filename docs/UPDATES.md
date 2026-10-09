# Updates: finding and fixing flaws

*Started 2026-10-08 (the CMMC Level 1 gap audit, P3). This file is the record that flaws in what the product runs on
are looked for, and fixed in a stated time. It covers both repos (`sos/` and `www/`).*

## The rule

*(Proposed 2026-10-08. Brendan confirms the days; until then these are the working numbers.)*

- **Where a flaw is heard of.** Dependabot alerts on both GitHub repos (`.github/dependabot.yml`; alerts and security
  updates switched on in each repo's settings), `npm audit` at the monthly check below, and the notices Railway,
  Cloudflare and Anthropic send their customers.
- **How fast it is fixed**, from the day it is heard of:
  - critical or high, in something the product runs: 14 days
  - everything else: at the next monthly check
  - a flaw that does not reach the product as it is used (the code path is never run) is written down here with the
    reason, and still updated at the next monthly check
- **The monthly check**, first week of the month, one line below each time:
  1. `npm audit --omit=dev` in `sos/` and in `www/`: both must say 0.
  2. `npm outdated` in both: take the minor and patch updates, run `bash scripts/e2e/run-all.sh`, push.
  3. Node: `railpack.json` pins the major version (24); a push picks up its latest patch. Chromium comes from Debian
     at every build, and the Postgres image (`ghcr.io/railwayapp-templates/postgres-ssl`) is redeployed from Railway.
  4. The upload scanner (docs/SAFEGUARDS.md): the Instance tab shows the date of its signatures; older than 3 days
     is a fault.
- Nothing is updated on the live instance by hand: a fix is a push, and every push is in the repo's history.

## The log

One line a check, newest first: the date, who, what `npm audit` said in each repo, what was updated, anything left
open and why.

- 2026-10-08, Claude with Brendan. `npm audit`: sos 1 high (GHSA-6qxp-vccf-f47h in `@modelcontextprotocol/sdk`
  1.30.0: its OAuth client could send credentials to an authorization server the MCP server chose; the product runs
  the server side only, so the path is not reached), www 0. Updated `@modelcontextprotocol/sdk` 1.30.0 to 1.32.1;
  sos now 0. Dependabot configured in both repos. Left open: switching on Dependabot alerts in each repo's GitHub
  settings (Brendan).
