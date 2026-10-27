/* ------------------------------------------------------------------ *
 * Opencom — test suite
 *
 * Plain Node, zero dependencies, no test runner:
 *
 *     node verify.js
 *
 * It requires the real production modules and asserts against them, so
 * what is tested is what ships. Exits non-zero on any failure.
 * ------------------------------------------------------------------ */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var Convos = require('./js/convos.js');
var Stats = require('./js/stats.js');
var CSV = require('./js/csv.js');
var Store = require('./js/store.js');

var passed = 0;
var failed = 0;
var failures = [];
var section = '';

function banner(title) {
  section = title;
  console.log('\n== ' + title + ' ==');
}

function ok(name, cond) {
  if (cond) { passed++; }
  else { failed++; failures.push(section + ' › ' + name); }
}

function eq(name, actual, expected) {
  var a = JSON.stringify(actual);
  var b = JSON.stringify(expected);
  if (a === b) { passed++; }
  else {
    failed++;
    failures.push(section + ' › ' + name + '  (expected ' + b + ', got ' + a + ')');
  }
}

function throws(name, fn, messagePart) {
  try {
    fn();
    failed++;
    failures.push(section + ' › ' + name + '  (no error thrown)');
  } catch (e) {
    if (messagePart && e.message.indexOf(messagePart) === -1) {
      failed++;
      failures.push(section + ' › ' + name + '  (wrong message: ' + e.message + ')');
    } else {
      passed++;
    }
  }
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function iso(y, mo, d, h, m, s) {
  return y + '-' + pad2(mo) + '-' + pad2(d) + 'T' + pad2(h) + ':' + pad2(m) + ':' + pad2(s === undefined ? 0 : s);
}

/* ------------------------------- store ----------------------------- */

banner('store');

(function () {
  var s = Store.createStore({ backend: null });
  ok('backend reports memory', s.backend() === 'memory');
  ok('a missing key is null', s.get('nope') === null);
  ok('set returns true', s.set('doc', { a: 1, b: ['x'] }) === true);
  eq('get round-trips an object', s.get('doc'), { a: 1, b: ['x'] });
  ok('has is true after a set', s.has('doc') === true);
  ok('has is false before a set', s.has('never') === false);
  s.remove('doc');
  ok('remove clears the key', s.get('doc') === null && s.has('doc') === false);
})();

(function () {
  var backing = { a: '1', b: '2' };
  var ls = {
    store: backing,
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(backing, k) ? backing[k] : null; },
    setItem: function (k, v) { backing[k] = String(v); },
    removeItem: function (k) { delete backing[k]; },
    key: function (i) { var ks = Object.keys(backing); return ks[i] || null; },
    get length() { return Object.keys(backing).length; }
  };
  var s = Store.createStore({ backend: ls, prefix: 'test.' });
  s.set('one', 1);
  s.set('two', 2);
  ok('the storage backend is used', s.backend() === 'localStorage' && backing['test.one'] === '1');
  s.clear();
  ok('clear removes prefixed keys', backing['test.one'] === undefined && backing['test.two'] === undefined);
  ok('clear leaves foreign keys alone', backing.a === '1' && backing.b === '2');
})();

(function () {
  var backing = { 'opencom.bad': '{not json' };
  var ls = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(backing, k) ? backing[k] : null; },
    setItem: function (k, v) { backing[k] = String(v); },
    removeItem: function (k) { delete backing[k]; },
    key: function () { return null; },
    get length() { return 0; }
  };
  var s = Store.createStore({ backend: ls, prefix: 'opencom.' });
  ok('a corrupt payload reads back as null', s.get('bad') === null);
  ok('but a corrupt payload is still present', s.has('bad') === true);
})();

/* ---------------------------- convos: core ------------------------- */

banner('conversations');

(function () {
  var c = Convos.newConversation({ contactName: '  Ada Lovelace  ' });
  eq('names are trimmed', c.contactName, 'Ada Lovelace');
  eq('a new thread defaults to open', c.status, 'open');
  eq('a new thread starts with no tags', c.tags, []);
  ok('a new thread has no first response yet', c.firstResponseAt === null);
  ok('a new thread has no closed stamp', c.closedAt === null);
  eq('the subject falls back when absent', c.subject, 'New conversation');
  eq('a bare conversation has no messages', c.messages.length, 0);
  ok('ids are namespaced', /^c_/.test(c.id));
})();

throws('a conversation requires a contact name',
  function () { Convos.newConversation({ contactName: '' }); }, 'contactName');
throws('a conversation refuses a missing name',
  function () { Convos.newConversation({}); }, 'contactName');

(function () {
  var c = Convos.newConversation({
    contactName: 'Ada',
    contactEmail: 'ada@example.com',
    subject: 'Hello there',
    body: 'Can you **help** me?',
    at: iso(2026, 3, 2, 9, 30)
  });
  eq('the opening message is seeded', c.messages.length, 1);
  eq('the opening message is from the customer', c.messages[0].author, 'customer');
  eq('an explicit subject is honoured', c.subject, 'Hello there');
  eq('createdAt comes from the opening message', c.createdAt, iso(2026, 3, 2, 9, 30));
  eq('updatedAt starts equal to createdAt', c.updatedAt, c.createdAt);
  eq('the contact email is stored', c.contactEmail, 'ada@example.com');

  var tagged = Convos.newConversation({ contactName: 'B', tags: [' Billing ', 'billing', 'bug'] });
  eq('tags are normalised and de-duplicated', tagged.tags, ['billing', 'bug']);
})();

