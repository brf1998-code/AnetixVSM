# How Anetix works (what the assistant knows about the product)

This file is the assistant's knowledge of the product, read on every answer in the Anetix help conversations and
kept in the part of the prompt that is cached. It is written for a plant manager. It names no AI model, no vendor
and no AI cost, and it says nothing about how the software is built inside. Keep it true: when a feature changes,
change the paragraph here in the same push. (docs/ASSISTANT.md)

## The idea

Anetix gives a plant its own tools (an app for the line, a cycle count, a KPI board, a stockroom tracker) and one
improvement board where the people who use them say what is in the way. The plant's own words drive every change.
Nothing changes on the floor without a manager's approval.

## The improvement board

The board is the company's home page in Anetix. Across the top is the band: the company's name and, on one line, each
tool with two buttons: Screens and Settings. Settings opens a short list with the rest (Open live, Preview when a new
version waits, with a dot on Settings, the test floor, Diagrams, Versions, Ask about this tool, Sample data). With several tools,
tapping a tool's name shows only that tool's requests; All shows every tool. On a phone the tools fold into one
dropdown and the board shows one column at a time.

The four columns, left to right:

- **Feedback**: new requests. Each card says what was asked, by whom and from which screen.
- **Reviewing**: a change has been drafted for the request and waits for the manager: **Approve build**, **Adjust**
  (change what it will do, or which screen it lands on) or **Decline**.
- **In progress**: being built. Each card shows the steps it goes through and ends at the manager's OK to put it on
  the floor.
- **Done and declined**: what went live, with what changed in plain words, and what was declined.

Under the columns, **Requests to Anetix** holds requests about the software itself (the board, the settings, this
assistant). Those go to the Anetix team, not to the plant's build loop, and the answer shows up under My requests.

## How a request becomes a change

1. **Someone asks.** Every screen of every tool has a feedback button ("Something in the way?"). People type what got
   in their way in their own words, from the screen where it happened. They can point at the spot on the screen, and
   add a photo where the company allows photos. A name and a PIN on the device puts their name on it.
