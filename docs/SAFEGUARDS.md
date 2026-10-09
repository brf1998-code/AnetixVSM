# Safeguards: a company that keeps government contract information here

*Built 2026-10-08 from the CMMC Level 1 gap audit of the same day (project doc
`claude/cmmc-level-1-gap-audit-2026-10-08.md`; the rules and the costs are in `claude/cmmc-level-1-pathway.md`).
Brendan: "offering to some of the defense base", then "get going on the product side fixes that are needed
including scanning uploaded files for malware". The code is `src/safeguards.js` and `src/scan.js`; the feature
history has the bullet "Safeguards for a company that keeps contract information here, and the upload scanner".*

## What this is for

A defense supplier answers for fifteen basic safeguards (CMMC Level 1, FAR 52.204-21, renumbered FAR 52.240-93
in 2026) on every system its Federal Contract Information (FCI) touches. Once a plant's tools here hold that
information (a purchase order number on a label, a delivery date on a schedule), this product is one of those
systems, and the plant will ask how Anetix covers each of the fifteen. This file is the answer as the product
stands, and the runbook for setting such a company up.

It is for FCI only. Controlled Unclassified Information, export-controlled technical data and anything
classified stay out (the Terms, 7.4). Nothing here changes that.

## The switches

All on the company's card on `/admin` (More, Safeguards), set by Anetix, each change on the company's record
(`safeguards_changed`). Off or open by default, so no other company changes.

| Switch | What it does | Default |
|---|---|---|
| Talk instead of typing | Off: no mic button on the company's pages. The page asks the platform before it ever listens, and the browser is told the microphone is not for these pages. On: the browser turns speech into words by sending the audio to Google (Chrome, Edge) or Apple (Safari). | On |
| Label previews | Off: a label's contents are never sent to the public renderer that draws its picture; the tool shows the label's text. | On |
| Uploads must be scanned | On: a file the malware scan could not take (no scanner, or it did not answer) is refused. Off: it is kept, marked unscanned, and scanned when the scanner answers again. A flagged file is refused either way. | Off |
| Ask Anetix | Off: no assistant on the board and its routes refuse. On: managers can ask it; what it reads to answer (how the tools are built, the board, and the records unless the company is walled off) goes to the AI service like the rest of the loop. | On |
| Shared passwords work from | Empty: anywhere. A list of addresses or ranges: the floor's password (and a shared manager password while one exists) works only from the plant's own network, at sign-in and on every request after. A named account with a second factor works from anywhere. | Anywhere |

And one action, under Sign-in on the same card: **take the shared manager password away**, so a manager signs
in by name with a second factor and no other way. It is refused until the company has a manager account whose
second factor is set up.

Two more that were already there and belong in the same conversation: **What the AI reads** (the data wall,
`docs/DATA-WALL.md`) and the **Outside** boxes on each tool (ERP and printer connections, off until Anetix
turns them on).

## The upload scanner

Every file that comes in from outside is scanned for malware before it is kept: a photo with a request, a file
added to a new tool's questions, a spreadsheet for a tool's table, a company's icon read from its site.

- **What does the scanning.** ClamAV, as a service of its own (`clamav`) on the instance's private network. It
  keeps its own signatures up to date. The product sends each file's bytes to it over the private network and
  reads the verdict; nothing is written to a disk on either side. `SOS_SCAN_HOST` on the product is its address.
