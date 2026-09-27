// The Anetix Terms of Service (Brendan's own, 2026-09-26; docs/PAID-SITES.md). Every order form, demo set-up and credit
// purchase is accepted under a version of these, and the version and a hash of this document are kept with each
// acceptance (src/agreements.js; the orders in src/golive.js).
//
// DRAFT FOR COUNSEL, not in effect yet. The words in brackets are counsel's to fill in. The short version, sections 1
// to 21 and the contact line are what anetix.ai shows at /terms; the screen text and the notes for counsel from
// Brendan's document are not part of them (the screen text's lines are the WORDS below).
//
// draft-2, not draft-1: stage 2 shipped draft-1 as a cover page on Common Paper's Cloud Service Agreement. Nobody signed
// under it, but a version always means one text, so Brendan's own terms start a new one.
//
// A word changed here once anyone has accepted this version needs a new TERMS_VERSION: an acceptance names the
// version, and its terms_sha256 is the hash of these exact words (platform.terms_versions keeps them at the first).
const crypto = require("crypto");

const TERMS_VERSION = "draft-2";
const DRAFT = /^draft/.test(TERMS_VERSION);
const TITLE = "Anetix Terms of Service";
const STATUS = "A draft for counsel, not in effect yet. The words in brackets are counsel's to fill in.";

// The short version: a plain summary, not part of the Terms (it says so), shown above them.
const SUMMARY = {
  "heading": "The short version",
  "note": "A plain summary, not part of the Terms. The Terms below control.",
  "items": [
    [
      "Customer makes the calls.",
      "Anetix helps Customer's people see and improve their operation. Customer decides which orders to accept, which dates to promise, and what to build, buy, inspect and ship."
    ],
    [
      "Outputs are estimates.",
      "Schedules, projections, quantities and anything the AI produces can be wrong. Check what matters before committing to it."
    ],
    [
      "Changes Customer asks for go live only when Customer approves them",
      ", after checking them in the preview."
    ],
    [
      "Liability is limited.",
      "Anetix is not liable for lost profits, lost orders, missed deliveries, downtime, or penalties owed to Customer's customers. As far as the law allows, its total liability is capped at what Customer paid for the affected Site in the 12 months before the event that led to the claim."
    ],
    [
      "Customer owns its data.",
      "Anetix learns from a Site's data for other customers only if Customer opts in, and never shows it to another customer."
    ],
    [
      "No controlled or sensitive data.",
      "Keep CUI, ITAR or export-controlled technical data, classified information, health records, card or bank numbers, ID numbers and biometrics out of Anetix (section 7.4)."
    ],
    [
      "Month to month.",
      "Cancel any time, effective at the end of the paid month."
    ]
  ]
};

