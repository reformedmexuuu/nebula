(function () {
  'use strict';
  const { el, $, $$, r2, sleep, wallet, ui } = App;

  const N = 40, DRAW = 10, MAX_PICKS = 10;
  // Tabele wypłat: klucz = liczba wybranych pól, wartości = mnożnik dla 0..n trafień (RTP ~99%)
  const RISKS = {
    classic: {
      label: 'Klasyczne',
      table: {
        1: [0, 3.96],
        2: [0, 1.9, 4.5],
        3: [0, 1, 3.1, 10.4],
        4: [0, 0.8, 1.8, 5, 22.5],
        5: [0, 0.25, 1.4, 4.1, 16.5, 36],
        6: [0, 0, 1, 3.68, 7, 16.5, 40],
        7: [0, 0, 0.47, 3, 4.5, 14, 31, 60],
        8: [0, 0, 0, 2.2, 4, 13, 22, 55, 70],
        9: [0, 0, 0, 1.55, 3, 8, 15, 44, 60, 85],
        10: [0, 0, 0, 1.4, 2.25, 4.5, 8, 17, 50, 80, 100],
      },
    },
    low: {
      label: 'Niskie',
      table: {
        1: [0.7, 1.85],
        2: [0, 2, 3.8],
        3: [0, 1.1, 1.38, 26],
        4: [0, 0, 2.2, 7.9, 90],
        5: [0, 0, 1.5, 4.2, 13, 300],
        6: [0, 0, 1.1, 2, 6.2, 100, 700],
        7: [0, 0, 1.1, 1.6, 3.5, 15, 225, 700],
        8: [0, 0, 1.1, 1.5, 2, 5.5, 39, 100, 800],
        9: [0, 0, 1.1, 1.3, 1.7, 2.5, 7.5, 50, 250, 1000],
        10: [0, 0, 1.1, 1.2, 1.3, 1.8, 3.5, 13, 50, 250, 1000],
      },
    },
    medium: {
      label: 'Średnie',
      table: {
        1: [0.4, 2.75],
        2: [0, 1.8, 5.1],
        3: [0, 0, 2.8, 50],
        4: [0, 0, 1.7, 10, 100],
        5: [0, 0, 1.4, 4, 14, 390],
        6: [0, 0, 0, 3, 9, 180, 710],
        7: [0, 0, 0, 2, 7, 30, 400, 800],
        8: [0, 0, 0, 2, 4, 11, 67, 400, 900],
        9: [0, 0, 0, 2, 2.5, 5, 15, 100, 500, 1000],
        10: [0, 0, 0, 1.6, 2, 4, 7, 26, 100, 500, 1000],
      },
    },
    high: {
      label: 'Wysokie',
      table: {
        1: [0, 3.96],
        2: [0, 0, 17.1],
        3: [0, 0, 0, 81.5],
        4: [0, 0, 0, 10, 259],
        5: [0, 0, 0, 4.5, 48, 450],
        6: [0, 0, 0, 0, 11, 350, 710],
        7: [0, 0, 0, 0, 7, 90, 400, 800],
        8: [0, 0, 0, 0, 5, 20, 270, 600, 900],
        9: [0, 0, 0, 0, 4, 11, 56, 500, 800, 1000],
        10: [0, 0, 0, 0, 3.5, 8, 13, 63, 500, 800, 1000],
      },
    },
  };
  const GEM = `<svg viewBox="0 0 24 24"><path d="M6 3h12l4 6-10 12L2 9z" fill="#21e07a"/><path d="M2 9h20M8 3l4 18 4-18M6 3l2 6 4-6 4 6 2-6" stroke="#0b8f46" stroke-width="1" fill="none"/></svg>`;

  App.registerGame({
    id: 'keno',
    name: 'Keno',
    desc: 'Wybierz do 10 liczb z 40. Losujemy 10 — im więcej trafień, tym wyższa wypłata.',
    accent: '#8b5cff',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5" fill="currentColor"/><rect x="3" y="14" width="7" height="7" rx="1.5" fill="currentColor"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`,

    create(root) {
      let risk = 'classic';
      const picks = new Set();
      let drawn = new Set();
      let busy = false;
      const table = (n) => RISKS[risk].table[n];

      const { panel, stage } = ui.gameLayout(root, 'keno-stage');
      const tabs = ui.modeTabs((m) => { auto.node.classList.toggle('hidden', m !== 'auto'); updateButton(); });
      const bet = ui.betControl();
      const riskSel = ui.selectField('Ryzyko', Object.entries(RISKS).map(([k, v]) => [k, v.label]), risk);
      const pickBtns = el(`<div class="btn-row">
        <button type="button" class="btn btn-secondary" data-autopick>Wybierz losowo</button>
        <button type="button" class="btn btn-secondary" data-clear>Wyczyść</button>
      </div>`);
      const auto = ui.autobet({ bet, play: playOnce, delay: 300, onState: lock });
      auto.node.classList.add('hidden');
      const button = el(`<button class="btn btn-primary btn-bet">Postaw</button>`);
      panel.append(tabs.node, bet.node, riskSel.node, pickBtns, auto.node, button);

      const board = el(`<div class="keno-board"></div>`);
      const tiles = [];
      for (let i = 0; i < N; i++) {
        const t = el(`<button type="button" class="keno-tile"><span>${i + 1}</span></button>`);
        t.addEventListener('click', () => toggle(i));
        tiles.push(t);
        board.appendChild(t);
      }
      const payoutsEl = el(`<div class="keno-payouts"></div>`);
      const boardWrap = el(`<div class="board-wrap"></div>`);
      boardWrap.append(board);
      stage.append(boardWrap, payoutsEl);
      const popup = ui.winPopup(boardWrap);

      function renderTile(i) {
        const t = tiles[i];
        const p = picks.has(i), d = drawn.has(i);
        t.className = 'keno-tile' + (p && d ? ' hit' : p ? ' picked' : d ? ' miss' : '');
        t.innerHTML = p && d ? `<span class="gem">${GEM}</span><span>${i + 1}</span>` : `<span>${i + 1}</span>`;
      }
      const renderAll = () => tiles.forEach((_, i) => renderTile(i));

      function renderPayouts(hits = -1) {
        const n = picks.size;
        if (!n) {
          payoutsEl.innerHTML = `<div class="keno-hint">Wybierz od 1 do ${MAX_PICKS} pól, aby zagrać</div>`;
          return;
        }
        const tbl = table(n);
        payoutsEl.innerHTML = `<div class="keno-mults">${tbl
          .map((m, k) => `<div class="keno-mult${k === hits ? ' active' : ''}">${m.toFixed(2)}×</div>`)
          .join('')}</div><div class="keno-hits">${tbl
          .map((_, k) => `<div class="keno-hit${k === hits ? ' active' : ''}">${k} <i></i></div>`)
          .join('')}</div>`;
      }

      function clearDraw() {
        if (!drawn.size) return;
        drawn = new Set();
        renderAll();
        renderPayouts();
        popup.hide();
      }

      function toggle(i) {
        if (busy || auto.running) return;
        clearDraw();
        if (picks.has(i)) picks.delete(i);
        else if (picks.size < MAX_PICKS) picks.add(i);
        else return App.toast(`Możesz wybrać maksymalnie ${MAX_PICKS} pól`);
        renderTile(i);
        renderPayouts();
      }

      $('[data-autopick]', pickBtns).addEventListener('click', () => {
        if (busy || auto.running) return;
        const count = picks.size || MAX_PICKS;
        picks.clear();
        App.sample(N, count).forEach((i) => picks.add(i));
        drawn = new Set();
        popup.hide();
        renderAll();
        renderPayouts();
      });
      $('[data-clear]', pickBtns).addEventListener('click', () => {
        if (busy || auto.running) return;
        picks.clear();
        drawn = new Set();
        popup.hide();
        renderAll();
        renderPayouts();
      });
      riskSel.select.addEventListener('change', () => {
        risk = riskSel.select.value;
        renderPayouts();
      });

      async function playOnce(amount) {
        if (busy) return null;
        if (!picks.size) { App.toast('Wybierz co najmniej jedno pole'); return null; }
        if (!App.placeBet(amount)) return null;
        busy = true;
        setInputsDisabled(true);
        clearDraw();
        popup.hide();
        const fast = auto.running;
        let hits = 0;
        for (const i of App.sample(N, DRAW)) {
          drawn.add(i);
          if (picks.has(i)) hits++;
          renderTile(i);
          tiles[i].classList.add('pop');
          await sleep(fast ? 35 : 75);
        }
        const m = table(picks.size)[hits];
        const payout = r2(amount * m);
        if (payout) wallet.credit(payout);
        App.recordBet({ game: 'keno', wagered: amount, payout, multiplier: m });
        renderPayouts(hits);
        if (m > 0) popup.show(m, payout, fast ? 600 : 0);
        busy = false;
        setInputsDisabled(auto.running);
        return { wagered: amount, payout };
      }

      function setInputsDisabled(b) {
        bet.setDisabled(b);
        riskSel.select.disabled = b;
        $$('button', pickBtns).forEach((x) => (x.disabled = b));
        board.classList.toggle('locked', b);
        tabs.setLocked(b || auto.running);
      }
      function lock(running) {
        setInputsDisabled(running || busy);
        updateButton();
      }
      function updateButton() {
        button.textContent = tabs.mode === 'auto' ? (auto.running ? 'Zatrzymaj autobet' : 'Rozpocznij autobet') : 'Postaw';
        button.classList.toggle('btn-stop', auto.running);
      }
      button.addEventListener('click', () => (tabs.mode === 'auto' ? auto.toggle() : playOnce(bet.value)));

      renderPayouts();
      return {};
    },
  });
})();
