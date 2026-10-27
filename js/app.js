/* ------------------------------------------------------------------ *
 * Opencom — DOM layer
 *
 * The only file that touches the page. It is deliberately thin: render
 * functions plus a few delegated listeners, so re-rendering never
 * detaches handlers. All behaviour lives in convos.js / stats.js /
 * csv.js / store.js, which is what verify.js tests.
 * ------------------------------------------------------------------ */
(function () {
  'use strict';

  var Store = window.ComStore;
  var Convos = window.ComConvos;
  var Stats = window.ComStats;
  var CSV = window.ComCSV;

  if (!Store || !Convos || !Stats || !CSV) {
    document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif;color:#f87171">' +
      'Opencom failed to load its scripts. Open it from a local server or check the console.</p>';
    return;
  }

  /* ---------------------------- DOM helpers -------------------------- */

  function $(id) { return document.getElementById(id); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) { continue; }
        var v = attrs[k];
        if (v === null || v === undefined || v === false) { continue; }
        if (k === 'class') { node.className = v; }
        else if (k === 'text') { node.textContent = v; }
        else if (k === 'html') { node.innerHTML = v; }
        else if (k === 'dataset') {
          for (var d in v) { if (Object.prototype.hasOwnProperty.call(v, d)) { node.dataset[d] = v[d]; } }
        } else if (k.slice(0, 2) === 'on' && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v === true) { node.setAttribute(k, ''); }
        else { node.setAttribute(k, v); }
      }
    }
    function collect(node, kid) {
      if (kid === null || kid === undefined || kid === false || kid === true) { return; }
      if (Array.isArray(kid)) {
        for (var j = 0; j < kid.length; j++) { collect(node, kid[j]); }
        return;
      }
      node.appendChild(typeof kid === 'string' || typeof kid === 'number'
        ? document.createTextNode(String(kid)) : kid);
    }

    var kids = Array.isArray(children) ? children : (children === undefined ? [] : [children]);
    for (var i = 0; i < kids.length; i++) { collect(node, kids[i]); }
    return node;
  }

  function clear(node) { while (node.firstChild) { node.removeChild(node.firstChild); } }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function stamp(isoString) {
    var d = Convos.fromISO(isoString);
    if (!d) { return ''; }
    var now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    var time = (d.getHours() < 10 ? '0' + d.getHours() : d.getHours()) + ':' +
               (d.getMinutes() < 10 ? '0' + d.getMinutes() : d.getMinutes());
    if (sameDay) { return time; }
    var sameYear = d.getFullYear() === now.getFullYear();
    var date = (d.getMonth() + 1) + '/' + d.getDate() + (sameYear ? '' : '/' + d.getFullYear());
    return date + ' ' + time;
  }

  function dayLabel(isoString) {
    var d = Convos.fromISO(isoString);
    if (!d) { return ''; }
    var now = new Date();
    if (d.toDateString() === now.toDateString()) { return 'Today'; }
    var yest = new Date(now.getTime() - 86400000);
    if (d.toDateString() === yest.toDateString()) { return 'Yesterday'; }
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  }

  /* ------------------------- markdown rendering --------------------- */

  /**
   * Render a small, safe markdown subset to HTML. Input is escaped first,
   * so the only markup that can appear in the output is markup we add.
   * Supports: **bold**, *italic*, `code`, ```fenced```, [text](url),
   * headings, bullet and numbered lists, blockquotes and rules.
   */
  function renderMarkdown(src) {
    var text = String(src === null || src === undefined ? '' : src);

    var fences = [];
    text = text.replace(/```([\s\S]*?)```/g, function (_, code) {
      fences.push(code.replace(/^\n+|\n+$/g, ''));
      return '\u0000F' + (fences.length - 1) + '\u0000';
    });

    text = esc(text);

    var spans = [];
    text = text.replace(/`([^`\n]+)`/g, function (_, code) {
      spans.push(code);
      return '\u0000S' + (spans.length - 1) + '\u0000';
    });

    text = text
      .replace(/!\[([^\]]*)\]\((https?:[^)\s]+)\)/g, '$1')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/^\s{0,3}#{1,6}\s+(.+)$/gm, '<strong>$1</strong>')
      .replace(/^\s*[-*_]{3,}\s*$/gm, '<hr>')
      .replace(/(\*\*|__)([\s\S]+?)\1/g, '<strong>$2</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
      .replace(/(^|[\s(])~~([^~\n]+)~~(?=[\s).,;:!?]|$)/g, '$1<del>$2</del>');

    var blocks = text.split(/\n{2,}/);
    var html = blocks.map(function (block) {
      var lines = block.split('\n');
      var ordered = /^\s*\d+\.\s+/.test(lines[0]);
      var isList = ordered || /^\s*[-*+]\s+/.test(lines[0]);
      var isQuote = /^\s*&gt;\s?/.test(lines[0]);

      var body = lines.map(function (line) {
        if (isList) {
          return '<li>' + line.replace(/^\s*\d+\.\s+/, '').replace(/^\s*[-*+]\s+/, '') + '</li>';
        }
        if (isQuote) {
          return line.replace(/^\s*&gt;\s?/, '');
        }
        return line.replace(/\n/g, '<br>');
      }).join(isList ? '' : '\n');

      if (isList) { return (ordered ? '<ol>' : '<ul>') + body + (ordered ? '</ol>' : '</ul>'); }
      if (isQuote) { return '<blockquote>' + body + '</blockquote>'; }
      if (/^<hr>$/.test(block.trim())) { return block.trim(); }
      return '<p>' + body + '</p>';
    }).join('\n');

    html = html
      .replace(/\u0000S(\d+)\u0000/g, function (_, i) { return '<code>' + spans[Number(i)] + '</code>'; })
      .replace(/\u0000F(\d+)\u0000/g, function (_, i) {
        return '<pre><code>' + fences[Number(i)] + '</code></pre>';
      });
    return html;
  }

  /* ------------------------------- state ----------------------------- */

  var state = {
    doc: null,
    store: null,
    selectedId: null,
    search: '',
    status: 'all',
    tag: 'all',
    sort: 'newest',
    cursor: 0,
    preview: false,
    draft: '',
    macroQuery: null,
    macroIndex: 0,
    modal: null
  };

  function load() {
    var doc = state.store.get(Store.DOC_KEY);
    if (!doc || !Array.isArray(doc.conversations)) {
      doc = Convos.demoDocument();
      state.store.set(Store.DOC_KEY, doc);
    } else {
      doc = {
        version: Convos.SCHEMA_VERSION,
        exportedAt: null,
        conversations: (doc.conversations || []).map(Convos.normalizeConversation).filter(Boolean),
        macros: Array.isArray(doc.macros) && doc.macros.length ? doc.macros : Convos.defaultMacros(),
        agents: Array.isArray(doc.agents) && doc.agents.length ? doc.agents : Convos.emptyDocument().agents,
        tags: Array.isArray(doc.tags) && doc.tags.length ? doc.tags : Convos.emptyDocument().tags
      };
    }
    state.doc = doc;
  }

  /** Save to storage and repaint everything that depends on the document. */
  function commit() {
    state.store.set(Store.DOC_KEY, state.doc);
    render();
  }

  function filtered() {
    return Convos.filterConversations(state.doc.conversations, {
      search: state.search,
      status: state.status,
      tag: state.tag,
      sort: state.sort
    });
  }

  function selected() {
    for (var i = 0; i < state.doc.conversations.length; i++) {
      if (state.doc.conversations[i].id === state.selectedId) { return state.doc.conversations[i]; }
    }
    return null;
  }

  /** Run `fn(conversation) -> conversation` against one thread, then persist. */
  function mutateConvo(id, fn) {
    var list = state.doc.conversations;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        var next = fn(list[i]);
        if (next && next !== list[i]) { list[i] = next; }
        break;
      }
    }
    commit();
  }

  /* ---------------------------- stats strip -------------------------- */

  function stat(num, label, mod) {
    return el('div', { class: 'stat' + (mod ? ' ' + mod : '') }, [
      el('span', { class: 'stat__num', text: String(num) }),
      el('span', { class: 'stat__label', text: label })
    ]);
  }

  function renderStats() {
    var s = Stats.computeStats(state.doc);
    var bar = $('statsbar');
    clear(bar);
    bar.appendChild(stat(s.open, 'Open', 'stat--open'));
    bar.appendChild(stat(s.pending, 'Pending', 'stat--pending'));
    bar.appendChild(stat(s.closedToday, 'Closed today', 'stat--closed'));
    bar.appendChild(stat(s.medianFirstResponseHours > 0 ? s.medianFirstResponseHours.toFixed(1) + 'h' : '—',
      'Median first reply', 'stat--time'));
    bar.appendChild(stat(s.conversationsThisWeek, 'This week', ''));
    bar.appendChild(stat(s.needsFollowUp, 'Needs a reply', s.needsFollowUp > 0 ? 'stat--alert' : ''));

    var tags = s.byTag.slice(0, 5);
    if (!tags.length) { return; }
    var max = tags[0].count || 1;
    var wrap = el('div', { class: 'tagbars' });
    tags.forEach(function (t) {
      wrap.appendChild(el('span', { class: 'tagbar' }, [
        el('span', { text: t.tag }),
        el('span', { class: 'tagbar__track' }, [
          el('span', { class: 'tagbar__fill', style: 'width:' + Math.max(8, Math.round(t.count / max * 100)) + '%' })
        ]),
        el('span', { text: String(t.count) })
      ]));
    });
    bar.appendChild(wrap);
  }

  /* ------------------------------ filters ---------------------------- */

  function renderTagFilter() {
    var sel = $('f-tag');
    var current = state.tag;
    clear(sel);
    sel.appendChild(el('option', { value: 'all', text: 'All tags' }));
    Convos.tagUniverse(state.doc).forEach(function (t) {
      sel.appendChild(el('option', { value: t, text: t }));
    });
    sel.value = current;
    if (sel.value !== current) { state.tag = 'all'; }
  }

  /* -------------------------- conversation list ---------------------- */

  function avatar(name) {
    var text = Convos.initials(name);
    return el('span', { class: 'avatar', text: text, title: 'Assigned to ' + name });
  }

  function renderList() {
    var list = $('convos');
    clear(list);
    var rows = filtered();

    if (!rows.length) {
      list.appendChild(el('li', { class: 'listempty' },
        state.doc.conversations.length === 0
          ? ['Your inbox is empty. Hit "New conversation" or "Load demo".']
          : ['Nothing matches those filters.']));
    }

    rows.forEach(function (c, idx) {
      var assignee = Convos.agentName(state.doc, c.assigneeId);
      var item = el('li', null, [
        el('button', {
          class: 'convo' + (c.id === state.selectedId ? ' is-active' : '') +
                 (c.status === 'pending' ? ' is-pending' : '') +
                 (c.status === 'closed' ? ' is-closed' : ''),
          dataset: { action: 'open-convo', id: c.id },
          title: 'Open ' + c.contactName + (assignee ? ' (assigned to ' + assignee + ')' : ' (unassigned)')
        }, [
          el('div', { class: 'convo__top' }, [
            assignee ? avatar(assignee) : null,
            el('span', { class: 'convo__name', text: c.contactName }),
            el('span', { class: 'convo__age', text: Convos.timeAgo(c.updatedAt) })
          ]),
          el('div', { class: 'convo__subject', text: c.subject }),
          el('div', { class: 'convo__snippet', text: Convos.snippet(c) }),
          el('div', { class: 'convo__meta' }, [
            el('span', { class: 'pill pill--' + c.status, text: c.status }),
            (c.tags || []).map(function (t) {
              return el('span', { class: 'chip', text: t, title: 'Filter by tag: ' + t });
            })
          ])
        ])
      ]);
      list.appendChild(item);
    });

    state.cursor = Math.min(state.cursor, Math.max(0, rows.length - 1));
    var active = list.querySelector('.convo.is-active');
    if (active && rows.length) {
      active.scrollIntoView({ block: 'nearest' });
    }
  }

  /* ------------------------------ thread ----------------------------- */

  function renderThread() {
    var pane = $('thread');
    clear(pane);
    var c = selected();
    if (!c) {
      pane.appendChild(el('div', { class: 'thread__empty' }, [
        el('img', { src: 'icon.svg', width: 72, height: 72, alt: '' }),
        el('p', { text: state.doc.conversations.length
          ? 'Pick a conversation from the left. Use j and k to move, Enter to open.'
          : 'Nothing in the inbox yet. Create a conversation or load the demo inbox to see a working product.' })
      ]));
      return;
    }

    /* header */
    var statuses = Convos.allowedStatuses(c);
    var agentSel = el('select', {
      id: 't-assignee',
      'aria-label': 'Assignee',
      onchange: function (e) {
        mutateConvo(c.id, function (x) { return Convos.setAssignee(x, e.target.value || null); });
      }
    }, [
      el('option', { value: '', text: 'Unassigned' }),
      state.doc.agents.map(function (a) {
        return el('option', { value: a.id, text: a.name, selected: a.id === c.assigneeId });
      })
    ]);

    var tags = el('div', { class: 'thread__tags' });
    (c.tags || []).forEach(function (t) {
      tags.appendChild(el('span', { class: 'chip' }, [
        document.createTextNode(t),
        el('button', {
          'aria-label': 'Remove tag ' + t,
          title: 'Remove tag',
          dataset: { action: 'remove-tag', tag: t },
          text: '×'
        })
      ]));
    });
    var tagInput = el('input', {
      id: 't-tag-add',
      class: 'tagpick',
      type: 'text',
      placeholder: '+ tag',
      autocomplete: 'off',
      title: 'Add a tag and press Enter'
    });
    tags.appendChild(tagInput);

    pane.appendChild(el('header', { class: 'thread__head' }, [
      el('div', { class: 'thread__titlerow' }, [
        el('h1', { class: 'thread__subject', text: c.subject }),
        el('span', { class: 'thread__contact' }, [
          el('strong', { text: c.contactName }),
          c.contactEmail ? [
            document.createTextNode(' · '),
            el('a', { href: 'mailto:' + esc(c.contactEmail), text: c.contactEmail })
          ] : null
        ]),
        el('span', { class: 'pill pill--' + c.status, text: c.status })
      ]),
      el('div', { class: 'thread__controls' }, [
        el('label', null, [
          document.createTextNode('Assignee'),
          agentSel
        ]),
        el('span', {
          style: 'font-size:11px;color:var(--text-mute)',
          text: 'opened ' + Convos.timeAgo(c.createdAt)
        }),
        tags
      ])
    ]));

    /* messages */
    var body = el('div', { class: 'thread__body', id: 'thread-body' });
    var lastDay = '';
    c.messages.forEach(function (m) {
      var d = Convos.fromISO(m.at);
      var label = d ? d.toDateString() : '';
      if (label !== lastDay) {
        body.appendChild(el('div', { class: 'daybreak', text: dayLabel(m.at) }));
        lastDay = label;
      }
      var isAgent = m.author === 'agent';
      var name = m.authorName || (isAgent ? 'Agent' : c.contactName);
      body.appendChild(el('div', { class: 'msg' + (isAgent ? ' msg--agent' : '') }, [
        el('span', { class: 'avatar msg__avatar', text: Convos.initials(name) }),
        el('div', { class: 'msg__bubble' }, [
          el('div', { class: 'msg__meta' }, [
            el('span', { class: 'msg__who', text: name }),
            el('span', { class: 'msg__role', text: isAgent ? 'agent' : 'customer' }),
            el('span', { text: stamp(m.at) })
          ]),
          el('div', { class: 'md', html: renderMarkdown(m.body) })
        ])
      ]));
    });
    body.scrollTop = body.scrollHeight;
    pane.appendChild(body);

    /* composer */
    var ta = el('textarea', {
      id: 'composer-body',
      class: 'composer__textarea',
      rows: '3',
      placeholder: 'Reply to ' + c.contactName + '…  Type / for a canned response',
      autocomplete: 'off'
    });
    ta.value = state.draft || '';
    var preview = el('div', { class: 'composer__preview', id: 'composer-preview' });

    var statusSel = el('select', {
      id: 'composer-status',
      'aria-label': 'Set status with this reply',
      onchange: function () { /* applied on send */ }
    }, statuses.map(function (s) {
      return el('option', { value: s, text: s, selected: s === c.status });
    }));

    pane.appendChild(el('section', { class: 'composer' }, [
      el('div', { class: 'composer__toolbar' }, [
        el('button', { class: 'fmt fmt--b', title: 'Bold (**text**)', dataset: { action: 'fmt', kind: 'bold' }, text: 'B' }),
        el('button', { class: 'fmt fmt--i', title: 'Italic (*text*)', dataset: { action: 'fmt', kind: 'italic' }, text: 'I' }),
        el('button', { class: 'fmt fmt--c', title: 'Code (`text`)', dataset: { action: 'fmt', kind: 'code' }, text: '`code`' }),
        el('button', { class: 'fmt', title: 'Link ([text](url))', dataset: { action: 'fmt', kind: 'link' }, text: 'link' }),
        el('button', { class: 'fmt', title: 'Insert a canned response (/)', dataset: { action: 'btn-macro-menu' }, text: '/ macro' }),
        el('span', { class: 'composer__spacer' }),
        el('button', {
          class: 'btn btn--sm ' + (state.preview ? 'btn--teal' : 'btn--ghost'),
          dataset: { action: 'btn-preview' },
          text: 'Preview'
        }),
        el('span', { class: 'composer__count', id: 'composer-count', text: '' })
      ]),
      el('div', { class: 'composer__row' }, [
        ta,
        state.preview ? preview : null
      ]),
      el('div', { class: 'composer__foot' }, [
        el('label', null, [document.createTextNode('Status'), statusSel]),
        el('span', { class: 'composer__hint' }, [
          el('kbd', { text: '/' }), document.createTextNode(' macro · '),
          el('kbd', { text: 'Ctrl' }), document.createTextNode('+'),
          el('kbd', { text: '↵' }), document.createTextNode(' send')
        ]),
        el('button', {
          class: 'btn btn--primary',
          id: 'btn-send',
          dataset: { action: 'btn-send' },
          text: 'Send reply'
        })
      ])
    ]));

    if (state.preview) {
      preview.innerHTML = renderMarkdown(ta.value);
      ta.style.display = 'none';
      preview.style.display = '';
    }
    syncCount();
  }

  function composerBody() { return $('composer-body'); }

  function syncCount() {
    var ta = composerBody();
    var out = $('composer-count');
    if (ta && out) { out.textContent = ta.value.length ? ta.value.length + ' chars' : ''; }
  }

  function syncPreview() {
    var ta = composerBody();
    var pv = $('composer-preview');
    if (ta && pv && state.preview) { pv.innerHTML = renderMarkdown(ta.value); }
  }

  /* ----------------------------- toasts ------------------------------ */

  function toast(message, kind, actionLabel, onAction) {
    var node = el('div', { class: 'toast' + (kind ? ' toast--' + kind : '') }, [
      el('span', { class: 'toast__msg', text: message })
    ]);
    if (actionLabel && typeof onAction === 'function') {
      node.appendChild(el('button', {
        class: 'btn btn--sm btn--ghost toast__action',
        text: actionLabel,
        onclick: function () { onAction(); dismiss(); }
      }));
    }
    var root = $('toast-root');
    root.appendChild(node);
    var timer = setTimeout(dismiss, actionLabel ? 8000 : 3600);
    function dismiss() {
      clearTimeout(timer);
      if (node.parentNode) { node.parentNode.removeChild(node); }
    }
  }

  /* ------------------------------ modals ----------------------------- */

  function closeModal() {
    var root = $('modal-root');
    clear(root);
    state.modal = null;
    renderList();
  }

  function openModal(head, bodyChildren, footChildren) {
    closeModal();
    var root = $('modal-root');
    var modal = el('div', { class: 'overlay', onclick: function (e) { if (e.target === e.currentTarget) { closeModal(); } } }, [
      el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': head }, [
        el('header', { class: 'modal__head' }, [
          el('h2', { text: head }),
          el('button', { class: 'btn btn--sm btn--ghost', dataset: { action: 'btn-modal-close' }, title: 'Close (Esc)', text: 'Close' })
        ]),
        el('div', { class: 'modal__body' }, bodyChildren),
        footChildren ? el('footer', { class: 'modal__foot' }, footChildren) : null
      ])
    ]);
    root.appendChild(modal);
    state.modal = { name: head };
  }

  function openNewConversation() {
    var subject = el('input', { id: 'new-subject', type: 'text', placeholder: 'What is this about?' });
    var body = el('textarea', { id: 'new-body', rows: '4', placeholder: 'First message, in markdown. Optional.' });
    var tags = el('input', { id: 'new-tags', type: 'text', placeholder: 'billing, bug', autocomplete: 'off' });
    var assignee = el('select', { id: 'new-assignee' }, [
      el('option', { value: '', text: 'Unassigned' }),
      state.doc.agents.map(function (a) { return el('option', { value: a.id, text: a.name }); })
    ]);

    openModal('New conversation', [
      el('div', { class: 'field-row' }, [
        el('label', { class: 'field' }, [
          el('span', { class: 'field__label', text: 'Contact name' }),
          el('input', { id: 'new-name', type: 'text', placeholder: 'Ada Lovelace', autocomplete: 'off' })
        ]),
        el('label', { class: 'field' }, [
          el('span', { class: 'field__label', text: 'Email' }),
          el('input', { id: 'new-email', type: 'email', placeholder: 'ada@example.com', autocomplete: 'off' })
        ])
      ]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label', text: 'Subject' }), subject]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label', text: 'First message' }), body]),
      el('div', { class: 'field-row' }, [
        el('label', { class: 'field' }, [el('span', { class: 'field__label', text: 'Tags' }), tags]),
        el('label', { class: 'field' }, [el('span', { class: 'field__label', text: 'Assignee' }), assignee])
      ])
    ], [
      el('button', { class: 'btn btn--ghost', dataset: { action: 'btn-modal-close' }, text: 'Cancel' }),
      el('button', { class: 'btn btn--primary', dataset: { action: 'btn-new-save' }, text: 'Create conversation' })
    ]);
    setTimeout(function () { var n = $('new-name'); if (n) { n.focus(); } }, 0);
  }

  function saveNewConversation() {
    var name = $('new-name').value.trim();
    if (!name) { toast('A contact name is required.', 'warn'); $('new-name').focus(); return; }
    var convo = Convos.newConversation({
      contactName: name,
      contactEmail: $('new-email').value,
      subject: $('new-subject').value,
      body: $('new-body').value,
      assigneeId: $('new-assignee').value || null
    });
    var tagText = $('new-tags').value;
    if (tagText) {
      tagText.split(',').forEach(function (t) { convo = Convos.addTag(convo, t); });
    }
    state.doc.conversations.unshift(convo);
    tagText.split(',').forEach(function (t) {
      var norm = Convos.normalizeTag(t);
      if (norm && state.doc.tags.indexOf(norm) === -1) { state.doc.tags.push(norm); }
    });
    state.selectedId = convo.id;
    state.cursor = 0;
    state.draft = '';
    closeModal();
    commit();
    toast('Conversation with ' + convo.contactName + ' created.', 'ok');
  }

  function openMacros() {
    var list = el('ul', { id: 'macro-list' });
    function repaint() {
      clear(list);
      if (!state.doc.macros.length) {
        list.appendChild(el('li', { class: 'listempty', text: 'No macros yet. Add one below.' }));
      }
      state.doc.macros.forEach(function (m) {
        list.appendChild(el('li', { class: 'listrow' }, [
          el('div', { class: 'listrow__text' }, [
            el('div', { class: 'listrow__title', text: m.title }),
            el('div', { class: 'listrow__sub', text: Convos.stripMarkdown(m.body).slice(0, 120) })
          ]),
          el('div', { class: 'listrow__actions' }, [
            el('button', { class: 'btn btn--sm btn--ghost', dataset: { action: 'btn-macro-edit', id: m.id }, text: 'Edit' }),
            el('button', { class: 'btn btn--sm btn--ghost btn--danger', dataset: { action: 'btn-macro-del', id: m.id }, text: 'Delete' })
          ])
        ]));
      });
    }
    var title = el('input', { id: 'macro-title', type: 'text', placeholder: 'Macro title, e.g. Refund policy' });
    var macroBody = el('textarea', { id: 'macro-body', rows: '4', placeholder: 'Body, in markdown. Keep it short and reusable.' });
    repaint();

    openModal('Canned responses', [
      list,
      el('div', { class: 'field-row' }, [
        el('label', { class: 'field' }, [el('span', { class: 'field__label', text: 'Title' }), title]),
        el('button', { class: 'btn', dataset: { action: 'btn-macro-add' }, text: 'Add' })
      ]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label', text: 'Body' }), macroBody]),
      el('p', { style: 'font-size:12px;color:var(--text-mute);margin:0',
        text: 'In the reply box, type / and a snippet of the title to insert a macro. Ctrl/Cmd+S saves from here.' })
    ], [
      el('button', { class: 'btn btn--ghost', dataset: { action: 'btn-modal-close' }, text: 'Done' })
    ]);
    setTimeout(function () { title.focus(); }, 0);

    function doAdd() {
      var t = title.value.trim(), b = macroBody.value.trim();
      if (!t || !b) { toast('A macro needs both a title and a body.', 'warn'); return; }
      state.doc.macros.push(Convos.newMacro(t, b));
      title.value = ''; macroBody.value = '';
      repaint();
      commit();
      toast('Macro "' + t + '" added.', 'ok');
      title.focus();
    }
    state.modalHandlers = { repaint: repaint, add: doAdd };
  }

  function saveMacroEdit(id) {
    var t = $('macro-title'), b = $('macro-body');
    if (!t || !b) { return; }
    var idx = -1;
    for (var i = 0; i < state.doc.macros.length; i++) {
      if (state.doc.macros[i].id === id) { idx = i; break; }
    }
    if (idx === -1) { return; }
    try {
      state.doc.macros[idx] = Convos.updateMacro(state.doc.macros[idx], { title: t.value, body: b.value });
      commit();
      toast('Macro updated.', 'ok');
      closeMacroEdit();
    } catch (e) {
      toast(e.message, 'warn');
    }
  }

  function closeMacroEdit() {
    state.modalHandlers = null;
    openMacros();
  }

  function deleteMacro(id) {
    var before = state.doc.macros.length;
    state.doc.macros = state.doc.macros.filter(function (m) { return m.id !== id; });
    if (state.doc.macros.length === before) { return; }
    commit();
    if (state.modalHandlers && typeof state.modalHandlers.repaint === 'function') {
      state.modalHandlers.repaint();
    }
    toast('Macro deleted.', 'warn', 'Undo', function () {
      state.doc.macros = state.doc.macros.concat(state._lastDeleted || []);
      delete state._lastDeleted;
      commit();
      if (state.modalHandlers && typeof state.modalHandlers.repaint === 'function') {
        state.modalHandlers.repaint();
      }
    });
  }

  function openAgents() {
    var list = el('ul');
    function repaint() {
      clear(list);
      state.doc.agents.forEach(function (a) {
        list.appendChild(el('li', { class: 'listrow' }, [
          el('span', { class: 'avatar', text: Convos.initials(a.name) }),
          el('div', { class: 'listrow__text' }, [
            el('div', { class: 'listrow__title', text: a.name }),
            el('div', { class: 'listrow__sub', text: state.doc.conversations.filter(function (c) {
              return c.assigneeId === a.id;
            }).length + ' conversations assigned' })
          ]),
          el('button', { class: 'btn btn--sm btn--ghost btn--danger', dataset: { action: 'btn-agent-del', id: a.id }, text: 'Remove' })
        ]));
      });
    }
    repaint();
    openModal('Agent roster', [
      list,
      el('div', { class: 'addrow' }, [
        el('input', { id: 'agent-name', type: 'text', placeholder: 'Agent name', autocomplete: 'off' }),
        el('button', { class: 'btn', dataset: { action: 'btn-agent-add' }, text: 'Add' })
      ]),
      el('p', { style: 'font-size:12px;color:var(--text-mute);margin:0',
        text: 'Removing an agent unassigns their conversations. Press Enter to add.' })
    ], [
      el('button', { class: 'btn btn--ghost', dataset: { action: 'btn-modal-close' }, text: 'Done' })
    ]);
    setTimeout(function () { var n = $('agent-name'); if (n) { n.focus(); } }, 0);
  }

  function confirmClear() {
    var convoCount = state.doc.conversations.length;
    openModal('Clear the whole inbox?', [
      el('p', { text: convoCount + ' conversation' + (convoCount === 1 ? '' : 's') +
        ', ' + state.doc.macros.length + ' macros and ' + state.doc.agents.length +
        ' agents will be deleted from this browser. There is no undo.' })
    ], [
      el('button', { class: 'btn btn--ghost', dataset: { action: 'btn-modal-close' }, text: 'Cancel' }),
      el('button', { class: 'btn btn--danger', dataset: { action: 'btn-clear-do' }, text: 'Delete everything' })
    ]);
  }

  /* --------------------------- file I/O ------------------------------ */

  function stampName(prefix) {
    var d = new Date();
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return prefix + '-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
           '-' + p(d.getHours()) + p(d.getMinutes()) + '.json';
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function exportJSON() {
    download(stampName('opencom-export'), CSV.exportDocument(state.doc), 'application/json');
    toast('Exported ' + state.doc.conversations.length + ' conversations as JSON.', 'ok');
  }

  function exportConversationsCSV() {
    download(stampName('opencom-conversations').replace('.json', '.csv'),
      CSV.conversationsToCSV(state.doc), 'text/csv');
    toast('Exported conversations as CSV.', 'ok');
  }

  function exportMessagesCSV() {
    var rows = CSV.flattenMessages(state.doc);
    download(stampName('opencom-messages').replace('.json', '.csv'),
      CSV.messagesToCSV(state.doc), 'text/csv');
    toast('Exported ' + rows.length + ' messages as CSV.', 'ok');
  }

  function importFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var doc = CSV.importDocument(String(reader.result));
        var n = doc.conversations.length;
        state.doc = doc;
        state.selectedId = n ? doc.conversations[0].id : null;
        state.cursor = 0;
        state.draft = '';
        closeModal();
        commit();
        toast('Imported ' + n + ' conversation' + (n === 1 ? '' : 's') + '.', 'ok');
      } catch (e) {
        toast(e.message, 'bad');
      }
    };
    reader.onerror = function () { toast('Could not read that file.', 'bad'); };
    reader.readAsText(file);
  }

  /* ----------------------------- actions ----------------------------- */

  function doAction(action, node) {
    var id = node && node.dataset ? node.dataset.id : null;
    switch (action) {
      case 'open-convo':
        selectConvo(node.dataset.id);
        return;
      case 'remove-tag':
        mutateConvo(state.selectedId, function (c) { return Convos.removeTag(c, node.dataset.tag); });
        return;
      case 'fmt':
        applyFormat(node.dataset.kind);
        return;
      case 'btn-preview':
        state.preview = !state.preview;
        renderThread();
        return;
      case 'btn-macro-menu':
        openMacroMenu(true);
        return;
      case 'btn-send':
        sendReply();
        return;
      case 'btn-new':
        openNewConversation();
        return;
      case 'btn-new-save':
        saveNewConversation();
        return;
      case 'btn-macros':
        openMacros();
        return;
      case 'btn-macro-add':
        if (state.modalHandlers) { state.modalHandlers.add(); }
        return;
      case 'btn-macro-edit':
        editMacro(id);
        return;
      case 'btn-macro-save':
        if (state.modalHandlers && state.modalHandlers.id) { saveMacroEdit(state.modalHandlers.id); }
        return;
      case 'btn-macro-del':
        state._lastDeleted = state.doc.macros.filter(function (m) { return m.id === id; });
        deleteMacro(id);
        return;
      case 'btn-agents':
        openAgents();
        return;
      case 'btn-agent-add':
        addAgent();
        return;
      case 'btn-agent-del':
        deleteAgent(id);
        return;
      case 'btn-import':
        $('file-import').click();
        return;
      case 'btn-export-json':
        exportJSON();
        return;
      case 'btn-export-csv':
        exportConversationsCSV();
        return;
      case 'btn-export-csv-msgs':
        exportMessagesCSV();
        return;
      case 'btn-demo':
        loadDemo();
        return;
      case 'btn-clear':
        confirmClear();
        return;
      case 'btn-clear-do':
        doClear();
        return;
      case 'btn-modal-close':
        closeModal();
        return;
      case 'tag-filter':
        state.tag = node.dataset.tag;
        $('f-tag').value = state.tag;
        render();
        return;
    }
  }

  function editMacro(id) {
    for (var i = 0; i < state.doc.macros.length; i++) {
      if (state.doc.macros[i].id === id) {
        openModal('Edit macro', [
          el('label', { class: 'field' }, [
            el('span', { class: 'field__label', text: 'Title' }),
            el('input', { id: 'macro-title', type: 'text', value: state.doc.macros[i].title })
          ]),
          el('label', { class: 'field' }, [
            el('span', { class: 'field__label', text: 'Body' }),
            el('textarea', { id: 'macro-body', rows: '5' }, state.doc.macros[i].body)
          ])
        ], [
          el('button', { class: 'btn btn--ghost', dataset: { action: 'btn-modal-close' }, text: 'Cancel' }),
          el('button', { class: 'btn btn--primary', dataset: { action: 'btn-macro-save' }, text: 'Save (Ctrl+S)' })
        ]);
        state.modalHandlers = { id: id };
        setTimeout(function () { var t = $('macro-title'); if (t) { t.focus(); } }, 0);
        return;
      }
    }
  }

  function addAgent() {
    var input = $('agent-name');
    var name = input.value.trim();
    if (!name) { return; }
    var exists = state.doc.agents.some(function (a) { return a.name.toLowerCase() === name.toLowerCase(); });
    if (exists) { toast('An agent named ' + name + ' already exists.', 'warn'); return; }
    state.doc.agents.push({ id: Convos.uid('ag'), name: name });
    input.value = '';
    commit();
    openAgents();
    setTimeout(function () { var n = $('agent-name'); if (n) { n.focus(); } }, 0);
    toast('Added ' + name + ' to the roster.', 'ok');
  }

  function deleteAgent(id) {
    var name = Convos.agentName(state.doc, id);
    state.doc.agents = state.doc.agents.filter(function (a) { return a.id !== id; });
    state.doc.conversations.forEach(function (c, i) {
      if (c.assigneeId === id) { state.doc.conversations[i] = Convos.setAssignee(c, null); }
    });
    commit();
    openAgents();
    toast('Removed ' + name + ' and unassigned their conversations.', 'warn');
  }

  function loadDemo() {
    state.doc = Convos.demoDocument();
    state.selectedId = state.doc.conversations[0].id;
    state.cursor = 0;
    state.draft = '';
    closeModal();
    commit();
    toast('Loaded the demo inbox: 10 conversations across all statuses.', 'ok');
  }

  function doClear() {
    state.doc = Convos.emptyDocument();
    state.selectedId = null;
    state.cursor = 0;
    state.draft = '';
    closeModal();
    commit();
    toast('Inbox cleared.', 'warn');
  }

  /* -------------------------- reply composer ------------------------- */

  function applyFormat(kind) {
    var ta = composerBody();
    if (!ta) { return; }
    var s = ta.selectionStart, e = ta.selectionEnd;
    var sel = ta.value.slice(s, e);
    var inserted;
    var caretFrom, caretTo;
    if (kind === 'bold') {
      inserted = '**' + (sel || 'bold text') + '**';
      caretFrom = s + 2; caretTo = caretFrom + (sel || 'bold text').length;
    } else if (kind === 'italic') {
      inserted = '*' + (sel || 'italic text') + '*';
      caretFrom = s + 1; caretTo = caretFrom + (sel || 'italic text').length;
    } else if (kind === 'code') {
      inserted = '`' + (sel || 'code') + '`';
      caretFrom = s + 1; caretTo = caretFrom + (sel || 'code').length;
    } else {
      var text = sel || 'link text';
      inserted = '[' + text + '](https://)';
      caretFrom = s + 1 + text.length + 2;
      caretTo = caretFrom + 8;
    }
    ta.value = ta.value.slice(0, s) + inserted + ta.value.slice(e);
    ta.focus();
    ta.selectionStart = caretFrom;
    ta.selectionEnd = caretTo;
    syncCount();
    syncPreview();
  }

  function detectMacroQuery(ta) {
    var pos = ta.selectionStart;
    var before = ta.value.slice(0, pos);
    var line = before.slice(before.lastIndexOf('\n') + 1);
    var m = /^\/([^\s/]*)$/.exec(line);
    return m ? m[1] : null;
  }

  function renderMacroMenu() {
    var menu = $('macro-menu');
    if (menu) { menu.parentNode.removeChild(menu); }
    if (state.macroQuery === null) { return; }
    var matches = Convos.findMacros(state.doc.macros, state.macroQuery);
    var composer = $('thread').querySelector('.composer');
    if (!composer) { return; }
    var menuNode = el('div', { class: 'macromenu', id: 'macro-menu', role: 'listbox' });
    if (!matches.length) {
      menuNode.appendChild(el('div', { class: 'macromenu__empty', text: 'No macro matches "' + state.macroQuery + '"' }));
    } else {
      matches.slice(0, 8).forEach(function (m, idx) {
        menuNode.appendChild(el('button', {
          class: 'macromenu__item' + (idx === state.macroIndex ? ' is-active' : ''),
          role: 'option',
          dataset: { action: 'btn-macro-pick', id: m.id },
          text: '',
          onclick: function () { pickMacro(m.id); }
        }, [
          el('span', { class: 'macromenu__title', text: m.title }),
          el('span', { class: 'macromenu__body', text: Convos.stripMarkdown(m.body).slice(0, 90) })
        ]));
      });
    }
    composer.parentNode.insertBefore(menuNode, composer);
  }

  function openMacroMenu(force) {
    var ta = composerBody();
    if (!ta) { return; }
    if (force) {
      var pos = ta.selectionStart;
      var before = ta.value.slice(0, pos);
      if (detectMacroQuery(ta) === null) {
        var lineStart = before.lastIndexOf('\n') + 1;
        ta.value = ta.value.slice(0, lineStart) + '/' + ta.value.slice(pos);
        ta.selectionStart = ta.selectionEnd = lineStart + 1;
        state.macroQuery = '';
      }
    }
    state.macroIndex = 0;
    renderMacroMenu();
    ta.focus();
  }

  function closeMacroMenu() {
    state.macroQuery = null;
    var menu = $('macro-menu');
    if (menu) { menu.parentNode.removeChild(menu); }
  }

  function pickMacro(id) {
    var ta = composerBody();
    var macro = null;
    for (var i = 0; i < state.doc.macros.length; i++) {
      if (state.doc.macros[i].id === id) { macro = state.doc.macros[i]; break; }
    }
    if (!macro || !ta) { return; }
    var pos = ta.selectionStart;
    var before = ta.value.slice(0, pos);
    var lineStart = before.lastIndexOf('\n') + 1;
    var after = ta.value.slice(pos);
    var body = macro.body;
    if (lineStart > 0 && !/\n$/.test(ta.value.slice(0, lineStart))) { body = '\n' + body; }
    if (after.length && !/^\n/.test(after)) { body = body + '\n'; }
    ta.value = ta.value.slice(0, lineStart) + body + after;
    var caret = lineStart + body.length;
    ta.selectionStart = ta.selectionEnd = caret;
    closeMacroMenu();
    syncCount();
    syncPreview();
    ta.focus();
  }

  /** Select a thread, resetting the per-thread draft. */
  function selectConvo(id) {
    state.selectedId = id;
    state.draft = '';
    state.preview = false;
    var rows = filtered();
    var idx = rows.findIndex(function (c) { return c.id === id; });
    if (idx >= 0) { state.cursor = idx; }
    closeMacroMenu();
    renderList();
    renderThread();
  }

  function sendReply() {
    var ta = composerBody();
    var sel = $('composer-status');
    if (!ta || !state.selectedId) { return; }
    var body = ta.value.trim();
    if (!body) { toast('Write something before sending.', 'warn'); ta.focus(); return; }
    var convo = selected();
    if (!convo) { return; }
    var next = Convos.appendMessage(convo, { author: 'agent', body: body });
    if (sel && sel.value && sel.value !== convo.status) {
      try { next = Convos.setStatus(next, sel.value); } catch (e) { toast(e.message, 'warn'); return; }
    }
    mutateConvo(convo.id, function () { return next; });
    state.draft = '';
    state.preview = false;
    renderThread();
    toast('Reply sent.' + (sel && sel.value !== convo.status ? ' Status set to ' + sel.value + '.' : ''), 'ok');
  }

  /* ------------------------------ status ----------------------------- */

  function renderStatus() {
    var storage = $('status-storage');
    var counts = $('status-counts');
    if (storage) {
      storage.textContent = state.store.backend() === 'localStorage'
        ? 'Stored locally · ' + Store.PREFIX + Store.DOC_KEY
        : 'In-memory only · storage is blocked in this browser';
      storage.className = state.store.backend() === 'localStorage' ? '' : 'statusbar__warn';
    }
    if (counts) {
      var s = Stats.computeStats(state.doc);
      counts.textContent = s.total + ' conversations · ' + s.totalMessages + ' messages';
    }
  }

  function render() {
    renderStats();
    renderTagFilter();
    renderList();
    renderThread();
    renderStatus();
  }

  /* ------------------------------ events ----------------------------- */

  function bind() {
    document.addEventListener('click', function (e) {
      var node = e.target.closest ? e.target.closest('[data-action]') : null;
      if (!node) { return; }
      doAction(node.dataset.action, node);
    });

    $('search').addEventListener('input', function (e) {
      state.search = e.target.value;
      state.cursor = 0;
      renderList();
    });
    $('f-status').addEventListener('change', function (e) {
      state.status = e.target.value; state.cursor = 0; renderList();
    });
    $('f-tag').addEventListener('change', function (e) {
      state.tag = e.target.value; state.cursor = 0; renderList();
    });
    $('f-sort').addEventListener('change', function (e) {
      state.sort = e.target.value; state.cursor = 0; renderList();
    });

    $('thread').addEventListener('input', function (e) {
      var ta = e.target;
      if (ta.id !== 'composer-body') { return; }
      state.draft = ta.value;
      syncCount();
      syncPreview();
      var q = detectMacroQuery(ta);
      if (q !== null) {
        state.macroQuery = q;
        state.macroIndex = 0;
        renderMacroMenu();
      } else if (state.macroQuery !== null) {
        closeMacroMenu();
      }
    });

    $('thread').addEventListener('keydown', function (e) {
      var ta = e.target;
      if (ta.id !== 'composer-body') { return; }

      if (state.macroQuery !== null) {
        var matches = Convos.findMacros(state.doc.macros, state.macroQuery).slice(0, 8);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (!matches.length) { return; }
          state.macroIndex = (state.macroIndex + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length;
          renderMacroMenu();
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          if (matches.length) { pickMacro(matches[state.macroIndex].id); }
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          closeMacroMenu();
          var pos = ta.selectionStart;
          var before = ta.value.slice(0, pos);
          var lineStart = before.lastIndexOf('\n') + 1;
          ta.value = ta.value.slice(0, lineStart) + ta.value.slice(pos);
          ta.selectionStart = ta.selectionEnd = lineStart;
          return;
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        sendReply();
        return;
      }
    });

    $('thread').addEventListener('keydown', function (e) {
      if (e.target.id === 't-tag-add' && e.key === 'Enter') {
        e.preventDefault();
        var tag = e.target.value.trim();
        e.target.value = '';
        if (!tag || !state.selectedId) { return; }
        mutateConvo(state.selectedId, function (c) {
          var next = Convos.addTag(c, tag);
          return next;
        });
        var norm = Convos.normalizeTag(tag);
        if (norm && state.doc.tags.indexOf(norm) === -1) {
          state.doc.tags.push(norm);
        }
      }
    });

    $('file-import').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (file) { importFile(file); }
      e.target.value = '';
    });

    document.addEventListener('keydown', onKeydown);
  }

  function isTyping(target) {
    var t = target;
    while (t && t !== document.body) {
      var tag = t.tagName && t.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable) { return true; }
      t = t.parentNode;
    }
    return false;
  }

  function moveCursor(delta) {
    var rows = filtered();
    if (!rows.length) { return; }
    state.cursor = Math.max(0, Math.min(rows.length - 1, state.cursor + delta));
    selectConvo(rows[state.cursor].id);
  }

  function onKeydown(e) {
    var modalOpen = $('modal-root').firstChild !== null;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && modalOpen && state.modalHandlers && state.modalHandlers.id) {
      e.preventDefault();
      saveMacroEdit(state.modalHandlers.id);
      return;
    }

    if (e.key === 'Escape') {
      if (state.macroQuery !== null) { return; }
      if (modalOpen) { closeModal(); return; }
      return;
    }

    if (modalOpen || state.macroQuery !== null) { return; }
    if (isTyping(e.target)) { return; }

    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault(); moveCursor(1);
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault(); moveCursor(-1);
    } else if (e.key === 'Enter') {
      var rows = filtered();
      if (rows.length) {
        selectConvo(rows[state.cursor].id);
        var ta = composerBody();
        if (ta) { ta.focus(); }
      }
    } else if (e.key.toLowerCase() === 'n') {
      e.preventDefault();
      openNewConversation();
    }
  }

  /* -------------------------------- boot ----------------------------- */

  function boot() {
    state.store = Store.createStore();
    load();
    state.selectedId = state.doc.conversations.length ? state.doc.conversations[0].id : null;
    bind();
    render();
    if (!state.doc.conversations.length) {
      state.doc = Convos.demoDocument();
      state.selectedId = state.doc.conversations[0].id;
      state.store.set(Store.DOC_KEY, state.doc);
      render();
      toast('Loaded the demo inbox so you can see it working.', 'ok');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
