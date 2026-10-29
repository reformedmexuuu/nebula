(function () {
  'use strict';
  const { el, $, r2, clamp, wallet, ui } = App;

  const MIN_TARGET = 1.01, MAX_TARGET = 1000000;

  App.registerGame({
    id: 'limbo',
    name: 'Limbo',
    desc: 'Ustaw docelowy mnożnik. Jeśli wylosowany wynik będzie co najmniej taki sam — wygrywasz.',
    accent: '#ffb02e',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2c3 2.5 4.5 6 4.5 10l-2 4h-5l-2-4C7.5 8 9 4.5 12 2z"/><circle cx="12" cy="9.5" r="1.6"/><path d="M9.5 16l-3 2.5 1-4M14.5 16l3 2.5-1-4M10.5 19.5h3"/></svg>`,

    create(root) {
      const RTP = 1 - App.config.houseEdge;
      let target = 2;
      let busy = false;

      const { panel, stage } = ui.gameLayout(root, 'limbo-stage');
      const tabs = ui.modeTabs((m) => { auto.node.classList.toggle('hidden', m !== 'auto'); updateButton(); });
      const bet = ui.betControl();
      const profitField = ui.field('Zysk przy wygranej', `<div class="input-wrap readonly"><span class="input-prefix">$</span><input type="text" readonly></div>`);
      const auto = ui.autobet({ bet, play: playOnce, delay: 150, onState: lock });
      auto.node.classList.add('hidden');
      const button = el(`<button class="btn btn-primary btn-bet">Postaw</button>`);
      panel.append(tabs.node, bet.node, profitField, auto.node, button);

      const recent = ui.recentBar(stage);
      const display = el(`<div class="limbo-display"><div class="limbo-number">1.00×</div></div>`);
      const number = $('.limbo-number', display);
      stage.appendChild(display);
      stage.appendChild(el(`<div class="limbo-inputs">
        <div class="field"><label class="field-label"><span>Docelowy mnożnik</span></label>
          <div class="input-wrap"><input type="number" step="0.01" min="${MIN_TARGET}" data-target><span class="input-suffix">×</span></div></div>
        <div class="field"><label class="field-label"><span>Szansa wygranej</span></label>
          <div class="input-wrap"><input type="number" step="0.0001" data-chance><span class="input-suffix">%</span></div></div>
      </div>`));
      const targetIn = $('[data-target]', stage);
      const chanceIn = $('[data-chance]', stage);
      const popup = ui.winPopup(display);

      const chance = () => (RTP * 100) / target;
      const fmtNum = (x) => x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '×';

      function refresh() {
        if (document.activeElement !== targetIn) targetIn.value = target.toFixed(2);
        if (document.activeElement !== chanceIn) chanceIn.value = +chance().toPrecision(6);
        $('input', profitField).value = r2(bet.value * (target - 1)).toFixed(2);
      }
      function setTarget(t) {
        target = Math.round(clamp(t, MIN_TARGET, MAX_TARGET) * 100) / 100;
        refresh();
      }
      targetIn.addEventListener('change', () => { setTarget(parseFloat(targetIn.value) || 2); targetIn.value = target.toFixed(2); });
      chanceIn.addEventListener('change', () => {
        const c = clamp(parseFloat(chanceIn.value) || 49.5, (RTP * 100) / MAX_TARGET, (RTP * 100) / MIN_TARGET);
        setTarget((RTP * 100) / c);
        chanceIn.value = +chance().toPrecision(6);
      });
      bet.onChange(refresh);

      // Wynik: P(wynik >= t) = RTP / t, minimum 1.00×
      function roll() {
        const x = RTP / (1 - App.rand());
        return Math.min(MAX_TARGET, Math.max(1, Math.floor(x * 100) / 100));
      }

      async function animateTo(result, ms) {
        const start = performance.now();
        // licznik rośnie logarytmicznie, żeby duże wyniki też wyglądały płynnie
        const lnEnd = Math.log(result);
        await new Promise((resolve) => {
          function frame(now) {
            const t = Math.min(1, (now - start) / ms);
            const e = 1 - Math.pow(1 - t, 3);
            number.textContent = fmtNum(t < 1 ? Math.exp(lnEnd * e) : result);
            if (t < 1) requestAnimationFrame(frame);
            else resolve();
          }
          requestAnimationFrame(frame);
          // zabezpieczenie, gdy karta jest w tle i animacje stoją
          setTimeout(resolve, ms + 200);
        });
        number.textContent = fmtNum(result);
      }

      async function playOnce(amount) {
        if (busy) return null;
        if (!App.placeBet(amount)) return null;
        busy = true;
        if (!auto.running) button.disabled = true;
        popup.hide();
        const t = target;
        const result = roll();
        const win = result >= t;
        number.className = 'limbo-number';
        await animateTo(result, auto.running ? 220 : 450);
        number.classList.add(win ? 'win' : 'lose');
        const payout = win ? r2(amount * t) : 0;
        if (payout) wallet.credit(payout);
        App.recordBet({ game: 'limbo', wagered: amount, payout, multiplier: win ? t : 0 });
        recent.push(fmtNum(result), win ? 'win' : 'lose');
        if (win && !auto.running) popup.show(t, payout, 1500);
        busy = false;
        button.disabled = false;
        return { wagered: amount, payout };
      }

      function lock(running) {
        bet.setDisabled(running);
        tabs.setLocked(running);
        targetIn.disabled = chanceIn.disabled = running;
        updateButton();
      }
      function updateButton() {
        button.textContent = tabs.mode === 'auto' ? (auto.running ? 'Zatrzymaj autobet' : 'Rozpocznij autobet') : 'Postaw';
        button.classList.toggle('btn-stop', auto.running);
      }
      button.addEventListener('click', () => (tabs.mode === 'auto' ? auto.toggle() : playOnce(bet.value)));

      refresh();
      return {};
    },
  });
})();