banner('messages');

(function () {
  var original = Convos.newConversation({ contactName: 'Ada', body: 'One', at: iso(2026, 3, 2, 9, 0) });
  var grown = Convos.appendMessage(original, { author: 'agent', body: 'Two' }, iso(2026, 3, 2, 9, 5));
  var chained = Convos.appendMessage(grown, { author: 'customer', body: 'Three' }, iso(2026, 3, 2, 9, 9));
  eq('messages stay in arrival order',
    chained.messages.map(function (m) { return m.body; }), ['One', 'Two', 'Three']);
  eq('updatedAt follows the newest message', chained.updatedAt, iso(2026, 3, 2, 9, 9));
  ok('the source conversation is not mutated', original.messages.length === 1 && grown.messages.length === 2);
  ok('the messages array is copied, not shared', original.messages !== grown.messages);
  eq('the agent role is recorded', grown.messages[1].author, 'agent');
  eq('an agent reply defaults to "Agent"', grown.messages[1].authorName, 'Agent');
  eq('a customer reply defaults to the contact name', chained.messages[2].authorName, 'Ada');
  throws('an empty reply is refused',
    function () { Convos.appendMessage(chained, { author: 'agent', body: '   ' }, iso(2026, 3, 2, 9, 10)); },
    'message.body');
  throws('you cannot reply to a broken object',
    function () { Convos.appendMessage(null, { author: 'agent', body: 'x' }); }, 'not a conversation');
})();

(function () {
  var c = Convos.newConversation({ contactName: 'Ada', body: 'Hi', at: iso(2026, 3, 2, 9, 0) });
  c = Convos.appendMessage(c, { author: 'agent', body: 'Reply one' }, iso(2026, 3, 2, 10, 0));
  eq('the first agent reply stamps firstResponseAt', c.firstResponseAt, iso(2026, 3, 2, 10, 0));
  var first = c.firstResponseAt;
  c = Convos.appendMessage(c, { author: 'agent', body: 'Reply two' }, iso(2026, 3, 2, 12, 0));
  eq('a later reply does not move firstResponseAt', c.firstResponseAt, first);
  ok('firstResponseHours is exact to the hour', Math.abs(Convos.firstResponseHours(c) - 1) < 1e-9);
  var unanswered = Convos.newConversation({ contactName: 'Ada' });
  eq('an unanswered thread yields no duration', Convos.firstResponseHours(unanswered), null);
  eq('a clock that runs backwards is rejected', Convos.firstResponseHours({
    createdAt: iso(2026, 3, 2, 12, 0), firstResponseAt: iso(2026, 3, 2, 9, 0)
  }), null);
})();

(function () {
  var c = Convos.newConversation({ contactName: 'Ada', body: 'Still stuck', at: iso(2026, 3, 2, 9, 0) });
  c = Convos.appendMessage(c, { author: 'agent', body: 'Look at it' }, iso(2026, 3, 2, 9, 5));
  c = Convos.setStatus(c, 'closed', iso(2026, 3, 2, 10, 0));
  eq('the conversation is closed', c.status, 'closed');
  c = Convos.appendMessage(c, { author: 'customer', body: 'Actually not fixed' }, iso(2026, 3, 2, 11, 0));
  eq('a customer reply reopens a closed thread', c.status, 'open');
  ok('reopening clears the closed stamp', c.closedAt === null);
})();

banner('status');

(function () {
  var c = Convos.newConversation({ contactName: 'Ada', body: 'x', at: iso(2026, 3, 2, 9, 0) });
  eq('open may move to pending', Convos.setStatus(c, 'pending', iso(2026, 3, 2, 9, 1)).status, 'pending');
  eq('pending may move to closed',
    Convos.setStatus(Convos.setStatus(c, 'pending', iso(2026, 3, 2, 9, 1)), 'closed', iso(2026, 3, 2, 9, 2)).status,
    'closed');
  eq('open may close directly', Convos.setStatus(c, 'closed', iso(2026, 3, 2, 9, 1)).status, 'closed');
  eq('moving to the same status is a no-op',
    Convos.setStatus(c, 'open', iso(2026, 3, 2, 9, 1)), c);
  throws('an unknown status is rejected', function () { Convos.setStatus(c, 'archived'); }, 'unknown status');

  var closed = Convos.setStatus(c, 'closed', iso(2026, 3, 2, 9, 1));
  throws('a closed thread cannot go pending',
    function () { Convos.setStatus(closed, 'pending'); }, 'cannot move');
  eq('closing stamps closedAt', Convos.setStatus(c, 'closed', iso(2026, 3, 2, 9, 1)).closedAt, iso(2026, 3, 2, 9, 1));
  eq('reopening clears closedAt',
    Convos.setStatus(closed, 'open', iso(2026, 3, 2, 9, 2)).closedAt, null);
  eq('open offers three destinations', Convos.allowedStatuses(c).length, 3);
  eq('closed offers two destinations', Convos.allowedStatuses(closed).length, 2);
  eq('a status change moves updatedAt',
    Convos.setStatus(c, 'pending', iso(2026, 3, 2, 13, 0)).updatedAt, iso(2026, 3, 2, 13, 0));
})();

