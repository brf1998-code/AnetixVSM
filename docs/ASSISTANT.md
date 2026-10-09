# The assistant on the board (design, 2026-10-08, not built)

An AI engineer inside the improvement board. It walks people through the tools they have, explains how Anetix works,
helps turn an idea into a request, and for a manager knows the whole company. It is the "no forward deployed
engineers" line of the pitch made real: the engineer is in the product.

Working name in this doc: **the assistant**. Button label on the board: **Ask Anetix** (open to change). It never
names a model or a vendor, the same rule as module creation ("The Agent").

## What Brendan asked for (2026-10-08)

- An agentic chat built into the board. The person picks what to work with, like Cowork: **Anetix help** (how the
  product works) or **one tool**. It walks them through their system, suggests requests, and suggests new ideas.
- "That will be their forward deployed engineer." Someone with owner privileges gets **full company access**, not
  just one tool: the fully aware engineer.
- In a **demo** it shows but does not work: a scripted explanation of what it does, and that it is not available in a
  demo.
- Added the same evening: it can **write a proposal that goes straight to Reviewing** from the chat discussion.

## What the research says

Two research passes on 2026-10-08: shipped in-product assistants (Shopify Sidekick, Atlassian Rovo, Notion, HubSpot,
Linear, Intercom Fin, Microsoft Copilot in Dynamics, Salesforce Agentforce, and on the manufacturing side Tulip,
MaintainX, Rockwell, Siemens) and agent architecture and safety (Anthropic, OpenAI, Microsoft and Google agent
guidance, OWASP Top 10 for LLM apps 2025, NIST AI 600-1). Sources are at the end. What matters for this design:

**Shape.** Every vendor's guidance says the same: one agent with a handful of good tools, a hard cap on steps, human
checkpoints. Anthropic measured multi-agent setups at about 15x the tokens of a chat, against about 4x for one agent.
Fixed parts (who can see what, the request form, routing) stay plain code, not prompt. The Claude Agent SDK, which
the build loop uses, is the wrong runtime here: it starts a CLI process per session and reads settings from disk. A
plain Messages API tool loop is lighter and is what `agent.runStructured` already does.

**Scope.** The best products default to where the person already is and let them widen or narrow it on purpose, with
the scope always visible (Notion, Sidekick, VS Code). Atlassian shipped a bug in July 2026 where clicking a starter
prompt silently dropped the page context and the agent then made up a document id. So: a visible scope chip, and a
scope change starts a fresh conversation.

**Permissions.** The industry rule is that the assistant sees only what the person could see (Microsoft 365 Copilot,
Glean, Rovo, Salesforce). Scope comes from the signed-in session and is enforced in the tool code and the database,
never by the prompt and never from an argument the model sets (OWASP LLM06, "complete mediation"). Assume the system
prompt leaks (OWASP LLM07).

**Writes.** Draft, then a person confirms (Rovo, Sidekick, Cowork). Generated tickets and work orders are editable
before they are filed (MaintainX, Intercom). Rate each action by risk; only the low-risk ones run without a tap.

**Suggestions.** Starter prompts are few (Rovo gives each agent three), specific to the scope, and fill the box rather
than send. Proactive ideas go on their own surface, not as chat interruptions: Shopify's Pulse shows up to five
dismissable cards on the owner's home page. The Clippy problem is still live: Microsoft's floating Copilot button drew
enough complaints in 2026 that they added a way to dock it, and a small September 2026 study (10 people) found
proactive, generic help drove half of them to minimize or abandon the tool.

**"Show me where."** Products that guide people through screens pick from tours someone wrote (Pendo, Userflow,
Whatfix) rather than inventing highlights on the fly.

