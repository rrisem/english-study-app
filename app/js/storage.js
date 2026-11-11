/*
 * storage.js — 端末内保存（ブラウザの localStorage）
 *
 * ・保存はこの端末・このブラウザの中だけ。別の端末・別のブラウザとは共有されません。
 * ・同じiPadの同じブラウザを複数の生徒が使うと、記録は1人分として混ざります（生徒の区別はまだありません）。
 * ・Safari の「履歴とWebサイトデータを消去」やプライベートブラウズでは消えることがあります。
 *
 * 保存領域
 *   ea-study-v1        通常の学習記録
 *   ea-study-demo-v1   動作確認用デモモードの記録（通常の記録とは完全に別。デモ終了で削除）
 *   ea-study-mode      'demo' のときデモモード
 *   ea-study-backup-*  更新前・読み込めなかったデータの控え（自動では削除しません）
 *
 * 将来サーバーに保存するときは、この load / save を差し替えます。
 */
(function (root) {
  'use strict';
  var EA = root.EA = root.EA || {};
  var KEYS = { normal: 'ea-study-v1', demo: 'ea-study-demo-v1', mode: 'ea-study-mode', backupPrefix: 'ea-study-backup-' };
  var SCHEMA = 3;

  function ls() { return root.localStorage; }
  function get(k) { try { return ls().getItem(k); } catch (e) { return undefined; } }
  function set(k, v) { try { ls().setItem(k, v); return true; } catch (e) { return false; } }
  function del(k) { try { ls().removeItem(k); return true; } catch (e) { return false; } }

  function defaultState(mode) {
    var s = {
      schemaVersion: SCHEMA,
      mode: mode || 'normal',
      createdAt: Date.now(),
      settings: { dailyGoalMinutes: (EA.config && EA.config.defaultDailyGoalMinutes) || 10 },
      attempts: [],
      schedule: {},
      units: {},
      activeSession: null,
      sessions: [],
      migrations: []
    };
    if (mode === 'demo') s.demo = { dayOffset: 0 };
    return s;
  }

  /*
   * v1 → v2 の変換。記録は1件も削除しません。
   *  - 開発用の日付ずらし（devDayOffset）を通常の記録から外し、ずらした日付で作られた回答に印（devDated）をつける
   *  - 「解説のあとに答えたか（afterExplanation）」を、当時の流れから推定してつける
   */
  function migrate(s, realNow) {
    var notes = [];
    if (!s.schemaVersion) s.schemaVersion = 1;
    if (s.schemaVersion < 2) {
      var offset = (s.settings && s.settings.devDayOffset) || 0;
      if (s.settings) delete s.settings.devDayOffset;
      var marked = 0;
      var seen = {};
      (s.attempts || []).forEach(function (a) {
        if (offset && a.answeredAt > realNow + 60000) { a.devDated = true; marked++; }
        if (a.afterExplanation === undefined) {
          var key = a.sessionId + '|' + a.skillId;
          if (a.attemptType === 'retry' || a.attemptType === 'similar') a.afterExplanation = true;
          else if (a.attemptType === 'review') a.afterExplanation = !!seen[key];
          else a.afterExplanation = false;
          seen[key] = true;
        }
        a.migratedFrom = a.migratedFrom || 1;
      });
      if (s.activeSession) {
        s.activeSession.explained = s.activeSession.explained || {};
        s.activeSession.followUps = s.activeSession.followUps || 0;
        s.activeSession.unresolved = s.activeSession.unresolved || [];
      }
      notes.push('v1→v2：記録 ' + (s.attempts || []).length + '件を引き継ぎ' +
        (offset ? '。開発用の日付（+' + offset + '日）を解除し、その日付で作られた回答 ' + marked + '件を判定から除外' : ''));
      s.schemaVersion = 2;
      s.mode = s.mode || 'normal';
      s.migrations = (s.migrations || []).concat([{ at: realNow, from: 1, to: 2, note: notes[0] }]);
    }
    /*
     * v2 → v3：答える前に日本語訳を見ていたか（translationShown）と、理由の回答が訳なしで答えたものか（independent）を補う。
     * v2 までは空所補充・並び替え・日→英はすべて日本語つきで出題していたので true、意味の確認問題は false。
     */
    if (s.schemaVersion < 3) {
      var filled = 0;
      (s.attempts || []).forEach(function (a) {
        if (typeof a.translationShown !== 'boolean') {
          a.translationShown = a.format !== 'meaning' || a.attemptType === 'retry';
          filled++;
        }
        if (a.reason && typeof a.reason.independent !== 'boolean') {
          a.reason.independent = !a.translationShown && !a.afterExplanation && !a.hintUsed;
        }
      });
      if (s.activeSession) s.activeSession.reasonsAsked = s.activeSession.reasonsAsked || 0;
      var note = 'v2→v3：記録 ' + (s.attempts || []).length + '件を引き継ぎ、日本語訳を見ていたかを ' + filled + '件に補足';
      notes.push(note);
      s.schemaVersion = 3;
      s.migrations = (s.migrations || []).concat([{ at: realNow, from: 2, to: 3, note: note }]);
    }
    var d = defaultState(s.mode);
    Object.keys(d).forEach(function (k) { if (s[k] === undefined) s[k] = d[k]; });
    return notes;
  }

  /**
   * 読み込み。{ state, mode, status, message, readOnly } を返す
   * status: new | ok | migrated | corrupt-backed-up | corrupt-readonly | unavailable
   */
  function load() {
    var mode = get(KEYS.mode) === 'demo' ? 'demo' : 'normal';
    var key = KEYS[mode];
    var raw = get(key);
    if (raw === undefined) return { state: defaultState(mode), mode: mode, status: 'unavailable', readOnly: false,
      message: 'このブラウザでは記録を保存できない状態です（プライベートブラウズなど）。ページを閉じると記録が消えます。' };
    if (!raw) return { state: defaultState(mode), mode: mode, status: 'new', readOnly: false };
    var s;
    try {
      s = JSON.parse(raw);
      if (!s || typeof s !== 'object' || !Array.isArray(s.attempts)) throw new Error('形式が違います');
    } catch (e) {
      // 壊れたデータは消さずに控えを作る。控えを作れないときは、上書きしないよう保存を止める
      var bkey = KEYS.backupPrefix + 'unreadable-' + Date.now();
      if (set(bkey, raw)) {
        return { state: defaultState(mode), mode: mode, status: 'corrupt-backed-up', readOnly: false,
          message: '保存データを読み込めなかったため、元のデータを「' + bkey + '」に控えて新しく始めました。講師に伝えてください。' };
      }
      return { state: defaultState(mode), mode: mode, status: 'corrupt-readonly', readOnly: true,
        message: '保存データを読み込めませんでした。元のデータを守るため、今回の記録は保存しません。講師に伝えてください。' };
    }
    if (!s.schemaVersion || s.schemaVersion < SCHEMA) {
      var bk = KEYS.backupPrefix + 'schema' + (s.schemaVersion || 1) + '-' + mode;
      if (!get(bk)) set(bk, raw);
      var notes = migrate(s, Date.now());
      return { state: s, mode: mode, status: 'migrated', readOnly: false, message: notes.join(' ') };
    }
    migrate(s, Date.now());
    return { state: s, mode: mode, status: 'ok', readOnly: false };
  }

  function save(state) {
    var key = KEYS[state.mode === 'demo' ? 'demo' : 'normal'];
    return set(key, JSON.stringify(state));
  }

  /** デモモードを始める（通常の記録には触れない） */
  function enterDemo() {
    if (!set(KEYS.mode, 'demo')) return null;
    del(KEYS.demo);
    var s = defaultState('demo');
    set(KEYS.demo, JSON.stringify(s));
    return s;
  }
  /** デモモードを終える（デモの記録を削除し、通常の記録に戻る） */
  function exitDemo() {
    del(KEYS.demo);
    del(KEYS.mode);
    return load();
  }
  /** 通常の記録を消す（設定画面の確認操作のあとだけ） */
  function clearNormal() { return del(KEYS.normal); }

  EA.storage = {
    KEYS: KEYS, SCHEMA: SCHEMA,
    load: load, save: save, migrate: migrate, defaultState: defaultState,
    enterDemo: enterDemo, exitDemo: exitDemo, clearNormal: clearNormal
  };
})(typeof window !== 'undefined' ? window : globalThis);
