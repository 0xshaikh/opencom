<p align="center">
  <img src="./icon.svg" alt="Opencom" width="120" height="120" />
</p>

<h1 align="center">Opencom</h1>

<p align="center">
  <strong>Open-source customer messaging inbox.</strong>
</p>

<p align="center">
  Every helpdesk charges per agent seat — which is why the expensive part is
  the shared inbox, not the chat widget. Opencom is the inbox: a searchable
  conversation list, threaded replies with markdown, canned responses, tags,
  assignment, and a stats strip, all computed from your own data. It runs
  entirely in your browser. No account, no install, no build step, no
  server, no telemetry. Your inbox never leaves your machine.
</p>

<p align="center">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-4c9aff" />
  <img alt="dependencies" src="https://img.shields.io/badge/dependencies-0-orange" />
  <img alt="build" src="https://img.shields.io/badge/build-step%20none-3c873a" />
  <img alt="runtime" src="https://img.shields.io/badge/runtime-any%20modern%20browser-8a6dff" />
  <img alt="storage" src="https://img.shields.io/badge/storage-localStorage-a0a0a0" />
  <img alt="version" src="https://img.shields.io/badge/version-1.0.0-6d5efc" />
  <a href="https://github.com/0xshaikh/opencom/actions">
    <img alt="ci" src="https://github.com/0xshaikh/opencom/workflows/CI/badge.svg" />
  </a>
</p>

---

## What it is

Opencom is a **single-page helpdesk** written in ~3,500 lines of plain vanilla
JavaScript. There is no framework, no bundler, no `package.json`, no
`npm install`, and no backend — the entire app is one `index.html`, a
stylesheet, five script files, and two SVG icons.

It is an **inbox, not a messenger.** Nothing in it talks to any email
provider or chat platform. There is no OAuth, no API key, no webhooks. You
paste in a conversation, or create one from a note, and the thread lives in
your browser's `localStorage`. "Replying" appends a message and optionally
moves the status. What it does is give one person a real helpdesk surface —
inbox, queue, macros, assignment, first-response metrics — with no signup
and no per-seat monthly fee.

## Quick start

There is nothing to install. Pick whichever feels right:

```sh
# Just open the file
xdg-open index.html          # or double-click it

# Or serve it locally
python3 -m http.server 8080
# then visit http://localhost:8080
```

That is it. There is no build step to run and no environment variable to
set. The app opens with the demo inbox already loaded — ten conversations
across every status — so the product looks like a product on first load.
Hit **Load demo** any time to get it back, and **Clear** to start from an
empty inbox.

## Features

**Conversation list.** Searchable across contact names, subjects, emails
and message bodies. Sortable by newest or oldest activity, filterable by
status (all / open / pending / closed) and by tag. Each row shows the
contact, subject, a snippet of the latest message with its markdown
stripped, a status pill, tag chips, the assignee's initial avatar, and a
relative timestamp.

**Thread view.** The full message history for the selected conversation,
customer messages aligned left, agent replies aligned right, grouped
under day breaks, each with a sender label, role badge and timestamp.
Messages are rendered from a small markdown subset: **bold**, *italic*,
`code`, fenced blocks, links, lists, blockquotes and rules.

**Reply composer.** A textarea with real formatting affordances — bold,
italic, code and link buttons that wrap the current selection in markdown —
plus a live preview toggle, a character count, and a status select that
sends `open → pending → closed` transitions together with the reply.

**Canned responses.** Named macros with a title and a markdown body,
create, edit and delete in a modal, with undo on delete. Type `/` in the
composer and a menu of matches appears; arrow keys to move, Enter to insert
at the cursor, Esc to dismiss. Six realistic defaults ship: greeting, ETA,
billing question, apology, escalation and closing.

**Tags.** Per-conversation chips you can add and remove inline from the
thread header — type a tag and press Enter. Tags are normalised
(lowercase, whitespace to dashes), de-duplicated, and a tag palette of the
declared tags plus anything a conversation has ever used feeds both the
filter and the palette.

**Assignment.** A small editable agent roster. Pick an assignee from a
dropdown in the thread header; the row avatar shows the first and last
initial. Removing an agent unassigns their conversations.

