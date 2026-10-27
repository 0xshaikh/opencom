/* ------------------------------------------------------------------ *
 * Opencom — conversations, messages, macros, tags, assignments
 *
 * Pure logic: no DOM, no storage, no timers. Every function that changes
 * a conversation returns a new object and leaves the input untouched, so
 * the caller can hold a reference to the previous state for undo.
 *
 * All dates are local wall-clock ISO strings ("2026-10-27T09:30:00"),
 * not UTC — they are parsed back as local time by Date.parse, so a round
 * trip is exact.
 * ------------------------------------------------------------------ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ComConvos = factory();
  }
})(typeof self !== 'undefined' ? self : global, function () {
  'use strict';

  var SCHEMA_VERSION = 1;

  var STATUSES = ['open', 'pending', 'closed'];

  // Which statuses each status may move to. Kept as a table so the UI can
  // render a real dropdown instead of guessing.
  var TRANSITIONS = {
    open:    ['open', 'pending', 'closed'],
    pending: ['open', 'pending', 'closed'],
    closed:  ['open', 'closed']
  };

  var DEFAULT_TAGS = ['billing', 'bug', 'feature', 'onboarding', 'account', 'escalation'];

  var DEFAULT_AGENTS = [
    { id: 'ag_ada', name: 'Ada' },
    { id: 'ag_ben', name: 'Ben' },
    { id: 'ag_cara', name: 'Cara' },
    { id: 'ag_dev', name: 'Dev' }
  ];

  var DEFAULT_MACRO_SEEDS = [
    {
      title: 'Greeting',
      body: 'Hi — thanks for reaching out! I am happy to help with this. Could you share a little more detail so I can look into it straight away?'
    },
    {
      title: 'ETA',
      body: 'Thanks for your patience! I have started looking into this and will have a proper update for you within 24 hours.'
    },
    {
      title: 'Billing question',
      body: 'For billing questions, your account is currently on the plan listed on the latest invoice. Which part can I help with — a charge, a refund, or a plan change?'
    },
    {
      title: 'Apology',
      body: 'First off, sorry about that — this should not have happened. I am looking at it directly rather than routing it around, and I will come back with what actually went wrong.'
    },
    {
      title: 'Escalation',
      body: 'This needs someone with deeper access, so I am handing it to the engineering team with the full thread attached. I will stay on it with you and follow up here rather than making you re-explain anything.'
    },
    {
      title: 'Closing',
      body: 'Sounds like we have got this sorted. I am closing the thread for now — if anything comes back, just reply here and it will reopen. Thanks for helping me get to the bottom of it!'
    }
  ];

  /* ---------------------------- ids & time --------------------------- */

  var counter = 0;

  /**
   * Short, sortable, collision-resistant id: "c_lz9ab1k0". The process
   * counter never resets, so ids issued in the same millisecond still
   * differ.
   */
  function uid(prefix) {
    counter++;
    return (prefix || 'id') + '_' + Date.now().toString(36)
      + counter.toString(36)
      + Math.random().toString(36).slice(2, 6);
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  /** Local wall-clock ISO string, no timezone suffix. */
  function toISO(value) {
    var d = value instanceof Date ? value : new Date(value);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
           'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  /** Parse an ISO string we produced; returns a Date or null. */
  function fromISO(value) {
    if (typeof value !== 'string' || value === '') { return null; }
    var d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  function shallowCopy(obj) {
    var out = {};
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) { out[k] = obj[k]; }
    }
    return out;
  }

  function requireConversation(convo, what) {
    if (!convo || typeof convo !== 'object' || !Array.isArray(convo.messages)) {
      throw new TypeError(what + ': argument is not a conversation');
    }
    return convo;
  }

  /* ---------------------------- markdown ----------------------------- */

  /** Strip markdown down to readable prose. Used for list snippets. */
  function stripMarkdown(text) {
    if (typeof text !== 'string') { return ''; }
    return text
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/(\*\*|__)/g, '')
      .replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, '$1$2')
      .replace(/(^|\W)~~([^~\n]+)~~(?=\W|$)/g, '$1$2')
      .replace(/^\s{0,3}>\s?/gm, '')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s{0,3}[-*+]\s+/gm, '')
      .replace(/^\s{0,3}\d+\.\s+/gm, '')
      .replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ------------------------- conversation ---------------------------- */

  /**
   * Build a conversation from a partial. Missing pieces get safe defaults;
   * the first message seeds createdAt and (if it is an agent message) the
   * first response clock.
   */
  function newConversation(opts) {
    opts = opts || {};
    if (typeof opts.contactName !== 'string' || opts.contactName.trim() === '') {
      throw new TypeError('newConversation: contactName is required');
    }
    var now = opts.at instanceof Date || typeof opts.at === 'string' ? new Date(opts.at) : new Date();
    var at = toISO(now);
    var msgs = [];
    if (typeof opts.body === 'string' && opts.body.trim() !== '') {
      msgs.push({
        id: uid('m'),
        author: 'customer',
        authorName: opts.contactName.trim(),
        body: opts.body,
        at: at
      });
    }
    var status = STATUSES.indexOf(opts.status) !== -1 ? opts.status : 'open';
    var tags = Array.isArray(opts.tags) ? opts.tags.map(normalizeTag).filter(Boolean) : [];
    return {
      id: uid('c'),
      contactName: opts.contactName.trim(),
      contactEmail: typeof opts.contactEmail === 'string' ? opts.contactEmail.trim() : '',
      subject: typeof opts.subject === 'string' && opts.subject.trim() !== ''
        ? opts.subject.trim()
        : (msgs.length ? stripMarkdown(msgs[0].body).slice(0, 80) : 'New conversation'),
      status: status,
      tags: Array.from ? Array.from(new Set(tags)) : tags,
      assigneeId: typeof opts.assigneeId === 'string' ? opts.assigneeId : null,
      createdAt: at,
      updatedAt: at,
      firstResponseAt: null,
      closedAt: status === 'closed' ? at : null,
      messages: msgs
    };
  }

  /**
   * Append a message. Agent messages stamp firstResponseAt exactly once —
   * the median first-response metric depends on that being stable.
   */
  function appendMessage(convo, message, when) {
    requireConversation(convo, 'appendMessage');
    if (!message || typeof message.body !== 'string' || message.body.trim() === '') {
      throw new TypeError('appendMessage: message.body must be a non-empty string');
    }
    var isAgent = message.author === 'agent';
    var at = toISO(when instanceof Date || typeof when === 'string' ? when : new Date());
    var msg = {
      id: uid('m'),
      author: isAgent ? 'agent' : 'customer',
      authorName: typeof message.authorName === 'string' && message.authorName.trim() !== ''
        ? message.authorName.trim()
        : (isAgent ? 'Agent' : convo.contactName),
      body: message.body,
      at: at
    };
    var out = shallowCopy(convo);
    out.messages = convo.messages.concat([msg]);
    out.updatedAt = at;
    if (isAgent && !out.firstResponseAt) { out.firstResponseAt = at; }
    // A reply from the customer reopens a closed thread.
    if (!isAgent && convo.status === 'closed') {
      out.status = 'open';
      out.closedAt = null;
    }
    return out;
  }

  /**
   * Move a conversation between statuses. Unknown statuses and illegal
   * jumps throw instead of being silently ignored, so a typo in the UI
   * surfaces as a real error.
   */
  function setStatus(convo, status, when) {
    requireConversation(convo, 'setStatus');
    if (STATUSES.indexOf(status) === -1) {
      throw new TypeError('setStatus: unknown status "' + status + '"');
    }
    var from = convo.status;
    if (TRANSITIONS[from].indexOf(status) === -1) {
      throw new TypeError('setStatus: cannot move from ' + from + ' to ' + status);
    }
    if (from === status) { return convo; }
    var at = toISO(when instanceof Date || typeof when === 'string' ? when : new Date());
    var out = shallowCopy(convo);
    out.status = status;
    out.closedAt = status === 'closed' ? at : null;
    out.updatedAt = at;
    return out;
  }

  /** Allowed next statuses, for rendering a dropdown. */
  function allowedStatuses(convo) {
    requireConversation(convo, 'allowedStatuses');
    return TRANSITIONS[convo.status] || [];
  }

  /** Hours between createdAt and firstResponseAt, or null if unanswered. */
  function firstResponseHours(convo) {
    if (!convo || !convo.firstResponseAt) { return null; }
    var c = fromISO(convo.createdAt);
    var r = fromISO(convo.firstResponseAt);
    if (!c || !r || r < c) { return null; }
    return (r.getTime() - c.getTime()) / 3600000;
  }

  /* ------------------------------- tags ------------------------------ */

  function normalizeTag(tag) {
    if (typeof tag !== 'string') { return null; }
    var t = tag.trim().toLowerCase().replace(/\s+/g, '-');
    return t || null;
  }

  function addTag(convo, tag) {
    requireConversation(convo, 'addTag');
    var t = normalizeTag(tag);
    if (!t) { throw new TypeError('addTag: tag must be a non-empty string'); }
    if (convo.tags.indexOf(t) !== -1) { return convo; }
    var out = shallowCopy(convo);
    out.tags = convo.tags.concat([t]);
    return out;
  }

  function removeTag(convo, tag) {
    requireConversation(convo, 'removeTag');
    var t = normalizeTag(tag);
    var out = shallowCopy(convo);
    out.tags = convo.tags.filter(function (x) { return x !== t; });
    return out;
  }

  /** Distinct tags in use across the inbox, sorted alphabetically. */
  function tagUniverse(doc) {
    var seen = Object.create(null);
    var declared = (doc && Array.isArray(doc.tags)) ? doc.tags : [];
    for (var i = 0; i < declared.length; i++) { seen[declared[i]] = true; }
    var convos = (doc && Array.isArray(doc.conversations)) ? doc.conversations : [];
    for (var j = 0; j < convos.length; j++) {
      var tags = convos[j].tags || [];
      for (var k = 0; k < tags.length; k++) { seen[tags[k]] = true; }
    }
    var out = [];
    for (var name in seen) { if (Object.prototype.hasOwnProperty.call(seen, name)) { out.push(name); } }
    out.sort();
    return out;
  }

  /* --------------------------- assignment ---------------------------- */

  function setAssignee(convo, agentId) {
    requireConversation(convo, 'setAssignee');
    var out = shallowCopy(convo);
    out.assigneeId = typeof agentId === 'string' && agentId !== '' ? agentId : null;
    return out;
  }

  function agentName(doc, agentId) {
    if (!agentId) { return null; }
    var agents = (doc && Array.isArray(doc.agents)) ? doc.agents : [];
    for (var i = 0; i < agents.length; i++) {
      if (agents[i].id === agentId) { return agents[i].name || agents[i].id; }
    }
    return null;
  }

  function initials(name) {
    if (typeof name !== 'string' || name.trim() === '') { return '?'; }
    var parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 1) { return parts[0].slice(0, 2).toUpperCase(); }
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  /* ---------------------------- macros ------------------------------- */

  function newMacro(title, body) {
    if (typeof title !== 'string' || title.trim() === '') {
      throw new TypeError('newMacro: title is required');
    }
    if (typeof body !== 'string' || body.trim() === '') {
      throw new TypeError('newMacro: body is required');
    }
    var at = toISO(new Date());
    return { id: uid('mac'), title: title.trim(), body: body, createdAt: at, updatedAt: at };
  }

  function updateMacro(macro, patch) {
    if (!macro || typeof macro !== 'object') {
      throw new TypeError('updateMacro: argument is not a macro');
    }
    patch = patch || {};
    var out = shallowCopy(macro);
    if (patch.title !== undefined) {
      if (typeof patch.title !== 'string' || patch.title.trim() === '') {
        throw new TypeError('updateMacro: title must be a non-empty string');
      }
      out.title = patch.title.trim();
    }
    if (patch.body !== undefined) {
      if (typeof patch.body !== 'string' || patch.body.trim() === '') {
        throw new TypeError('updateMacro: body must be a non-empty string');
      }
      out.body = patch.body;
    }
    out.updatedAt = toISO(new Date());
    return out;
  }

  /**
   * Splice a macro body into a draft at the cursor. Runs are separated
   * from surrounding text with newlines so a macro inserted mid-paragraph
   * does not glue itself to the neighbouring words.
   */
  function insertMacroAt(text, cursor, macro) {
    if (!macro || typeof macro.body !== 'string' || macro.body === '') {
      throw new TypeError('insertMacroAt: macro.body is required');
    }
    var s = typeof text === 'string' ? text : '';
    var pos = typeof cursor === 'number' && isFinite(cursor) && cursor >= 0 ? cursor : s.length;
    if (pos > s.length) { pos = s.length; }
    var before = s.slice(0, pos);
    var after = s.slice(pos);
    if (before === '' && after === '') { return macro.body; }
    var gapBefore = before !== '' ? '\n' : '';
    var gapAfter = after !== '' ? '\n' : '';
    return before + gapBefore + macro.body + gapAfter + after;
  }

  /** Macros whose title or body contains the typed fragment. */
  function findMacros(macros, query) {
    var list = Array.isArray(macros) ? macros : [];
    var q = typeof query === 'string' ? query.trim().toLowerCase() : '';
    if (!q) { return list.slice(); }
    return list.filter(function (m) {
      return (m.title || '').toLowerCase().indexOf(q) !== -1
          || (m.body || '').toLowerCase().indexOf(q) !== -1;
    });
  }

  /* --------------------------- presentation -------------------------- */

  /** One-line snippet of the latest message, markdown stripped. */
  function snippet(convo, max) {
    max = max || 110;
    var msgs = convo && convo.messages ? convo.messages : [];
    if (!msgs.length) { return 'No messages yet'; }
    var last = msgs[msgs.length - 1];
    var text = stripMarkdown(last.body);
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
  }

  /** Human relative time, computed against an explicit "now" for tests. */
  function timeAgo(isoString, now) {
    var then = fromISO(isoString);
    if (!then) { return ''; }
    var ref = now ? (typeof now === 'string' ? fromISO(now) : new Date(now)) : new Date();
    var ms = (ref ? ref.getTime() : Date.now()) - then.getTime();
    if (ms < 0) { return 'just now'; }
    var mins = Math.floor(ms / 60000);
    if (mins < 1) { return 'just now'; }
    if (mins < 60) { return mins + 'm ago'; }
    var hours = Math.floor(mins / 60);
    if (hours < 24) { return hours + 'h ago'; }
    var days = Math.floor(hours / 24);
    if (days < 7) { return days + 'd ago'; }
    var weeks = Math.floor(days / 7);
    if (weeks < 5) { return weeks + 'w ago'; }
    var months = Math.floor(days / 30);
    if (months < 12) { return months + 'mo ago'; }
    return Math.floor(days / 365) + 'y ago';
  }

  /**
   * Filter and sort conversations without mutating the input.
   * filters: { search, status ('all' or a status), tag ('all' or a tag),
   *            sort ('newest' | 'oldest') }
   */
  function filterConversations(conversations, filters) {
    var list = Array.isArray(conversations) ? conversations : [];
    filters = filters || {};
    var q = typeof filters.search === 'string' ? filters.search.trim().toLowerCase() : '';
    var status = filters.status && filters.status !== 'all' ? filters.status : null;
    var tag = filters.tag && filters.tag !== 'all' ? filters.tag : null;
    var sort = filters.sort === 'oldest' ? 'oldest' : 'newest';

    var out = list.filter(function (c) {
      if (status && c.status !== status) { return false; }
      if (tag && (c.tags || []).indexOf(tag) === -1) { return false; }
      if (!q) { return true; }
      var msgs = c.messages || [];
      var hay = [
        c.contactName, c.contactEmail, c.subject,
        msgs.map(function (m) { return stripMarkdown(m.body); }).join(' ')
      ].join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });

    out.sort(function (a, b) {
      var ta = fromISO(a.updatedAt) ? fromISO(a.updatedAt).getTime() : 0;
      var tb = fromISO(b.updatedAt) ? fromISO(b.updatedAt).getTime() : 0;
      return sort === 'oldest' ? ta - tb : tb - ta;
    });
    return out;
  }

  /* ----------------------------- seeding ----------------------------- */

  function defaultMacros() {
    return DEFAULT_MACRO_SEEDS.map(function (m) {
      return newMacro(m.title, m.body);
    });
  }

  /** An empty inbox with the standard roster and macros, no conversations. */
  function emptyDocument() {
    return {
      version: SCHEMA_VERSION,
      exportedAt: null,
      conversations: [],
      macros: defaultMacros(),
      agents: DEFAULT_AGENTS.map(function (a) { return shallowCopy(a); }),
      tags: DEFAULT_TAGS.slice()
    };
  }

  /**
   * A realistic demo inbox: ten threads across every status, with
   * multi-message histories and first-response clocks spread out so the
   * median metric has something real to measure. Timestamps are relative
   * to the moment this is called.
   */
  function demoDocument() {
    var now = Date.now();
    var H = 3600000;
    function ago(hours) { return toISO(new Date(now - Math.round(hours * H))); }

    function convo(opts) {
      var msgs = opts.messages.map(function (m) {
        return {
          id: uid('m'),
          author: m.author,
          authorName: m.name,
          body: m.body,
          at: ago(m.ago)
        };
      });
      var firstCustomer = null;
      var firstAgent = null;
      for (var i = 0; i < msgs.length; i++) {
        if (msgs[i].author === 'customer' && !firstCustomer) { firstCustomer = msgs[i]; }
        if (msgs[i].author === 'agent' && !firstAgent) { firstAgent = msgs[i]; }
      }
      var startedAt = firstCustomer ? firstCustomer.at : msgs[0].at;
      return {
        id: uid('c'),
        contactName: opts.name,
        contactEmail: opts.email,
        subject: opts.subject,
        status: opts.status,
        tags: opts.tags.slice(),
        assigneeId: opts.assignee || null,
        createdAt: startedAt,
        updatedAt: msgs[msgs.length - 1].at,
        firstResponseAt: firstAgent ? firstAgent.at : null,
        closedAt: opts.status === 'closed' ? msgs[msgs.length - 1].at : null,
        messages: msgs
      };
    }

    var conversations = [
      convo({
        name: 'Priya Raman', email: 'priya@northbeam.io', subject: 'Charged twice for September',
        status: 'open', tags: ['billing'], assignee: 'ag_ada',
        messages: [
          { author: 'customer', name: 'Priya Raman', ago: 26,
            body: 'We were **charged twice** for September — invoice `INV-4471` and `INV-4472`, same amount, two days apart. Can you refund the duplicate?' },
          { author: 'agent', name: 'Ada', ago: 24,
            body: 'Thanks for flagging Priya, and sorry about that. I can see both invoices on your account — refunding `INV-4472` now. It should reach your card in 3–5 working days.' },
          { author: 'customer', name: 'Priya Raman', ago: 2,
            body: 'Appreciate it. Do we need to do anything on our side for the tax line?' }
        ]
      }),
      convo({
        name: 'Marcus Webb', email: 'marcus@webbdesign.co', subject: 'CSV export breaks in Safari',
        status: 'open', tags: ['bug'],
        messages: [
          { author: 'customer', name: 'Marcus Webb', ago: 5,
            body: 'Exporting a project to CSV produces a blank file in Safari 17.4. Works fine in Chrome. Console shows a *type error* on the blob URL.' }
        ]
      }),
      convo({
        name: 'Lena Fischer', email: 'lena.f@helio.de', subject: 'Sandbox credentials not arriving',
        status: 'pending', tags: ['onboarding'], assignee: 'ag_ben',
        messages: [
          { author: 'customer', name: 'Lena Fischer', ago: 52,
            body: 'I completed the onboarding checklist but the sandbox API key email never arrived. Checked spam. Is this manual?' },
          { author: 'agent', name: 'Ben', ago: 49,
            body: 'Hi Lena, sandbox keys are issued automatically but are sometimes held by strict corporate mail filters. I have re-triggered the send and added a fallback link to your dashboard — check the *Settings → Credentials* tab.' },
          { author: 'customer', name: 'Lena Fischer', ago: 20,
            body: 'Thank you, that worked. Our IT filters *.io domains, so it may take another week for other users.' }
        ]
      }),
      convo({
        name: 'Tomás Silva', email: 'tomas@verde.app', subject: 'Upgrading to Pro — invoice timing',
        status: 'pending', tags: ['billing'], assignee: 'ag_ada',
        messages: [
          { author: 'customer', name: 'Tomás Silva', ago: 31,
            body: 'We want to move to Pro next month. If we upgrade mid-cycle, is the remainder of this month prorated, or billed in full?' },
          { author: 'agent', name: 'Ada', ago: 30,
            body: 'Hi Tomás — mid-cycle upgrades are prorated against the remaining days, and the Pro charge appears on your next regular invoice rather than immediately. I can apply it for you when you are ready.' }
        ]
      }),
      convo({
        name: 'Aisha Khan', email: 'aisha@meridian.dev', subject: 'Bulk import for CSV uploads',
        status: 'open', tags: ['feature'], assignee: 'ag_cara',
        messages: [
          { author: 'customer', name: 'Aisha Khan', ago: 8,
            body: 'Would love a **bulk import** for CSV — we have ~4,000 contacts to migrate and copying them one at a time is not viable. Is this on the roadmap?' },
          { author: 'agent', name: 'Cara', ago: 7,
            body: 'Hi Aisha, yes — CSV import is in active development. I have added your account to the waitlist and I will reply here the moment it opens for early access. No action needed from you.' }
        ]
      }),
      convo({
        name: 'Jonas Berg', email: 'jonas@nordvik.se', subject: 'Login loop on mobile Safari',
        status: 'closed', tags: ['bug'], assignee: 'ag_ben',
        messages: [
          { author: 'customer', name: 'Jonas Berg', ago: 74,
            body: 'Every time I open the app on iPhone I get bounced to the login screen, even with an active session.' },
          { author: 'agent', name: 'Ben', ago: 71,
            body: 'Thanks Jonas — reproduced on iOS 17.4 with cookies restricted. A fix is deployed; please force-close the app once and it should keep the session.' },
          { author: 'customer', name: 'Jonas Berg', ago: 46,
            body: 'Confirmed fixed, thanks for the quick turnaround.' },
          { author: 'agent', name: 'Ben', ago: 45,
            body: 'Glad to hear it. Closing this out — reopen anytime if it returns.' }
        ]
      }),
      convo({
        name: 'Nour Haddad', email: 'nour@atlasmail.com', subject: 'Change company name on the account',
        status: 'closed', tags: ['account'], assignee: 'ag_dev',
        messages: [
          { author: 'customer', name: 'Nour Haddad', ago: 96,
            body: 'We renamed our company. Could you update the account name so invoices match? New name: *Atlas Mail Ltd*.' },
          { author: 'agent', name: 'Dev', ago: 94,
            body: 'Done — the account now reads Atlas Mail Ltd and future invoices will use it. The legal name on billing remains unchanged unless you ask me to update that too.' },
          { author: 'customer', name: 'Nour Haddad', ago: 92,
            body: 'Perfect, that is all I needed. Thank you!' }
        ]
      }),
      convo({
        name: 'Wei Chen', email: 'wei.chen@quanta.sg', subject: 'Annual vs monthly billing math',
        status: 'closed', tags: ['billing'], assignee: 'ag_cara',
        messages: [
          { author: 'customer', name: 'Wei Chen', ago: 120,
            body: 'Annual billing is 2,880 for 20 seats and monthly is 260/mo. Can you confirm the annual price is the same 20 seats, not 24 months of monthly?' },
          { author: 'agent', name: 'Cara', ago: 118,
            body: 'Confirmed Wei — annual is 20 seats × 144, the same seats as monthly, just prepaid for 12 months. No seat inflation.' },
          { author: 'customer', name: 'Wei Chen', ago: 117,
            body: 'Great, switching us over to annual then. Thanks!' }
        ]
      }),
      convo({
        name: 'Sofia Marino', email: 'sofia@lumenware.it', subject: 'Warehouse sync has stopped updating',
        status: 'open', tags: ['escalation', 'bug'], assignee: 'ag_ben',
        messages: [
          { author: 'customer', name: 'Sofia Marino', ago: 11,
            body: 'Our warehouse sync stopped writing new rows around 03:00 UTC yesterday. The connector shows *healthy* but no rows have landed in 20 hours. This is blocking our morning reporting.' },
          { author: 'agent', name: 'Ben', ago: 10,
            body: 'Thanks Sofia — sorry, that is a production impact so I am treating it as urgent. I can see the connector reporting healthy while the write cursor is stalled, which points at the downstream side rather than our connector. I have opened a priority engineering ticket and attached the full thread.' },
          { author: 'agent', name: 'Ben', ago: 4,
            body: 'Update: engineering has isolated it to an expired credential on the warehouse side, which our health check was not catching. Your credentials need a one-time re-authorisation — I am sending you a link. Rows will resume as soon as you accept it.' }
        ]
      }),
      convo({
        name: 'Ravi Patel', email: 'ravi@fernleaf.in', subject: 'First five minutes with the product',
        status: 'pending', tags: ['onboarding'], assignee: 'ag_cara',
        messages: [
          { author: 'customer', name: 'Ravi Patel', ago: 6,
            body: 'Just signed up. Where do I start? There are a lot of panels and I do not want to break anything on day one.' },
          { author: 'agent', name: 'Cara', ago: 5,
            body: 'Welcome Ravi! The safe path is: *Settings → Workspace* to name your team, then *Import* to bring in your contacts, then try the *Sample project* from the dashboard. Everything you change on day one can be undone — only deleting a workspace is permanent.' }
        ]
      })
    ];

    return {
      version: SCHEMA_VERSION,
      exportedAt: null,
      conversations: conversations,
      macros: defaultMacros(),
      agents: DEFAULT_AGENTS.map(function (a) { return shallowCopy(a); }),
      tags: DEFAULT_TAGS.slice()
    };
  }

  /* --------------------------- normalising --------------------------- */

  /** Repair a conversation read back from a file or an older version. */
  function normalizeConversation(raw) {
    if (!raw || typeof raw !== 'object') { return null; }
    var status = STATUSES.indexOf(raw.status) !== -1 ? raw.status : 'open';
    var msgs = Array.isArray(raw.messages) ? raw.messages.filter(function (m) {
      return m && typeof m === 'object' && typeof m.body === 'string';
    }).map(function (m) {
      return {
        id: typeof m.id === 'string' ? m.id : uid('m'),
        author: m.author === 'agent' ? 'agent' : 'customer',
        authorName: typeof m.authorName === 'string' ? m.authorName : '',
        body: m.body,
        at: typeof m.at === 'string' ? m.at : toISO(new Date())
      };
    }) : [];

    var firstResponseAt = null;
    for (var i = 0; i < msgs.length; i++) {
      if (msgs[i].author === 'agent') { firstResponseAt = msgs[i].at; break; }
    }
    var updatedAt = msgs.length ? msgs[msgs.length - 1].at : toISO(new Date());
    var createdAt = typeof raw.createdAt === 'string' ? raw.createdAt
      : (msgs.length ? msgs[0].at : updatedAt);

    return {
      id: typeof raw.id === 'string' ? raw.id : uid('c'),
      contactName: typeof raw.contactName === 'string' && raw.contactName.trim() !== ''
        ? raw.contactName : 'Unknown contact',
      contactEmail: typeof raw.contactEmail === 'string' ? raw.contactEmail : '',
      subject: typeof raw.subject === 'string' && raw.subject.trim() !== ''
        ? raw.subject : 'Imported conversation',
      status: status,
      tags: Array.isArray(raw.tags)
        ? raw.tags.map(normalizeTag).filter(Boolean) : [],
      assigneeId: typeof raw.assigneeId === 'string' ? raw.assigneeId : null,
      createdAt: createdAt,
      updatedAt: updatedAt,
      firstResponseAt: typeof raw.firstResponseAt === 'string' ? raw.firstResponseAt : firstResponseAt,
      closedAt: typeof raw.closedAt === 'string' ? raw.closedAt : null,
      messages: msgs
    };
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    STATUSES: STATUSES,
    TRANSITIONS: TRANSITIONS,
    DEFAULT_TAGS: DEFAULT_TAGS,
    DEFAULT_AGENTS: DEFAULT_AGENTS,
    DEFAULT_MACRO_SEEDS: DEFAULT_MACRO_SEEDS,

    uid: uid,
    toISO: toISO,
    fromISO: fromISO,
    stripMarkdown: stripMarkdown,
    normalizeTag: normalizeTag,

    newConversation: newConversation,
    appendMessage: appendMessage,
    setStatus: setStatus,
    allowedStatuses: allowedStatuses,
    firstResponseHours: firstResponseHours,

    addTag: addTag,
    removeTag: removeTag,
    tagUniverse: tagUniverse,
    setAssignee: setAssignee,
    agentName: agentName,
    initials: initials,

    newMacro: newMacro,
    updateMacro: updateMacro,
    insertMacroAt: insertMacroAt,
    findMacros: findMacros,
    defaultMacros: defaultMacros,

    snippet: snippet,
    timeAgo: timeAgo,
    filterConversations: filterConversations,

    emptyDocument: emptyDocument,
    demoDocument: demoDocument,
    normalizeConversation: normalizeConversation
  };
});