banner('tags & assignment');

(function () {
  var c = Convos.newConversation({ contactName: 'Ada' });
  c = Convos.addTag(c, 'Billing');
  eq('a tag is added normalised', c.tags, ['billing']);
  eq('adding the same tag twice is a no-op', Convos.addTag(c, 'billing').tags, ['billing']);
  c = Convos.addTag(c, 'bug');
  eq('a second tag joins the list', c.tags, ['billing', 'bug']);
  var thinned = Convos.removeTag(c, 'bug');
  eq('removing one leaves the rest', thinned.tags, ['billing']);
  eq('removing a missing tag is safe', Convos.removeTag(thinned, 'nope').tags, ['billing']);
  eq('removeTag does not mutate the source', c.tags, ['billing', 'bug']);
  throws('a blank tag is refused', function () { Convos.addTag(c, '   '); }, 'tag');
  eq('normalise collapses inner whitespace to a dash', Convos.normalizeTag('  billing inquiries  '), 'billing-inquiries');
  eq('normalise rejects empty strings', Convos.normalizeTag(''), null);
  eq('normalise rejects non-strings', Convos.normalizeTag(42), null);
})();

(function () {
  var doc = Convos.emptyDocument();
  var c = Convos.newConversation({ contactName: 'Ada' });
  eq('an assignee is stored', Convos.setAssignee(c, 'ag_ben').assigneeId, 'ag_ben');
  eq('unassigning clears it', Convos.setAssignee(c, null).assigneeId, null);
  eq('an unassigned thread has none', c.assigneeId, null);
  eq('the roster resolves a name', Convos.agentName(doc, 'ag_cara'), 'Cara');
  eq('an unknown id resolves to null', Convos.agentName(doc, 'ag_nope'), null);
  eq('two initials come from first and last', Convos.initials('Ada Lovelace'), 'AL');
  eq('one initial comes from the whole name', Convos.initials('Ada'), 'AD');
  eq('blank names yield a placeholder', Convos.initials('   '), '?');
})();

banner('filtering');

(function () {
  function mk(name, subject, status, tags, activityAt, bodies) {
    var c = Convos.newConversation({ contactName: name, subject: subject, at: iso(2026, 3, 10, 9, 0) });
    tags.forEach(function (t) { c = Convos.addTag(c, t); });
    bodies.forEach(function (b) {
      c = Convos.appendMessage(c, { author: 'agent', body: b }, activityAt);
    });
    return Convos.setStatus(c, status, activityAt);
  }
  var list = [
    mk('Ada', 'Invoice problem', 'open', ['billing'], iso(2026, 3, 20, 8, 0), ['refunded the invoice']),
    mk('Ben', 'Safari bug', 'open', ['bug'], iso(2026, 3, 19, 8, 0), ['blank file export']),
    mk('Cara', 'Onboarding help', 'pending', ['onboarding'], iso(2026, 3, 15, 8, 0), ['sandbox key']),
    mk('Dev', 'Login loop', 'closed', ['bug'], iso(2026, 3, 12, 8, 0), ['fixed and closed'])
  ];

  eq('a status filter narrows the list', Convos.filterConversations(list, { status: 'open' }).length, 2);
  eq('an "all" status filter keeps everything', Convos.filterConversations(list, { status: 'all' }).length, 4);
  eq('a tag filter narrows the list', Convos.filterConversations(list, { tag: 'bug' }).length, 2);
  eq('search matches contact names',
    Convos.filterConversations(list, { search: 'ben' }).map(function (c) { return c.contactName; }), ['Ben']);
  eq('search matches subjects',
    Convos.filterConversations(list, { search: 'Invoice' }).map(function (c) { return c.contactName; }), ['Ada']);
  eq('search reaches into message bodies',
    Convos.filterConversations(list, { search: 'sandbox' }).map(function (c) { return c.contactName; }), ['Cara']);
  ok('search ignores case', Convos.filterConversations(list, { search: 'SANDBOX' }).length === 1);
  eq('an unmatched search is empty', Convos.filterConversations(list, { search: 'zzzz' }).length, 0);
  eq('filters compose', Convos.filterConversations(list, { status: 'open', tag: 'bug' }).length, 1);

  eq('newest orders by recent activity',
    Convos.filterConversations(list, { sort: 'newest' }).map(function (c) { return c.contactName; }),
    ['Ada', 'Ben', 'Cara', 'Dev']);
  eq('oldest reverses it',
    Convos.filterConversations(list, { sort: 'oldest' }).map(function (c) { return c.contactName; }),
    ['Dev', 'Cara', 'Ben', 'Ada']);
  eq('filtering does not mutate the input', list.length, 4);
  ok('filtering returns a fresh array', Convos.filterConversations(list) !== list);
  eq('filtering an empty list is empty', Convos.filterConversations([], { search: 'x' }).length, 0);
})();