**Stats strip.** A persistent metrics bar computed live from the
conversations: open, pending, closed today, median first-response time in
hours, conversations started this week, threads still waiting on a reply
from you, and mini bars for the most common tags. Every number is real —
an empty inbox honestly reports zeros.

**New conversation.** A modal for contact name, email, subject, first
message, tags and assignee.

**Import and export.** The whole inbox as JSON — the same structure the app
stores — and as CSV in two shapes: one row per conversation, and one row per
message with the conversation columns repeated. Import a JSON export back in.
Exports are versioned and validated on the way in, so a file from a newer
version is refused with a message rather than silently half-loaded.

**Local storage.** Everything lives in `localStorage` under one key
(`opencom.document`). If storage is blocked, the app falls back to an
in-memory store and tells you in the status bar — nothing else changes.

## Sample data

**Load demo** seeds ten realistic, varied conversations:

| Contact | Subject | Status | Tags |
|---|---|---|---|
| Priya Raman | Charged twice for September | open | billing |
| Marcus Webb | CSV export breaks in Safari | open | bug |
| Lena Fischer | Sandbox credentials not arriving | pending | onboarding |
| Tomás Silva | Upgrading to Pro — invoice timing | pending | billing |
| Aisha Khan | Bulk import for CSV uploads | open | feature |
| Jonas Berg | Login loop on mobile Safari | closed | bug |
| Nour Haddad | Change company name on the account | closed | account |
| Wei Chen | Annual vs monthly billing math | closed | billing |
| Sofia Marino | Warehouse sync has stopped updating | open | escalation, bug |
| Ravi Patel | First five minutes with the product | pending | onboarding |

Nine of the ten have been answered, with first-response clocks spread from
one to three hours apart, so the median metric has something real to
measure. Nine carry multi-message threads, including a live escalation
thread where the agent replies twice. Timestamps are generated relative to
the moment you load the demo, so "2h ago" is always accurate.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `j` / `ArrowDown` | Next conversation |
| `k` / `ArrowUp` | Previous conversation |
| `Enter` | Open the current conversation |
| `/` in the composer | Open the canned-response menu |
| `ArrowUp` / `ArrowDown` in the menu | Move through matches |
| `Enter` in the menu | Insert the selected macro |
| `Ctrl` / `Cmd` + `Enter` | Send the reply |
| `Ctrl` / `Cmd` + `S` | Save a macro while editing one |
| `Esc` | Close a dialog, or dismiss the macro menu |
| `n` | New conversation |

## Data & privacy

Opencom makes **zero network requests at runtime**. There is no analytics,
no beacon, no font CDN, no icon font, no API call — the only thing it
loads is its own local files.

Everything is stored in this browser under one `localStorage` key:

```
opencom.document = {
  "version": 1,
  "conversations": [ { "id", "contactName", "contactEmail", "subject",
                       "status", "tags", "assigneeId",
                       "createdAt", "updatedAt", "firstResponseAt",
                       "closedAt", "messages": [ { "id", "author",
                          "authorName", "body", "at" } ] } ],
  "macros":  [ { "id", "title", "body", "createdAt", "updatedAt" } ],
  "agents":  [ { "id", "name" } ],
  "tags":    [ "billing", "bug", ... ]
}
```

Dates are local wall-clock ISO strings, not UTC — `2026-10-27T09:30:00`
means 9:30 a.m. your time. `version` is bumped when the schema changes;
importing a file with a newer version is refused rather than guessed at.

Because it is browser-local, clearing site data, using an incognito window,
or switching browsers means starting again. **Export regularly** if the
inbox matters to you.

## Architecture

```
opencom/
├── index.html                  # App shell: topbar, stats strip, sidebar, thread
├── css/
│   └── styles.css              # Dark theme, layout, list, thread, composer, modals
├── js/
│   ├── store.js                # localStorage wrapper with in-memory fallback
│   ├── convos.js               # Conversations, messages, status, tags, macros,
│   │                           #   assignment, filtering, seeding — pure logic
│   ├── stats.js                # Median first response, weekly series, tag
│   │                           #   distribution — pure logic
│   ├── csv.js                  # RFC 4180 CSV, JSON export/import, flattening
│   └── app.js                  # DOM layer: rendering, events, modals, toasts
├── verify.js                   # Test suite — plain Node, zero dependencies
├── icon.svg                    # 100×100 app icon
├── favicon.svg                 # 32×32 favicon
├── README.md
├── LICENSE                     # MIT
├── .gitignore
└── .github/workflows/
    └── ci.yml                  # node verify.js on every push
```

