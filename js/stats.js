/* ------------------------------------------------------------------ *
 * Opencom — dashboard metrics
 *
 * Pure logic. Every number here is computed from the conversation data;
 * nothing is defaulted, so an empty inbox honestly reports zeros.
 * ------------------------------------------------------------------ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ComStats = factory();
  }
})(typeof self !== 'undefined' ? self : global, function () {
  'use strict';

  var DAY_MS = 86400000;

  function toDate(value) {
    if (value instanceof Date) { return value; }
    if (typeof value === 'number' || typeof value === 'string') {
      var d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  /** Midnight, local time, in a new Date. */
  function startOfDay(value) {
    var d = toDate(value) || new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  /** Monday 00:00, local time, in a new Date. */
  function startOfWeek(value) {
    var d = startOfDay(value);
    var dow = d.getDay();            // 0 = Sunday .. 6 = Saturday
    var sinceMonday = dow === 0 ? 6 : dow - 1;
    d.setDate(d.getDate() - sinceMonday);
    return d;
  }

  function startOfMonth(value) {
    var d = startOfDay(value);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  function sameDay(a, b) {
    var x = toDate(a), y = toDate(b);
    if (!x || !y) { return false; }
    return x.getFullYear() === y.getFullYear()
        && x.getMonth() === y.getMonth()
        && x.getDate() === y.getDate();
  }

  /** Unbiased sample median. [] -> 0, odd n -> middle, even n -> mean of the pair. */
  function median(values) {
    var v = (Array.isArray(values) ? values : []).filter(function (n) {
      return typeof n === 'number' && isFinite(n);
    });
    if (!v.length) { return 0; }
    v.sort(function (a, b) { return a - b; });
    var mid = Math.floor(v.length / 2);
    return v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  }

  /** Hours from createdAt to firstResponseAt, or null when unanswered. */
  function firstResponseHours(conversation) {
    if (!conversation || !conversation.firstResponseAt) { return null; }
    var c = toDate(conversation.createdAt);
    var r = toDate(conversation.firstResponseAt);
    if (!c || !r) { return null; }
    var ms = r.getTime() - c.getTime();
    if (ms < 0) { return null; }
    return ms / 3600000;
  }

  function list(doc) {
    return doc && Array.isArray(doc.conversations) ? doc.conversations : [];
  }

  /** Distinct tag counts, most frequent first, ties alphabetical. */
  function tagDistribution(doc, limit) {
    var convos = list(doc);
    var counts = Object.create(null);
    for (var i = 0; i < convos.length; i++) {
      var tags = convos[i].tags || [];
      // Count each tag once per conversation, not once per message.
      var seen = Object.create(null);
      for (var j = 0; j < tags.length; j++) {
        var t = tags[j];
        if (!t || seen[t]) { continue; }
        seen[t] = true;
        counts[t] = (counts[t] || 0) + 1;
      }
    }
    var out = [];
    for (var name in counts) {
      if (Object.prototype.hasOwnProperty.call(counts, name)) {
        out.push({ tag: name, count: counts[name] });
      }
    }
    out.sort(function (a, b) {
      return b.count !== a.count ? b.count - a.count : a.tag < b.tag ? -1 : 1;
    });
    if (typeof limit === 'number' && limit > 0) { return out.slice(0, limit); }
    return out;
  }

  /**
   * The dashboard strip. All counts are real; medians are over the
   * conversations that actually have a first response.
   */
  function computeStats(doc, now) {
    var convos = list(doc);
    var ref = now ? (toDate(now) || new Date()) : new Date();
    var dayStart = startOfDay(ref).getTime();
    var weekStart = startOfWeek(ref).getTime();
    var monthStart = startOfMonth(ref).getTime();

    var open = 0, pending = 0, closed = 0, closedToday = 0;
    var thisWeek = 0, thisMonth = 0, answered = 0, unanswered = 0;
    var hrs = [];
    var needsFollowUp = 0;
    var totalMessages = 0;

    for (var i = 0; i < convos.length; i++) {
      var c = convos[i];
      if (c.status === 'open') { open++; }
      else if (c.status === 'pending') { pending++; }
      else if (c.status === 'closed') { closed++; }

      var updatedAt = toDate(c.updatedAt);
      if (c.status === 'closed' && c.closedAt && sameDay(c.closedAt, ref)) {
        closedToday++;
      } else if (c.status === 'closed' && !c.closedAt && updatedAt && updatedAt.getTime() >= dayStart) {
        closedToday++;
      }

      var createdAt = toDate(c.createdAt);
      if (createdAt) {
        if (createdAt.getTime() >= weekStart) { thisWeek++; }
        if (createdAt.getTime() >= monthStart) { thisMonth++; }
      }

      var h = firstResponseHours(c);
      if (h === null) { unanswered++; } else { answered++; hrs.push(h); }

      totalMessages += c.messages ? c.messages.length : 0;

      // Open threads nobody has answered yet are the ones at risk.
      var msgs = c.messages || [];
      var lastIsAgent = msgs.length > 0 && msgs[msgs.length - 1].author === 'agent';
      if (c.status === 'open' && !lastIsAgent && msgs.length > 0) { needsFollowUp++; }
    }

    return {
      total: convos.length,
      open: open,
      pending: pending,
      closed: closed,
      closedToday: closedToday,
      medianFirstResponseHours: median(hrs),
      answered: answered,
      unanswered: unanswered,
      conversationsThisWeek: thisWeek,
      conversationsThisMonth: thisMonth,
      needsFollowUp: needsFollowUp,
      totalMessages: totalMessages,
      byTag: tagDistribution(doc),
      asOf: ref
    };
  }

  /** Per-week conversation counts for the last `weeks` weeks, oldest first. */
  function weeklySeries(doc, weeks, now) {
    var convos = list(doc);
    var ref = now ? (toDate(now) || new Date()) : new Date();
    var current = startOfWeek(ref);
    var out = [];
    for (var i = weeks - 1; i >= 0; i--) {
      var ws = new Date(current.getFullYear(), current.getMonth(), current.getDate() - i * 7);
      var we = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + 7);
      var count = 0;
      for (var j = 0; j < convos.length; j++) {
        var c = toDate(convos[j].createdAt);
        if (c && c.getTime() >= ws.getTime() && c.getTime() < we.getTime()) { count++; }
      }
      out.push({ week: ws, count: count });
    }
    return out;
  }

  return {
    startOfDay: startOfDay,
    startOfWeek: startOfWeek,
    startOfMonth: startOfMonth,
    sameDay: sameDay,
    median: median,
    firstResponseHours: firstResponseHours,
    tagDistribution: tagDistribution,
    computeStats: computeStats,
    weeklySeries: weeklySeries,
    DAY_MS: DAY_MS
  };
});