// Sections 1 to 21. A section has numbered clauses ({ n, title, text, list, after }), or definitions (defs, with an
// intro), or plain paragraphs (text).
const SECTIONS = [
  {
    "n": "1",
    "heading": "The agreement",
    "clauses": [
      {
        "n": "1.1",
        "title": "Parties",
        "text": "These Terms of Service (the “Terms”) are an agreement between Anetix, Inc., a Delaware corporation (“Anetix”), and the business that accepts them (“Customer”)."
      },
      {
        "n": "1.2",
        "title": "Acceptance",
        "text": "Customer accepts these Terms when a person acting for it (a) signs an Order Form that refers to them, (b) ticks a box or clicks a button stating that they agree to them, including when setting up a Demo or buying Credit, or (c) signs a master agreement that incorporates them. Each acceptance applies the version of these Terms named or linked at that moment."
      },
      {
        "n": "1.3",
        "title": "Authority",
        "text": "The person who accepts represents that they are authorized to bind Customer. A person who sets up a Demo accepts for the company they name, and if they cannot bind it, they accept these Terms themselves."
      },
      {
        "n": "1.4",
        "title": "Business use only",
        "text": "The Service is offered only to businesses, for use in their operations. Customer accepts these Terms in the course of its business and not as a consumer."
      },
      {
        "n": "1.5",
        "title": "Order of precedence",
        "text": "If documents conflict, this order controls: (a) a document signed by both parties that expressly changes these Terms, such as a master agreement; (b) the Order Form, for its Site's fee, billing, term and add-ons (an Order Form changes any other section of these Terms only where it names that section); (c) these Terms; (d) the Documentation. Terms in a purchase order, supplier portal or other Customer paperwork do not apply, even if Anetix signs or accepts that paperwork."
      }
    ]
  },
  {
    "n": "2",
    "heading": "Definitions",
    "intro": "Other terms are defined where they first appear.",
    "defs": [
      [
        "“Affiliate”",
        "an entity that controls, is controlled by, or is under common control with a party."
      ],
      [
        "“AI Features”",
        "the parts of the Service that use artificial intelligence models, including those that propose, write, review, test or change Tools, answer questions, summarize information, or generate sample data."
      ],
      [
        "“Credit”",
        "a prepaid balance that pays for AI Features in a Demo."
      ],
      [
        "“Customer Data”",
        "data and content that Customer or its Users submit to the Service, or that the Service collects from Customer's systems through an integration Customer sets up, including the words Users type, photos, files and records kept in Tools. It excludes Usage Data and Feedback."
      ],
      [
        "“Demo”",
        "an account for evaluating the Service, including a Site's account after its Subscription ends and it returns to a demo."
      ],
      [
        "“Documentation”",
        "the descriptions and instructions for the Service that Anetix makes available, as updated from time to time."
      ],
      [
        "“Fees”",
        "the amounts payable under an Order Form, for Credit, or for integrations and hardware."
      ],
      [
        "“Order Form”",
        "an Anetix site order form, or another ordering document accepted by both parties, that names a Site and its Fees."
      ],
      [
        "“Output”",
        "anything the AI Features produce for Customer, including proposals, code, Tools and changes to Tools, answers, summaries, schedules, calculations and sample data."
      ],
      [
        "“Service”",
        "Anetix's hosted software, including the AI Features, the Tools, the Documentation and the integrations Anetix provides. It excludes Third-Party Services and hardware."
      ],
      [
        "“Site”",
        "one address, or one contiguous campus under one plant manager, named in an Order Form."
      ],
      [
        "“Subscription”",
        "Customer's paid right to use the Service at a Site under an Order Form."
      ],
      [
        "“Third-Party Services”",
        "products and services Anetix does not provide, including Customer's ERP and other systems Customer connects to the Service."
      ],
      [
        "“Tools”",
        "the boards, modules, screens, forms, reports and other functionality that run in the Service for Customer, including those the AI Features build or change at Customer's request."
      ],
      [
        "“Usage Data”",
        "information about how the Service performs and is used, such as response times, errors, the cost of AI Features, and counts of requests and approvals. It does not include the content of Customer Data."
      ],
      [
        "“User”",
        "a person Customer allows to use the Service under its account, including employees, contractors and anyone using a shared floor login."
      ]
    ]
  },
  {
    "n": "3",
    "heading": "The Service",
    "clauses": [
      {
        "n": "3.1",
        "title": "Access",
        "text": "Subject to these Terms and payment of the Fees, Anetix grants Customer a non-exclusive, non-transferable right, during a Subscription or while a Demo is open, to let its Users use the Service at the Site for Customer's internal business purposes."
      },
      {
        "n": "3.2",
        "title": "Users, Sites and Affiliates",
        "text": "A Site may have any number of Users. Customer may copy its Tools between its own Sites at no charge. An Affiliate of Customer that signs its own Order Form becomes the Customer for that Site under these Terms. Customer is responsible for its Users' compliance with these Terms."
      },
      {
        "n": "3.3",
        "title": "Support and availability",
        "text": "Anetix provides support through the Service and by email. There is no response-time commitment, uptime commitment or service credit unless an Order Form includes a service level."
      },
      {
        "n": "3.4",
        "title": "Changes to the Service",
        "text": "Anetix changes the Service often, including its features, AI models and screens, and may add, change or remove features at any time, subject to section 13.2."
      },
      {
        "n": "3.5",
        "title": "No reliance",
        "text": "In accepting these Terms and any Order Form, Customer has not relied on any statement, estimate, promise or representation that is not written in them, including anything said or shown in a sales call, email, demo, presentation or roadmap. Customer's purchase is not contingent on any future feature, integration or date unless an Order Form says so."
      },
      {
        "n": "3.6",
        "title": "Who provides the Service",
        "text": "Anetix may use employees, contractors and service providers, such as hosting, payment and AI model providers, to provide the Service, and is responsible for their compliance with these Terms. Anetix will give Customer a current list of the service providers that process Customer Data on request."
      }
    ]
  },
  {
    "n": "4",
    "heading": "Demos and credit",
    "clauses": [
      {
        "n": "4.1",
        "title": "Demos",
        "text": "Anetix offers Demos at its discretion, by access pin or otherwise. A Demo is for evaluating the Service and has one manager account unless Anetix allows more. Anetix may limit, suspend or end a Demo at any time."
      },
      {
        "n": "4.2",
        "title": "Credit",
        "text": "AI Features in a Demo draw on Credit. Anetix may grant Credit free, and Customer may buy more at the price shown when it buys. Credit can be used only for AI Features in that Demo. It is not money or a deposit, earns no interest, cannot be transferred, and is not refundable, with two exceptions: when a Demo becomes a Subscription, the unused part of the Credit Customer bought comes off Customer's first bill at the price Customer paid for it; and if Anetix ends a Demo for a reason other than Customer's breach, Anetix refunds the unused part of the Credit Customer bought. When Credit runs out, new AI work stops until more is added. Work already running finishes, and Anetix does not charge for its cost past zero."
      },
      {
        "n": "4.3",
        "title": "Demos are as is",
        "text": "Demos, free Credit, sample data, and any feature Anetix labels beta, preview or experimental are provided as is, with no warranty, support commitment or service level. Section 14.2 caps Anetix's liability for them."
      },
      {
        "n": "4.4",
        "title": "What Anetix learns from Demos",
        "text": "Anetix may review everything in a Demo, including what was requested, what was built and what was said in feedback, and may use it to improve the Service for all customers. Anetix will not show a Demo's Customer Data to another customer, or publish it, without Customer's approval. Customer should not put anything into a Demo that it would not share with Anetix on these terms. This section does not reach Customer Data entered while the account was a subscribed Site, which stays under section 10.2 after the Site returns to a Demo."
      },
      {
        "n": "4.5",
        "title": "When a Demo becomes a Site",
        "text": "When a Demo becomes a Subscription, its Tools and Customer Data carry over, and section 10 applies to them from then on."
      }
    ]
  },
  {
    "n": "5",
    "heading": "Sites, fees and payment",
    "clauses": [
      {
        "n": "5.1",
        "title": "Price by Site",
        "text": "Each Site has its own Order Form and Subscription. Its monthly Fee is set by its band in Anetix's price book, based on the size Customer states. There is no charge per User or per use."
      },
      {
        "n": "5.2",
        "title": "Stated size",
        "text": "Customer states each Site's headcount across all shifts and its floor space, and Anetix relies on that statement. Customer will confirm the size once a year when asked. If the confirmed size falls in a higher band, the higher band applies from the next billing month. A Site's band does not move down during its Subscription."
      },
      {
        "n": "5.3",
        "title": "Billing",
        "text": "Unless the Order Form provides for invoicing, Fees are billed monthly in advance to the payment method on file, starting on the day Anetix switches the Site on. Customer authorizes Anetix and its payment processor to charge that payment method for Fees when due. Invoiced Fees are due 30 days after the invoice date."
      },
      {
        "n": "5.4",
        "title": "Switching a Site on",
        "text": "Anetix aims to switch a Site on within 24 hours after its Order Form is signed, and charges nothing before then. Until the Site is on, Customer may withdraw the order at no charge, and that is Customer's only remedy for a delay in switching it on."
      },
      {
        "n": "5.5",
        "title": "Price lock",
        "text": "Anetix will not raise a Site's monthly Fee while its Subscription continues, except for a band change under section 5.2. New prices in Anetix's price book apply only to Subscriptions that start after they are published, including a Site that subscribes again after its Subscription ended."
      },
      {
        "n": "5.6",
        "title": "Fair use",
        "text": "Users, Tools, requests and changes are unlimited at a Site, with one backstop: if Anetix's own cost of AI Features for a Site in a billing month passes 80% of that month's Fee, Anetix may pause new AI work for that Site until the next billing month. A fair-use pause does not stop the Site's Tools."
      },
      {
        "n": "5.7",
        "title": "Taxes",
        "text": "Fees exclude taxes. Customer pays all sales, use, value added and similar taxes on the Fees, other than taxes on Anetix's income. A Customer claiming an exemption must give Anetix a valid certificate."
      },
      {
        "n": "5.8",
        "title": "Late payment",
        "text": "If a charge fails, Anetix may retry it. If Fees are still unpaid 14 days after they were due, Anetix may pause new AI work for the Site until they are paid. If they are still unpaid 30 days after they were due, Anetix may end the Subscription on notice. Overdue invoiced amounts bear interest at 1% a month or the highest rate the law allows, whichever is lower."
      },
      {
        "n": "5.9",
        "title": "No refunds",
        "text": "Fees are non-refundable, and partial months are not refunded, except as sections 4.2, 6.4, 13.2 and 17.2 provide."
      },
      {
        "n": "5.10",
        "title": "Charge disputes",
        "text": "Customer will raise any dispute about a charge with Anetix in writing within 60 days of the charge, and before starting a chargeback."
      }
    ]
  },
  {
    "n": "6",
    "heading": "Term, cancellation and termination",
    "clauses": [
      {
        "n": "6.1",
        "title": "Term",
        "text": "These Terms apply from acceptance until every Subscription and Demo under them has ended. Each Subscription runs month to month unless its Order Form sets another term."
      },
      {
        "n": "6.2",
        "title": "Cancelling",
        "text": "Customer may cancel a Subscription at any time, in the Service's billing settings or by notice to Anetix. Cancellation takes effect at the end of the month already paid. If the current month has not been paid, it takes effect immediately and the unpaid charge is cancelled."
      },
      {
        "n": "6.3",
        "title": "After a Subscription ends",
        "text": "Unless Customer asks for deletion, the Site becomes a Demo for Customer's manager: its Tools and Customer Data stay, floor access closes, and AI Features run on Credit. Anetix keeps the Customer Data until Customer asks for its deletion, or until 12 months pass with no sign-in to the account, whichever comes first, and may then delete it under section 10.7. Customer may ask for an export under section 10.6 at any time before then."
      },
      {
        "n": "6.4",
        "title": "Ending a Subscription",
        "text": "Anetix may end a Subscription (a) for any reason, on 30 days' notice, refunding any Fees prepaid for the period after the end date, but never as a way to change a Site's price; (b) for non-payment, under section 5.8; or (c) on notice, if Customer materially breaches these Terms and does not cure the breach within 30 days after notice, or at once for a breach of section 7.4 or 7.5 that cannot be cured. Customer may end a Subscription on notice if Anetix materially breaches these Terms and does not cure the breach within 30 days after notice, and Anetix will then refund the Fees prepaid for the period after the end date."
      },
      {
        "n": "6.5",
        "title": "Insolvency",
        "text": "Either party may end these Terms on notice if the other becomes insolvent, makes a general assignment for the benefit of creditors, or becomes subject to a bankruptcy or similar proceeding that is not dismissed within 60 days."
      }
    ]
  },
  {
    "n": "7",
    "heading": "Customer responsibilities",
    "clauses": [
      {
        "n": "7.1",
        "title": "Accounts",
        "text": "Customer is responsible for all activity under its accounts, including through a shared floor login, and for keeping its passwords, passkeys, authenticator devices and access links secure. Customer will tell Anetix promptly about any unauthorized access it discovers."
      },
      {
        "n": "7.2",
        "title": "Accurate inputs",
        "text": "The Service works from what Customer's Users enter and from Customer's connected systems. Customer is responsible for the accuracy, completeness and legality of Customer Data, and for the settings, permissions and data in its own systems. Anetix is not responsible for results that follow from inaccurate, incomplete or outdated inputs."
      },
      {
        "n": "7.3",
        "title": "Notice to Users",
        "text": "The Service records what Users submit, including the words they type, their photos, and who requested and approved each change, and shows it to Customer's managers and to Anetix. Customer is responsible for giving its Users any notice, and getting any consent, that the law requires for that, including under workplace monitoring and privacy laws, and for deciding whether to turn on features such as photos."
      },
      {
        "n": "7.4",
        "title": "Restricted Data",
        "text": "Unless an Order Form expressly allows it and states the safeguards, Customer will not submit any of the following to the Service (“Restricted Data”):",
        "list": [
          "Controlled Unclassified Information, including covered defense information;",
          "technical data controlled under the International Traffic in Arms Regulations, or technology listed on the Commerce Control List of the Export Administration Regulations;",
          "classified information or naval nuclear propulsion information;",
          "protected health information, payment card numbers, bank account numbers, government identification numbers or biometric identifiers; or",
          "any other data whose storage or processing requires a certification or authorization the Service does not hold, such as a FedRAMP authorization or CMMC Level 2."
        ],
        "after": "Customer is responsible for identifying its Restricted Data, for keeping it out of typed requests, photos, files and integrations, and for the consequences of submitting it. Anetix has no duty to detect Restricted Data and may delete any it finds."
      },
      {
        "n": "7.5",
        "title": "Acceptable use",
        "text": "Customer will not, and will not let anyone:",
        "list": [
          "sell, resell, sublicense or provide the Service to anyone other than its Users, or use it to provide services to third parties;",
          "copy, reverse engineer, decompile, or try to extract the source code, models, prompts or other non-public parts of the Service, except to the extent the law allows despite this restriction;",
          "use the Service or any Output to build or train a competing product, or benchmark the Service for a competitor;",
          "probe, scan or test the security of the Service, or get around its access controls, Credit, rate limits or fair-use line;",
          "access another customer's account or data;",
          "upload malicious code, or use the Service in a way that could harm it or other customers;",
          "use the Service to break the law or to infringe or misappropriate anyone's rights; or",
          "use the Service for High-Risk Use (section 7.6)."
        ]
      },
      {
        "n": "7.6",
        "title": "Not a safety system",
        "text": "“High-Risk Use” means using the Service to control machines or processes directly; as a safety function, interlock, lockout and tagout device or emergency system; or anywhere a failure or error could reasonably lead to death, bodily injury, or serious physical or environmental damage. The Service is not designed or permitted for High-Risk Use. Customer may use Tools to record and display safety information, such as checklists or incident reports, but Customer remains solely responsible for the safety of its workplace, equipment and people, and for complying with workplace safety laws."
      },
      {
        "n": "7.7",
        "title": "Export and sanctions",
        "text": "Customer will not use or allow access to the Service in violation of US export control or sanctions laws, including from an embargoed country or by a sanctioned person."
      }
    ]
  },
  {
    "n": "8",
    "heading": "Customer's operations and decisions",
    "clauses": [
      {
        "n": "8.1",
        "title": "Decision support",
        "text": "The Service helps Customer see and improve its operation. It does not run Customer's business. Every schedule, projection, estimate, quantity, due date, capacity figure, recommendation and other Output is a starting point for Customer's own judgment, and it may be wrong or incomplete."
      },
      {
        "n": "8.2",
        "title": "Customer's commitments are Customer's",
        "text": "Customer alone decides, and is responsible for, whether to accept an order; what price, quantity and delivery date to quote or promise; how much capacity, labor, material and equipment to commit; what to buy, make, inspect, release and ship; and how to staff and run its operation. Customer will not treat any Output, or any expectation that the Service, a Tool or an integration will be ready or working by a date, as the basis for a commitment to its customers or anyone else without confirming it independently."
      },
      {
        "n": "8.3",
        "title": "A way to run without it",
        "text": "The Service may at times be unavailable, slow or wrong, including because of problems with the internet, hosting, AI model providers or integrations. Customer will keep procedures that let it run its operation, meet its commitments and keep the records it needs when the Service is unavailable or in error."
      },
      {
        "n": "8.4",
        "title": "Customer's products and customers",
        "text": "Customer is solely responsible for its products and services, including their quality, safety and conformity; for its contracts, quotes and warranties with its own customers and suppliers; and for any delay, penalty, chargeback, recall or claim arising from them. Anetix owes no duty to Customer's customers, suppliers, employees or other third parties."
      },
      {
        "n": "8.5",
        "title": "Records",
        "text": "Customer is responsible for keeping any record that the law, a certification or its customers require, and for deciding whether records kept in the Service meet those requirements."
      }
    ]
  },
  {
    "n": "9",
    "heading": "AI Features and the Tools",
    "clauses": [
      {
        "n": "9.1",
        "title": "How changes happen",
        "text": "Users file requests and feedback, and the AI Features propose, build and test changes to Tools. A change to a Tool goes live only when a User with approval rights at Customer approves it. Anetix may also change the Service without Customer's approval where needed to fix, secure or maintain it. It changes a live Tool that way only to fix a security problem or an error that stops the Tool working, and tells Customer's manager when it does."
      },
      {
        "n": "9.2",
        "title": "Review before relying",
        "text": "Before approving a change, Customer is responsible for reviewing it with the preview and test features the Service provides. Before relying on a Tool in production, Customer is responsible for checking that it works correctly for its purpose. Customer can roll a Tool back to an earlier version in the Service. Approval by any User with approval rights is Customer's approval."
      },
      {
        "n": "9.3",
        "title": "Output can be wrong",
        "text": "AI models can produce Output that is inaccurate, incomplete, inconsistent or unsuitable, and can repeat an error. Output for Customer may resemble output produced for others. Anetix does not guarantee any Output, and Customer relies on Output at its own risk, subject to section 14."
      },
      {
        "n": "9.4",
        "title": "The data wall",
        "text": "Customer may ask Anetix to keep the AI Features from reading Customer Data while they build. They then build from the data's structure, such as its fields, without seeing the data itself. Whatever a User types into a request, intake or feedback is always sent to the AI Features."
      },
      {
        "n": "9.5",
        "title": "AI providers",
        "text": "Anetix sends the content each AI task needs to third-party AI model providers, under terms that do not allow them to train their models on it. Anetix chooses, and may change, the models and providers it uses."
      },
      {
        "n": "9.6",
        "title": "Sample data",
        "text": "Sample or simulated data the Service generates is fictional and for demonstration only."
      }
    ]
  },
  {
    "n": "10",
    "heading": "Data, learning and security",
    "clauses": [
      {
        "n": "10.1",
        "title": "Customer owns Customer Data",
        "text": "As between the parties, Customer owns Customer Data. Customer grants Anetix a non-exclusive, worldwide, royalty-free license to host, copy, process, transmit and display Customer Data as needed to provide, support, secure and maintain the Service for Customer, to prevent abuse, and to comply with law."
      },
      {
        "n": "10.2",
        "title": "Learning is Customer's choice",
        "text": "For a Site, Anetix uses Customer Data to improve the Service for other customers only if Customer opts in, on the Order Form or later in the Service's settings. Customer may opt out at any time for data going forward. Opting in lets Anetix learn from how the Site uses the Service, such as which kinds of Tools and changes work, and apply what it learns for all customers. Opting in also lets Anetix offer adaptations of Customer's Tools to other customers under section 12.2, never with Customer Data in them. Either way, Anetix never shows Customer Data to another customer."
      },
      {
        "n": "10.3",
        "title": "Usage Data",
        "text": "Anetix may collect and use Usage Data to run, support, secure, bill for and improve the Service, and may use and publish aggregated statistics that do not identify Customer or any person."
      },
      {
        "n": "10.4",
        "title": "Anetix access",
        "text": "Anetix personnel may access Customer's account and Customer Data to provide support, fix problems, maintain and secure the Service, and as Customer asks. They are bound by confidentiality obligations."
      },
      {
        "n": "10.5",
        "title": "Security",
        "text": "Anetix will maintain reasonable administrative, technical and physical safeguards designed to protect Customer Data. No system is perfectly secure. If Anetix confirms unauthorized access to Customer Data in its systems, it will notify Customer without undue delay and share what it reasonably can about what happened and what it is doing about it."
      },
      {
        "n": "10.6",
        "title": "Backups and export",
        "text": "Anetix backs up the Service in the ordinary course but does not guarantee that a backup will be complete or restorable. Customer may ask for an export of its Customer Data in a standard machine-readable format at any time while Anetix holds it."
      },
      {
        "n": "10.7",
        "title": "Deletion",
        "text": "When Customer asks Anetix to delete its Customer Data, or when the period in section 6.3 ends, Anetix will delete it from the live Service within 30 days, and from backups as they expire in the ordinary course. Anetix may keep Order Forms, billing records and records of acceptance as the law or its legitimate business needs require."
      },
      {
        "n": "10.8",
        "title": "Personal information",
        "text": "Where Customer Data includes personal information, Anetix processes it on Customer's behalf to provide the Service. Anetix's privacy notice at [PRIVACY NOTICE URL] describes how Anetix handles personal information of Users and site visitors. If a law requires specific terms for that processing, the parties will agree them in a separate addendum."
      }
    ]
  },
  {
    "n": "11",
    "heading": "Confidentiality",
    "clauses": [
      {
        "n": "11.1",
        "title": "Definition",
        "text": "“Confidential Information” means non-public information that one party (the discloser) gives the other (the recipient) in connection with these Terms that is marked confidential or that a reasonable person would understand to be confidential. Customer's Confidential Information includes Customer Data. Anetix's Confidential Information includes the non-public parts of the Service and its plans."
      },
      {
        "n": "11.2",
        "title": "Use and protection",
        "text": "The recipient will use the discloser's Confidential Information only to perform its obligations and exercise its rights under these Terms, will protect it with at least reasonable care, and will share it only with its employees, contractors, advisers and service providers who need it for that purpose and are bound by confidentiality obligations at least as protective as these."
      },
      {
        "n": "11.3",
        "title": "Exclusions",
        "text": "Confidential Information does not include information that is or becomes public through no fault of the recipient, that the recipient knew without restriction before receiving it, that the recipient receives from a third party without a duty of confidentiality, or that the recipient develops independently."
      },
      {
        "n": "11.4",
        "title": "Required disclosure",
        "text": "The recipient may disclose Confidential Information when the law or a court requires it, after giving the discloser prompt notice where the law allows and reasonable help, at the discloser's cost, in seeking protection for it."
      },
      {
        "n": "11.5",
        "title": "Return",
        "text": "When these Terms end, each party will return or destroy the other's Confidential Information on request, subject to sections 6.3 and 10.7. Copies kept in backups or under a legal duty stay protected by this section."
      }
    ]
  },
  {
    "n": "12",
    "heading": "Ownership and feedback",
    "clauses": [
      {
        "n": "12.1",
        "title": "Anetix's property",
        "text": "Anetix and its licensors own the Service, including its software, AI Features, prompts and templates, the code of the Tools, and all improvements to them, whether made by Anetix, by the AI Features or at Customer's request, together with all intellectual property rights in them. Customer Data is not part of the Service and stays Customer's. No rights are granted except those these Terms state expressly."
      },
      {
        "n": "12.2",
        "title": "Customer's Tools",
        "text": "Customer may use its Tools as part of the Service while it has a Subscription or Demo. Anetix will not provide a Tool built for Customer, or a copy or adaptation of it, to another customer unless Customer has opted in under section 10.2, and never with Customer Data or Customer's Confidential Information in it."
      },
      {
        "n": "12.3",
        "title": "Feedback",
        "text": "Anetix may use suggestions and ideas about its own product that Customer or its Users give it (“Feedback”) without restriction or obligation. Requests for changes to Customer's own Tools are Customer Data, not Feedback."
      }
    ]
  },
  {
    "n": "13",
    "heading": "Warranties and disclaimers",
    "clauses": [
      {
        "n": "13.1",
        "title": "Both parties",
        "text": "Each party represents that it is validly existing and has the power to enter into these Terms."
      },
      {
        "n": "13.2",
        "title": "Anetix's limited warranty",
        "text": "Anetix warrants that it will not materially reduce the general functionality of the Service for a subscribed Site during a month Customer has paid for. If it does, Customer must tell Anetix within 30 days. If Anetix does not restore the functionality within 30 days after that notice, Customer may end the affected Subscription at once and receive a refund of the Fees prepaid for the rest of that month. That is Customer's only remedy for a breach of this warranty. This warranty does not cover Demos, free Credit, sample data or beta features."
      },
      {
        "n": "13.3",
        "title": "DISCLAIMER",
        "text": "EXCEPT FOR THE WARRANTIES IN SECTIONS 13.1 AND 13.2, THE SERVICE, THE TOOLS, ALL OUTPUT, DEMOS, CREDIT, INTEGRATIONS AND ANY HARDWARE ARE PROVIDED “AS IS” AND “AS AVAILABLE,” AND ANETIX DISCLAIMS ALL OTHER WARRANTIES AND CONDITIONS, WHETHER EXPRESS, IMPLIED OR STATUTORY, INCLUDING ANY WARRANTY OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, NON-INFRINGEMENT OR ACCURACY, AND ANY WARRANTY ARISING FROM A COURSE OF DEALING OR USAGE OF TRADE. ANETIX DOES NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, TIMELY, SECURE OR ERROR-FREE; THAT ANY OUTPUT, SCHEDULE, ESTIMATE OR CALCULATION WILL BE ACCURATE OR COMPLETE; THAT ANY TOOL OR INTEGRATION WILL BE READY BY ANY DATE; OR THAT USING THE SERVICE WILL ACHIEVE ANY PRODUCTION, DELIVERY, QUALITY, COST OR OTHER RESULT. NO ADVICE OR INFORMATION FROM ANETIX OR THE SERVICE CREATES A WARRANTY THAT THESE TERMS DO NOT STATE."
      }
    ]
  },
  {
    "n": "14",
    "heading": "Limitation of liability",
    "clauses": [
      {
        "n": "14.1",
        "title": "EXCLUDED DAMAGES",
        "text": "TO THE FULLEST EXTENT THE LAW ALLOWS, NEITHER PARTY WILL BE LIABLE TO THE OTHER, HOWEVER CAUSED AND WHETHER THE LOSS IS DIRECT OR INDIRECT, FOR ANY OF THE FOLLOWING:",
        "list": [
          "LOST PROFITS, REVENUE, SALES, ORDERS, CONTRACTS, CUSTOMERS, GOODWILL OR ANTICIPATED SAVINGS;",
          "LOST PRODUCTION, DOWNTIME, DELAY, OR IDLE LABOR OR EQUIPMENT;",
          "THE COST OF OVERTIME, EXPEDITING, REWORK, SCRAP, RECALLS, OR SUBSTITUTE GOODS, SERVICES OR SOFTWARE;",
          "PENALTIES, LIQUIDATED DAMAGES, CHARGEBACKS OR OTHER AMOUNTS OWED TO THIRD PARTIES, INCLUDING CUSTOMER'S CUSTOMERS;",
          "LOSS OR CORRUPTION OF DATA (ANETIX'S ONLY OBLIGATION FOR LOST OR CORRUPTED CUSTOMER DATA IS TO USE REASONABLE EFFORTS TO RESTORE IT FROM ITS MOST RECENT AVAILABLE BACKUP); OR",
          "ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY OR PUNITIVE DAMAGES."
        ],
        "after": "THIS APPLIES EVEN IF THE PARTY WAS TOLD THOSE DAMAGES WERE POSSIBLE, AND EVEN IF THEY WERE FORESEEABLE."
      },
      {
        "n": "14.2",
        "title": "LIABILITY CAP",
        "text": "TO THE FULLEST EXTENT THE LAW ALLOWS, EACH PARTY'S TOTAL LIABILITY FOR ALL CLAIMS ARISING OUT OF OR RELATING TO THESE TERMS OR THE SERVICE, TAKEN TOGETHER, WILL NOT EXCEED THE FEES CUSTOMER PAID ANETIX FOR THE SITE OR SITES THE CLAIMS RELATE TO IN THE 12 MONTHS BEFORE THE EVENT THAT GAVE RISE TO THE FIRST CLAIM. FOR A DEMO, OR FOR CLAIMS NOT TIED TO A SITE, THE CAP IS THE GREATER OF $100 OR WHAT CUSTOMER PAID FOR CREDIT IN THOSE 12 MONTHS."
      },
      {
        "n": "14.3",
        "title": "Exceptions",
        "text": "Sections 14.1 and 14.2 do not limit (a) Customer's obligation to pay Fees; (b) Customer's obligations under section 15; (c) Customer's liability for breaching section 7.4 or 7.5, or for infringing or misappropriating Anetix's intellectual property; or (d) liability that the law does not allow to be limited, including liability for a party's intentional fraud."
      },
      {
        "n": "14.4",
        "title": "How these limits apply",
        "text": "The exclusions and the cap apply to every claim and every theory, whether in contract, tort (including negligence), strict liability, warranty, statute or otherwise. They apply even if a limited remedy in these Terms fails of its essential purpose. Refunds and credits Anetix gives count toward the cap, and more than one claim does not raise it."
      },
      {
        "n": "14.5",
        "title": "Basis of the bargain",
        "text": "The parties agree that sections 13 and 14 allocate risk between them, that the Fees reflect that allocation, and that Anetix would not provide the Service on these Terms without them."
      },
      {
        "n": "14.6",
        "title": "One year to bring a claim",
        "text": "To the extent the law allows, a claim arising out of or relating to these Terms or the Service must be brought within one year after the claiming party knew or should have known of it, or it is waived. This does not apply to claims for unpaid Fees or under section 15."
      }
    ]
  },
  {
    "n": "15",
    "heading": "Indemnification",
    "clauses": [
      {
        "n": "15.1",
        "title": "Customer's defense of Anetix",
        "text": "Customer will defend Anetix, its Affiliates, and their directors, officers, employees and contractors against any third-party claim, suit or proceeding, including one brought by Customer's customers, suppliers, employees or Users or by a government authority, to the extent it arises out of or relates to:",
        "list": [
          "Customer Data, including a claim that it infringes or misappropriates anyone's rights, or was collected or used without a notice or consent the law requires;",
          "Customer's products, services, facilities or operations, or its commitments, contracts and dealings with its own customers, suppliers and employees, including a claim that a delay, defect, shortfall, injury or loss was caused by Customer's use of or reliance on the Service or any Output;",
          "Customer's breach of section 7; or",
          "use of the Service under Customer's accounts in breach of these Terms or the law."
        ],
        "after": "Customer will pay the damages and costs finally awarded, and any settlement Customer agrees to, including reasonable attorneys' fees. Item 2 applies even if the claim alleges that Anetix, the Service or any Output was negligent, defective or late. This section does not apply to the extent a claim results from Anetix's breach of section 10.5 or 11, or from Anetix's fraud or willful misconduct."
      },
      {
        "n": "15.2",
        "title": "Procedure",
        "text": "Anetix will give Customer prompt written notice of the claim (a delay excuses Customer only to the extent it hurts the defense), let Customer control the defense and settlement, and give reasonable help at Customer's cost. Customer may not settle a claim in a way that admits fault by Anetix or imposes an obligation on it without Anetix's written consent. Anetix may take part with its own counsel at its own cost."
      }
    ]
  },
  {
    "n": "16",
    "heading": "Suspension",
    "text": [
      "Anetix may suspend all or part of the Service for Customer, including by pausing AI Features, if (a) Fees are overdue as described in section 5.8; (b) Customer or its Users breach section 7; (c) Customer's use threatens the security, integrity or availability of the Service or of other customers; or (d) the law, a court or a government authority requires it. Anetix will limit a suspension to what is reasonably needed, give notice when practical, and restore access once the cause is resolved. Fees continue during a suspension Customer caused."
    ]
  },
  {
    "n": "17",
    "heading": "Integrations, third-party services and hardware",
    "clauses": [
      {
        "n": "17.1",
        "title": "Third-Party Services",
        "text": "Customer is responsible for its licenses, accounts, credentials and permissions for any Third-Party Service it connects, and for complying with that service's terms. Anetix is not responsible for Third-Party Services, including their availability, their changes or the data they supply. If a Third-Party Service changes or stops in a way that affects an integration, Anetix may change or end that integration."
      },
      {
        "n": "17.2",
        "title": "Integrations",
        "text": "Anetix builds an integration only if Customer asks, for the one-time price in an Order Form or quote. Unless the Order Form says otherwise, an integration only reads from Customer's systems and does not write to them. Any date for an integration is an estimate, even one in a quote or Order Form, unless the Order Form states that the date is guaranteed and what happens if Anetix misses it. If an integration is not working within 60 days after Customer gives Anetix the access it needs, Customer may cancel that integration for a refund of its fee, which is Customer's only remedy for the delay. Otherwise integration fees are non-refundable once work starts."
      },
      {
        "n": "17.3",
        "title": "Hardware",
        "text": "Hardware Anetix supplies, such as tablets, scanners or label printers, is sold at cost plus handling and is not part of the Service. Title and risk of loss pass to Customer when Anetix hands the hardware to the carrier. Anetix passes through the manufacturer's warranty and gives no warranty of its own."
      }
    ]
  },
  {
    "n": "18",
    "heading": "Publicity",
    "text": [
      "Anetix may name Customer as a customer, and show its logo, on its website and in sales and investor materials, unless Customer tells Anetix in writing not to. Anetix will not publish a case study, a quote, anything a User said or submitted, or any Customer Data without Customer's prior written approval of that item."
    ]
  },
  {
    "n": "19",
    "heading": "Changes to these Terms",
    "text": [
      "Anetix may update these Terms by posting a new version, with a new version number, at [TERMS URL]. A material change applies to an existing Subscription from the start of the first billing month that begins at least 30 days after Anetix gives notice of it by email or in the Service, and to a Demo 30 days after that notice. Other changes, and changes the law requires, apply when posted. If Customer does not agree to a change, it may cancel before the change applies. A signed master agreement stays on the version it names until both parties sign a change."
    ]
  },
  {
    "n": "20",
    "heading": "Governing law and disputes",
    "clauses": [
      {
        "n": "20.1",
        "title": "Law",
        "text": "The laws of the State of Delaware govern these Terms and any dispute arising out of or relating to them or the Service, without regard to conflict of laws rules. The UN Convention on Contracts for the International Sale of Goods does not apply."
      },
      {
        "n": "20.2",
        "title": "Courts",
        "text": "The state and federal courts located in Suffolk County, Massachusetts have exclusive jurisdiction over any such dispute, and each party consents to their jurisdiction. Either party may seek an injunction in any court to protect its intellectual property or Confidential Information."
      },
      {
        "n": "20.3",
        "title": "JURY WAIVER",
        "text": "EACH PARTY WAIVES ANY RIGHT TO A JURY TRIAL IN ANY DISPUTE ARISING OUT OF OR RELATING TO THESE TERMS OR THE SERVICE."
      },
      {
        "n": "20.4",
        "title": "Talk first",
        "text": "Before starting a lawsuit, other than for an injunction or unpaid Fees, a party will give the other written notice of the dispute, and senior people from both parties will try in good faith to resolve it for 30 days."
      },
      {
        "n": "20.5",
        "title": "Collection costs",
        "text": "Customer will pay Anetix's reasonable costs, including attorneys' fees, of collecting overdue Fees."
      }
    ]
  },
  {
    "n": "21",
    "heading": "General",
    "clauses": [
      {
        "n": "21.1",
        "title": "Force majeure",
        "text": "Neither party is liable for a failure or delay caused by events beyond its reasonable control, including natural disasters, fire, flood, epidemics, war, terrorism, civil unrest, labor disputes other than with its own employees, government action, cyberattacks that reasonable safeguards would not have prevented, and failures of utilities, the internet, or hosting, payment or AI model providers. This does not excuse Customer's obligation to pay Fees."
      },
      {
        "n": "21.2",
        "title": "Assignment",
        "text": "Neither party may assign these Terms without the other's written consent, except that either party may assign them on notice to a successor in a merger, acquisition, reorganization or sale of all or substantially all of its assets, or of the business these Terms relate to. Any other attempted assignment is void. These Terms bind permitted successors and assigns."
      },
      {
        "n": "21.3",
        "title": "Notices",
        "text": "Anetix gives notice by email to the account or billing email on file, or in the Service. Customer gives notice to Anetix by email at [LEGAL EMAIL], and notices of breach or of a claim also by mail to Anetix, Inc., [MAILING ADDRESS]. An email notice is given when sent unless the sender receives a delivery failure."
      },
      {
        "n": "21.4",
        "title": "Entire agreement",
        "text": "These Terms, the Order Forms, and any document signed by both parties that expressly changes them are the entire agreement on their subject. They replace all earlier and contemporaneous agreements, proposals and statements, oral or written, including those made in demos, presentations and roadmaps."
      },
      {
        "n": "21.5",
        "title": "Amendments and waivers",
        "text": "Except under section 19, a change to these Terms must be in writing and signed, including electronically, by both parties. A failure or delay in enforcing a right is not a waiver of it."
      },
      {
        "n": "21.6",
        "title": "Severability",
        "text": "If a court finds any provision unenforceable, it will be enforced to the maximum extent allowed, and the rest of these Terms stay in effect. If any part of section 14 is found unenforceable, the rest of that section still applies to the maximum extent allowed."
      },
      {
        "n": "21.7",
        "title": "Relationship",
        "text": "The parties are independent contractors. Nothing in these Terms creates a partnership, joint venture, agency, fiduciary or employment relationship."
      },
      {
        "n": "21.8",
        "title": "No third-party beneficiaries",
        "text": "No one other than the parties has rights under these Terms, except the people section 15.1 protects."
      },
      {
        "n": "21.9",
        "title": "Electronic acceptance",
        "text": "Ticking a box, clicking to accept or signing electronically has the same effect as a handwritten signature. Anetix's electronic records of acceptance, including the version accepted, the time and the account, are evidence of acceptance."
      },
      {
        "n": "21.10",
        "title": "US government users",
        "text": "The Service is commercial computer software and commercial computer software documentation, provided to government users only under these Terms, consistent with FAR 12.212 and DFARS 227.7202."
      },
      {
        "n": "21.11",
        "title": "Interpretation",
        "text": "“Including” means including without limitation. Headings are for convenience only. The short version at the top of these Terms is a summary, not part of them."
      },
      {
        "n": "21.12",
        "title": "Survival",
        "text": "Sections 5 (for Fees owed), 6.3, 8, 10.6, 10.7, 11 to 15, 20 and 21 survive the end of these Terms."
      }
    ]
  }
];

