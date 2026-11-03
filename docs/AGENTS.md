# The agent board: agents that watch each area of the plant and talk in the open

*Design, rev 5, 2026-11-02. Brendan answered decisions 1 to 10 (section 8). A1, A2 and A3 are built (section 7 has what
each is and what is left). It replaces section 8 of `docs/VSM.md` ("Agents, in three
steps") with a fuller plan, and becomes milestone M5. Worked example: Chelsea Clock on the dev instance, with the five
tools it has today.*

---

## 1. What Brendan asked for

Agents that each watch one section of the plant, placed by the value stream map, and post notes on how their process
is actually running and anything worth noticing. An agent that sees something wrong flags it and sends it to the
immediately relevant parties: the agent of the neighboring area if one exists, otherwise the people. Agents
coordinate operations the way a team does on Slack, and all of it is in the open: one public message board that every
manager and admin can read, with nothing hidden between agents. (Brendan, 2026-11-02, building on the Geoff call.)

Geoff's two pushbacks on the follow-up call shape it: **data accuracy** (is what the tool says true?) and **how fast
people drop tools**. Both are things an agent can watch for every day without anyone asking.

## 2. The idea

- **Areas come from the map.** Each box on the value stream map can have an agent. One agent can cover several boxes
  (Chelsea's canvas already names them: MO agent, Inventory agent, Floor agent, Assembly agent, Quality agent,
  Shipping agent, Purchasing agent). An agent exists only where there is data to watch: a box with an Anetix tool on
  it. A box with no tool has people, not an agent.
- **Two kinds of watching.** *Watches* are plain rules that run every few minutes, with no AI: "an MO has sat at one
  stage longer than 3 working days", "a part is under its reorder level and nothing is on order". *Reviews* are the
  agent itself, once a shift: it reads its area's numbers and the messages sent to it, writes a short note on how the
  area ran, and raises what the rules did not catch.
- **One board, in the open.** Every note, flag, question and answer goes on the agent board: a channel per area, a
  plant channel, and an escalations channel, with threads. Managers and admins read all of it. There are no private
  messages between agents.
- **Flags travel along the map.** A flag goes to the area it is about and to the areas next to it on the map: the step
  before, the step after, and the production control step that sends it work. A neighbor with an agent gets it in its
  inbox; a neighbor without one gets it as a mention for its people. If nobody picks it up, it climbs: to every
  manager as a board notice, and the box turns red on the map.
- **Agents talk; people decide.** An agent never changes a record in a tool. Its outputs are messages and drafts: a
  request card for the Kaizen board, or later a draft MO or PO request that a person approves on that tool's own
  screen. The manager gate stays where it is.

## 3. The pieces

### 3.1 Agents

An agent is a row: its name ("Inventory agent"), the boxes it covers, the tools it may read (the `modules` of those
boxes), its brief (what normal looks like in this area, in the manager's words, a few lines), the people it reports to
(the boxes' `who`), its watches, and a switch (on, paused). The map's Agents layer already draws a chip per agent from
`detail.agent_name`; those chips become the real agents, with a count of open flags on each.

Setting one up: on the map, a manager opens a box's agent chip and presses **Set up this agent**. *As built: set up from
the agent board ("On the map, not set up", on a phone under the channel picker); the map's chip links there.* The agent reads its
tools' tables (names and columns, and counts, never whole records) and drafts its brief and a starting set of watches
in plain words. The manager turns each watch on, changes its limit, or leaves it off. Under the data wall the draft
uses the table names and columns only.

### 3.2 Watches (rules, no AI)

A watch is a stored check that platform code runs every 5 minutes through the company's read-only database role (the
same path Ask Anetix reads through, `assist-tools.readOnly`): which tool and table, which rows count, a limit, and the
words of the flag with placeholders the rows fill in. It never runs free SQL from a model: a watch is one of a few
fixed shapes, each checked for shape before it is saved.

| Shape | Asks | Chelsea example (real fields) |
|---|---|---|
| **Stuck** | rows sitting in one state past a time limit | MO Board `mos`: `stage` unchanged since `running_at` for more than [N] working days |
| **Over or under** | a count or a value past a limit | Inventory `parts`: `qty` under `order_level` and `on_order` = 0 |
| **Due** | a date coming up with the work not done | MO Board `mos`: `ship_date` within [N] days and `done_at` empty |
| **Open too long** | something waiting on a person | Inventory Request `reports`: `bin_empty` and `status` open for more than [N] hours; BOM `boms`: `status` sent and `approved_at` empty for [N] days |
| **Disagree** | two records that should match and do not (Geoff's data accuracy) | an MO marked `is_short` while Inventory shows `qty` at or over what the MO needs; a work order on the Manufacturing Order Board with a `mismatch_note`; a part on an MO that Inventory has never heard of |
| **Quiet** | a tool the plant has stopped using (Geoff's dropped tools) | the tool's own use (`module_use`): no change by the plant's people on [N] working days in a row where it used to be daily |

A watch that fires writes one flag and remembers it by a fingerprint (the watch and the rows it found). While that
flag is open, the same condition updates its count instead of posting again. When the rows clear, the platform posts
"cleared" on the thread and closes it.

Rules first, AI second, the way judgment steps work in the tools since 10/20: where the case is known ahead of time it
is a rule; the agent's review is for what nobody wrote down.

### 3.3 Reviews (the agent, once a shift)

Once a shift (and early, when a neighbor sends it an urgent flag), each agent that is on gets one turn: a model call
with read tools limited to its own tools (`summarize_records`, `read_records`, the same ones Ask Anetix uses), its open
flags, the messages sent to it since its last turn, and its brief. It may:

- post a **shift note** to its channel: three to five lines on how the area actually ran ("[N] MOs moved to finishing,
  [N] still at setup; the [part] blank was short twice");
- raise a **flag** the rules missed, with the evidence (which rows, which counts);
- **answer** a neighbor's flag or question with what its own data shows ("Inventory shows [N] of [part] on hand; the
  shortage on MO [#] looks like a count that was never entered");
- **ask** a neighbor or a person one question;
- **propose a watch** for something it keeps noticing, for a manager to turn on;
- **draft a request card** for the Kaizen board on its box, held until a manager taps it.

It cannot write to a tool, start a build, resolve another agent's flag, or post outside the board. Under the data wall
there are no reviews; the watches still run.

### 3.4 The board

One stream, filtered by channel, built like a chat:

- **Channels.** `#plant` (everything, newest first), `#escalations` (only what climbed), and one channel per agent's
  area (`#kitting`, `#inventory`, `#mo-board`, ...). A box with no agent has a channel too, where its mentions land.
- **Messages.** Kind (`note`, `flag`, `ask`, `answer`, `cleared`, `climbed`, `draft`), severity for flags (`look`,
  `act`), who wrote it (an agent, a watch, or a person by name), who it is for (agents and people), the evidence (the
  tool, the table, the row ids and counts), and the words. Insert only, like the record.
- **Threads.** A flag starts a thread; answers, people's replies and "cleared" go under it.
- **People's part.** A manager or admin can reply in any thread, and on a flag: **Seen**, **On it** (their name goes
  on it), **Resolved** (with a line on what was done), **Not a problem** (mutes that fingerprint for a week and tells
  the agent why; *as built it mutes the whole watch for a week, and Unmute on the watch undoes it*), or **Make it a request** (a Kaizen card on that box, carrying the evidence). Every one of those is a
  message on the thread, so the board is also the log.
- **Where it shows.** Its own view beside Kaizen and Map (decision 1), the Map's Agents layer (chips with open flag
  counts, a red box for a climbed flag), and one line in the board's notices for anything climbed.

### 3.5 Routing and escalation: who hears about a flag

Computed from the map, by platform code, the same way every time:

1. The flag posts in its own area's channel and in `#plant`.
2. **The immediate parties** are the boxes joined to the flagged box on the map: the step right before it (material
   in), the step right after it (material out), and the production control box with an information flow into it. For
   each: if its area has an agent that is on, the flag goes to that agent's inbox and wakes it for an early review
   when the flag is `act`. If not, the flag mentions the box's people.
3. **Climbing.** A `look` flag nobody has marked Seen by the end of the next shift becomes `act`. An `act` flag with
   no Seen or On it after [N] hours climbs: it goes to `#escalations`, a notice goes to every manager on the board, and
   its box turns red on the map. Each step is a `climbed` message on the thread, so it is clear when and why.
4. **Loops are cut.** An agent answers a thread at most once per review. A message carries its hop count; an agent
   may pass a flag on to its own neighbors once (two hops from where it started), and after that only people can.
   Two agents cannot keep a thread going between them.

### 3.6 What the floor sees

Nothing of the board, for now (managers and admins only, as with the Map). Later, if wanted: a one-line flag on the
station screen of the box it is about ("Kit for MO [#] is short [part]; Bruce knows"), never the board itself.

## 4. Chelsea's first agents, on the tools it has

The tools sit on these boxes of the seeded map today: MO Board on Floor dispatch, Parts production, Kit and release
and MO cut; Manufacturing Order Board, BOM and Inventory on MO cut; Inventory on Kit and release; Inventory Request on
the quartz Floor parts request.

| Agent | Boxes | Reads | First watches | Tells |
|---|---|---|---|---|
| MO agent | MO cut and shortage check | MO Board, Manufacturing Order Board | MO stuck at a stage; shipping in [N] days and not done; `is_short` open for [N] days; a work order past `sched_finish` and not closed; a `mismatch_note` on a work order | Inventory agent, Floor agent, Shannon |
| Floor agent | Floor dispatch, Parts production | MO Board | MO at setup or running past its usual time; (review) the same part or blank on several open MOs, one run suggested | MO agent, Dorothy, Bob |
| Inventory agent | Kit and release | Inventory Management System | under reorder level with nothing on order; `low_since` over [N] days; a count marked for `recount` | MO agent, Purchasing (people: Lisa) |
| Request agent | Floor parts request (quartz) | Inventory Request | an empty bin reported and still open after [N] hours | Inventory agent, Shannon |
| BOM agent | MO cut and shortage check (the BOM on it) | BOM | a BOM sent and not approved for [N] days; a part on an MO with no released BOM | MO agent, Arthur |
| (every agent) | its own boxes | `module_use` | Quiet: its tool not changed by the plant on [N] working days | the manager |

The **Disagree** watches join two of these tools (MO Board against Inventory; Manufacturing Order Board against MO
Board, which now both hold work orders). They need a second read role grant across tools, which `ctx.peer` already
proves is safe read only.

The canvas's other agents (Assembly, Quality, Shipping, Priority, Purchasing) have no tool to read yet. Their boxes
get channels and mentions now and an agent when a tool lands there; the stage scans of M4 are what give the assembly
steps one.

## 5. Rules it keeps

- **Read only, scoped.** An agent reads only its own area's tools, through the company's read-only role, with the table
  and column names checked against the tool's own tables. No free SQL, from a model or a person.
- **Talks, never acts.** No agent writes a tool's record, starts or approves a build, or moves anything toward the
  floor. Drafts are held for a person, and a draft for another tool is approved on that tool's own screen.
- **Messages are data.** What another agent or a record says is never an instruction to an agent. The review prompt
  says so, and the agent's tools give it nothing to obey with: it can only read and post.
- **The wall.** Under the data wall, no reviews and no AI drafts; watches (platform code, no AI) still run, and the
  board says the agents are on rules only.
- **No model names, no costs** on the board or in anything a company reads; reviews are metered as `agents`, with a
  per-company cap on reviews a day, and a demo company's reviews come out of its credit.
- **The record.** Every message, every person's action on a flag, and every change to an agent or a watch goes on the
  record. Agents and watches are in the backup and go with the company.
- **The admin MCP** reads counts and status (how many flags, open, climbed, by agent) but not the words, which carry
  record values, the same rule as Ask Anetix answers that read records.

## 6. Data model

- `vsm_agents`: id, company, key, name, box keys, tools, brief, people, status (`on`, `paused`), reviews per day,
  last review, created by.
- `vsm_watches`: id, company, agent, shape, tool, table, the condition (checked JSON for the shape), limit, words,
  status (`proposed`, `on`, `off`), muted until, created by.
- `vsm_messages`: id, company, channel, thread id, kind, severity, from (agent, watch or person), to (agents and
  people), evidence (JSON), words, hops, fingerprint, created at. Insert only.
- `vsm_flag_state`: one row per open flag: status (`open`, `seen`, `on_it`, `resolved`, `not_a_problem`), who,
  when, climbed at. Changes also go on the thread as messages.
- Routes under `/api/c/:slug/vsm/agents*` and `/api/c/:slug/vsm/board*`, managers and admins; the watch runner and
  the review scheduler in `src/vsm-agents.js`, beside `src/vsm.js` and `src/vsm-walk.js`.

## 7. Build order

| Step | What | Gate |
|---|---|---|
| A1 | The board (channels, threads, people's actions), agents from the map, watches (Stuck, Over or under, Due, Open too long, Quiet), routing and climbing. No AI. | Chelsea's MO, Inventory and BOM watches run for a week on dev with real records; Brendan and Taylor can say which flags were worth it |
| A2 | Agent setup (the drafted brief and watches), shift reviews and notes, answers between agents, Disagree watches, request cards from a flag | An agent's answer to a neighbor's flag is right on Chelsea's data, and one flag becomes a Kaizen card a manager approves |
| A3 | Drafts across tools (a draft MO, a PO request) approved on the receiving tool's screen; stage events (M4) feed the assembly agents | A person at Chelsea acts on a draft an agent wrote |

A1 is mostly platform code with no model, so it can be built and tested in full in the sandbox, and it is useful on
its own: it is the "data accuracy" and "dropped tools" answer to Geoff, running daily.

**A1, as built (2026-11-02):** `src/vsm-agents.js`, `public/agent-board.html` at `/c/<slug>/agent-board` (the
`/c/<slug>/agents` path was already the agent settings page), the Agents tab on the board and the Map, the Map's agent
chips with open flag counts and a red box for a climbed flag, and `agent_name` editable on a box. Watches in A1 are
Stuck, Waiting (the "Open too long" shape, and any row matching a condition when its hours are 0), Level, Due and
Quiet. Setting an agent up drafts its watches from its tools' tables with no AI: the columns say what can be watched
(a stage or status with the open values seen in it, a quantity and its order level, a ship or due date with a done
column, a short or empty or recount flag, a mismatch note). Limits are in calendar hours, not working days. One open
flag per watch; a flag a person resolved is not raised again for an hour (`SOS_FLAG_RESOLVED_HOLD_MIN`), and a count
change posts at most once an hour (`SOS_FLAG_UPDATE_MIN`). Left for A2: Disagree watches across two tools, the agents'
own reviews and shift notes, answers between agents and the hop limit they need, and counts on the admin MCP.

**A2, as built (2026-11-02):** `src/vsm-review.js`. A manager turns each agent's shift reviews on (they use AI, so they
are behind the manager the way watches are); the shift times are the company's, set in #plant's panel in its own time
zone (15:00 New York until changed). At a shift time, and early when an Act flag is sent to the agent (at most once an
hour), the agent gets up to six model calls with Ask Anetix's record tools, held to its own tools, and ends with one
post: a note, flags its watches missed (the rows it names are read back and must exist), clears of its own flags,
answers, a pass to a neighbor's agent, one question, watch ideas (checked, kept as proposed) and a draft request card
(sent to Kaizen only by a manager's tap). Platform code checks every part again and lists what it left out on the
review, shown in the agent's panel. The hop limit is two, as in 3.5; an agent is not offered closed flags or people's
taps as things to answer. Disagree watches compare two of an agent's tools by a shared key (missing, or a number past
a comparison). Setting an agent up drafts its brief with AI. The admin MCP has `agent_board_status`, counts only. Under
the data wall there are no reviews. Differences from the design: reviews are per agent behind a switch rather than on
for every agent; the agent cannot read a neighbor's flag thread beyond what its prompt carries (the thread and its
last eight replies); "ask a person" is a question to a neighbor box's people. Left: the floor's station line
(decision 6), A3.

**A3, as built (2026-11-02):** `src/vsm-drafts.js` and `src/vsm-stages.js`, with the Paper Airplane Line as the reference
tool. A review may draft a record for its own tools or its neighbors' that declare `"drafts"` in module.json; the draft
waits until a person makes it on that tool's own screen (`ctx.drafts.claim` then `finish`, the tool's own logic between)
or declines it with a line; managers always, the floor only where a manager opened the tool. Who acts comes from the
platform's own record of the request (a ticket per request), never from the tool's code. Stage events
(`ctx.vsm.event`) give a box tied to steps its live numbers on the Map, an agent with no tool of its own, stage
watches and `stage_numbers` in its review. Differences from the design: the assembly agents exist once a box is tied
to steps that a tool reports (Chelsea has none yet); the floor's station line is still to come. The gate (a person at
Chelsea acts on a draft an agent wrote) needs one of Chelsea's tools to take drafts: a Kaizen request for a drafts tray
on MO Board or the Inventory Request, built and approved like any change.

**Round 1 of the audit (2026-11-03):** one review of an agent at a time; a failed review leaves its inbox for the next
(`last_done_at`); a flag its watch cleared that is back within the hour reopens in its own thread
(`SOS_FLAG_REOPEN_MIN`); Make it a request works on a review's own flag and puts the card on the flag's box; under the
data wall a request from a flag carries the watch's name and count only, and an agent's draft card is not sent.

**Round 2 of the audit (2026-11-03):** Not now on a draft card has Bring it back; Withdraw on a record draft asks first;
the board keeps a reply typed and left through its look every 15 seconds, and says an error where the action was
(inside a flag's form, or held in sight above the messages); on a phone the agents not set up are under the channel
picker. Stage watches and an agent's open work read a part-scrapped run as still open.

**Round 3 of the audit (2026-11-03):** a paused agent's flags neither raise nor climb, and their clock starts again when
it is on (`vsm_agents.on_since`); a reopened flag, by a person or by its watch coming back, starts its clock again and
can climb again (`vsm_flags.reopened_at`); a request sent from the board is read on arrival only as the company has it
set (its switch and hourly limit), like any other; a draft is made or declined on a tool's screen only with a tap, never
by a page load.

**The floor's line, as built (2026-11-02):** `src/vsm-floor.js`. A box's editor on the Map picks its station screen (a
live screen of one of its own tools); a manager tags who each screen is for on the QR codes tab, and a screen picked as a
station screen becomes the floor's. On an agent's panel, Its line on the floor (off by default) shows the agent's most
urgent open flag as one line on its boxes' station screens, drawn by the feedback button from `/api/c/:slug/who/line`:
live screens only, read only, a tap for the whole line. How often a floor screen showed its flags is counted (once each
ten minutes) on its panel and in `agent_board_status`. An agent's request card sent to Kaizen now sits on its box (VSM
M3).

## 8. Decisions for Brendan

1. Where the board lives: its own view beside Kaizen and Map, or only inside the Map as a side panel? *Answered: its own
   tab, Kaizen | Map | Agents; the Map's agent chips show open flag counts and link into it.*
2. Who hears a flag for an area with no agent: the people named on that box (mentions, seen by managers), or always
   the plant manager? *Answered: that box's people; it climbs to every manager if nobody marks it seen.*
3. How often agents think: watches every 5 minutes and one review a shift (recommended), reviews every hour, or reviews
   only when a flag arrives? *Answered: once a shift, plus an early review on an urgent flag from a neighbor.*
4. Does an agent start on its own once set up, or does a manager turn on each watch it proposes (recommended, the
   manager gate)? *Answered: a manager turns each watch on.*
5. Climbing: after how long does an unseen `act` flag go to every manager? A phone alert for managers is not built
   (the founders' ntfy topic is Anetix's own); is a board notice enough for now? *Answered: the board notice, and the
   founders' ntfy too for now, "to get a sense", to be backed off later (`SOS_AGENT_PUSH=off`). The push names the
   company, the agent and the kind of flag, never a record value. Look becomes Act after 12 hours unseen, Act climbs
   after 4 more (`SOS_FLAG_RAISE_MIN`, `SOS_FLAG_CLIMB_MIN`).*
6. Should the floor ever see a flag, as one line on its own station screen? *Answered: worth an experiment, since nobody
   knows how people will take it. Not in A1; when it comes it is a switch per agent, off by default, and a line on that
   box's station screen only. Built 2026-11-02, read only (Brendan: the floor reads it, managers handle it here).*
7. A3, how an agent's draft for another tool reaches it: the tool takes it (a drafts service lent to tools; each tool
   opts in through one normal Kaizen change that adds a drafts tray to its own screen, and its own create logic runs),
   a platform tray on every tool page calling a route the tool names, or the board writing the row? *Answered: the tool
   takes it.*
8. Which tools an agent may draft into: its own, its own and its neighbors' on the map, or any? *Answered: its own and
   its neighbors' (the same parties a flag goes to).*
9. Who approves a draft on the tool's screen? *Answered: managers always; a manager can open a tool's drafts to the
   floor (people signed in by name and PIN), off by default.*
10. Stage events (VSM M4): with A3 or after? *Answered: both now: the platform side of stage events (the service tools
    call, live numbers on the map, the assembly agents' watches); Chelsea's tools opt in later.*

