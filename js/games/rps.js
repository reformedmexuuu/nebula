(function () {
  'use strict';
  const { el, $, $$, r2, sleep, fmtMult, wallet, ui } = App;

  const RTP = 0.98;       // 2% przewagi kasyna
  const MAX_ROUNDS = 20;  // 0.98 × 2^20 = 1 027 604.48×
  const HANDS = {
    rock: { label: 'Kamień', emoji: '✊' },
    paper: { label: 'Papier', emoji: '✋' },
    scissors: { label: 'Nożyce', emoji: '✌️' },
  };
  const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
  const KEYS = Object.keys(HANDS);

  App.registerGame({
    id: 'rps',
    name: 'Kamień Papier Nożyce',
    short: 'KPN',
    desc: 'Pokonaj krupiera. Każda wygrana podwaja mnożnik, remis nic nie zmienia, przegrana kończy rundę.',
    accent: '#5bc0ff',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M7 11V5.5a1.5 1.5 0 0 1 3 0V10m0-5.5v-1a1.5 1.5 0 0 1 3 0V10m0-5a1.5 1.5 0 0 1 3 0v5m0-3a1.5 1.5 0 0 1 3 0v6.5A7.5 7.5 0 0 1 11.5 21h-.5a6 6 0 0 1-5.2-3L3.5 14a1.6 1.6 0 0 1 2.6-1.8L7 13.5"/></svg>`,

    create(root) {
      let game = null; // { bet, wins }
      let busy = false;
      const multFor = (k) => (k === 0 ? 1 : RTP * Math.pow(2, k));

      const { panel, stage } = ui.gameLayout(root, 'rps-stage');
      const bet = ui.betControl();
      const profitField = ui.field('Łączny zysk', `<div class="input-wrap readonly"><span class="input-prefix">$</span><input type="text" readonly></div>`);
      profitField.classList.add('hidden');
      const picks = el(`<div class="pick-row three hidden">
        ${KEYS.map((k) => `<button type="button" class="btn btn-secondary pick-btn" data-hand="${k}"><span class="pick-emoji">${HANDS[k].emoji}</span>${HANDS[k].label}</button>`).join('')}
        <button type="button" class="btn btn-secondary pick-btn wide" data-hand="random">Losowo</button>
      </div>`);
      const button = el(`<button class="btn btn-primary btn-bet">Postaw</button>`);
      panel.append(bet.node, profitField, picks, button);

      const status = el(`<div class="ladder-status">Postaw zakład, a potem wybierz rękę</div>`);
      const arena = el(`<div class="rps-arena">
        <div class="rps-side"><span class="rps-who">Ty</span><div class="rps-hand" data-you>❔</div></div>
        <div class="rps-vs">VS</div>
        <div class="rps-side"><span class="rps-who">Krupier</span><div class="rps-hand" data-house>❔</div></div>
      </div>`);
      const you = $('[data-you]', arena), house = $('[data-house]', arena);
      const ladder = el(`<div class="mult-ladder"></div>`);
      stage.append(status, arena, ladder);
      const popup = ui.winPopup(arena);

      function renderLadder() {
        const k = game ? game.wins : 0;
        const from = Math.max(1, Math.min(k, MAX_ROUNDS - 5));
        ladder.innerHTML = [...Array(6)]
          .map((_, i) => {
            const r = from + i;
            const cls = game && r <= k ? 'done' : game && r === k + 1 ? 'current' : '';
            return `<div class="rung ${cls}"><span>${r}</span><b>${fmtMult(multFor(r))}</b></div>`;
          })
          .join('');
      }

      function updateUI() {
        const active = !!game;
        bet.setDisabled(active);
        picks.classList.toggle('hidden', !active);
        $$('button', picks).forEach((b) => (b.disabled = busy));
        profitField.classList.toggle('hidden', !active);
        button.textContent = active ? 'Wypłać' : 'Postaw';
        button.classList.toggle('btn-cashout', active);
        button.disabled = busy || (active && game.wins === 0);
        if (active) {
          const m = multFor(game.wins);
          $('.field-label span', profitField).textContent = `Łączny zysk (${fmtMult(m)})`;
          $('input', profitField).value = r2(game.bet * m - game.bet).toFixed(2);
        }
        renderLadder();
      }

      function start() {
        if (!App.placeBet(bet.value)) return;
        popup.hide();
        game = { bet: bet.value, wins: 0 };
        you.textContent = house.textContent = '❔';
        arena.className = 'rps-arena';
        status.textContent = `Wybierz rękę · wygrana: ${fmtMult(multFor(1))}`;
        updateUI();
      }

      function finish(win) {
        const g = game;
        game = null;
        const m = win ? multFor(g.wins) : 0;
        const payout = r2(g.bet * m);
        if (payout) wallet.credit(payout);
        App.recordBet({ game: 'rps', wagered: g.bet, payout, multiplier: m });
        if (win) {
          status.textContent = `Wypłacono ${fmtMult(m)}`;
          popup.show(m, payout);
        }
        updateUI();
      }

      async function play(hand) {
        if (!game || busy) return;
        if (hand === 'random') hand = KEYS[App.randInt(3)];
        busy = true;
        updateUI();
        arena.className = 'rps-arena shaking';
        you.textContent = house.textContent = '✊';
        await sleep(600);
        const dealer = KEYS[App.randInt(3)];
        arena.className = 'rps-arena';
        you.textContent = HANDS[hand].emoji;
        house.textContent = HANDS[dealer].emoji;
        busy = false;
        if (hand === dealer) {
          arena.classList.add('tie');
          status.textContent = `Remis — zagraj jeszcze raz · mnożnik ${fmtMult(multFor(game.wins))}`;
          return updateUI();
        }
        if (BEATS[hand] === dealer) {
          arena.classList.add('win');
          game.wins++;
          App.haptic(15);
          status.textContent = `${HANDS[hand].label} bije ${HANDS[dealer].label.toLowerCase()}! Następna wygrana: ${fmtMult(multFor(game.wins + 1))}`;
          if (game.wins >= MAX_ROUNDS) return finish(true);
          return updateUI();
        }
        arena.classList.add('lose');
        App.haptic([40, 40, 60]);
        status.textContent = `${HANDS[dealer].label} bije ${HANDS[hand].label.toLowerCase()}. Runda przegrana.`;
        finish(false);
      }

      $$('[data-hand]', picks).forEach((b) => b.addEventListener('click', () => play(b.dataset.hand)));
      button.addEventListener('click', () => (game ? finish(true) : start()));

      updateUI();
      return {};
    },
  });
})();
