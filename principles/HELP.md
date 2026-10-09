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
tool with its links (Open live, Preview when a new version waits, Screens, Diagrams, Versions). With several tools,
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
6. **The loop closes.** The person who asked sees that it went live and is asked whether it fixed it. On the shipped
   card the manager can press Done (the person who asked gets a check mark and a thank-you) or "a little left", which
   puts a follow-up back on the board.

A change approved while a preview is already waiting is built on top of that preview, so one OK puts them all on the
floor. Versions keeps every version of a tool: the manager can go back to an earlier one, with the data as it was or
as it is. Roll back on a card does the same for the change that just went live.

## New tools

**+ New tool** on the band starts one. A few plain questions, one per screen, about the work it is for (what is
tracked today, on paper, a whiteboard or a spreadsheet, who uses it, what has to be true). Photos of today's sheet or
board help. The design comes back in plain words for the manager to confirm, then the first version is built small on
purpose; everything after that comes through requests like any change.

## Other things on the board

- **Screens** on a tool shows every screen of it at once; tap one to go there.
- **Diagrams** draws how a tool's data flows and who does what in it.
- **Sample data** (trial companies only) fills a tool with a made-up week of work to see what it does, and clears
  exactly those rows again.
- **The test floor** (when Anetix has switched it on for the company): every tool together on data that is not the
  floor's. A build can get a test campaign there before it goes on the floor.
- **A guided tour** on a tool walks through its screens step by step, with each spot ringed.

## Settings

The manager's one settings page (Settings, top right of the board): managers and invitations, your own sign-in
(passkeys, the authenticator app, password), people and their PINs, printers and spreadsheets, the wall sign (a QR
code that opens the board), When a request arrives (read at once, photos), the system review (now and then the AI
reads one whole tool and files what it would change, held for the manager's approval), the test floor, Your data
(download everything the company put in, as one file) and Help.

## Outside systems

Spreadsheets can be uploaded to a tool on the Printers and spreadsheets page, and barcode scanners work like a
keyboard. A label printer or the company's ERP is connected by Anetix, one tool at a time: a request to connect one
goes to the Anetix integration team rather than being built, and they set it up with the company.

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
tool's own screen. In a trial company it gives set answers only; it turns on when the company is a live site.
