/* ------------------------------------------------------------------ *
 * Opencom — import / export
 *
 * JSON is the full document, the same shape the app stores. CSV flattens
 * the inbox into two spreadsheets: one row per conversation, one row per
 * message. Both follow RFC 4180: fields containing a comma, double
 * quote, or line break are quoted and internal quotes are doubled. LF
 * terminators, which every spreadsheet accepts.
 *
 * Pure functions, browser + Node.
 * ------------------------------------------------------------------ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(root);
  } else {
    root.ComCSV = factory(root);
  }
})(typeof self !== 'undefined' ? self : global, function (rootRef) {
  'use strict';

  var NEEDS_QUOTE = /["\n\r,]/;

  /* --------------------------- CSV primitives ------------------------ */

  function escapeField(value) {
    if (value === null || value === undefined) { return ''; }
    var s = typeof value === 'string' ? value : String(value);
    if (s.indexOf('"') === -1 && s.indexOf('\n') === -1
        && s.indexOf('\r') === -1 && s.indexOf(',') === -1) {
      return s;
    }
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function toCSV(rows, headers) {
    if (!rows || !rows.length) { return ''; }
    var lines = [];
    if (headers && headers.length) {
      lines.push(headers.map(escapeField).join(','));
    }
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var cells;
      if (Array.isArray(row)) {
        cells = row;
      } else if (row && typeof row === 'object') {
        if (!headers || !headers.length) {
          throw new TypeError('toCSV: object rows require a headers list');
        }
        cells = headers.map(function (h) { return row[h]; });
      } else {
        throw new TypeError('toCSV: row must be an array or object, got ' + typeof row);
      }
      lines.push(cells.map(escapeField).join(','));
    }
    return lines.join('\n') + '\n';
  }

  function parseCSV(text) {
    if (typeof text !== 'string' || text === '') { return []; }
    var rows = [], row = [], field = '', inQuotes = false;
    var i = 0, n = text.length;

    function endField() { row.push(field); field = ''; }
    function endRow() { endField(); rows.push(row); row = []; }

    while (i < n) {
      var c = text.charAt(i);
      if (inQuotes) {
        if (c === '"') {
          if (i + 1 < n && text.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') {
        if (field === '') { inQuotes = true; i++; continue; }
        field += c; i++; continue;
      }
      if (c === ',') { endField(); i++; continue; }
      if (c === '\r') {
        endRow(); i++;
        if (i < n && text.charAt(i) === '\n') { i++; }
        continue;
      }
      if (c === '\n') { endRow(); i++; continue; }
      field += c; i++;
    }
    if (field !== '' || row.length > 0) { endRow(); }
    return rows;
  }

  function parseCSVRows(text) {
    var rows = parseCSV(text);
    if (!rows.length) { return []; }
    var headers = rows[0];
    var out = [];
    for (var i = 1; i < rows.length; i++) {
      var obj = {};
      for (var j = 0; j < headers.length; j++) {
        obj[headers[j]] = j < rows[i].length ? rows[i][j] : '';
      }
      out.push(obj);
    }
    return out;
  }

  /* --------------------------- local ISO ----------------------------- */

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function toLocalISO(value) {
    var d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) { return ''; }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
           'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  /* --------------------------- document IO --------------------------- */

/* Shared normaliser: required under Node, looked up as a global in the
 * browser. csv.js is loaded after convos.js in index.html. */
  function convosModule() {
    if (typeof module === 'object' && module.exports
        && typeof require === 'function') {
      return require('./convos.js');
    }
    return rootRef && rootRef.ComConvos ? rootRef.ComConvos : null;
  }

  var SCHEMA_VERSION = 1;

  /** Serialise the whole inbox as pretty JSON. */
  function exportDocument(doc) {
    if (!doc || typeof doc !== 'object') {
      throw new TypeError('exportDocument: argument is not a document');
    }
    var payload = {
      version: SCHEMA_VERSION,
      exportedAt: toLocalISO(new Date()),
      conversations: Array.isArray(doc.conversations) ? doc.conversations : [],
      macros: Array.isArray(doc.macros) ? doc.macros : [],
      agents: Array.isArray(doc.agents) ? doc.agents : [],
      tags: Array.isArray(doc.tags) ? doc.tags : []
    };
    return JSON.stringify(payload, null, 2);
  }

  /**
   * Parse a JSON export back into a document. Rejects malformed input
   * with a message instead of guessing, and refuses newer schemas
   * rather than half-loading them.
   */
  function importDocument(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) {
      throw new Error('Import failed: that is not valid JSON');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Import failed: expected a JSON object at the top level');
    }
    if (typeof data.version !== 'number') {
      throw new Error('Import failed: the file has no version field');
    }
    if (data.version > SCHEMA_VERSION) {
      throw new Error('Import failed: this file was made by a newer version ('
                      + data.version + ') than this app understands (' + SCHEMA_VERSION + ')');
    }
    if (!Array.isArray(data.conversations)) {
      throw new Error('Import failed: the file has no conversations array');
    }

    var mod = convosModule();
    if (!mod || typeof mod.normalizeConversation !== 'function') {
      throw new Error('Import failed: the conversation module is not available');
    }
    var normalize = mod.normalizeConversation;

    var conversations = [];
    for (var i = 0; i < data.conversations.length; i++) {
      var c = normalize(data.conversations[i]);
      if (c) { conversations.push(c); }
    }

    var macros = Array.isArray(data.macros)
      ? data.macros.filter(function (m) {
          return m && typeof m === 'object' && typeof m.body === 'string';
        }).map(function (m) {
          return {
            id: typeof m.id === 'string' ? m.id : 'mac_import',
            title: typeof m.title === 'string' && m.title.trim() !== ''
              ? m.title.trim() : 'Imported macro',
            body: m.body,
            createdAt: typeof m.createdAt === 'string' ? m.createdAt : '',
            updatedAt: typeof m.updatedAt === 'string' ? m.updatedAt : ''
          };
        })
      : [];

    var agents = Array.isArray(data.agents)
      ? data.agents.filter(function (a) {
          return a && typeof a === 'object' && typeof a.name === 'string' && a.name.trim() !== '';
        }).map(function (a) {
          return {
            id: typeof a.id === 'string' ? a.id : 'ag_import',
            name: a.name.trim()
          };
        })
      : [];

    var tags = Array.isArray(data.tags)
      ? data.tags.filter(function (t) { return typeof t === 'string' && t.trim() !== ''; })
      : [];

    return {
      version: SCHEMA_VERSION,
      exportedAt: data.exportedAt || null,
      conversations: conversations,
      macros: macros,
      agents: agents,
      tags: tags
    };
  }

  /* ----------------------------- CSV views --------------------------- */

  var CONVERSATION_HEADERS = [
    'id', 'contact_name', 'contact_email', 'subject', 'status',
    'tags', 'assignee', 'created_at', 'updated_at',
    'first_response_at', 'closed_at',
    'message_count', 'last_message', 'last_message_at'
  ];

  var MESSAGE_HEADERS = [
    'conversation_id', 'contact_name', 'subject', 'author',
    'author_name', 'at', 'body'
  ];

  function joinTags(tags) {
    return (Array.isArray(tags) ? tags : []).join(' ');
  }

  function agentLabel(doc, conversation) {
    var agents = Array.isArray(doc.agents) ? doc.agents : [];
    if (!conversation.assigneeId) { return ''; }
    for (var i = 0; i < agents.length; i++) {
      if (agents[i].id === conversation.assigneeId) { return agents[i].name || agents[i].id; }
    }
    return conversation.assigneeId;
  }

  /** One row per conversation, tags space-joined and the last message inlined. */
  function flattenConversations(doc) {
    var convos = doc && Array.isArray(doc.conversations) ? doc.conversations : [];
    return convos.map(function (c) {
      var msgs = Array.isArray(c.messages) ? c.messages : [];
      var last = msgs.length ? msgs[msgs.length - 1] : null;
      return {
        id: c.id || '',
        contact_name: c.contactName || '',
        contact_email: c.contactEmail || '',
        subject: c.subject || '',
        status: c.status || '',
        tags: joinTags(c.tags),
        assignee: agentLabel(doc, c),
        created_at: c.createdAt || '',
        updated_at: c.updatedAt || '',
        first_response_at: c.firstResponseAt || '',
        closed_at: c.closedAt || '',
        message_count: msgs.length,
        last_message: last ? last.body : '',
        last_message_at: last ? last.at : ''
      };
    });
  }

  /** One row per message, in thread order, oldest first. */
  function flattenMessages(doc) {
    var convos = doc && Array.isArray(doc.conversations) ? doc.conversations : [];
    var rows = [];
    for (var i = 0; i < convos.length; i++) {
      var c = convos[i];
      var msgs = Array.isArray(c.messages) ? c.messages : [];
      for (var j = 0; j < msgs.length; j++) {
        rows.push({
          conversation_id: c.id || '',
          contact_name: c.contactName || '',
          subject: c.subject || '',
          author: msgs[j].author || '',
          author_name: msgs[j].authorName || '',
          at: msgs[j].at || '',
          body: msgs[j].body || ''
        });
      }
    }
    return rows;
  }

  function conversationsToCSV(doc) {
    return toCSV(flattenConversations(doc), CONVERSATION_HEADERS);
  }

  function messagesToCSV(doc) {
    return toCSV(flattenMessages(doc), MESSAGE_HEADERS);
  }

  /** Rebuild conversation rows parsed from a spreadsheet. */
  function rowsToConversations(rows) {
    var convos = parseCSVRows(rows);
    var conv = convosModule();
    return convos.map(function (r) {
      var subject = r.subject || '';
      var body = r.last_message || '';
      var c = conv.newConversation({
        contactName: r.contact_name || 'Imported contact',
        contactEmail: r.contact_email || '',
        subject: subject,
        body: body,
        status: conv.STATUSES.indexOf(r.status) !== -1 ? r.status : 'open'
      });
      if (r.tags && r.tags.trim() !== '') {
        r.tags.split(/\s+/).filter(Boolean).forEach(function (t) {
          c = conv.addTag(c, t);
        });
      }
      c.id = r.id || c.id;
      if (r.created_at) { c.createdAt = r.created_at; }
      if (r.updated_at) { c.updatedAt = r.updated_at; }
      if (r.first_response_at) { c.firstResponseAt = r.first_response_at; }
      if (r.closed_at) { c.closedAt = r.closed_at; }
      if (c.messages.length && r.last_message_at) { c.messages[0].at = r.last_message_at; }
      return c;
    });
  }

  return {
    escapeField: escapeField,
    toCSV: toCSV,
    parseCSV: parseCSV,
    parseCSVRows: parseCSVRows,
    toLocalISO: toLocalISO,

    SCHEMA_VERSION: SCHEMA_VERSION,
    exportDocument: exportDocument,
    importDocument: importDocument,

    CONVERSATION_HEADERS: CONVERSATION_HEADERS,
    MESSAGE_HEADERS: MESSAGE_HEADERS,
    flattenConversations: flattenConversations,
    flattenMessages: flattenMessages,
    conversationsToCSV: conversationsToCSV,
    messagesToCSV: messagesToCSV,
    rowsToConversations: rowsToConversations
  };
});
