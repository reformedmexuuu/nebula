(function () {
  'use strict';
  const { el, $, r2, sleep, fmtMult, wallet, ui } = App;

  const MAX_ROLLS = 5;
  const S = 0; // wąż
  // Wartość pola dla każdej sumy oczek 2..12 (0 = wąż). Każdy rzut ma RTP 98%.
  const LEVELS = {
    easy: { label: 'Łatwy', tiles: [2, 1.3, 1.2, 1.1, 1.01, S, 1.01, 1.1, 1.2, 1.3, 2] },
    medium: { label: 'Średni', tiles: [4, 2.5, 1.4, 1.11, S, S, S, 1.11, 1.4, 2.5, 4] },
    hard: { label: 'Trudny', tiles: [7.5, 3, 1.38, S, S, S, S, S, 1.38, 3, 7.5] },
    expert: { label: 'Ekspert', tiles: [10, 3.82, S, S, S, S, S, S, S, 3.82, 10] },
    master: { label: 'Mistrz', tiles: [17.64, S, S, S, S, S, S, S, S, S, 17.64] },
  };
  // Pola na obwodzie planszy 4×4: [wiersz, kolumna]; pole 0 to start, pole i (1..11) = suma i+1
  const RING = [[1, 1], [1, 2], [1, 3], [1, 4], [2, 4], [3, 4], [4, 4], [4, 3], [4, 2], [4, 1], [3, 1], [2, 1]];
  const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
  const SNAKE = `<svg viewBox="0 0 32 32"><path d="M6 26c6 0 6-6 12-6s6 6 10 2" stroke="#ff3d5e" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M6 26c-2-6 4-10 8-12 5-2 6-6 3-8" stroke="#ff3d5e" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="16" cy="5.5" r="3.6" fill="#ff3d5e"/><circle cx="15" cy="4.8" r=".9" fill="#fff"/></svg>`;

  const dieHTML = (v) => `<div class="die">${[...Array(9)].map((_, i) => `<i${PIPS[v].includes(i + 1) ? ' class="on"' : ''}></i>`).join('')}</div>`;

  App.registerGame({
    id: 'snakes',
    name: 'Snakes',
    desc: 'Rzucaj dwiema kośćmi i przesuwaj się po planszy. Mnożniki się sumują, wąż kończy grę. Maksymalnie 5 rzutów.',
    accent: '#3ddc84',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 19c4 0 4-4 8-4s4 4 8 1"/><path d="M4 19c-1-4 3-7 6-8 3-1 4-4 2-6"/><circle cx="12" cy="4" r="1.8" fill="currentColor"/></svg>`,

    create(root) {
      let level = 'medium';
      let game = null; // { bet, mult, rolls, pos }
      let busy = false;
      let pos = 0;

      const { panel, stage } = ui.gameLayout(root, 'snakes-stage');
      const bet = ui.betControl();
      const levelSel = ui.selectField('Trudność', Object.entries(LEVELS).map(([k, v]) => [k, v.label]), level);
      const profitField = ui.field('Łączny zysk', `<div class="input-wrap readonly"><span class="input-prefix">$</span><input type="text" readonly></div>`);
      profitField.classList.add('hidden');
      const button = el(`<button class="btn btn-primary btn-bet">Postaw</button>`);
      const cashBtn = el(`<button type="button" class="btn btn-secondary btn-random hidden">Wypłać</button>`);
      panel.append(bet.node, levelSel.node, profitField, button, cashBtn);

      const status = el(`<div class="ladder-status">Postaw zakład — pierwszy rzut następuje od razu</div>`);
      const board = el(`<div class="snakes-board"><div class="snakes-center"><div class="dice-pair">${dieHTML(1)}${dieHTML(1)}</div><div class="snakes-sum">–</div></div></div>`);
      const tiles = RING.map(([r, c], i) => {
        const t = el(`<div class="snake-tile${i === 0 ? ' start' : ''}"><span class="tile-sum"></span><span class="tile-val"></span></div>`);
        t.style.gridArea = `${r} / ${c}`;
        board.appendChild(t);
        return t;
      });
      const token = el(`<div class="snakes-token"></div>`);
      board.appendChild(token);
      const rollsEl = el(`<div class="snakes-rolls"></div>`);
      const boardWrap = el(`<div class="board-wrap"></div>`);
      boardWrap.append(board);
      stage.append(status, boardWrap, rollsEl);
      const popup = ui.winPopup(boardWrap);
      const diceEl = $('.dice-pair', board);
      const sumEl = $('.snakes-sum', board);

      function renderTiles() {
        const vals = LEVELS[level].tiles;
        tiles.forEach((t, i) => {
          if (i === 0) { $('.tile-val', t).textContent = 'START'; return; }
          const v = vals[i - 1];
          $('.tile-sum', t).textContent = i + 1;
          t.classList.toggle('snake', v === S);
          $('.tile-val', t).innerHTML = v === S ? SNAKE : fmtMult(v);
        });
      }

      function placeToken(i) {
        pos = i;
        const t = tiles[i];
        token.style.left = t.offsetLeft + t.offsetWidth / 2 + 'px';
        token.style.top = t.offsetTop + t.offsetHeight / 2 + 'px';
      }
      new ResizeObserver(() => placeToken(pos)).observe(board);

      function renderRolls() {
        const done = game ? game.rolls : [];
        rollsEl.innerHTML = [...Array(MAX_ROLLS)]
          .map((_, i) => {
            const r = done[i];
            if (!r) return `<div class="roll-slot"></div>`;
            return `<div class="roll-slot ${r.v === S ? 'bad' : 'ok'}">${r.v === S ? 'Wąż' : fmtMult(r.v)}</div>`;
          })
          .join('');
      }

      function updateUI() {
        const active = !!game;
        bet.setDisabled(active || busy);
        levelSel.select.disabled = active || busy;
        profitField.classList.toggle('hidden', !active);
        cashBtn.classList.toggle('hidden', !active);
        cashBtn.disabled = busy;
        button.textContent = active ? `Rzuć (${game.rolls.length + 1}/${MAX_ROLLS})` : 'Postaw';
        button.disabled = busy;
        if (active) {
          $('.field-label span', profitField).textContent = `Łączny zysk (${fmtMult(game.mult)})`;
          $('input', profitField).value = r2(game.bet * game.mult - game.bet).toFixed(2);
          status.textContent = `Mnożnik: ${fmtMult(game.mult)} · pozostało rzutów: ${MAX_ROLLS - game.rolls.length}`;
        }
      }

      async function moveTo(target) {
        // krok po kroku zgodnie z ruchem wskazówek zegara
        let i = pos;
        while (i !== target) {
          i = (i + 1) % tiles.length;
          placeToken(i);
          await sleep(70);
        }
      }

      async function roll() {
        busy = true;
        updateUI();
        tiles.forEach((t) => t.classList.remove('hit'));
        const d1 = 1 + App.randInt(6), d2 = 1 + App.randInt(6);
        diceEl.classList.add('rolling');
        for (let i = 0; i < 6; i++) {
          diceEl.innerHTML = dieHTML(1 + App.randInt(6)) + dieHTML(1 + App.randInt(6));
          await sleep(60);
        }
        diceEl.classList.remove('rolling');
        diceEl.innerHTML = dieHTML(d1) + dieHTML(d2);
        const sum = d1 + d2;
        sumEl.textContent = sum;
        await moveTo(sum - 1);
        const v = LEVELS[level].tiles[sum - 2];
        tiles[sum - 1].classList.add('hit');
        game.rolls.push({ sum, v });
        renderRolls();
        busy = false;
        if (v === S) {
          App.haptic([40, 40, 60]);
          return finish(false);
        }
        game.mult *= v;
        App.haptic(15);
        if (game.rolls.length >= MAX_ROLLS) return finish(true);
        updateUI();
      }

      async function start() {
        if (!App.placeBet(bet.value)) return;
        popup.hide();
        game = { bet: bet.value, mult: 1, rolls: [] };
        renderRolls();
        await roll();
      }

      function finish(win) {
        const g = game;
        game = null;
        const m = win ? g.mult : 0;
        const payout = r2(g.bet * m);
        if (payout) wallet.credit(payout);
        App.recordBet({ game: 'snakes', wagered: g.bet, payout, multiplier: m });
        status.textContent = win ? `Wypłacono ${fmtMult(m)}` : 'Wąż! Runda przegrana.';
        if (win && m > 1) popup.show(m, payout);
        updateUI();
      }

      levelSel.select.addEventListener('change', () => { level = levelSel.select.value; renderTiles(); });
      button.addEventListener('click', () => (game ? roll() : start()));
      cashBtn.addEventListener('click', () => { if (game && !busy) finish(true); });

      renderTiles();
      renderRolls();
      updateUI();
      requestAnimationFrame(() => placeToken(0));
      return { onShow: () => placeToken(pos) };
    },
  });
})();