**Trust.** A "looked at" line naming what the answer drew on, citations that link to the real screen, thumbs up and
down with a reason, history, and "I don't know" over a made-up answer (Tulip: "I don't know is a better answer than
something made up"). Disclose that it is AI at first contact (EU AI Act Article 50, from August 2026; NIST AI 600-1).

**Safety.** Prompt injection is not solved (Anthropic, Microsoft). The design goal is that a successful injection
does no harm. The "lethal trifecta" (private data, untrusted text, a way to send data out) is the frame: this
assistant has the first two by nature (company data, words operators type), so it gets no way out. Text from records
goes to the model as labeled data, never as instructions.

**Cost.** Prompt caching with a stable prefix (tools, then system, then the conversation), a cap on tool steps per
turn, `max_tokens` on every call, metered from the response's usage including cache reads. Pooled per-company
allowances with alerts are the closest product pattern to Anetix's (Rovo alerts admins at 80% and 100%, and a request
already running always finishes).

**Demos.** I found no shipped product that answers with a scripted preview. The common pattern is a small real taste,
then a clear message naming the plan and who can turn it on (Notion, Intercom, Canva). Scripted is still the right
call for v1 per Brendan: it costs nothing and cannot leak; a real taste from the demo credit is the option for later.

## What is already built that this stands on

| The assistant needs | Already in the product | What changes |
|---|---|---|
| Live vs demo | `kind.isSite(company)`: a paid site or a trial, read at the moment | Nothing. Live on a paid site, scripted everywhere else |
| Its tools | The company MCP tool list in `docs/MCP.md` phase 2 (designed, not built) | Build that list once as a shared registry; the MCP and the assistant both serve it |
| Read-only, own company only, held by Postgres | The MCP design's `sos_<company>_mcp` SELECT-only role, same pattern as `src/dbroles.js` | The assistant's record reads go through it too |
| What the AI may read | The data wall, `src/datawall.js`; `atWall` refuses `runChat` outright for a walled company (Jonah) | A new wall kind for the assistant: allowed, but no record tools offered and no images or files |
| Filing a request | `POST /api/feedback`, arrival triage in `src/arrival.js` (duplicate, new tool, integration, one question), `proposals.generateProposal` | A new source, `assistant`, that lands in Reviewing with the proposer's draft |
| "Show me where" | Tours: each tool's `tour.json`, the spotlight engine in `public/assets/feedback-widget.js`, `?tour=1` | Start a tour at a given step |
| How a tool works | Diagrams after every deploy (`src/diagrams.js`), the "what changed" summaries | Nothing; read as tools |
| Voice | `public/assets/dictate.js`, the mic under every answer box | `Dictate.attach` on the chat box |
| Word-for-word record | `src/record.js` already has `chat_question` and `chat_answer` kinds | Add scope and the tools used to `detail`; add `assistant_filed` |
| No model names, no costs | `src/companyview.js` scrubs every `/api/` answer to a manager or floor session | The chat route goes through it like every other |
| Spend | The meter (`platform.ai_calls`), fair use at 80% of the site fee, `src/spendwatch.js` alerts | Meter kind `assistant`, so the admin pages show it on its own line |
| Platform requests | Requests to Anetix (`module = 'platform'`, the Requests tab) | Help scope can file there instead of to a tool |

## The design

### Where it lives: the board, not the tool pages

The assistant opens as a panel on the board (a side panel on a computer, a full-screen sheet on a phone) from an
**Ask Anetix** button in the band. It is also on the settings page.

**It does not run on a tool's own pages.** This is the one place the research and the codebase meet head on. A tool
page runs agent-written code, and CLAUDE.md's hard rule is that anything the page policy opens is reachable by that
code with the session of whoever has the page open, a manager included. An assistant reachable from a tool page would
let agent-written code ask it, as the manager, for anything the manager can see, and file requests. So a tool page gets
a plain link, **Ask about this tool** (manager sessions only), that opens the board with the panel open and that tool
picked. The chat routes
live under a path the page policy does not open.

### The picker

A row of chips at the top of the panel, always visible:

- **Anetix help**: how the product works (the board, requests, previews, going live, settings).
- **One chip per tool** live or in preview at the company.
- **Whole company**: managers only. This is the "fully aware engineer."