- **At the door.** Clean: kept, marked clean with the time and the signature set that said so. Flagged: refused
  and never stored, on the company's record (`file_refused_by_scan`), in the event log, and a phone alert that
  names the company and the kind of file (never the file's name). Could not be scanned: refused for a company
  with "Uploads must be scanned" on, kept and marked unscanned for any other.
- **Looking behind.** Every hour the product scans whatever was kept unscanned, and scans again every stored
  file whose last scan is a week old, under that day's signatures. A stored file that a later scan flags is
  removed, on the company's record (`file_removed_by_scan`), with a phone alert.
- **Watching the scanner.** The Instance tab of `/admin` has an Upload scanner card: whether it answers, its
  engine, the day of its signatures, how many stored files are clean and how many are not scanned yet. A
  header pill shows when it is missing or not answering. The phones are told when it stops answering and when
  its signatures are more than three days old.
- **What is not scanned.** A backup file an admin restores (Anetix's own file, read as data, behind a fresh
  code); the files it carries are scanned by the look-behind. Text people type.

### Setting the scanner up on Railway (once)

1. A service named `clamav` in the `symbiotic-os` project from the image `clamav/clamav:stable`, with a volume
   at `/var/lib/clamav` (so a restart does not download the signatures again), no public domain, and a memory
   limit of 3 GB (it holds about 1.2 GB, and up to twice that for a moment when the signatures reload).
   `FRESHCLAM_CHECKS=4` on it makes it look for new signatures four times a day.
2. `SOS_SCAN_HOST=clamav.railway.internal` on the `SymbioticOS` service.
3. After the next deploy the boot log says `[scan] the scanner answers at clamav.railway.internal:3310: engine
   ..., signatures ... of ...`, and the Instance tab's card says Answering. The first start takes a few
   minutes while the signatures download.
4. Prove it: add the industry's harmless test file (search "EICAR test file") to a new tool's questions on a
   test company. It must be refused with "the malware scan flagged it", and both phones must buzz.

Cost, from Railway's published rates (10 dollars a GB of memory a month, by use): about 13 dollars a month at
rest, more in the minutes the signatures reload. Not yet read off a bill.

Nothing on the scanner is reachable from outside the project. Inside it, the scanner takes commands from any
service on the private network with no password, which is how ClamAV works; the only other services there are
the product, anetix.ai and the database.

## Setting up a defense supplier

In this order, on the company's card unless it says otherwise:

1. Confirm in writing that the plant will keep CUI and export-controlled data out (the Terms, 7.4), and which
   tools will hold contract information.
2. **What the AI reads:** decide with the plant. Walled off is the conservative setting.
3. **Safeguards:** Talk off. Label previews off. Uploads must be scanned on (the Instance tab must say the
   scanner is Answering first).
4. **Photos:** off on the plant's Settings page unless the plant wants them. A shop floor is where a drawing
   ends up in a frame by accident.
5. **Managers:** add each manager by name (Settings, Managers); each sets up a second factor at first sign-in.
   Then, under Sign-in, take the shared manager password away.
6. **The plant's network:** ask the plant's IT for the address its internet connection shows the world, or
   stand in the plant on its wifi and press "Add the network I am on now". Ask for both kinds of address: a
   plant whose connection has IPv6 reaches the product over it, so a list with only the IPv4 address locks its
   floor out (the button adds whichever kind your own device used; add the other by hand). Before promising
   this, ask whether the address is fixed: with an address that changes, the floor cannot sign in the morning
   after it does, and the list has to be changed by Anetix. A plant with a backup connection has a second
   address. The list is accepted only while the edge check is enforced (the Instance tab): without it the
   address a request claims is not proven.
7. **Outside connections:** leave ERP and Printer off on each tool unless the plant asks, and write down which
   are on.
8. Hand the plant the table below with its name on it.

## Where a company's information can go

Everything the product connects to, and what decides whether a given company's information goes there.

| Where | What goes there | What decides |
|---|---|---|
| Railway (hosting, the database, its backups) | Everything the company keeps here | Always. Anetix's hosting provider |
| Cloudflare (in front of the product) | Every request and answer, in passing | Always. Requests that skip it are refused |
| The AI service (Anthropic's API) | A tool's files and the words people type; rows, uploads, photos and ERP answers too unless the company is walled off. Ask Anetix sends a manager's questions and what it reads to answer them, inside the same wall | What the AI reads, per company; Ask Anetix, per company |
| The upload scanner | Every uploaded file's bytes, for the length of the scan | Always. Inside the private network, not outside |
| The plant's own ERP (read only) | Queries the plant's tools ask of it | Off until Anetix turns it on, per tool |
| A label printer on the plant's device | A label, from the browser to a program on the same device | Off until Anetix turns it on, per tool |
| The public label renderer (Labelary) | A label's contents, to draw its preview | Label previews, per company; only when a printer is on |
| Google or Apple speech recognition | The audio of someone talking into a text box | Talk instead of typing, per company |
| ntfy (alerts to Anetix's phones) | The company's name, a site's name, a price band, what happened. Never a person's words or a file's name | Always |
| Stripe (through anetix.ai) | Who pays and what for | A paying site |
| A connected AI app of Anetix's own (the admin connector) | Operations across companies. Never a row from a company's tool, an upload or a tool's code | Anetix's admins, each connection allowed with a fresh code |
| The company's own public website | Nothing is sent; the platform reads the site once to build the brand guide | When Anetix builds a brand guide |

No email is sent by the product. Nothing a company keeps here is shared with another company or shown on
anetix.ai.

## The fifteen, and who covers what

*A draft for Brendan to read before it goes to a plant. It describes the product with this file's changes
live and the scanner running. "The plant" is the customer. "Inherited" means a provider's own controls, shown by
its audit report; Railway's and Cloudflare's reports are not on file yet (audit item P6).*

| # | The safeguard | Anetix | The plant | Inherited |
|---|---|---|---|---|
| 1 | Limit access to authorized users, processes and devices | Named accounts with a second factor for Anetix's admins and the plant's managers. One floor password per plant, kept as a hash, working only from the plant's network once the list is set. Every session belongs to one company. | Keeps its list of people current, hands the floor password only to its floor, tells Anetix its network address, decides who is on its wifi. | |
| 2 | Limit users to the functions they are allowed | Three roles (floor, manager, Anetix admin). Nothing reaches the floor without a manager's approval. Each company's tools run in a process and a database login of their own. | Decides who is a manager. | |
| 3 | Control connections to outside systems | The table above, and a switch for each connection that is a choice. | Decides with Anetix which are on. Owns the read-only ERP login it gives. | |
| 4 | Control what is posted publicly | Nothing a company keeps here is public or shared with another company. Anetix uses a plant's material outside the product only with the plant's written yes (proposed; Brendan to confirm). | What its people type and photograph. | |
| 5 | Identify users and devices | Admins and managers sign in by name. People on the floor are on a list with a name and a PIN. Each browser carries a device id. Account sign-ins are logged for 400 days. | One name per person; switches a person off when they leave. | |
| 6 | Authenticate before access | Passwords and PINs kept as scrypt hashes. A code from an authenticator app or a passkey for every named account. An account or a PIN locks after five wrong tries, and wrong passwords from one address are limited. | Keeps passwords and PINs to the people they belong to. | |
| 7 | Sanitize or destroy media before disposal or reuse | Deletes a company's data from the live service within 30 days of the ask, and from backups as they expire (the Terms, 10.7). Backup files Anetix downloads stay on encrypted laptops and are deleted after use (company procedure, to be written). | Its own devices and printed labels. | Railway: the disks under the database and its backups |
| 8 | Limit physical access | Anetix's laptops: encrypted, locked when unattended (company procedure). | The devices on its floor. | Railway and Cloudflare: their data centers |
| 9 | Escort visitors, log physical access, control keys | As 8. | Its own building. | Railway and Cloudflare |
| 10 | Monitor and protect the network boundary | Cloudflare in front; a request that did not come through it is refused; everything over TLS. | Its own network and wifi. | Cloudflare, Railway |
| 11 | Separate public components from internal ones | The public site (anetix.ai) is a service of its own and holds no company's data. The database has no public address. | | Railway's private network |
| 12 | Find, report and fix flaws in a timely way | Dependency alerts on both code repositories, a monthly update check, a stated time to fix, a written log (`docs/UPDATES.md`). | Keeps its browsers and devices updated. | Railway, Cloudflare: their platforms |
| 13 | Protect against malicious code | Every uploaded file is scanned before it is kept. Tool code is built only through the manager's gate, runs in its own process and reaches nothing but what the platform lends it. | Malware protection on its own devices. | |
| 14 | Keep that protection updated | The scanner updates its own signatures several times a day; Anetix is alerted when they are more than three days old or the scanner stops answering. | Same, on its devices. | |
| 15 | Scan periodically, and scan files as they arrive | At the door for every file; every stored file again each week under that day's signatures; a file flagged later is removed and reported. | Same, on its devices. | |

## What these do not do

- The network list is not a second factor. A guest on the plant's wifi shares its address, and the address is
  only as good as the plant's own network. What it does is keep the floor's password from working anywhere else.
- The floor still shares one password per plant, and a floor device can file a request with no name. The
  record names a person only when one tapped their name and PIN. A plant that needs a name on everything needs
  "a name before anything" on the floor's devices, which is not built.
- The microphone header is read by Chrome and Edge; Safari may not read it. The page asking the platform before
  it listens is what holds in every browser, and that is the platform's own script. A tool's own page code that
  asked the browser for the microphone itself would be refused by Chrome and Edge under the header, and would
  meet Safari's own permission prompt.
- A wrong try from outside the plant's network counts against that address like a wrong password: ten of them
  hold every sign-in from that address, a named account's included, for fifteen minutes.
- A tool's own table can hold a file (a column of bytes) that came in through the tool's own screen rather than
  through the platform's upload paths. No tool built so far does; one that did would keep it unscanned and outside
  the look-behind. The scan covers what the platform itself takes in.
- The scanner finds what its signatures know. It is one safeguard among several, not a promise that a file is
  safe. A scanner false alarm on a stored file removes that file; the manager sends it again.
- None of this is a certification. Level 1 is the plant's own self-assessment; this is what the plant can say
  about the product in it.
