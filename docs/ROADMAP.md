# Symbiotic Operating System: Product Vision and Roadmap

*Rewritten 2026-09-20; updated 2026-10-29 with the floor round from Chelsea Clock's first weeks on the floor (section 6), what was built since 9/20 in brief (section 3), and the decisions log. Supersedes the 2026-08-13 draft, whose five phases are built and folded in below. Working doc, update aggressively. The company is Anetix (Delaware C-corp, filed 2026-09-17); the product name is still Symbiotic OS. Decisions carry a date; the log at the end is the record.*

---

## 1. What this is

Symbiotic OS is an operating system for factories that forms around how a company actually runs, instead of forcing the company into the mold of an enterprise system. A production manager with process knowledge and no software background describes what the floor needs, and the system builds it. From then on every point of friction on the floor feeds one continuous improvement loop: a request comes in, the AI reads it and drafts a proposal, the manager reviews and redirects, the AI builds the change onto a staged copy and shows it working, the manager approves, it is on the floor, and the person who asked is told and asked whether it fixed anything. The whole loop lives in one application. No GitHub, no Railway, no accounts to wire together, no git to understand.

The objective, in Brendan's words from the 2026-09-18 product review: **a floor operator with no technical experience builds and develops their own system through the CI loop, so the system molds to their operation and significantly improves it.** The bar for usability has not moved: if someone can run their team on Teams, they can run their factory's software on this.

The pitch underneath it: as models get better, what grows is the size of change the gate can safely carry. Verification is the limit, not generation. So the product is built as a verification machine with a model in the middle, and the model is swappable.

## 2. Why this wins

The Langmuir deployment proved the method: an operator-grade system built in weeks, adopted by the floor, at a running cost in the hundreds of dollars a year, with measured value around $220K a year. Most skilled people could replicate the method. What is not replicable is the delivery machinery, and that machinery was the expensive part: pull before every edit, per-machine git transport, stale lock files, a day lost on a retired repo, deploy config, cache masking deploys. Every one of those is a reason a nontechnical manager cannot run that stack. Symbiotic OS deletes the list by making build, stage, review, deploy and rollback native operations of one application. The moat is not the AI. It is a delivery loop so well defined that using it is easier than not using it.

This is also the productization of the operator-as-builder question from the thesis work. If a floor operator can grow their own system through this loop, the market moves from "we send a team in" to "we equip the person who already knows the process."

## 3. What exists today (2026-09-20)

Everything below is built, live at app.anetix.ai, and covered by the suites in `scripts/` and `scripts/e2e/` (about 800 checks across units, end to end and headless browser). The 2026-09-18 review's build order, items 1 to 9, is delivered. `CLAUDE.md` is the engineering reference; this section is the shape.

**The loop.** Feedback from a button on every module page, with the screen it came from recorded. The proposer reads every request the moment it arrives: it drafts a proposal, or folds a repeat into the request it repeats ("asked 4 times by 3 people"), or asks the person ONE plain question with answers to tap instead of guessing, or flags a request that is not about the tool. The manager's board has four columns and a gate at each: approve, adjust or decline the proposal; confirm the restated requirement on a functionality change; deploy after the preview. Two lanes: a UI change gets a visual check and the page load; a functionality change gets a requirement restated and confirmed, an independent cross-check by a second model on the diff, and the module's own accumulated checks. Nothing reaches the floor without a manager's click. Rollback is one click and restores data.

**The operator's half.** A name and a PIN per person, on shared tablets. My requests, with one plain line per request saying where it is. When a change ships, the floor page says what is new and who asked; the person who asked gets "Did it fix it?" and a not quite goes round the loop again as a follow-up the proposer is told about. The manager's close-out on the shipped tile: Done, with a thank-you by name, or "a little left". Point at it and a photo ride along with a request, for the proposer, not for the manager's card.