banner('macros');

eq('six realistic default seeds ship', Convos.DEFAULT_MACRO_SEEDS.length, 6);
eq('the seeds cover the expected set',
  Convos.DEFAULT_MACRO_SEEDS.map(function (m) { return m.title; }),
  ['Greeting', 'ETA', 'Billing question', 'Apology', 'Escalation', 'Closing']);

(function () {
  var macros = Convos.defaultMacros();
  eq('default macros are materialised', macros.length, 6);
  eq('each macro has a unique id',
    macros.filter(function (m, i) {
      return macros.findIndex(function (x) { return x.id === m.id; }) === i;
    }).length, 6);
  ok('each macro has a real body',
    macros.every(function (m) { return typeof m.body === 'string' && m.body.length > 40; }));
  eq('each macro is dated', macros.filter(function (m) { return typeof m.createdAt === 'string'; }).length, 6);
})();

throws('a macro needs a title', function () { Convos.newMacro('', 'body'); }, 'title');
throws('a macro needs a body', function () { Convos.newMacro('T', '  '); }, 'body');

(function () {
  var m = Convos.newMacro('Greeting', 'Hi there!');
  eq('inserting into an empty draft', Convos.insertMacroAt('', 0, m), 'Hi there!');
  eq('inserting at the start separates with a newline',
    Convos.insertMacroAt('and more', 0, m), 'Hi there!\nand more');
  eq('inserting at the end separates with a newline',
    Convos.insertMacroAt('thanks,', 7, m), 'thanks,\nHi there!');
  eq('a cursor past the end clamps', Convos.insertMacroAt('ab', 99, m), 'ab\nHi there!');
  eq('inserting mid-draft splits both sides',
    Convos.insertMacroAt('abcd', 2, m), 'ab\nHi there!\ncd');
  eq('inserting with no cursor puts it at the end',
    Convos.insertMacroAt('ab cd', undefined, m), 'ab cd\nHi there!');
  var updated = Convos.updateMacro(m, { title: '  Greetings  ' });
  eq('updating trims the title', updated.title, 'Greetings');
  eq('updating keeps the body', updated.body, 'Hi there!');
  eq('updating leaves the original intact', m.title, 'Greeting');
  throws('updating with a blank body is refused',
    function () { Convos.updateMacro(m, { body: '  ' }); }, 'body');
  throws('updating with a blank title is refused',
    function () { Convos.updateMacro(m, { title: '  ' }); }, 'title');
  throws('updating a non-macro is refused',
    function () { Convos.updateMacro(null, { title: 'x' }); }, 'not a macro');
})();

(function () {
  var macros = Convos.defaultMacros();
  eq('an empty query returns everything', Convos.findMacros(macros, '').length, 6);
  eq('find matches titles', Convos.findMacros(macros, 'apolog').map(function (m) { return m.title; }), ['Apology']);
  eq('find matches bodies', Convos.findMacros(macros, 'refund').length, 1);
  eq('find is case-insensitive', Convos.findMacros(macros, 'BILLING').length, 1);
  eq('find returns nothing for nonsense', Convos.findMacros(macros, 'zzzzz').length, 0);
  eq('find tolerates a missing list', Convos.findMacros(null, 'x').length, 0);
  throws('inserting a broken macro is refused', function () { Convos.insertMacroAt('x', 0, {}); }, 'macro.body');
})();

banner('presentation helpers');

(function () {
  var c = Convos.newConversation({
    contactName: 'Ada',
    body: 'Please **fix** the [export button](https://example.com) which is `broken`.'
  });
  var s = Convos.snippet(c);
  ok('a snippet drops bold markers', s.indexOf('**') === -1);
  ok('a snippet reduces links to their text',
    s.indexOf('export button') !== -1 && s.indexOf('https://') === -1);
  ok('a snippet drops code markers', s.indexOf('`') === -1);
  ok('a snippet collapses whitespace', /\s{2,}/.test(s) === false);
  eq('a snippet truncates to the limit', Convos.snippet(c, 10).length, 10);
  ok('truncation ends with an ellipsis', Convos.snippet(c, 10).slice(-1) === '…');
  eq('an empty thread gets a placeholder', Convos.snippet(Convos.newConversation({ contactName: 'A' })), 'No messages yet');
  eq('stripMarkdown unwraps quotes and list markers',
    Convos.stripMarkdown('> hello\n- one\n- two'), 'hello one two');
  eq('stripMarkdown drops headings and rules',
    Convos.stripMarkdown('## Title\n---\nbody'), 'Title body');
  eq('stripMarkdown survives non-strings', Convos.stripMarkdown(null), '');
})();

