(function () {
  'use strict';
  const { el, $, r2, sleep, fmtMult, wallet, ui } = App;

  const ROUNDS = 8;
  // Środki nor w procentach planszy: układ plastra miodu 2-3-2
  const SPOTS = [[37, 30], [63, 30], [24, 55], [50, 55], [76, 55], [37, 80], [63, 80]];
  const HOLES = SPOTS.length;
  const LEVELS = {
    easy: { label: 'Łatwy (5 kretów)', moles: 5 },
    medium: { label: 'Średni (4 krety)', moles: 4 },
    hard: { label: 'Trudny (3 krety)', moles: 3 },
    expert: { label: 'Ekspert (2 krety)', moles: 2 },
  };
  // Płaski kret: brązowe ciało w kształcie kapsuły, jaśniejszy brzuszek, różowy nos i łapki na krawędzi nory
  const MOLE = `<svg class="mole" viewBox="0 0 64 100">
    <rect x="5" y="8" width="54" height="92" rx="27" fill="#7b5236"/>
    <ellipse cx="22" cy="20" rx="9" ry="5" fill="#9a6d4b" transform="rotate(-25 22 20)"/>
    <ellipse cx="32" cy="74" rx="18" ry="20" fill="#c9966a"/>
    <circle class="eye" cx="22" cy="36" r="4.2" fill="#14202c"/><circle class="eye" cx="42" cy="36" r="4.2" fill="#14202c"/>
    <circle cx="23.4" cy="34.6" r="1.4" fill="#fff"/><circle cx="43.4" cy="34.6" r="1.4" fill="#fff"/>
    <path d="M14 47h8M13 52l9-2M50 47h-8M51 52l-9-2" stroke="#3b2618" stroke-width="1.4" stroke-linecap="round"/>
    <ellipse cx="32" cy="47" rx="7" ry="5.2" fill="#ff8fab"/>
    <ellipse cx="30" cy="45.5" rx="2.2" ry="1.4" fill="#ffd0dc"/>
    <path d="M28.5 54h7v4.5a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5z" fill="#fff"/>
    <path d="M32 54v6" stroke="#d9cfc4" stroke-width="1"/>
    <ellipse cx="13" cy="82" rx="8" ry="6" fill="#f0b9a0"/><ellipse cx="51" cy="82" rx="8" ry="6" fill="#f0b9a0"/>
    <g class="stars" fill="#ffd23d">
      <path d="M14 2l1.6 3.6 3.9.4-2.9 2.6.9 3.9-3.5-2-3.5 2 .9-3.9-2.9-2.6 3.9-.4z"/>
      <path d="M50 2l1.6 3.6 3.9.4-2.9 2.6.9 3.9-3.5-2-3.5 2 .9-3.9-2.9-2.6 3.9-.4z"/>
    </g>
  </svg>`;
  // Młotek: drewniany trzonek i stalowa głowica z zieloną opaską
  const HAMMER = `<svg class="hammer" viewBox="0 0 100 100">
    <rect x="44" y="40" width="10" height="58" rx="5" fill="#c08a55" transform="rotate(-45 49 69)"/>
    <g transform="rotate(-45 40 34)">
      <rect x="14" y="22" width="52" height="26" rx="9" fill="#9fb0c2"/>
      <rect x="14" y="22" width="52" height="8" rx="4" fill="#cdd8e3"/>
      <rect x="35" y="22" width="10" height="26" fill="#1fdc7a"/>
      <rect x="10" y="25" width="7" height="20" rx="3" fill="#7d8ea1"/><rect x="63" y="25" width="7" height="20" rx="3" fill="#7d8ea1"/>
    </g>
  </svg>`;

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
        const h = el(`<button type="button" class="hole" aria-label="Nora ${i + 1}">
          <div class="hole-pit"><div class="hole-mole">${MOLE}</div></div>
          ${HAMMER}
          <div class="hole-miss">✕</div>
        </button>`);
        h.style.setProperty('--x', SPOTS[i][0] + '%');
        h.style.setProperty('--y', SPOTS[i][1] + '%');
        h.addEventListener('click', () => whack(i));
        holes.push(h);
        field.appendChild(h);
      }
      const fieldWrap = el(`<div class="board-wrap"></div>`);
      fieldWrap.append(field);
      const dots = el(`<div class="moles-dots">${'<i></i>'.repeat(ROUNDS)}</div>`);
      stage.append(ladder, status, fieldWrap, dots);
      const popup = ui.winPopup(fieldWrap);

      function renderLadder() {
        const r = game ? game.round : -1;
        ladder.innerHTML = [...Array(ROUNDS)]
          .map((_, k) => {
            const cls = game && k < r ? 'done' : game && k === r ? 'current' : '';
            return `<div class="rung ${cls}"><span>${k + 1}</span><b>${fmtMult(multFor(k + 1))}</b></div>`;
          })
          .join('');
        [...dots.children].forEach((d, k) => (d.className = game && k < r ? 'done' : game && k === r ? 'current' : ''));
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
