/*
 * core.js — 共通の小さな道具（名前空間・日付・時計・HTMLエスケープ）
 * すべてのファイルは window.EA（English App）にまとめて登録します。
 * ビルド不要の普通の <script> として読み込めるように、import/export は使っていません。
 */
(function (root) {
  'use strict';
  var EA = root.EA = root.EA || {};
  EA.banks = EA.banks || {};

  var DAY_MS = 24 * 60 * 60 * 1000;

  EA.util = {
    DAY_MS: DAY_MS,

    uid: function (prefix) {
      return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    },

    esc: function (s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    /** その日の 0:00（端末の時刻帯）を返す */
    startOfDay: function (ms) {
      var d = new Date(ms);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    },

    /** 日付だけを比べた差（b − a の日数） */
    dayDiff: function (a, b) {
      return Math.round((EA.util.startOfDay(b) - EA.util.startOfDay(a)) / DAY_MS);
    },

    addDays: function (ms, days) {
      var d = new Date(EA.util.startOfDay(ms));
      d.setDate(d.getDate() + days);
      return d.getTime();
    },

    fmtDate: function (ms) {
      var d = new Date(ms);
      var w = '日月火水木金土'.charAt(d.getDay());
      return (d.getMonth() + 1) + '月' + d.getDate() + '日（' + w + '）';
    },

    fmtDateTime: function (ms) {
      var d = new Date(ms);
      var mm = String(d.getMinutes()).padStart(2, '0');
      return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + mm;
    },

    fmtDuration: function (ms) {
      var s = Math.round((ms || 0) / 1000);
      if (s < 60) return s + '秒';
      var m = Math.floor(s / 60);
      return m + '分' + (s % 60 ? (s % 60) + '秒' : '');
    },

    /** 「今日」「明日」「3日後」「2日前」など */
    relDay: function (target, now) {
      var diff = EA.util.dayDiff(now, target);
      if (diff === 0) return '今日';
      if (diff === 1) return '明日';
      if (diff > 1) return diff + '日後';
      return (-diff) + '日前';
    }
  };

  /*
   * 時計。開発・確認用に「日付を進める」設定（devDayOffset）があり、
   * アプリ内のすべての日時はこの EA.clock.now() から取得します。
   */
  EA.clock = {
    offsetDays: 0,
    now: function () {
      return Date.now() + (EA.clock.offsetDays || 0) * DAY_MS;
    }
  };

  /** 問題集（data/*.js）がここに自分を登録します */
  EA.registerBank = function (bank) {
    EA.banks[bank.unit.id] = bank;
  };

  /** 問題IDから問題を探す */
  EA.findQuestion = function (bank, id) {
    for (var i = 0; i < bank.questions.length; i++) {
      if (bank.questions[i].id === id) return bank.questions[i];
    }
    return null;
  };

  EA.findSkill = function (bank, id) {
    for (var i = 0; i < bank.skills.length; i++) {
      if (bank.skills[i].id === id) return bank.skills[i];
    }
    return null;
  };
})(typeof window !== 'undefined' ? window : globalThis);
