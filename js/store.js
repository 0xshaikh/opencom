/* ------------------------------------------------------------------ *
 * Opencom — storage
 *
 * A thin JSON wrapper over localStorage with an in-memory fallback, so
 * the exact same code path runs under Node (where there is no
 * localStorage) and in browsers that block storage (private mode,
 * file:// with hardened settings).
 *
 * API:  store.get(key) -> value | null
 *       store.set(key, value) -> true | false
 *       store.remove(key)
 *       store.clear()
 *       store.has(key) -> boolean
 *       store.backend() -> 'localStorage' | 'memory'
 *
 * The whole inbox lives under a single key: 'document'.
 * ------------------------------------------------------------------ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ComStore = factory();
  }
})(typeof self !== 'undefined' ? self : global, function () {
  'use strict';

  var DEFAULT_PREFIX = 'opencom.';
  var DOC_KEY = 'document';

  function probeLocalStorage() {
    try {
      if (typeof localStorage === 'undefined') { return null; }
      var key = '__opencom_probe__';
      localStorage.setItem(key, '1');
      localStorage.removeItem(key);
      return localStorage;
    } catch (e) {
      return null;   // blocked, quota, or a security error
    }
  }

  /** Create a store. Pass a stub backend to test without touching storage. */
  function createStore(options) {
    options = options || {};
    var prefix = typeof options.prefix === 'string' ? options.prefix : DEFAULT_PREFIX;
    var memory = Object.create(null);

    var ls = options.backend !== undefined ? options.backend : probeLocalStorage();

    function readRaw(key) {
      if (ls) {
        try { return ls.getItem(key); } catch (e) { return null; }
      }
      return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
    }

    function writeRaw(key, value) {
      if (ls) {
        try {
          ls.setItem(key, value);
          return true;
        } catch (e) {
          // Quota or revoked permission: fall back to memory so the app
          // keeps working for this session.
          memory[key] = value;
          return true;
        }
      }
      memory[key] = value;
      return true;
    }

    return {
      get: function (key) {
        var raw = readRaw(prefix + key);
        if (raw === null || raw === undefined) { return null; }
        try { return JSON.parse(raw); } catch (e) { return null; }
      },

      set: function (key, value) {
        var raw;
        try { raw = JSON.stringify(value); } catch (e) { return false; }
        return writeRaw(prefix + key, raw);
      },

      remove: function (key) {
        if (ls) { try { ls.removeItem(prefix + key); } catch (e) { /* ignore */ } }
        delete memory[prefix + key];
      },

      /** True when a value is stored under `key` — including a corrupt
       *  one, which `get()` would otherwise report as absent. */
      has: function (key) {
        return readRaw(prefix + key) !== null;
      },

      clear: function () {
        for (var k in memory) { delete memory[k]; }
        if (!ls) { return; }
        var doomed = [];
        try {
          for (var i = 0; i < ls.length; i++) {
            var name = ls.key(i);
            if (name && name.indexOf(prefix) === 0) { doomed.push(name); }
          }
        } catch (e) { return; }
        for (var j = 0; j < doomed.length; j++) {
          try { ls.removeItem(doomed[j]); } catch (e) { /* ignore */ }
        }
      },

      backend: function () { return ls ? 'localStorage' : 'memory'; }
    };
  }

  return { createStore: createStore, DOC_KEY: DOC_KEY, PREFIX: DEFAULT_PREFIX };
});