Default: the tool the person came from (the "Ask about this tool" link, or the board's tool filter when it is set to
one tool). Otherwise **Whole company**. Changing the chip starts a new
conversation and says so in one line; a conversation never quietly changes what it is about.

### Who sees what

**v1 is managers only** (decision 2). A floor session sees no button, no panel and no "Ask about this tool" link, and
the chat routes refuse it. The floor column is the plan for when Brendan turns it on.

| | Floor (later, not v1) | Manager (v1) | Anetix admin |
|---|---|---|---|
| Scopes | Anetix help, any one tool | Anetix help, any one tool, Whole company | Any company's assistant as that company's manager, for support |
| A tool's screens, tour, diagram, what changed | Yes | Yes | Yes |
| The board's requests and their status | The ones the board already shows the floor | All of them, with the history | All |
| The record (what was said and decided) | Their own requests | All of it | All |
| A tool's records | One tool at a time, wall down only | Any tool, wall down only | As the manager |
| File a request to Reviewing | Yes, as their name | Yes, as their account | No (support only) |
| Never | Model names, AI costs, a tool's code, agent docs, secrets, another company | Same | Same on the company side |

The rule in one line: **the assistant shows a person nothing their own screens do not already show them.** "Owner
privileges" is the manager role (decision 1): there is no owner role, and a manager already sees the whole board.