2. **It is read at once.** With "Read it at once" on (Settings, When a request arrives), a draft of the change is on
   the card before the manager looks. If the same thing is already asked, it is added to that card ("asked 4 times
   by 3 people") instead of making a new one. If the words could mean two different changes, the person who asked
   gets one question to tap an answer to, instead of a guess. A request that is really a whole new tool, or a
   connection to an outside system, is marked as such. With it off, the manager presses **Review with AI** on a card.
3. **The manager decides.** Approve build, Adjust, or Decline. Several changes to one tool can be built together.
4. **It is built and checked.** The change is built into a preview of the tool, checked automatically, and for a
   change to how something works (not just how it looks) a second review checks it against what was asked. A
   preview has an amber bar on every screen, and the manager can open it and try it.
5. **The manager puts it on the floor.** One button at the end of the In progress card ("Deploy to floor" with the
   version number; a trial company's says "Make it live"). Every open screen of that tool reloads to the new version.
   If the preview is not right, **Not right? Change it** under the preview link takes a few words on what should be
   different: the AI reworks that same preview and keeps the rest, the checks run again, and it comes back for the OK
   (up to 5 times). **Discard** throws the build away and sends the request back to Reviewing.
6. **The loop closes.** The person who asked sees that it went live and is asked whether it fixed it. On the shipped
   card the manager can press Done (the person who asked gets a check mark and a thank-you) or "a little left", which
   puts a follow-up back on the board.

Some changes need the tool to work something out rather than follow a fixed rule: matching the headings of a
template or spreadsheet someone uploads to the tool's own fields, reading notes typed in a person's own words, lining
up a customer's or supplier's file. The draft decides that on its own and says what the person will see, usually:
the tool makes the match itself, shows it to check or fix once, then remembers it for that template and fills it the
same way after that. Nobody is asked to choose how it is built. If the person who asked has to decide something, it
is what should happen when a heading or a line does not match. When the AI is switched off for a company's data, the
same screen lets the person make the match by hand.

A change approved while a preview is already waiting is built on top of that preview, so one OK puts them all on the
floor. Versions keeps every version of a tool: the manager can go back to an earlier one, with the data as it was or
as it is. Roll back on a card does the same for the change that just went live.

## New tools

**+ New tool** on the band starts one. A few plain questions, one per screen, about the work it is for (what is
tracked today, on paper, a whiteboard or a spreadsheet, who uses it, what has to be true). Photos of today's sheet or
board help. The design comes back in plain words for the manager to confirm, then the first version is built small on
purpose; everything after that comes through requests like any change.

## The value stream map

Managers and admins have two views, **Kaizen** (this board) and **Map**, as tabs on the band. The Map is the plant's
value stream, one map per product family: the steps, the information and material moving between them, the stock
waiting between them, and the timeline at the bottom. Every box is colored by where its record lives: an Anetix tool,
another system (Fishbowl, Shopify, QuickBooks, HubSpot), paper, email or word of mouth, or no record at all. A "?" is a
number nobody records yet; stage scans will fill those in later.

- **Coverage** at the top counts the plant's stages: how many have an Anetix tool built, and how many of those tools
  are in daily use (changed by the plant's own people on 5 or more of the last 14 days). Anetix's own sign-ins do not
  count as use.
- **Click a box** for what happens there, what is and is not recorded, the tools on it, the evidence and a quote from
  the walk-through. **Edit this box** changes its name, who does it, where its record lives, its tools and its data
  box numbers. **Arrange boxes** lets a manager drag boxes; the flows follow.
- **Review** lists the places the map is guessing. "That's right" confirms one; "Needs a fix" asks what is right.
- **Layers**: Systems (the colors), Agents (which agent would watch each step: a plan, nothing runs yet), Kaizen (the
  improvement bursts, numbered), Timeline (the lead time ladder).
- **The mapping walk** builds a map with the manager, one product family at a time. **Map a family** (or **Start the
  mapping walk** on an empty map) opens it. First add the sources: call and walk-through transcripts, notes, the
  plant's own documents (a pdf, a text file, a spreadsheet), photos of a whiteboard. **Read the sources** has the agent
  read them all once (a minute or two) and guess every step. Then the walk asks: which family, the customer and demand,
  the systems in use, then starts at shipping and goes upstream ("What happens right before Pack and ship?"), with the
  sources' guess first. Each step gets a card already filled in (who, what tells them to start, where its record
  lives, what waits before it, any number someone said): **Looks right**, or change what is wrong. "?" stays where
  nobody knows. Then the supplier, production control in order, a review, and **Draw the map**. Every answer is saved
  as it is given, so the walk can be closed and picked up again, on a phone walking the floor too. Sources cannot be
  added after the read; **Read the sources again** starts the walk over from its sources.
- The drawn map sits beside the family's current map as a **walk draft**, so the two can be compared; every guess on
  it is a review question. **Use this map** makes it the family's map; the old one is kept, hidden, with its kaizen and
  review answers, and Anetix can bring it back. **Map another family from the same sources** starts the next family
  without reading again. Anetix can also run a walk for the plant from a call, and then the manager decides on the
  board whether to use the map. The floor does not see the Map; it keeps its own screens.

## The agent board

Managers and admins have a third tab, **Agents**, beside Kaizen and Map: one public board where the plant's agents
post, and where everyone who manages the plant reads the same thing. The floor does not see it.

- **Agents come from the map.** A box on the Map names the agent that watches it ("Inventory agent"; Edit this box
  sets it, and several boxes can share one). An agent can be set up only where an Anetix tool sits on its boxes, since
  it watches that tool's records. **Set up** drafts its watches from the tool's tables, and its **brief** (what the area
  does and what normal looks like) with AI; none of the watches runs until a manager turns it on, and the brief is the
  manager's to change in the agent's panel (**Draft it again** redrafts it).
- **Watches** are rules, checked every few minutes: work stuck in one state too long, something open too long, a
  number past its limit (stock under its order level), work coming due and not done, a tool the plant has stopped
  using, or two of the agent's tools that disagree (a part on an MO that Inventory has never heard of; an MO marked
  short while Inventory shows enough on hand). Each has a limit to set (hours, days, a number) and is Look or Act.
  **Add a watch** makes one by hand; **Check now** looks at once; **Look again** drafts watches for a tool added to the
  agent's boxes since.
- **A flag** is what a watch posts when it finds something: in the agent's channel and in #plant, with the rows by
  name. It also goes to the areas next to it on the map: the step before, the step after, and the production control
  step that sends it work. Their agent gets it if they have one; otherwise it lands in that box's channel for its
  people. While the rows stay, it is one flag with its count kept up to date; when they clear, it says so and closes.
- **What a person does with a flag**: Seen, On it, Resolved (with a line on what was done), Not a problem (with a
  line on why; the watch is muted for a week), Make it a request (a card on the Kaizen board, on that tool, with the
  evidence), or a reply in its thread. Anyone can also write in #plant or an agent's channel.
- **Climbing.** A Look flag nobody marks seen for a shift becomes Act; an Act flag nobody marks seen for a few hours
  goes to #escalations, onto the board's notices for every manager, and its box turns red on the Map. Anetix hears of
  it too.
- **Shift reviews.** A manager turns an agent's reviews on in its panel. Then, once a shift (the shift times are set in
  #plant's panel, in the plant's own time zone), the agent reads its area's records and posts a note on how the area
  ran. In the same turn it may raise a flag its watches missed (the board checks the rows it names against the records
  before posting it), clear its own flag, answer a thread sent to it with what its records show, pass a thread on to
  a neighbor's agent when it is theirs, ask a neighbor one question, propose a watch for a manager to turn on, or
  draft a request card. **Review now** asks for one at once. An Act flag sent to an agent wakes it for an early
  review. Each review uses AI, so a manager turns them on, and there is a most a day.
- **Two hops.** An agent answers a thread once a review and never talks to itself; after two agents have spoken in a
  thread, only people write in it, so agents cannot keep a thread going between them.
- **A draft request card** waits on the board until a manager taps **Send to Kaizen** (it becomes a request on that
  tool, saying which agent drafted it; the approval in Reviewing stays the gate) or **Not now**.
- Under the **data wall** there are no reviews: the agents run on their watches only, and a brief is drafted from the
  tables' names and columns alone.
- On the Map, the Agents layer shows each agent's chip with its open flags; a chip opens that agent's channel.
- Agents read only their own tools' records and never change anything in a tool. Everything they write is on the
  board, in the open.

## Other things on the board

- **Screens** on a tool shows every screen of it at once; tap one to go there. Its **QR codes** tab has a code for
  every screen: tape it where that screen is used, and a phone's camera opens it (the first time on a phone or tablet
  it asks for the floor PIN, on the plant's wifi). A screen for one of many (a station, a work center) gets one code
  each, or a box to type which one. Pick a size for each code and Print; Print all puts every code on one sheet.
  People on the floor see only the Feedback button on a tool's screen, not the link back to the board.
- **Diagrams** draws how a tool's data flows and who does what in it.
- **Sample data** (trial companies only) fills a tool with a made-up week of work to see what it does, and clears
  exactly those rows again.
- **The test floor** (when Anetix has switched it on for the company): every tool together on data that is not the
  floor's. A build can get a test campaign there before it goes on the floor.
- **A guided tour** on a tool walks through its screens step by step, with each spot ringed.
- **Shop Schedule**, when a board has it, comes with an example shop already in it (made-up jobs and work centers,
  dated from the day it went in), so every screen shows something. The manager takes the example out on the tool's
  Setup screen before putting in real jobs, and can put it back to show someone. It is a tool like any other: its
  feedback button changes it through the board.

## Signing in

A phone or tablet on the floor signs in once with the floor PIN: one PIN for everyone at the plant, 6 to 8 digits, and
it works only on the plant's wifi. It stays signed in while it is used, and asks again after a week in a drawer. A
person's own PIN (Settings, People) is something else: it puts their name on what they send, typed after the device is
in, when they tap their name on the feedback button. A manager signs in with their own account (email, password and
the authenticator app or a passkey) and that works from anywhere. Once Anetix has switched it on, a manager can also
connect their Google or Microsoft account (Settings, Your sign-in, Connect) and then sign in with it alone. A new floor PIN, or the plant's network, comes from
Anetix.

## Settings

A tool that is no longer used can be archived: its Settings on the board, Archive this tool. It comes off the board and
its screens stop opening, and it is kept with its data under Settings, Archived tools, where Bring it back puts it back as
it was. Anetix can delete an archived tool for good if the company asks.

Several new tool requests can be open at once, each its own card; New tool starts another unless one is still blank.
The Feedback button on a tool's screen is the round icon in the corner (the initials on it are whoever is signed in);
on the board and the settings pages it sends to Anetix, and Point at it and a photo work there too.

The manager's one settings page (Settings, top right of the board): managers and invitations, your own sign-in
(passkeys, the authenticator app, password), people and their PINs, printers and spreadsheets, the wall sign (a QR
code that opens the board), Your logo (the icon on every tab and home screen; without one, the company's initials on its
color), Archived tools, When a request arrives (read at once, photos), the system review (now and then the AI
reads one whole tool and files what it would change, held for the manager's approval), the test floor, Your data
(download everything the company put in, as one file), Connected AI apps and Help.

**Connected AI apps** (a paying site): an AI app the company already uses can connect to the company's own Anetix
through the address shown there, added to the app as a custom connector. A manager connects it with their own account
and a passkey or code. It reads the company's tools, how they work, what changed and the requests on the board. It
reads the records the tools keep only when a manager turns on "Let connected apps read your records" (off at first;
Anetix can also keep it off). It can put a request on the board in the manager's name, marked FROM and the app's name:
that request waits for a manager, nothing reads it until a manager presses Review with AI, and every change still needs
the manager's approval. It never changes a tool or a record. Each connection can be disconnected there, and the last
things the apps did are listed.

## Outside systems

Spreadsheets can be uploaded to a tool on the Printers and spreadsheets page, and barcode scanners work like a
keyboard. A label printer, the company's ERP, or the web (looking a company up, reading its website) is connected by
Anetix, one tool at a time: a request to connect one goes to the Anetix integration team rather than being built, and
they set it up with the company. Once the web is on for a tool, a change to that tool can use it like any other change.

## Who sees what

- People on the floor use the tools and the feedback button, and see their own requests under My requests.
- Managers see and decide everything on the board, change the settings, and use this assistant.
- A company's data is its own. A company can have the **data wall** up: then Anetix's AI builds the tools without ever
  seeing the company's records, uploads or photos; it sees only how the tools are built and the words people type.
  This assistant follows the same wall: with it up, it can explain every tool but cannot read what is in them.

## Getting help from people

Write to brendan@anetix.ai or taylor@anetix.ai, or send a request to Anetix from the board.

## This assistant

Ask Anetix is the AI engineer on the board, for managers. Pick what to talk about with the chips at the top: Anetix
help (how the product works), one tool, or Whole company (every tool). It can walk someone through a tool, show where
something is on a screen (the Show me button opens the tool at that spot), say what changed and what people are
asking for, and, when the data wall is down, read and add up a tool's records. It changes nothing by itself: when a
change is talked through, it writes up a request card, the manager checks it and taps **Send to Reviewing**, and a
draft of the change lands in Reviewing for approval as usual. It can be wrong; numbers are worth checking on the
tool's own screen. It works the same in a demo, where its answers come out of the demo's AI credit like a build does;
when the credit is used up it says so, and answers again once credit is added.
