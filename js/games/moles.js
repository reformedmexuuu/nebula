(function () {
  'use strict';
  const { el, $, r2, sleep, fmtMult, wallet, ui } = App;

  const HOLES = 9;
  const ROUNDS = 8;
  const LEVELS = {
    easy: { label: 'Łatwy (6 kretów)', moles: 6 },
    medium: { label: 'Średni (4 krety)', moles: 4 },
    hard: { label: 'Trudny (3 krety)', moles: 3 },
    expert: { label: 'Ekspert (2 krety)', moles: 2 },
  };
  const MOLE = `<svg class="mole" viewBox="0 0 100 100">
    <ellipse cx="50" cy="62" rx="34" ry="38" fill="#8a5a3b"/>
    <ellipse cx="50" cy="72" rx="22" ry="22" fill="#c48f69"/>
    <circle cx="37" cy="46" r="5" fill="#1b1b1b" class="eye"/><circle cx="63" cy="46" r="5" fill="#1b1b1b" class="eye"/>
    <circle cx="38.5" cy="44.5" r="1.6" fill="#fff"/><circle cx="64.5" cy="44.5" r="1.6" fill="#fff"/>
    <ellipse cx="50" cy="58" rx="8" ry="6" fill="#ff7a9a"/>
    <path d="M44 66 q6 6 12 0" stroke="#3b2414" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <rect x="45" y="66" width="4.5" height="6" rx="1" fill="#fff"/><rect x="50.5" y="66" width="4.5" height="6" rx="1" fill="#fff"/>
    <g class="stars" fill="#ffd23d"><path d="M28 22l2 5 5 .5-4 3 1.5 5-4.5-3-4.5 3 1.5-5-4-3 5-.5z"/><path d="M72 18l2 5 5 .5-4 3 1.5 5-4.5-3-4.5 3 1.5-5-4-3 5-.5z"/></g>
  </svg>`;
  const HAMMER = `<svg class="hammer" viewBox="0 0 64 64"><rect x="29" y="22" width="7" height="38" rx="3" fill="#b8865b"/><rect x="12" y="8" width="40" height="18" rx="5" fill="#9aa7b8"/><rect x="12" y="8" width="40" height="6" rx="3" fill="#c8d2df"/></svg>`;

  App.registerGame({
    id: 'moles',
    name: 'Moles',
    desc: 'Uderz młotkiem w norę, z której wyskoczy kret. Każde trafienie podbija mnożnik — wypłać zanim spudłujesz.',
    accent: '#c48f69',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 20c0-5 3-9 7-9s7 4 7 9"/><circle cx="9.5" cy="15" r=".8" fill="currentColor"/><circle cx="14.5" cy="15" r=".8" fill="currentColor"/><path d="M2 20h20"/><path d="M14 3l5 5M16.5 5.5L12 10"/></svg>`,

    create(root) {
      const EDGE = App.config.houseEdge;
      let level = 'medium';
      let game = null; // { bet, round }
      let busy = false;

      const multFor = (k, lv = level) => (k === 0 ? 1 : (1 - EDGE) * Math.pow(HOLES / LEVELS[lv].moles, k));

      const { panel, stage } = ui.gameLayout(root, 'moles-stage');
      const bet = ui.betControl();
      const levelSel = ui.selectField('Trudność', Object.entries(LEVELS).map(([k, v]) => [k, v.label]), level);
      const profitField = ui.field('Łączny zysk', `<div class="input-wrap readonly"><span class="input-prefix">$</span><input type="text" readonly></div>`);
      profitField.classList.add('hidden');
      const button = el(`<button class="btn btn-primary btn-bet">Postaw</button>`);
      const randomBtn = el(`<button type="button" class="btn btn-secondary btn-random hidden">Losowa nora</button>`);
      panel.append(bet.node, levelSel.node, profitField, button, randomBtn);

      const ladder = el(`<div class="moles-ladder"></div>`);
      const status = el(`<div class="moles-status">Postaw zakład i wybierz norę</div>`);
      const field = el(`<div class="moles-field"></div>`);
      const holes = [];
      for (let i = 0; i < HOLES; i++) {
        const h = el(`<button type="button" class="hole">
          <div class="hole-pit"><div class="hole-mole">${MOLE}</div></div>
          ${HAMMER}
          <div class="hole-miss">✕</div>
        </button>`);
        h.addEventListener('click', () => whack(i));
        holes.push(h);
        field.appendChild(h);
      }
      const fieldWrap = el(`<div class="board-wrap"></div>`);
      fieldWrap.append(field);
      stage.append(ladder, status, fieldWrap);
      const popup = ui.winPopup(fieldWrap);

      function renderLadder() {
        const r = game ? game.round : -1;
        ladder.innerHTML = [...Array(ROUNDS)]
          .map((_, k) => {
            const cls = game && k < r ? 'done' : game && k === r ? 'current' : '';
            return `<div class="rung ${cls}"><span>${k + 1}</span><b>${fmtMult(multFor(k + 1))}</b></div>`;
          })
          .join('');
        // na wąskim ekranie drabinka się przewija — trzymaj bieżącą rundę na widoku
        const cur = ladder.querySelector('.current');
        if (cur && ladder.scrollWidth > ladder.clientWidth) ladder.scrollLeft = cur.offsetLeft - ladder.clientWidth / 2 + cur.offsetWidth / 2;
        else if (!game) ladder.scrollLeft = 0;
      }

      function clearHoles() {
        holes.forEach((h) => (h.className = 'hole'));
      }

      function updateUI() {
        const active = !!game;
        bet.setDisabled(active);
        levelSel.select.disabled = active;
        profitField.classList.toggle('hidden', !active);
        randomBtn.classList.toggle('hidden', !active);
        randomBtn.disabled = busy;
        field.classList.toggle('playing', active && !busy);
        button.textContent = active ? 'Wypłać' : 'Postaw';
        button.classList.toggle('btn-cashout', active);
        button.disabled = busy || (active && game.round === 0);
        if (active) {
          const m = multFor(game.round);
          $('.field-label span', profitField).textContent = `Łączny zysk (${fmtMult(m)})`;
          $('input', profitField).value = r2(game.bet * m - game.bet).toFixed(2);
          status.textContent = `Runda ${game.round + 1}/${ROUNDS} · następne trafienie: ${fmtMult(multFor(game.round + 1))}`;
        }
        renderLadder();
      }

      function start() {
        if (!App.placeBet(bet.value)) return;
        popup.hide();
        clearHoles();
        game = { bet: bet.value, round: 0 };
        updateUI();
      }

      function finish(win) {
        const g = game;
        game = null;
        const m = win ? multFor(g.round) : 0;
        const payout = r2(g.bet * m);
        if (payout) wallet.credit(payout);
        App.recordBet({ game: 'moles', wagered: g.bet, payout, multiplier: m });
        status.textContent = win ? `Wypłacono ${fmtMult(m)}` : 'Pudło! Kret uciekł z wygraną.';
        if (win) popup.show(m, payout);
        updateUI();
      }

      async function whack(i) {
        if (!game || busy) return;
        busy = true;
        clearHoles();
        updateUI();
        const moles = new Set(App.sample(HOLES, LEVELS[level].moles));
        const hit = moles.has(i);
        holes[i].classList.add('swing');
        await sleep(180);
        moles.forEach((j) => holes[j].classList.add('up'));
        holes[i].classList.add(hit ? 'hit' : 'missed');
        App.haptic(hit ? 20 : [40, 40, 60]);
        await sleep(hit ? 650 : 400);
        busy = false;
        if (!hit) return finish(false);
        game.round++;
        if (game.round >= ROUNDS) return finish(true);
        holes.forEach((h) => h.classList.remove('up', 'swing'));
        updateUI();
      }

      levelSel.select.addEventListener('change', () => { level = levelSel.select.value; renderLadder(); });
      button.addEventListener('click', () => (game ? finish(true) : start()));
      randomBtn.addEventListener('click', () => whack(App.randInt(HOLES)));

      updateUI();
      return {};
    },
  });
})();