(function () {
  var now = iso(2026, 3, 20, 12, 0);
  eq('a fresh event is "just now"', Convos.timeAgo(now, now), 'just now');
  eq('minutes', Convos.timeAgo(iso(2026, 3, 20, 11, 55), now), '5m ago');
  eq('hours', Convos.timeAgo(iso(2026, 3, 20, 9, 0), now), '3h ago');
  eq('days', Convos.timeAgo(iso(2026, 3, 17, 12, 0), now), '3d ago');
  eq('weeks', Convos.timeAgo(iso(2026, 3, 5, 12, 0), now), '2w ago');
  eq('months', Convos.timeAgo(iso(2026, 1, 5, 12, 0), now), '2mo ago');
  eq('a future timestamp is "just now"', Convos.timeAgo(iso(2026, 3, 21, 0, 0), now), 'just now');
  eq('garbage yields an empty string', Convos.timeAgo('not a date', now), '');
})();

(function () {
  var doc = Convos.emptyDocument();
  doc.conversations = [
    Convos.addTag(Convos.newConversation({ contactName: 'A' }), 'billing'),
    Convos.newConversation({ contactName: 'B' })
  ];
  eq('tagUniverse merges declared and used tags',
    Convos.tagUniverse(doc), ['account', 'billing', 'bug', 'escalation', 'feature', 'onboarding']);
  eq('tagUniverse de-duplicates', Convos.tagUniverse({ tags: ['a', 'a'], conversations: [] }), ['a']);
  eq('tagUniverse handles a null document', Convos.tagUniverse(null), []);
  eq('tagUniverse picks up tags only conversations use',
    Convos.tagUniverse({ tags: [], conversations: [{ tags: ['urgent'] }] }), ['urgent']);
})();

/* ------------------------------- stats ----------------------------- */

banner('stats');

eq('the median of an odd count', Stats.median([3, 1, 2]), 2);
eq('the median of an even count', Stats.median([4, 1, 3, 2]), 2.5);
eq('the median of nothing is zero', Stats.median([]), 0);
eq('the median ignores non-numbers', Stats.median([2, null, 'x', 4]), 3);
eq('the median is order-independent', Stats.median([9, 1, 5]), 5);
ok('startOfWeek lands on a Monday', Stats.startOfWeek(iso(2026, 3, 20)).getDay() === 1);
eq('startOfWeek walks back from a Sunday',
  Stats.startOfWeek(iso(2026, 3, 22)).getDay(), 1);
ok('startOfDay zeroes the clock', Stats.startOfDay(iso(2026, 3, 20, 23, 59)).getHours() === 0);
ok('sameDay is day-granular', Stats.sameDay(iso(2026, 3, 20, 1, 0), iso(2026, 3, 20, 23, 0)) === true);
ok('sameDay rejects different days', Stats.sameDay(iso(2026, 3, 20), iso(2026, 3, 21)) === false);

(function () {
  var doc = Convos.demoDocument();
  var s = Stats.computeStats(doc);
  eq('the demo inbox has ten conversations', s.total, 10);
  eq('four are open', s.open, 4);
  eq('three are pending', s.pending, 3);
  eq('three are closed', s.closed, 3);
  eq('nine have been answered', s.answered, 9);
  eq('one is still waiting on a first reply', s.unanswered, 1);
  ok('the median first response is a real positive number',
    typeof s.medianFirstResponseHours === 'number' && s.medianFirstResponseHours > 0);
  eq('message counts are real', s.totalMessages,
    doc.conversations.reduce(function (n, c) { return n + c.messages.length; }, 0));
  eq('the tag distribution covers six tags', s.byTag.length, 6);
  eq('the most common tag is billing', s.byTag[0].tag, 'billing');
  eq('billing appears on three threads', s.byTag[0].count, 3);
  eq('bug ties at three threads', s.byTag[1].count, 3);
  eq('tag counts are per conversation, not per message',
    s.byTag.reduce(function (n, t) { return n + t.count; }, 0),
    doc.conversations.reduce(function (n, c) { return n + (c.tags ? c.tags.length : 0); }, 0));
  eq('the distribution honours a limit', Stats.tagDistribution(doc, 2).length, 2);
  eq('an empty inbox reports zeros', Stats.computeStats({ conversations: [] }).total, 0);
  eq('an empty inbox has a zero median', Stats.computeStats({ conversations: [] }).medianFirstResponseHours, 0);
})();

(function () {
  var today = new Date();
  function stamp(date, hour) {
    var x = new Date(date);
    x.setHours(hour, 0, 0, 0);
    return Convos.toISO(x);
  }
  var yesterday = Date.now() - 86400000;
  var older = Convos.setStatus(
    Convos.newConversation({ contactName: 'Older', body: 'x', at: stamp(yesterday - 86400000, 8) }),
    'closed', stamp(yesterday, 10));
  var todayClosed = Convos.setStatus(
    Convos.newConversation({ contactName: 'Today', body: 'x', at: stamp(today, 9) }),
    'closed', stamp(today, 11));
  var stillOpen = Convos.newConversation({ contactName: 'Open', body: 'x' });
  var doc = { conversations: [older, todayClosed, stillOpen] };
  var s = Stats.computeStats(doc);
  eq('only today\'s closure counts', s.closedToday, 1);
  eq('both new threads count for the week',
    Stats.computeStats({ conversations: [todayClosed, stillOpen] }).conversationsThisWeek, 2);
  eq('one thread is open', s.open, 1);
  var series = Stats.weeklySeries({ conversations: [todayClosed] }, 4);
  eq('weeklySeries returns one bucket per week', series.length, 4);
  eq('weeklySeries is oldest first', series[0].week.getTime() < series[3].week.getTime(), true);
  eq('the current week holds the conversation', series[3].count, 1);
  eq('the older buckets are empty', series[0].count + series[1].count + series[2].count, 0);
})();