const CONTACT = "Anetix, Inc., [MAILING ADDRESS], [LEGAL EMAIL].";

function termsDoc() {
  return { format: 2, version: TERMS_VERSION, title: TITLE, draft: DRAFT, status: DRAFT ? STATUS : null, summary: SUMMARY, sections: SECTIONS, contact: CONTACT };
}

// The document as plain text, the words the hash is taken over. Pure. A version kept from before (format 1, the
// Common Paper cover page of stage 2) reads the way it read then.
function termsText(doc = termsDoc()) {
  if (doc.format !== 2) {
    const out = [doc.title, `Version ${doc.version}.`, doc.status, "", ...(doc.intro || []), ""];
    for (const s of doc.sections || []) {
      out.push(s.heading);
      if (s.items) for (const [k, v] of s.items) out.push(`${k}: ${v}`);
      if (s.list) s.list.forEach((x, i) => out.push(`${i + 1}. ${x}`));
      out.push("");
    }
    out.push(doc.footer);
    return out.join("\n");
  }
  const out = [doc.title, `Version ${doc.version}.`];
  if (doc.status) out.push(doc.status);
  out.push("");
  if (doc.summary) {
    out.push(doc.summary.heading, doc.summary.note);
    for (const [k, v] of doc.summary.items) out.push(`- ${k}${/^[,.;:]/.test(v) ? "" : " "}${v}`);   // the bold lead, then the rest ("...approves them, after checking")
    out.push("");
  }
  for (const s of doc.sections) {
    out.push(`${s.n}. ${s.heading}`);
    if (s.intro) out.push(s.intro);
    for (const [k, v] of s.defs || []) out.push(`${k}: ${v}`);
    for (const p of s.text || []) out.push(p);
    for (const c of s.clauses || []) {
      out.push(`${c.n} ${c.title}. ${c.text}`);
      (c.list || []).forEach((x, i) => out.push(`${i + 1}. ${x}`));
      if (c.after) out.push(c.after);
    }
    out.push("");
  }
  if (doc.contact) out.push(`Contact. ${doc.contact}`);
  return out.join("\n");
}
const termsHash = (doc) => crypto.createHash("sha256").update(termsText(doc), "utf8").digest("hex");
// The words still in brackets, for the admin's switch: what counsel has left to fill in. Pure.
function placeholders(doc = termsDoc()) { return [...new Set(termsText(doc).match(/\[[A-Z][A-Z ]{2,}\]/g) || [])]; }