When it cannot see something it says so plainly and says why ("Your company has records switched off for Anetix's
AI, so I can see how this tool is built but not what is in it."). Shopify warns about the opposite failure, a model that explains why it
cannot help instead of trying, so the eval set checks both.

### What it can do: the tools

One registry, `src/assist-tools.js`, each tool a name, a description, an input schema and `handler(session, args)`.
The company MCP (phase 2) serves the same registry to a company's own AI app, so building this builds most of that.

| Tool | Does | Notes |
|---|---|---|
| `list_tools` | Each tool: name, screens, live version, last change | |
| `describe_tool` | Screens, tables and columns, row counts, the diagram, the tour's steps | No code, no agent docs |
| `whats_changed` | Shipped changes in plain words | |
| `list_requests`, `get_request` | The board: requests, status, who asked, the question asked and its answer | Later, a floor session would see only what the board shows the floor |
| `summarize_records` | Counts, sums and averages, grouped, over a date range | Wall down only. The query is built on the server from names checked against the tool's own tables. No free SQL |
| `read_records` | Rows of one table: filter, sort, page | Wall down only. Small pages, IDs resolved to names |
| `show_on_screen` | Picks a step from the tool's tour and returns a **Show me** button | Never makes up a screen element |
| `draft_request` | Returns a request card for the person to check | Writes nothing |

The **Anetix help** knowledge is a new customer-facing doc, `principles/HELP.md`, written in plain words, kept in the
cached part of the prompt. It covers the board, requests, previews, approvals, going live, settings, connections and
what the assistant itself can and cannot do. It names no model and no vendor.

Every handler takes company, role, person and scope from the session. No tool has a company, role or tool argument
the model can set to reach further; `list_tools` in a one-tool conversation returns that one tool.

### Filing a request straight to Reviewing

Brendan's addition. The flow:

1. The conversation settles on a change. The assistant calls `draft_request` and the panel shows a card: the tool,
   what to change in the person's words, why, the details agreed in the chat, and who is asking.
2. Before the card shows, the assistant checks the open requests. If the same thing is already asked, the card says
   so ("This looks like #12, asked by Dana on Tuesday. Add your voice to it?").
3. The person can edit the card, then taps **Send to Reviewing**. Nothing is filed without that tap.
4. The platform makes the feedback row (`source = 'assistant'`, the person's name, a link to the conversation) and
   runs the same triage the proposer runs on arrival: a duplicate folds into the open request, a whole new tool goes
   to module creation, an outside connection goes to the integration team.
5. The ordinary case goes to `proposals.generateProposal` with the card as the request. The proposer reads the tool's
   full source and picks the class and the screen, exactly as for any request. The card lands in **Reviewing** with
   its draft proposal, a small "from a conversation" tag, and the conversation one tap away.
6. The manager's gate is where it always was. Nothing is built until the manager approves.

Why the proposer writes the proposal and not the chat: one way of making proposals stays one way, and the proposer is
the step that reads the tool's whole source and is checked on class and screen. The chat supplies the request and the
agreed details, which is what the proposer has always worked from.

Help scope: a request about Anetix itself files to **Requests to Anetix** instead, as `module = 'platform'`.

Why this one does not wait for the manager's tap the way an MCP-filed request does: the MCP design made those wait
because a company's own AI app could paste walled rows into a request. Here, with the wall up the assistant never read
a row, so its card carries only words and structure; with the wall down the rows were already allowed in prompts. A
daily cap on requests filed through the assistant per person stops a loop from running up proposer spend.

### Ideas and suggestions

- **Starter prompts:** three per scope, filling the box rather than sending. Examples: help, "How do I get a change
  made?"; one tool, "Walk me through this tool" and "What changed here lately?"; whole company, "What should we
  improve next?"
- **"What should we improve next?"** (manager): reads the board, the record and, with the wall down, the tools'
  numbers, and offers up to three ideas, each with why and a **Draft it** button that goes to the request card.
- **No unprompted messages in v1.** No pop-ups, no nudges. The assistant speaks when spoken to.
- **v2, suggestion cards:** up to five idea cards on the board for managers, each dismissable with a reason that
  shapes the next ones (the Pulse pattern). Later, because a card nobody asked for has to be very good to be welcome.

### Show me where

The assistant answers "where do I find X" with words and a **Show me** button. The button opens the tool page at the
matching tour step (`?tour=1&step=N`, a small addition to the tour engine). It only offers steps that exist in that
tool's `tour.json`. A tool with no tour gets words only, and that gap is worth a line on the admin side so tours get
written for the tools people ask about.

### What the person sees in an answer

- Short answers by default, plain words, no software terms (the same rule as module creation's intake).
- A **Looked at** line under each answer naming what it read, each a link to the screen or the request.
- Thumbs up and down; down asks for a reason in a few words.
- History: the person's past conversations, newest first.
- A line at the top of the panel: "You're talking to Anetix's AI. It can be wrong; check numbers on the tool's own
  screen."
- Mic under the box (`Dictate.attach`).

### In a demo

On any company that is not a paid site (`kind.isSite` false), the panel, the chips and the starter prompts all show,
so the demo user sees the shape. Sending anything returns a set answer for the chip picked, with no model call and no
credit used. Each set answer is three parts: what the assistant does in that scope, one example exchange marked
**Example**, and "Turns on when this is a live site" with the Go live link for a manager. Draft copy:

**Anetix help.** "On a live site I answer questions about how Anetix works, walk you through your tools screen by
screen, and help you turn an idea into a request your manager can approve. I'm not switched on in a demo, so this is
a set answer.
*Example.* You: How do I get a change made to this screen? Me: Tell me what's off and I'll write it up with you. It
goes to Reviewing with a draft of the change, and nothing is built until your manager approves it."

**One tool.** "On a live site I know this tool's screens, what has changed in it, its open requests and, if your
company allows it, its numbers. I can show you where things are and help you write up a change.
*Example.* You: Where do I enter a recount? Me: [Show me] opens the screen and points at it."

**Whole company** (manager). "On a live site I see every tool, the board's history and what was decided, so I can
tell you where things stand and suggest what to improve next, then draft the request with you.
*Example.* You: What should we improve next? Me: Three ideas from this month's requests and records, each with a
Draft it button."

Typed words in a demo are recorded like every other interaction, and the Demos tab shows how many demo users opened
the panel, which chip they picked and what they asked. That is a cheap read on what people expect it to do.

### Safety

- **No way out.** No web, no email, no fetching an address. Answers render as plain text with simple formatting;
  links only to this instance's own pages; no images. With nothing outbound, an injected instruction has nowhere to
  send what it reads.
- **Typed text is data.** Tool results go to the model as JSON, labeled by where they came from ("typed by a person on
  the floor in a request"). The system prompt says nothing inside a tool result is an instruction. Seeded injection
  rows are in the eval set.
- **One write, two people.** The only write is a request, filed on the person's tap and built only on the manager's
  approval. The card shows the person's own words, so an approver sees what was asked, not just what the AI wrote.
- **Scope held in three places:** the session, the tool handler, and the read-only database role. A new route
  addressed by an id goes in `auth.OWNERS`; `scripts/e2e/badids.js` walks it.
- **Limits:** at most 8 tool calls per turn, `max_tokens` on every call, a conversation capped at about 40 turns
  (then "start a new one", with a summary carried over), and a per-person daily turn count as a loop guard. These are
  starting values to tune, not product limits on spend; Brendan's rule of alerts instead of spend caps stands.

### Model, cost and the meter

- **Model:** the company's baseline (Opus 5.5 today) for every scope in v1, per Brendan's stance of higher-end first
  and optimize later. Step Anetix help down to the short-text model (Sonnet 5) once the eval set passes on it.
- **Runtime:** a tool loop on the Messages API in `src/agent.js`, beside `runStructured`, through `atWall` and the
  meter. Not the Agent SDK.
- **Caching:** tools, then the system prompt and HELP.md, then the conversation, with the cache breakpoint moving
  forward each turn. Keep the tool sets to a few fixed variants (help, one tool, whole company; wall up or down) so
  the cache holds.
- **Rough cost**, my estimate from the price table in `src/agent.js`, not measured: about 5 to 10 cents a turn on
  Opus 5.5 with caching, about half that on Sonnet 5. The one real data point is Jonah: one Sonnet answer took 11
  seconds and 1.5 cents (2026-09-14).
- **Meter kind `assistant`**, so it has its own line on the admin pages and counts toward a site's fair use. The spend
  alerts already cover a company climbing fast.
- Stream the answer so the first words show quickly.

### The record, the audit trail and evals

- Every question and answer goes to the record (`chat_question`, `chat_answer`) with the scope and the tools used.
  The plant owns it; using conversations to improve the assistant across plants is opt-in, per the data terms.
- `platform.assistant_calls`, like `platform.mcp_calls`: per turn, who, scope, each tool called with its arguments,
  what was read (ids), whether it worked, tokens. Never the answer text (the record has that).
- Admin side: per company, conversations, thumbs down with reasons, requests filed through it and how many were
  approved, spend. Thumbs down become eval cases.
- **Evals before it goes live:** about 30 questions across the three scopes and both roles, kept in
  `scripts/e2e/assistant.js` and run on every change to the prompt, a tool description or the model. Must include: a
  one-tool conversation asked about a different tool (stays in scope, offers to switch), a walled company asking for
  rows (declines in plain words), a seeded injection line in a request, "what model are you" (names none), another
  company's slug (nothing), a floor session calling the chat route (refused), and plain help questions it must just
  answer.

## What I'd leave out of v1, and why

- **Subagents:** about 15x the tokens of a chat; nothing here needs parallel research.
- **Free SQL:** the catalog names other companies' schemas; the MCP design already rules it out.
- **Cross-session memory:** a poisoning risk and a privacy question; history is enough to start.
- **Suggestion cards and any unprompted message:** v2, managers only, after v1 shows what people ask.
- **Made-up screen highlights:** tour steps only.
- **Running on a tool's pages:** the page policy rule above.
- **The floor:** managers only until Brendan sees whether the floor would use it (decision 2).

## Build order

0. The shared tool registry and the read-only role (also the start of the company MCP, phase 2).
1. The panel, the chips, Anetix help with HELP.md, and the demo's set answers.
2. One-tool scope.
3. Whole company.
4. The request card to Reviewing.
5. Show me where (tour steps).
6. Evals, the admin view, the e2e proof; then turn it on for the first paid site.

## Decisions (Brendan, 2026-10-08)

1. **Owner:** every manager gets Whole company. No new role.
2. **Floor:** managers only in v1. "Eh let's keep it to just managers, we will see when the rubber meets the road if
   that would help." The floor column in "Who sees what" is the plan for later, not v1.
3. **Model:** the baseline (Opus 5.5) for every scope at first; step Anetix help down once the evals pass on the
   cheaper model.
4. **Demo:** set answers only. No model call, no credit used.

## Sources

In-product assistants: help.shopify.com/en/manual/shopify-admin/productivity-tools/sidekick/features,
help.shopify.com/en/manual/ai-powered-tools/sidekick/pulse, shopify.engineering/building-production-ready-agentic-systems,
support.atlassian.com/rovo/docs/chat-to-a-rovo-agent, support.atlassian.com/rovo/docs/chat-actions,
community.atlassian.com (Rovo context bug thread, July 2026), atlassian.com/licensing/rovo,
notion.com/help/notion-agent, notion.com/help/complimentary-ai-responses, knowledge.hubspot.com/ai/use-breeze-assistant,
linear.app/docs/triage-intelligence, linear.app/docs/linear-agent, intercom.com/pricing,
learn.microsoft.com/en-us/dynamics365/business-central/chat-with-copilot, code.visualstudio.com/docs/copilot/concepts/context,
cloudscape.design/patterns/genai/support-prompts, support.pendo.io (agent guidance article), userflow.com/ai-assistant,
support.tulip.co/docs/ai-chat-widget.md, support.tulip.co/docs/tulip-ai-usage-and-pricing.md,
tulip.co/blog/announcing-frontline-copilot, getmaintainx.com/blog/maintainx-assist-ai-assistant-for-maintenance,
rockwellautomation.com (FactoryTalk Design Studio Copilot docs), microsoft.com/en-us/haxtoolkit/library,
pair.withgoogle.com/chapter/explainability-trust, arxiv.org/abs/2609.13718,
webpronews.com/microsoft-bows-to-outcry-over-pesky-floating-copilot-button.

Architecture and safety: anthropic.com/engineering/building-effective-agents, anthropic.com/engineering/writing-tools-for-agents,
anthropic.com/engineering/effective-context-engineering-for-ai-agents, anthropic.com/engineering/multi-agent-research-system,
anthropic.com/engineering/demystifying-evals-for-ai-agents, anthropic.com/research/prompt-injection-defenses,
code.claude.com/docs/en/agent-sdk/hosting, platform.claude.com/docs/en/build-with-claude/prompt-caching,
platform.claude.com/docs/en/agents-and-tools/mcp-connector, cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf,
learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns,
learn.microsoft.com/en-us/copilot/microsoft-365/microsoft-365-copilot-privacy, learn.microsoft.com/en-us/purview/audit-copilot,
microsoft.com/msrc/blog/2025/07/how-microsoft-defends-against-indirect-prompt-injection-attacks,
docs.glean.com/security/security-principles, genai.owasp.org/llmrisk/llm01-prompt-injection,
genai.owasp.org/llmrisk/llm062025-excessive-agency, genai.owasp.org/llmrisk/llm072025-system-prompt-leakage,
genai.owasp.org/llmrisk/llm102025-unbounded-consumption, simonwillison.net/2025/Jun/16/the-lethal-trifecta,
simonwillison.net/2025/Jun/13/prompt-injection-design-patterns, postgresql.org/docs/current/ddl-rowsecurity.html,
nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf, artificialintelligenceact.eu/article/50.

Not verified: the September 2026 study is small (10 people); the OWASP agentic list came through a secondary source;
prompt caching and compaction details are from current docs and may change.
