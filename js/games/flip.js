(function () {
  'use strict';
  const { el, $, $$, r2, sleep, fmtMult, wallet, ui } = App;

  const RTP = 0.98;       // Flip ma 2% przewagi kasyna
  const MAX_ROUNDS = 20;  // 0.98 × 2^20 = 1 027 604.48×
  const SIDES = { heads: 'Orzeł', tails: 'Reszka' };

  App.registerGame({
    id: 'flip',
    name: 'Flip',
    desc: 'Rzut monetą: zgadnij stronę, a każdy trafiony rzut podwaja mnożnik. Wypłać, zanim się pomylisz.',
    accent: '#ffd23d',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="12" rx="9" ry="9.5"/><ellipse cx="12" cy="12" rx="5.5" ry="6"/><path d="M12 9v6"/></svg>`,

    create(root) {
      let game = null; // { bet, wins, history: [] }
      let busy = false;
      const multFor = (k) => (k === 0 ? 1 : RTP * Math.pow(2, k));

      const { panel, stage } = ui.gameLayout(root, 'flip-stage');
      const bet = ui.betControl();
      const profitField = ui.field('Łączny zysk', `<div class="input-wrap readonly"><span class="input-prefix">$</span><input type="text" readonly></div>`);
      profitField.classList.add('hidden');
      const picks = el(`<div class="pick-row hidden">
        <button type="button" class="btn btn-secondary pick-btn" data-side="heads"><span class="coin-mini heads"></span>Orzeł</button>
        <button type="button" class="btn btn-secondary pick-btn" data-side="tails"><span class="coin-mini tails"></span>Reszka</button>
        <button type="button" class="btn btn-secondary pick-btn wide" data-side="random">Losowo</button>
      </div>`);
      const button = el(`<button class="btn btn-primary btn-bet">Postaw</button>`);
      panel.append(bet.node, profitField, picks, button);

      const status = el(`<div class="ladder-status">Postaw zakład, a potem wybierz stronę monety</div>`);
      const coinWrap = el(`<div class="coin-wrap"><div class="coin"><div class="coin-face heads">O</div><div class="coin-face tails">R</div></div></div>`);
      const coin = $('.coin', coinWrap);
      const trail = el(`<div class="flip-trail"></div>`);
      const ladder = el(`<div class="mult-ladder"></div>`);
      stage.append(status, coinWrap, trail, ladder);
      const popup = ui.winPopup(coinWrap);
      let spin = 0; // łączny obrót monety w stopniach

      function renderLadder() {
        const k = game ? game.wins : 0;
        // pokazujemy okno kilku kolejnych szczebli wokół bieżącego
        const from = Math.max(1, Math.min(k, MAX_ROUNDS - 5));
        ladder.innerHTML = [...Array(6)]
          .map((_, i) => {
            const r = from + i;
            if (r > MAX_ROUNDS) return '';
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
          status.textContent = game.wins
            ? `Trafienia: ${game.wins} · następny rzut: ${fmtMult(multFor(game.wins + 1))}`
            : `Wybierz stronę · wygrana: ${fmtMult(multFor(1))}`;
        }
        renderLadder();
      }

      function renderTrail() {
        trail.innerHTML = (game ? game.history : []).map((h) => `<span class="coin-mini ${h.side}${h.ok ? '' : ' bad'}"></span>`).join('');
      }

      function start() {
        if (!App.placeBet(bet.value)) return;
        popup.hide();
        game = { bet: bet.value, wins: 0, history: [] };
        renderTrail();
        updateUI();
      }

      function finish(win) {
        const g = game;
        game = null;
        const m = win ? multFor(g.wins) : 0;
        const payout = r2(g.bet * m);
        if (payout) wallet.credit(payout);
        App.recordBet({ game: 'flip', wagered: g.bet, payout, multiplier: m });
        status.textContent = win ? `Wypłacono ${fmtMult(m)}` : 'Pudło! Moneta wypadła na drugą stronę.';
        if (win) popup.show(m, payout);
        updateUI();
      }

      async function pick(side) {
        if (!game || busy) return;
        if (side === 'random') side = App.rand() < 0.5 ? 'heads' : 'tails';
        busy = true;
        updateUI();
        const result = App.rand() < 0.5 ? 'heads' : 'tails';
        // kilka pełnych obrotów + ustawienie właściwej strony do góry
        const targetMod = result === 'heads' ? 0 : 180;
        spin += 1080 + ((targetMod - (spin % 360) + 360) % 360);
        coin.style.transform = `rotateY(${spin}deg)`;
        await sleep(700);
        const ok = side === result;
        game.history.push({ side: result, ok });
        renderTrail();
        App.haptic(ok ? 15 : [40, 40, 60]);
        busy = false;
        if (!ok) return finish(false);
        game.wins++;
        if (game.wins >= MAX_ROUNDS) return finish(true);
        updateUI();
      }

      $$('[data-side]', picks).forEach((b) => b.addEventListener('click', () => pick(b.dataset.side)));
      button.addEventListener('click', () => (game ? finish(true) : start()));

      updateUI();
      return {};
    },
  });
})();