**What holds it up.** The module gate, a no-token text check of every file before anything loads it. A browser policy that locks a module's pages to their own module. Checks that accumulate: each functionality change leaves a promise file the module keeps forever, every build runs every promise, a manager retires one deliberately or not at all. A real headless browser opens every screen of every build before the gate. And since 2026-09-20 the wall: module code runs in a process of its own per company, as its own unprivileged user, with a database login that reaches only that company's tables; a staged preview runs under a login that can read the floor and cannot write it.

**The record and the numbers.** Every word said and decided, insert-only, tied to the build it led to and how it turned out; the plant owns it. Loop health on the admin side: time to floor, same-shift share, manager wait, stops by kind, fixed-it share, spend per shipped change, the quiet stretch. Not the manager's KPIs, by design.

**Making new tools.** A guided intake in plain words (fixed questions, at most two generated rounds), a design the manager confirms item by item, a skeleton the platform writes without a model, then the same build and deploy loop. Two library modules ship in the repo: the paper airplane line (the demo) and Plant KPIs with Jonah, a chat persona for managers.

**Connections.** The platform owns every connection and lends it to a module. Spreadsheet upload into a module table. Zebra labels from the device that asked. Read-only ERP lookups (SAP OData, Epicor BAQ REST, plain JSON) built wide once, published as a field catalog the agents read, with the whole ERP side kept on the admin's screen and a data check at review so a manager never sees a lookup or a field. Two stand-in ERPs in the product for the showroom.

**Running it.** One instance hosts many companies, each with its own passwords, budget, brand, model choices, agent docs and now its own processes and database roles. Backup and restore of the whole instance. An AI credit glide slope so the admin sees the runout date.

**Since 2026-09-20** (the commit log has the detail, `docs/FEATURES.md` is the reference). The product is Anetix at app.anetix.ai, with a front door at anetix.ai where a person starts a self-serve demo: a pin, an email and their own password, a manager account with an authenticator app, demo credit and sample data for its tools. Named admin accounts with TOTP, passkeys, sliding sessions and trusted devices, and the outside audit's 1A fixes. Paid sites: the price book, the Sites tab, Activate with the rollover and the Terms of Service, the pilot offer and its order form; Chelsea Clock is the first paying site. The test floor (a third lane per company) and the data wall. Safeguards for a company that keeps contract information (a plant network list for shared sign-ins, the upload scanner). Ask Anetix, the assistant on the board. The admin MCP and the company MCP. Change it at the gate. The tool library (search, copy between companies, templates, Shop Schedule). Steps that need judgment (rules, judgment or match once). A web connection for tools. Talking instead of typing. Requests to Anetix and the Requests tab.

**What is not there.** A pattern library or any cross-plant learning (the record is the raw material; nothing reads it across plants yet). Per-plant memory from adjusted and declined proposals. Notifications of any kind (emails were taken off the plan on 2026-09-19: "they will get so annoyed"; the board is the notification surface). The bridge transport for an on-prem ERP. A second factor on delete and restore. A runtime and database per customer (option D below). Module code cannot be told which person is at the device yet. The real proposer's judgement on folding, asking and flagging is unread; fake mode proves the machinery.

## 4. Principles that held, and the ones that changed

Held from August: the manager gate is structural, not procedural; the AI's write surface is staging only; close the loop visibly back to the person who reported the friction; principles as readable files the AI and the humans both use; one runtime with managed modules; boring stack.

Learned or decided since:

- **Do not overload the manager.** Photo and element detail are for the AI to parse. A stopped build leads with what needs a decision and folds the rest. The ERP lives on the admin's screen, never the manager's.
- **Plain words are a rule, not a tone.** A word list the generated text is checked against, a rewrite pass, and a question that still fails is dropped rather than shown.
- **Verification is where the product is.** The gate, the page policy, the cross-check, the promises, the page load and the process boundary are the product; the builder is a component.
- **Run top models first, optimize on evidence.** Fable everywhere now. Shift a lane down only after a long quiet stretch with no reviewer or test stops and no rollbacks that frustrate the floor; the replay harness over labeled stops, then an A/B run, decides. The human cost of a build going wrong is far worse than the marginal cost of a better model.
- **The plant owns its record.** Anetix uses it to improve that plant by default. Anonymized cross-plant use is an opt-in clause. Defense tenants stay out.
- **One repo for every customer, permanently.** Never fork per customer. Tenancy hardens in steps (section 5) and the trigger is production data, not customer count.
- **Staging is a copy of the floor's data, on purpose.** It never leaves the company's database, the build agent has no database access, and a preview with real rows is what lets a manager judge a change.
- **One Anthropic key for the instance.** Per-company keys were in the trade study and were cancelled on 2026-09-20; billing is per iteration, so the platform meters and the key stays Anetix's.

## 5. Architecture as built

One instance, many companies, one repo. A company's live and staged module versions are files in the database, materialized to disk at boot; deploy repoints the live mount, rollback points it back and restores a snapshot. Module code has one door to the world, `ctx`, and the platform lends it a query function on its own tables, read-only peers, connections, a chat call and its docs. The build agent (Claude Agent SDK, Read/Write/Edit/Glob/Grep and nothing else, an allow-list environment) writes into one draft version directory and nowhere else.

The tenancy sequence from the 2026-09-17 trade study, and where it stands:

| Step | What it is | State |
|---|---|---|
| A | Shared instance, shared logins | Replaced 2026-09-19 |
| B | Shared instance, hardened: company in the session, per-company passwords and budgets, the module gate, the page lock | Live |
| C | A process per company and lane with its own unprivileged user and its own database role; a preview cannot write the floor | Live 2026-09-20; green on the live instance |
| D | A runtime and a database per customer under a control plane; same image for GovCloud and on-prem | Not started. Trigger: the first customer security questionnaire, or enterprise production data |

The stopgap between C and D, if pilots overlap before D is worth building: a second Railway service from the same repo, by hand.

The model sits behind one interface (`src/agent.js`): structured calls with a tool-choice fallback, agent runs through the SDK, plain chat for personas. Pointing it at Bedrock, Claude in GovCloud or a local model is a change in that one file, not in any module.

## 6. The roadmap from here

Gates, not dates, with one dated forcing function: the MIT summit on innovation in operations in December 2026, where Brendan and Taylor demo to a room of Fortune 500 executives. The plan is local pilot sites live and LOIs in hand before it, and the product has to back what the deck says by then. Effort is nights and weekends alongside the final LGO year until the raise changes that.

### First: the floor round (2026-10-29)

Chelsea Clock has been on the floor since mid October, and its first weeks turned up a set of requests that all point at one thing: getting an operator onto the right screen has to be as easy as scanning a code. On 2026-10-28 a phone at Chelsea could not sign in at all: a person was added on the People page and their PIN was typed into the floor password box, six times, and the box answered "That password did not match." The login only takes the shared floor password; a People PIN only names who is at a device that is already signed in, and nothing said so. The brief is in the Anetix project, `claude/build-brief-chelsea-floor-round-2026-10-29.md`. In build order:

