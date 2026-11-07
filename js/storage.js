/*
 * storage.js — 端末内保存（ブラウザの localStorage）
 *
 * ・保存はこの端末・このブラウザの中だけです。別の端末や別のブラウザとは共有されません。
 * ・ブラウザの「履歴とWebサイトデータを消去」や、プライベートブラウズでは消えることがあります。
 * ・保存できる量は数MB程度です（この試作品の記録なら数千回分は入ります）。
 * 将来サーバーに保存するときは、この load / save を差し替えるだけで済むようにしています。
 */
(function (root) {
  'use strict';
  var EA = root.EA = root.EA || {};
  var KEY = 'ea-study-v1';
  var SCHEMA = 1;

  function defaultState() {
    return {
      schemaVersion: SCHEMA,
      createdAt: Date.now(),
      settings: {
        dailyGoalMinutes: (EA.config && EA.config.defaultDailyGoalMinutes) || 10,
        devDayOffset: 0
      },
      attempts: [],
      schedule: {},
      units: {},
      activeSession: null,
      sessions: []
    };
  }

  var available = true;
  var lastError = null;

  function load() {
    var raw = null;
    try {
      raw = root.localStorage.getItem(KEY);
    } catch (e) {
      available = false; lastError = e;
    }
    if (!raw) return defaultState();
    try {
      var s = JSON.parse(raw);
      var d = defaultState();
      // 足りない項目を補う（古い保存データでも動くように）
      Object.keys(d).forEach(function (k) { if (s[k] === undefined) s[k] = d[k]; });
      Object.keys(d.settings).forEach(function (k) { if (s.settings[k] === undefined) s.settings[k] = d.settings[k]; });
      return s;
    } catch (e) {
      lastError = e;
      return defaultState();
    }
  }

  function save(state) {
    try {
      root.localStorage.setItem(KEY, JSON.stringify(state));
      available = true;
      return true;
    } catch (e) {
      available = false; lastError = e;
      return false;
    }
  }

  function clear() {
    try { root.localStorage.removeItem(KEY); } catch (e) { /* 何もしない */ }
  }

  EA.storage = {
    KEY: KEY,
    load: load,
    save: save,
    clear: clear,
    defaultState: defaultState,
    isAvailable: function () { return available; },
    lastError: function () { return lastError; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