Four of the five script files are **pure logic with no DOM access**, wrapped
in a small UMD pattern so the exact same file loads under Node (`require`)
and in a browser (a `window` global). `verify.js` therefore tests the real
production code, not a re-implementation:

```sh
node -e "const C = require('./js/convos.js'); console.log(C.DEFAULT_MACRO_SEEDS.length)"
```

`app.js` is the only file that touches the DOM, and it is deliberately thin —
render functions plus a few delegated listeners, so re-rendering never
detaches handlers. Status transitions are a table, so the composer's
dropdown renders whatever is legal rather than guessing.

## Verify

```sh
node verify.js
```

That is the whole command. No `npm install`, no test runner, no dev
dependencies, no headless browser — `verify.js` is a plain Node script with
its own tiny assert helper, and it exits non-zero on any failure.

The suite runs **275 assertions** across the four pure modules: storage
round-trips, the memory fallback, prefix isolation and corrupt-payload
handling; conversation creation and defaults, message ordering, the
one-shot first-response clock, customer replies reopening closed threads,
every legal and illegal status transition, tag normalisation and
de-duplication, assignment, id generation; filtering by search, status, tag
and sort order; macro insertion at every cursor position, macro search, and
update validation; snippet truncation, markdown stripping, relative time in
every bucket; the median over odd, even and empty inputs, Monday-first week
boundaries, closed-today counting, weekly series, and per-conversation
rather than per-message tag counts; CSV escaping for commas, quotes, newlines
and carriage returns, parse round-trips including embedded newlines, CRLF and
trailing terminators; flattening of both CSV shapes; JSON export/import
round-trips with ids, bodies, tags, statuses and first-response clocks
surviving intact; rejection of malformed, unversioned, newer-schema and
conversation-less imports; and the integrity of the demo seed. The final
section loads every module into a bare VM context with no `module` or
`require` in scope — the exact path a browser takes — to catch bugs the Node
branch would hide.

```
============================================================
PASS  275/275 assertions passed, 0 failed
============================================================
```

The DOM layer in `app.js` is exercised by hand in a real browser rather than
by jsdom, which is why it stays a thin rendering layer.

## Extending

A few ground rules, in the spirit of what this is:

- **Keep the dependency count at zero.** No runtime dependencies, no build
  step, no framework. If a change needs `npm install`, it needs to be
  discussed first.
- **Keep pure logic in pure files.** Anything that can be tested without a
  browser belongs in `store.js`, `convos.js`, `stats.js` or `csv.js` — and
  if you add a function there, add assertions for it.
- **Run `node verify.js` before you push.** It must exit green.
- **Do not add any network call to the app.** This project's value is that
  data never leaves the browser. Adding an API would change what it is.
- **Do not add accounts, auth, or sync.** Same reason.

## Roadmap

Honestly, in priority order:

- **Email import.** Paste an email into a new conversation and have the
  subject and body lifted. Genuinely the biggest single time-saver.
- **Multi-user.** A second person on the same inbox. This is the thing that
  turns "per seat" into a feature rather than a price — and it needs a
  backend, which this project deliberately does not have. Open by design.
- **Full-text search** over the message body as a real index rather than a
  substring scan, once inboxes get large.
- **Per-conversation notes** — internal, not sent to the customer.
- **SLA timers** — a visible breach countdown on open threads.
- **Slack/Telegram notifications** for new inbound messages.

Deliberately cut at v1.0:

- **No email delivery.** No SMTP, no OAuth, no IMAP polling. "Replying" is a
  local action you then paste somewhere. Adding sending would require
  credentials, and credentials are why helpdesks charge what they charge.
- **No email or chat import parsing.** New conversations are entered by hand.
  There are many valid formats and none of them are worth 40 minutes of
  brittle regex at this stage.
- **No attachments or media.** Threads are text with markdown.
- **No per-user permissions or audit log.** Single browser, one person.
- **No offline-first sync or sharing.** Browser-local only, by design.

## License

MIT — see [LICENSE](LICENSE). Use it, fork it, ship it.