1. **Floor sign-in by PIN.** The shared floor password goes away; the floor signs in with a PIN, only on the plant's wifi (Chelsea's address is fixed), and stays signed in a week on that device. A site starts on one common floor PIN and moves to a PIN per person, which then signs the device in and names the person in one step; that is also when module code is told who is at the device (`ctx`, from the small things below). Managers and admins sign in with their own account and a second factor, no shared manager password. The login screen recognizes a PIN and says what to do with it. Lockouts count per device, not per address, since a whole plant shares one address.
2. **A QR code for every operator screen, in every tool.** Each screen in a tool's manifest is tagged floor or office; the builder tags every new one and the tools already live are tagged once. A one-of-many screen (a station, a work center) gets one code per station from the tool's own list. Codes print at a size chosen per station. A scan signed out goes to the PIN and then that screen; signed in, the screen opens. Operators who come in by a code see the Feedback button only, not the link to the improvement board.
3. **Each tool's line on the board: its name, Screens and Settings.** Screens lists every screen with its QR code and Print. Settings is a popout holding the rest (Open live, the preview and test floor links, Diagrams, Versions, Ask, Sample data, Archive). This is item 2 of the summit list carried one step further.
4. **Small fixes.** The Feedback and board buttons shrink to small round icons and every page leaves room for them at the bottom. A company's own icon on every tab: a logo upload in Settings, and when there is none a plain mark in the company's colors, never the Anetix mark; Anetix stays discreet. Point at it and Add a photo on the pages that send to Anetix. Several new tool drafts open at once, each its own card.
5. **Archive a tool.** A manager archives from Settings: off the main screen, listed under Settings, data kept, can come back. An admin deletes it for good from the admin page, behind the admin's second factor (the small thing below, applied here first).
6. **Google and Microsoft sign-in** for managers, admins and demo sign-up, beside email, password and a second factor; never the floor.

