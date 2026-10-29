(function () {
  'use strict';
  const { el, $, r2, sleep, fmt, fmtMult, wallet, ui } = App;

  const SIZE = 25;
  const GEM = `<svg viewBox="0 0 24 24"><path d="M6 3h12l4 6-10 12L2 9z" fill="#21e07a"/><path d="M2 9h20M8 3l4 18 4-18M6 3l2 6 4-6 4 6 2-6" stroke="#0b8f46" stroke-width="1" fill="none"/></svg>`;
  const MINE = `<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="7.5" fill="#ff3d5e"/><circle cx="9.5" cy="10.5" r="2" fill="#ffb3c0"/><path d="M12 5.5V3M17.5 7.5l1.6-1.6M6.5 7.5L4.9 5.9" stroke="#ff3d5e" stroke-width="2" stroke-linecap="round"/></svg>`;

  App.registerGame({
    id: 'mines',
    name: 'Mines',
    desc: 'Odkrywaj diamenty i omijaj miny. Wypłać wygraną w dowolnym momencie.',
    accent: '#1fdc7a',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 4h12l4 5-10 11L2 9z"/><path d="M2 9h20"/></svg>`,

    create(root) {
      const EDGE = App.config.houseEdge;
      let mineCount = 3;
      let game = null; // { bet, mines:Set, revealed:Set }
      const autoSel = new Set();
      let busy = false;

      function multFor(k, m = mineCount) {
        let x = 1 - EDGE;
        for (let i = 0; i < k; i++) x *= (SIZE - i) / (SIZE - m - i);
        return x;
      }

      const { panel, stage } = ui.gameLayout(root, 'mines-stage');
      const tabs = ui.modeTabs((m) => {
        auto.node.classList.toggle('hidden', m !== 'auto');
        autoSel.clear();
        resetBoard();
        updateUI();
      });
      const bet = ui.betControl();
      const minesSel = ui.selectField('Miny', [...Array(24)].map((_, i) => [i + 1, i + 1]), mineCount);
      const gemsField = ui.field('Diamenty', `<div class="input-wrap readonly"><input type="text" readonly data-gems></div>`);
      const profitField = ui.field('Łączny zysk', `<div class="input-wrap readonly"><span class="input-prefix">$</span><input type="text" readonly data-profit></div>`, '');
      const liveFields = el(`<div class="live-fields hidden"></div>`);
      liveFields.append(gemsField, profitField);
      const auto = ui.autobet({ bet, play: playAuto, delay: 400, onState: () => updateUI() });
      auto.node.classList.add('hidden');
      const button = el(`<button class="btn btn-primary btn-bet">Postaw</button>`);
      const randomBtn = el(`<button type="button" class="btn btn-secondary btn-random hidden">Losowe pole</button>`);
      panel.append(tabs.node, bet.node, minesSel.node, liveFields, auto.node, button, randomBtn);

      const info = el(`<div class="mines-info"><span data-next></span></div>`);
      const board = el(`<div class="mines-board"></div>`);
      const tiles = [];
      for (let i = 0; i < SIZE; i++) {
        const t = el(`<button type="button" class="mine-tile"></button>`);
        t.addEventListener('click', () => onTile(i));
        tiles.push(t);
        board.appendChild(t);
      }
      const boardWrap = el(`<div class="board-wrap"></div>`);
      boardWrap.append(board);
      stage.append(info, boardWrap);
      const popup = ui.winPopup(boardWrap);

      function setTile(i, state, dim = false) {
        const t = tiles[i];
        t.className = 'mine-tile' + (state ? ' ' + state : '') + (dim ? ' dim' : '') + (autoSel.has(i) ? ' selected' : '');
        t.innerHTML = state === 'gem' ? GEM : state === 'mine' ? MINE : '';
      }
      function resetBoard() {
        popup.hide();
        tiles.forEach((_, i) => setTile(i, ''));
      }
      function revealAll(mines, revealed) {
        tiles.forEach((_, i) => {
          if (!revealed.has(i)) setTile(i, mines.has(i) ? 'mine' : 'gem', true);
        });
      }

      function updateUI() {
        const active = !!game;
        const locked = active || auto.running || busy;
        bet.setDisabled(locked);
        minesSel.select.disabled = locked;
        tabs.setLocked(locked);
        liveFields.classList.toggle('hidden', !active);
        randomBtn.classList.toggle('hidden', !active);
        board.classList.toggle('playing', active);
        board.classList.toggle('selecting', tabs.mode === 'auto' && !auto.running);
        if (tabs.mode === 'auto') {
          button.textContent = auto.running ? 'Zatrzymaj autobet' : 'Rozpocznij autobet';
          button.disabled = false;
        } else if (active) {
          button.textContent = 'Wypłać';
          button.disabled = game.revealed.size === 0;
        } else {
          button.textContent = 'Postaw';
          button.disabled = false;
        }
        button.classList.toggle('btn-stop', auto.running);
        button.classList.toggle('btn-cashout', active);

        const k = active ? game.revealed.size : tabs.mode === 'auto' ? autoSel.size : 0;
        if (active) {
          const m = multFor(k);
          $('[data-gems]', gemsField).value = SIZE - mineCount - k;
          $('.field-label span', profitField).textContent = `Łączny zysk (${fmtMult(m)})`;
          $('[data-profit]', profitField).value = r2(game.bet * m - game.bet).toFixed(2);
        }
        const left = SIZE - mineCount - k;
        info.querySelector('[data-next]').textContent =
          tabs.mode === 'auto'
            ? `Zaznaczone pola: ${autoSel.size} · Mnożnik: ${fmtMult(autoSel.size ? multFor(autoSel.size) : 0)}`
            : left > 0
              ? `Następne pole: ${fmtMult(multFor(k + 1))}`
              : '';
      }

      function start() {
        const amount = bet.value;
        if (!App.placeBet(amount)) return;
        resetBoard();
        game = { bet: amount, mines: new Set(App.sample(SIZE, mineCount)), revealed: new Set() };
        updateUI();
      }

      function finish(win) {
        const g = game;
        game = null;
        const k = g.revealed.size;
        const m = win ? multFor(k) : 0;
        const payout = win ? r2(g.bet * m) : 0;
        if (payout) wallet.credit(payout);
        App.recordBet({ game: 'mines', wagered: g.bet, payout, multiplier: m });
        revealAll(g.mines, g.revealed);
        if (win) popup.show(m, payout);
        updateUI();
      }

      function reveal(i) {
        if (!game || game.revealed.has(i)) return;
        if (game.mines.has(i)) {
          setTile(i, 'mine');
          tiles[i].classList.add('boom');
          App.haptic([40, 40, 60]);
          finish(false);
          return;
        }
        game.revealed.add(i);
        setTile(i, 'gem');
        tiles[i].classList.add('pop');
        if (game.revealed.size === SIZE - mineCount) finish(true);
        else updateUI();
      }

      function onTile(i) {
        if (game) return reveal(i);
        if (tabs.mode !== 'auto' || auto.running || busy) return;
        if (autoSel.has(i)) autoSel.delete(i);
        else if (autoSel.size < SIZE - mineCount) autoSel.add(i);
        else return App.toast('Za dużo zaznaczonych pól przy tej liczbie min');
        resetBoard();
        updateUI();
      }

      async function playAuto(amount) {
        if (!autoSel.size) { App.toast('Zaznacz pola na planszy'); return null; }
        if (!App.placeBet(amount)) return null;
        busy = true;
        resetBoard();
        const mines = new Set(App.sample(SIZE, mineCount));
        const sel = [...autoSel];
        const hitMine = sel.some((i) => mines.has(i));
        sel.forEach((i) => setTile(i, mines.has(i) ? 'mine' : 'gem'));
        revealAll(mines, new Set(sel));
        const m = hitMine ? 0 : multFor(sel.length);
        const payout = r2(amount * m);
        if (payout) wallet.credit(payout);
        App.recordBet({ game: 'mines', wagered: amount, payout, multiplier: m });
        if (m) popup.show(m, payout, 500);
        await sleep(500);
        busy = false;
        return { wagered: amount, payout };
      }

      minesSel.select.addEventListener('change', () => {
        mineCount = +minesSel.select.value;
        while (autoSel.size > SIZE - mineCount) autoSel.delete([...autoSel].pop());
        resetBoard();
        updateUI();
      });
      button.addEventListener('click', () => {
        if (tabs.mode === 'auto') return auto.toggle();
        if (game) finish(true);
        else start();
      });
      randomBtn.addEventListener('click', () => {
        if (!game) return;
        const hidden = tiles.map((_, i) => i).filter((i) => !game.revealed.has(i));
        reveal(hidden[App.randInt(hidden.length)]);
      });

      updateUI();
      return {};
    },
  });
})();
