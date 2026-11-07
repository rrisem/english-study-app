/*
 * ui-order.js — 並び替え問題の操作部品
 * ・単語をタップすると下の解答欄に追加、解答欄の単語をタップすると戻ります。
 * ・解答欄の中では、単語を長押し気味にドラッグして順番を入れ替えることもできます。
 *   （タップだけで最後まで回答できるので、ドラッグは使わなくても大丈夫です）
 */
(function (root) {
  'use strict';
  var EA = root.EA = root.EA || {};
  var esc = function (s) { return EA.util.esc(s); };

  /**
   * container に描画する。
   * tokens: 語句の配列 / pool: 表示順（tokens の番号の配列）/ placed: 解答欄に置いた番号の配列
   * onChange(newPlaced) が呼ばれる
   */
  function mount(container, tokens, pool, placed, onChange) {
    function chip(i, where, pos) {
      return '<button type="button" class="chip" data-tok="' + i + '" data-where="' + where + '"' +
        (pos != null ? ' data-pos="' + pos + '"' : '') + ' aria-label="' + esc(tokens[i]) +
        (where === 'answer' ? '（タップで戻す）' : '（タップで追加）') + '">' + esc(tokens[i]) + '</button>';
    }
    function draw() {
      var used = {};
      placed.forEach(function (i) { used[i] = true; });
      container.innerHTML =
        '<div class="order-answer" data-zone="answer" aria-label="解答欄">' +
          (placed.length ? placed.map(function (i, p) { return chip(i, 'answer', p); }).join('') :
            '<span class="order-placeholder">下の語句をタップして、ここに並べます</span>') +
        '</div>' +
        '<div class="order-pool" data-zone="pool" aria-label="語句">' +
          pool.map(function (i) {
            return used[i] ? '<span class="chip chip-ghost" aria-hidden="true">' + esc(tokens[i]) + '</span>' : chip(i, 'pool');
          }).join('') +
        '</div>' +
        '<div class="order-tools"><button type="button" class="btn-text" data-order="clear"' +
          (placed.length ? '' : ' disabled') + '>並べ直す</button></div>';
    }

    function set(next) { placed = next; draw(); onChange(placed.slice()); }

    // ---- タップ操作 ----
    container.addEventListener('click', function (ev) {
      // ドラッグを終えた直後に発生する click は無視する（ドラッグとタップの二重処理を防ぐ）
      if (Date.now() - dragEndedAt < 350) return;
      var t = ev.target.closest('[data-tok]');
      if (t) {
        var i = +t.getAttribute('data-tok');
        if (t.getAttribute('data-where') === 'pool') set(placed.concat([i]));
        else set(placed.filter(function (x, p) { return p !== +t.getAttribute('data-pos'); }));
        return;
      }
      if (ev.target.closest('[data-order="clear"]')) set([]);
    });

    // ---- ドラッグ操作（Pointer Events：指・ペン・マウス共通） ----
    var drag = null, dragEndedAt = 0;
    container.addEventListener('pointerdown', function (ev) {
      var t = ev.target.closest('[data-tok]');
      if (!t) return;
      drag = { el: t, tok: +t.getAttribute('data-tok'), from: t.getAttribute('data-where'),
        pos: t.hasAttribute('data-pos') ? +t.getAttribute('data-pos') : null,
        x: ev.clientX, y: ev.clientY, ghost: null, id: ev.pointerId };
    });
    container.addEventListener('pointermove', function (ev) {
      if (!drag || ev.pointerId !== drag.id) return;
      var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (!drag.ghost) {
        if (Math.abs(dx) + Math.abs(dy) < 10) return;
        var r = drag.el.getBoundingClientRect();
        drag.ghost = drag.el.cloneNode(true);
        drag.ghost.className = 'chip chip-drag';
        drag.ghost.style.width = r.width + 'px';
        drag.offX = drag.x - r.left; drag.offY = drag.y - r.top;
        document.body.appendChild(drag.ghost);
        drag.el.classList.add('chip-lifted');
        try { drag.el.setPointerCapture(ev.pointerId); } catch (e) { /* 無視 */ }
      }
      ev.preventDefault();
      drag.ghost.style.transform = 'translate(' + (ev.clientX - drag.offX) + 'px,' + (ev.clientY - drag.offY) + 'px)';
    });
    function endDrag(ev) {
      if (!drag || ev.pointerId !== drag.id) return;
      var d = drag; drag = null;
      if (!d.ghost) return; // ただのタップ → click で処理
      d.ghost.remove();
      dragEndedAt = Date.now();
      var ans = container.querySelector('[data-zone="answer"]');
      var ar = ans.getBoundingClientRect();
      var inAnswer = ev.clientX >= ar.left - 20 && ev.clientX <= ar.right + 20 && ev.clientY >= ar.top - 20 && ev.clientY <= ar.bottom + 20;
      var next = placed.slice();
      if (d.from === 'answer') next.splice(d.pos, 1);
      if (inAnswer) {
        // 指を離した位置に一番近い場所へ入れる
        var chips = Array.prototype.slice.call(ans.querySelectorAll('[data-tok]'))
          .filter(function (c) { return !(d.from === 'answer' && +c.getAttribute('data-pos') === d.pos); });
        var idx = chips.length;
        for (var k = 0; k < chips.length; k++) {
          var cr = chips[k].getBoundingClientRect();
          var sameRow = ev.clientY >= cr.top - 8 && ev.clientY <= cr.bottom + 8;
          if ((sameRow && ev.clientX < cr.left + cr.width / 2) || ev.clientY < cr.top - 8) { idx = k; break; }
        }
        next.splice(idx, 0, d.tok);
      }
      set(next);
    }
    container.addEventListener('pointerup', endDrag);
    container.addEventListener('pointercancel', function (ev) {
      if (drag && drag.ghost) drag.ghost.remove();
      drag = null; draw();
    });

    draw();
  }

  /** 正解の並びと同じにならないように混ぜる */
  function shuffledPool(tokens, answers) {
    var idx = tokens.map(function (_, i) { return i; });
    for (var tries = 0; tries < 20; tries++) {
      for (var i = idx.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = idx[i]; idx[i] = idx[j]; idx[j] = t;
      }
      var text = EA.grading.normalize(idx.map(function (k) { return tokens[k]; }).join(' '));
      var same = answers.some(function (a) { return EA.grading.normalize(a) === text; });
      if (!same) break;
    }
    return idx;
  }

  EA.orderWidget = { mount: mount, shuffledPool: shuffledPool };
})(typeof window !== 'undefined' ? window : globalThis);