Gate: an operator at Chelsea scans a station's code on their own phone on the plant wifi, types the floor PIN once, lands on that screen, and files a request from it, with nobody from Anetix helping. The MO sheet prints from the MO Board on Chelsea's office printer through the print dialog (a change to that tool, filed on Chelsea's board). Integrations at Chelsea (Fishbowl, QuickBooks, HubSpot) are parked until the floor round is done.

### Now to the summit

**1. The end of rollout test campaign.** Everything the sandbox and the fake agent cannot prove, run together from `docs/TEST-CAMPAIGN.md`: the first real checks Fable writes read against their requirements; what the real proposer folds, asks and flags on arrival; a live "not quite" follow-up; a proposal that depends on the later half of a server file; the label preview and a real Zebra print; the ERP rehearsals against both stand-ins and the first live lookup draft; the name-and-PIN flow on a phone (it failed in the field at Chelsea on 2026-10-28; the floor round replaces it, and its gate is the phone test); a build asked to read the environment stopping at the gate; the credit count against the console; and now a real build through the staged then the live process. Fix what it finds. Gate: every live check in the campaign has a result, and the ones that failed have a fix on the board or a decision written down.

**2. The board, simplified.** The manager's board has grown a control for every feature (batches, reviews, versions, diagrams, checks, people, connections, the record, the filter, the QR sign). Cut it back to what a manager touches in a normal week and move the rest behind one door, without losing a gate. Built 2026-09-20 (push 16): no model and no cost on the board, one Settings door, one big button per card with the rest under "more", "Build these N together" instead of batch controls on every card. Gate, still to run: a manager who has never seen it takes a request from Feedback to the floor without asking what a button does.

**3. The first pilot site live.** Chelsea Clock is the first pilot site, on the floor since mid October 2026 (New England Wire Products was the first prospect). What it needs from the product: connections in the field (a spreadsheet, a printer, the read-only SAP lookups built with their IT from the drafted definitions), tablets and a pace board on the floor, provisioning that is repeatable (a company on the instance with its own passwords in minutes; a second service by hand if the isolation step has to be stronger before D). Commercial shape per the pilot doc: a fixed end date, the customer pays hardware and API, a sustaining rate after. Gate: a floor person at the pilot files a request from a tablet, and the change is on their floor the same shift with the manager's click and nobody from Anetix in the loop.

**4. Demo readiness for the summit.** The runbook dry-run cold, fake mode off, with the proposer reading on arrival (or switched off for the "Review with AI" moment, the runbook says which). A three minute recorded loop. Gate: the demo runs in front of a stranger and the loop lands without narration.

**5. Model evidence.** Label every stop on the checks log as right, wrong or unsure. Replay the labeled cases through the current brief whenever the brief changes. When a lane's quiet stretch is long enough, run the first A/B of a cheaper build model on that lane, with the not-quite rate as the miss signal. Gate: a written answer, with numbers, to "can Sonnet build UI changes at this plant".

**6. Deck honesty.** The deck claims the pattern library compounds and teaches every other site, same-shift turnaround, under ten engineer-days to onboard, and 50 to 100 plants per engineer. Same shift is measured now (loop health). Onboarding days will be measured at the pilot. The pattern library does not exist. Before the summit, either the slide matches the product or the slide says "next". Gate: every claim on the deck maps to a measured number or a dated item on this roadmap.

### After the summit (the review's item 10 and what the pilot teaches)

- **Per-plant memory.** What this plant's manager adjusted, declined and said "a little left" about, distilled from the record into the proposer's and builder's guidance for that plant. The first use of the record beyond reading it back.
- **The pattern library.** Anonymized, opt-in, cross-plant: what changes were asked for, what was built, what held. A module reference format per module type, distilled from builds that worked, so the intake starts from a shape. This is the deck's compounding claim; it is built after there is more than one plant to compound.
- **Role-by-role replay and A/B.** The harness from item 5 turned into a standing practice: a lane at a time, with the quiet stretch as the trigger.
- **Option D.** A control plane, a runtime and database per customer, the same image for cloud, GovCloud and on-prem, when the trigger fires. The isolation built in C is the design of the runtime.
- **Connections, as real systems ask.** The bridge transport for an on-prem ERP; SAP Business One; an unattended file push; automatic BAQ creation only if a pilot shows it is real. A Teams notification through a Workflows webhook only if a pilot asks; email stays off.
- **Small things the review noted.** An operator's idea filed as a module request from the floor. A first-week mode for a new module (more questions, smaller changes). A governed data-correction lane (a manager fixing a row through the loop, not through SQL). Housekeeping reviews once a module's checks pile up. A second factor on company delete and restore (and on deleting a tool for good, the floor round, which goes first). Handing the person at the device to module code on `ctx` (with per-person PIN sign-in, the floor round). Photo retention.

### Further out

The defense story: the same image in GovCloud and on-prem, the model behind the interface pointed at a hosted or local model, tenants that never join the cross-plant library. Module marketplace or sharing across factories is still deliberately deferred; the pattern library is the honest first form of it.

## 7. Decisions

| Date | Decision | Call |
|---|---|---|
| 2026-08-13 | First build | Thin working slice, doubles as demo |
| 2026-08-13 | Runtime | One runtime, managed modules |
| 2026-08-13 | Stack | Node, Express, plain HTML, Postgres; boring is a feature |
| 2026-08-13 | Environment | A simulated factory; backend and process are what is proven |
| 2026-08-13 | IP posture | Clean-room; no Langmuir code, data, names or branding |
| 2026-08-21 | Two lanes | UI changes light; functionality changes get a confirmed requirement, a second-model cross-check and tests; ambiguity goes to the heavier lane |
| 2026-09-16 | Pace | Maximum speed ramp: LOIs first, then a VC raise, with the December summit as the forcing function |
| 2026-09-17 | Tenancy | One repo forever; shared and hardened now (B); a process and role per company before a second company's production data (C); a runtime per customer at the first questionnaire or enterprise data (D) |
| 2026-09-17 | Builder model | Fable 5.1 for module creation and everywhere; the Agent SDK moved to 0.3.x for it |
| 2026-09-17 | Cost caps | Off in development; spend what the work needs; per-company budgets exist for pilots |
| 2026-09-18 | Objective | A floor operator with no technical experience builds and develops their own system through the loop |
| 2026-09-18 | Record | Every interaction word for word, insert-only; the plant owns it; cross-plant use opt-in; defense out |
| 2026-09-18 | Manager's card | No photo, no element, no before-and-after screenshots; the AI parses those |
| 2026-09-18 | Duplicates and questions | Linked by the proposer, never tallied by hand; one multiple-choice question with free text, answered by the reporter or the manager |
| 2026-09-19 | Notifications | No emails for every change. A small Done button and an "a little left" link on the shipped tile instead. Teams and SMS parked |
| 2026-09-19 | Staging data | A copy of the floor's rows, on purpose, with the reasons written down |
| 2026-09-19 | ERP | Admin side only; the manager never sees a lookup or a field; the data check at review says whether the data is there |
| 2026-09-19 | Item 7 | A real browser on the instance with a fallback; a manager may retire a promise, with a confirm |
| 2026-09-20 | Credit | A glide slope on the admin page from a balance the admin enters; autofill when live |
| 2026-09-20 | API keys | One key for the instance; billing is per iteration; per-company keys cancelled |
| 2026-09-20 | Isolation posture | `auto`: a process of its own when the instance can, the old way with a red line on the admin page when it cannot; `process` (strict) before a second company's production data |
| 2026-10-29 | Floor sign-in | No shared floor password: the floor signs in with a PIN, on the plant's wifi only, a week per device; a site starts on one common floor PIN, then a PIN per person |
| 2026-10-29 | Managers and admins | Their own account and a second factor, or Google/Microsoft sign-in (also for demo sign-up); never a shared manager password |
| 2026-10-29 | QR codes | A path to a QR code for every operator screen of every tool, printable at a size per station; operators who come in by a code see Feedback only |
| 2026-10-29 | The tool line | Name, Screens and Settings; everything else moves into the Settings popout |
| 2026-10-29 | Archive | A manager archives a tool (under Settings, data kept); an admin deletes for good |
| 2026-10-29 | Branding on tabs | The company's own icon on every tab; Anetix stays discreet |
| 2026-10-29 | Chelsea integrations | Bypassed for now; the MO sheet prints through the print dialog |

## 8. Risks worth naming

- **A check is only as good as the agent that wrote it.** The promises a module keeps are written by the builder. The first live ones have to be read (campaign). Mitigation: the manager retires bad promises; the cross-check reads the check; housekeeping reviews later.
- **The proposer's judgement on arrival is unread.** A wrong fold or a bad question costs a person's patience on the floor. Mitigation: the switch on the Agent settings page, "not the same" on every fold, the plain-words drop, and reading the first live ones before the pilot.
- **The wall depends on the host.** The process and role boundary reads green on Railway today; it must be checked on every new instance and is the first thing to verify on GovCloud or on-prem. Until D, every company shares one database and one key.
- **The deck is ahead of the product on compounding.** Section 6, item 6.
- **Time.** A full-time student until May 2027, a cofounder, and a raise that has not happened. The campaign and the pilot are the highest-value stopping points: with those done the product is honest and demonstrable even if everything after the summit slips.
- **IP boundary.** No Langmuir code, data or names in the repo; the provisional patent effort is under Anetix; keep the TLO conversation ahead of any commercial pilot paperwork.
- **Incumbent framing.** "AI builds your factory software" invites the Ignition and Tulip comparison. The answer: they sell toolkits that need someone who knows what to build; this sells the loop that turns floor friction into deployed software with the process knowledge the customer already has, and the verification that makes a nontechnical manager's click safe.

## 9. What is measured

All of these are on the admin page now, per company and across the fleet, from the primary tables and the record: requests filed and open; time to floor (filed to deployed, median and p90) and the same-shift share; manager wait (drafted to decided, then ready to deployed); proposals approved, edited first, declined, waiting; builds started, shipped, rolled back, cancelled; stops by kind (gate, reviewer, tests, AI service) and fix rounds and overrides; checks added and promises retired; fixed it, not quite, done and a little left, and the met share; what the proposer did on arrival (proposed, folded, asked, answered, flagged); AI spend in the window and per shipped change; the quiet stretch. The one number that says whether the flywheel is alive is still weekly feedback volume: if the floor stops reporting friction, the loop is dying regardless of everything else.