(function () {
  var doc = Convos.demoDocument();
  var hours = doc.conversations.map(Convos.firstResponseHours).filter(function (h) { return h !== null; });
  eq('every answered thread yields a duration', hours.length, 9);
  ok('all durations are sane (0–48 hours)',
    hours.every(function (h) { return h > 0 && h < 48; }));
  eq('the dashboard median matches the plain median',
    Stats.computeStats(doc).medianFirstResponseHours, Stats.median(hours));
  eq('follow-ups are counted where the customer last spoke',
    Stats.computeStats(doc).needsFollowUp > 0, true);
})();

/* -------------------------------- csv ------------------------------ */

banner('csv');

eq('a plain field is untouched', CSV.escapeField('hello'), 'hello');
eq('a comma forces quoting', CSV.escapeField('a,b'), '"a,b"');
eq('quotes are doubled', CSV.escapeField('say "hi"'), '"say ""hi"""');
eq('a newline forces quoting', CSV.escapeField('line1\nline2'), '"line1\nline2"');
eq('a carriage return forces quoting', CSV.escapeField('a\rb'), '"a\rb"');
eq('null and empty both become empty', CSV.escapeField(null) + CSV.escapeField(''), '');
eq('numbers stringify', CSV.escapeField(42), '42');

(function () {
  var rows = [{ a: 1, b: 'x,y' }, { a: 2, b: 'q"z' }];
  eq('toCSV writes a header and a trailing newline',
    CSV.toCSV(rows, ['a', 'b']), 'a,b\n1,"x,y"\n2,"q""z"\n');
  eq('parseCSV splits quoted commas',
    CSV.parseCSV('a,b\n1,"x,y"\n'), [['a', 'b'], ['1', 'x,y']]);
  eq('parseCSV unescapes doubled quotes',
    CSV.parseCSV('a\n"say ""hi"""\n'), [['a'], ['say "hi"']]);
  eq('parseCSV keeps embedded newlines',
    CSV.parseCSV('a\n"l1\nl2"\n'), [['a'], ['l1\nl2']]);
  eq('parseCSV tolerates CRLF', CSV.parseCSV('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
  eq('a trailing terminator is not a phantom row', CSV.parseCSV('a,b\n1,2\n').length, 2);
  eq('an empty string parses to nothing', CSV.parseCSV('').length, 0);
  eq('object rows round-trip through CSV',
    CSV.parseCSVRows(CSV.toCSV(rows, ['a', 'b'])).map(function (r) { return r.a + ':' + r.b; }),
    ['1:x,y', '2:q"z']);
  throws('object rows need a headers list', function () { CSV.toCSV([{ a: 1 }]); }, 'headers');
  throws('scalar rows are rejected', function () { CSV.toCSV([1, 2, 3]); }, 'array or object');
  eq('an empty row set is an empty string', CSV.toCSV([]), '');
  eq('toLocalISO stamps local time', CSV.toLocalISO(iso(2026, 3, 2, 9, 30)), iso(2026, 3, 2, 9, 30));
})();

(function () {
  var doc = Convos.demoDocument();
  var rows = CSV.flattenConversations(doc);
  eq('one row per conversation', rows.length, 10);
  eq('the headers are documented', CSV.CONVERSATION_HEADERS,
    ['id', 'contact_name', 'contact_email', 'subject', 'status', 'tags', 'assignee',
     'created_at', 'updated_at', 'first_response_at', 'closed_at',
     'message_count', 'last_message', 'last_message_at']);
  eq('the row carries the contact', rows[0].contact_name, 'Priya Raman');
  eq('tags are space-joined', rows[0].tags, 'billing');
  eq('the assignee resolves to a name', rows[0].assignee, 'Ada');
  eq('the message count is correct', rows[0].message_count, 3);
  eq('the last message is inlined', rows[0].last_message.indexOf('tax line') !== -1, true);
  eq('a closed conversation keeps its stamp', rows[5].closed_at !== '' && rows[5].status === 'closed', true);
  eq('an unanswered conversation has no first response', rows[1].first_response_at, '');
  eq('an unassigned conversation has a blank assignee', rows[1].assignee, '');

  var msgs = CSV.flattenMessages(doc);
  eq('one row per message', msgs.length,
    doc.conversations.reduce(function (n, c) { return n + c.messages.length; }, 0));
  eq('messages keep thread order', msgs[0].body.indexOf('charged twice') !== -1, true);
  eq('message rows are keyed to their conversation', msgs[0].conversation_id, rows[0].id);
  eq('message rows carry the contact', msgs[0].contact_name, 'Priya Raman');
})();

(function () {
  var doc = Convos.demoDocument();
  var round = CSV.parseCSVRows(CSV.conversationsToCSV(doc));
  eq('the conversation CSV parses back to the same row count', round.length, 10);
  eq('a subject survives a CSV round trip', round[0].subject, doc.conversations[0].subject);
  ok('markdown-heavy bodies survive a CSV round trip',
    CSV.parseCSVRows(CSV.messagesToCSV(doc)).some(function (r) {
      return r.body.indexOf('**charged twice**') !== -1;
    }));

  var multi = Convos.demoDocument();
  multi.conversations[0] = Convos.appendMessage(
    multi.conversations[0],
    { author: 'agent', body: 'Line one\nLine two, with a comma and "quotes"' },
    iso(2026, 3, 21, 9, 0));
  var multiRound = CSV.parseCSVRows(CSV.conversationsToCSV(multi));
  eq('a multiline body with commas and quotes survives intact',
    multiRound[0].last_message, 'Line one\nLine two, with a comma and "quotes"');

  var mtext = CSV.messagesToCSV(doc);
  eq('the message CSV has one data row per message', CSV.parseCSVRows(mtext).length,
    doc.conversations.reduce(function (n, c) { return n + c.messages.length; }, 0));
  eq('messagesToCSV starts with its headers', mtext.split('\n')[0], CSV.MESSAGE_HEADERS.join(','));
})();

/* --------------------------- document IO --------------------------- */

banner('export / import');

(function () {
  var doc = Convos.demoDocument();
  var json = CSV.exportDocument(doc);
  var parsed = JSON.parse(json);
  eq('the export is valid JSON at the current version', parsed.version, CSV.SCHEMA_VERSION);
  eq('the export stamps when it was made',
    !isNaN(new Date(parsed.exportedAt).getTime()), true);
  eq('the export keeps every conversation', parsed.conversations.length, 10);
  eq('the export keeps macros, agents and tags',
    [parsed.macros.length, parsed.agents.length, parsed.tags.length], [6, 4, 6]);

  var back = CSV.importDocument(json);
  eq('the import restores every conversation', back.conversations.length, 10);
  eq('the import restores the macros', back.macros.length, 6);
  eq('the import restores the roster', back.agents.length, 4);
  eq('the import restores the tag palette', back.tags.length, 6);
  eq('conversation ids survive the round trip',
    back.conversations.map(function (c) { return c.id; }),
    doc.conversations.map(function (c) { return c.id; }));
  eq('message bodies survive the round trip',
    back.conversations[0].messages.map(function (m) { return m.body; }),
    doc.conversations[0].messages.map(function (m) { return m.body; }));
  eq('tag order survives the round trip', back.conversations[8].tags, ['escalation', 'bug']);
  eq('status survives the round trip',
    back.conversations.map(function (c) { return c.status; }),
    doc.conversations.map(function (c) { return c.status; }));
  eq('firstResponseAt survives the round trip', back.conversations[8].firstResponseAt !== null, true);
  eq('an import recomputes the answer counts', Stats.computeStats(back).answered, 9);
  eq('stats still work after an import', Stats.computeStats(back).total, 10);
  eq('the imported doc re-exports to the same shape',
    CSV.parseCSVRows(CSV.conversationsToCSV(back)).length, 10);
})();

throws('importing garbage is refused', function () { CSV.importDocument('{nope'); }, 'not valid JSON');
throws('importing an array is refused', function () { CSV.importDocument('[]'); }, 'JSON object');
throws('importing a file without a version is refused',
  function () { CSV.importDocument('{"conversations":[]}'); }, 'version');
throws('importing a newer schema is refused', function () {
  CSV.importDocument(JSON.stringify({ version: 99, conversations: [] }));
}, 'newer version');
throws('importing without conversations is refused',
  function () { CSV.importDocument(JSON.stringify({ version: 1 })); }, 'conversations');
throws('exporting a non-document is refused',
  function () { CSV.exportDocument(null); }, 'not a document');

(function () {
  var doc = Convos.demoDocument();
  var rows = CSV.rowsToConversations(CSV.conversationsToCSV(doc));
  eq('spreadsheet rows rebuild conversations', rows.length, 10);
  eq('a rebuilt conversation keeps its subject', rows[0].subject, doc.conversations[0].subject);
  eq('rebuilt tags are restored', rows[8].tags, ['escalation', 'bug']);
  eq('rebuilt status is restored', rows[5].status, 'closed');
  eq('rebuilt ids are restored', rows[0].id, doc.conversations[0].id);
  eq('the rebuilt last message is kept', rows[0].messages[0].body.indexOf('tax line') !== -1, true);
  eq('the first response clock is carried over', rows[0].firstResponseAt !== null, true);
})();

/* ------------------------- seed data quality ----------------------- */

banner('seed data');

(function () {
  var doc = Convos.emptyDocument();
  eq('an empty inbox has no conversations', doc.conversations.length, 0);
  eq('but it ships the macros', doc.macros.length, 6);
  eq('and a roster of agents', doc.agents.length, 4);
  eq('and a palette of tags', doc.tags.length, 6);
  eq('and a schema version', doc.version, Convos.SCHEMA_VERSION);
  eq('agents have ids and names', doc.agents.every(function (a) { return a.id && a.name; }), true);
})();

(function () {
  var doc = Convos.demoDocument();
  eq('the demo seeds ten conversations', doc.conversations.length, 10);
  eq('every demo conversation has a contact and a subject',
    doc.conversations.every(function (c) { return c.contactName && c.subject; }), true);
  eq('every demo conversation has at least one message',
    doc.conversations.every(function (c) { return c.messages.length >= 1; }), true);
  eq('the demo spans every status',
    ['open', 'pending', 'closed'].map(function (s) {
      return doc.conversations.some(function (c) { return c.status === s; });
    }), [true, true, true]);
  eq('every thread but one carries a conversation',
    doc.conversations.filter(function (c) { return c.messages.length >= 2; }).length, 9);
  eq('conversation ids are unique',
    doc.conversations.map(function (c) { return c.id; }).filter(function (id, i, a) {
      return a.indexOf(id) === i;
    }).length, 10);
  var msgIds = doc.conversations.reduce(function (acc, c) {
    return acc.concat(c.messages.map(function (m) { return m.id; }));
  }, []);
  eq('message ids are unique across threads',
    msgIds.filter(function (id, i, a) { return a.indexOf(id) === i; }).length, msgIds.length);
  eq('every thread is internally ordered',
    doc.conversations.every(function (c) {
      for (var i = 1; i < c.messages.length; i++) {
        if (Convos.fromISO(c.messages[i].at) < Convos.fromISO(c.messages[i - 1].at)) { return false; }
      }
      return true;
    }), true);
  eq('updatedAt is always the newest message',
    doc.conversations.every(function (c) { return c.updatedAt === c.messages[c.messages.length - 1].at; }), true);
  eq('assignees exist in the roster',
    doc.conversations.every(function (c) {
      return !c.assigneeId || doc.agents.some(function (a) { return a.id === c.assigneeId; });
    }), true);
  eq('tags exist in the palette',
    doc.conversations.every(function (c) {
      return (c.tags || []).every(function (t) { return doc.tags.indexOf(t) !== -1; });
    }), true);
  eq('agent messages always follow a customer message',
    doc.conversations.every(function (c) {
      var seen = false;
      for (var i = 0; i < c.messages.length; i++) {
        if (c.messages[i].author === 'agent' && !seen) { return false; }
        if (c.messages[i].author === 'customer') { seen = true; }
      }
      return true;
    }), true);
  eq('the demo has markdown worth rendering',
    doc.conversations.some(function (c) {
      return c.messages.some(function (m) { return /\*\*|`|\[/.test(m.body); });
    }), true);
  eq('the demo has a waiting thread for the unanswered metric',
    doc.conversations.filter(function (c) { return !c.firstResponseAt; }).length, 1);
  ok('two demo runs produce different ids',
    Convos.demoDocument().conversations[0].id !== Convos.demoDocument().conversations[0].id);
})();

/* --------------------- browser path (no module) -------------------- */

banner('browser path (no module / no require)');

(function () {
  var sandbox = {};
  ['js/store.js', 'js/convos.js', 'js/stats.js', 'js/csv.js'].forEach(function (rel) {
    var code = fs.readFileSync(path.join(__dirname, rel), 'utf8');
    vm.runInNewContext(code, { self: sandbox, window: sandbox, console: console }, { filename: rel });
  });
  ok('store exposes a browser global', typeof sandbox.ComStore === 'object');
  ok('convos exposes a browser global', typeof sandbox.ComConvos === 'object');
  ok('stats exposes a browser global', typeof sandbox.ComStats === 'object');
  ok('csv exposes a browser global', typeof sandbox.ComCSV === 'object');
  eq('the browser convos module is functional', sandbox.ComConvos.DEFAULT_MACRO_SEEDS.length, 6);
  eq('the browser csv module matches the Node module',
    Object.keys(sandbox.ComCSV).length, Object.keys(CSV).length);
  var doc = sandbox.ComConvos.demoDocument();
  var round = sandbox.ComCSV.importDocument(sandbox.ComCSV.exportDocument(doc));
  eq('export/import works on the browser path', round.conversations.length, 10);
  eq('stats work on the browser path', sandbox.ComStats.computeStats(round).total, 10);
  eq('csv flattening works on the browser path', sandbox.ComCSV.flattenConversations(round).length, 10);
  eq('the browser path resolves the shared normaliser',
    sandbox.ComCSV.importDocument(sandbox.ComCSV.exportDocument(doc)).conversations[0].messages.length, 3);
  var store = sandbox.ComStore.createStore({ backend: null });
  eq('the browser store round-trips', store.set('document', { a: 1 }) && store.get('document'), { a: 1 });
})();

/* ------------------------------- report ---------------------------- */

console.log('\n============================================================');
if (failed === 0) {
  console.log('PASS  ' + passed + '/' + passed + ' assertions passed, 0 failed');
} else {
  console.log('FAIL  ' + passed + ' passed, ' + failed + ' failed of ' + (passed + failed));
  failures.forEach(function (f) { console.log('  x ' + f); });
}
console.log('============================================================');
process.exit(failed === 0 ? 0 : 1);