// ---- the words beside each tick box (Brendan's screen text, 2026-09-26) ------------------------------------------------
// Each is kept with the acceptance it was shown for. "linked" in his text is the Terms' name made a link on the page,
// so the words say the name and the page makes it the link.
const endSentence = (x) => { x = String(x || "").trim(); return /[.!?]$/.test(x) ? x : `${x}.`; };
const WORDS = {
  // above the signature on Go live's sign step, then the required tick box
  notice: "Before you sign. Anetix helps your team run and improve your operation. Your company still decides which orders to take and which dates to promise. Schedules, estimates and anything the AI produces can be wrong, so check what matters before you commit to it. Anetix is not liable for lost profits, missed deliveries, downtime or penalties you owe others, and as far as the law allows, its total liability is limited to what you paid for this site in the 12 months before the problem behind a claim. Sections 8, 13 and 14 of the Terms have the details.",
  order: (legal, version = TERMS_VERSION) => `I agree to this order form and the Anetix Terms of Service (version ${version}), and I can sign for ${endSentence(legal)}`,
  // above "Make my demo" on anetix.ai
  demo: () => "I agree to the Anetix Terms of Service for the company named above, and I can agree for it. Demos come as is, and Anetix learns from what is built in them (section 4).",
  // above the refill on the top-up page (Brendan's words for Stripe's box, on anetix.ai's own page: see src/agreements.js)
  topup: () => "I agree to the Anetix Terms of Service. Credit pays for AI work in this demo and is refundable only as section 4.2 says.",
  // once, on the board of a demo made before the Terms were switched on
  board: (company) => `I agree to the Anetix Terms of Service for ${String(company || "this company").trim()}, and I can agree for it. Demos come as is, and Anetix learns from what is built in them (section 4).`,
};

module.exports = { TERMS_VERSION, DRAFT, termsDoc, termsText, termsHash, placeholders, WORDS };
