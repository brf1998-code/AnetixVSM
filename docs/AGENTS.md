# The agent board: agents that watch each area of the plant and talk in the open

*Design, rev 3, 2026-11-02. Brendan answered all six decisions (section 8). A1 is built (section 7 has what it is and
what it leaves for A2). It replaces section 8 of `docs/VSM.md` ("Agents, in three
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

Setting one up: on the map, a manager opens a box's agent chip and presses **Set up this agent**. The agent reads its
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
  the agent why), or **Make it a request** (a Kaizen card on that box, carrying the evidence). Every one of those is a
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
   box's station screen only.*
