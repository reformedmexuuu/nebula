(function () {
  'use strict';
  const { el, $, r2, clamp, fmt, fmtMult, wallet, ui } = App;

  App.registerGame({
    id: 'dice',
    name: 'Dice',
    desc: 'Wybierz próg i zagraj powyżej lub poniżej wylosowanej liczby.',
    accent: '#3d8bff',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/></svg>`,

    create(root) {
      const RTP = (1 - App.config.houseEdge) * 100;
      const MIN_CHANCE = 0.01, MAX_CHANCE = 98;
      let target = 50.5;
      let over = true;

      const { panel, stage } = ui.gameLayout(root, 'dice-stage');
      const tabs = ui.modeTabs((m) => { auto.node.classList.toggle('hidden', m !== 'auto'); updateButton(); });
      const bet = ui.betControl();
      const profitField = ui.field('Zysk przy wygranej', `<div class="input-wrap readonly"><span class="input-prefix">$</span><input type="text" readonly></div>`);
      const auto = ui.autobet({ bet, play: playOnce, delay: 200, onState: lock });
      auto.node.classList.add('hidden');
      const button = el(`<button class="btn btn-primary btn-bet">Postaw</button>`);
      panel.append(tabs.node, bet.node, profitField, auto.node, button);

      const recent = ui.recentBar(stage);
      stage.appendChild(el(`<div class="dice-board">
        <div class="dice-slider">
          <div class="dice-scale"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
          <div class="dice-track-outer">
            <div class="dice-result hidden"><span></span></div>
            <div class="dice-track"></div>
            <input type="range" class="dice-range" min="0" max="100" step="0.01">
          </div>
        </div>
      </div>`));
      stage.appendChild(el(`<div class="dice-inputs">
        <div class="field"><label class="field-label"><span>Mnożnik</span></label>
          <div class="input-wrap"><input type="number" step="0.0001" data-mult><span class="input-suffix">×</span></div></div>
        <div class="field"><label class="field-label"><span data-target-label>Rzut powyżej</span></label>
          <div class="input-wrap clickable" data-swap title="Zamień powyżej/poniżej"><input type="text" readonly data-target><span class="input-suffix">⇄</span></div></div>
        <div class="field"><label class="field-label"><span>Szansa wygranej</span></label>
          <div class="input-wrap"><input type="number" step="0.01" data-chance><span class="input-suffix">%</span></div></div>
      </div>`));

      const range = $('.dice-range', stage);
      const track = $('.dice-track', stage);
      const result = $('.dice-result', stage);
      const multIn = $('[data-mult]', stage);
      const chanceIn = $('[data-chance]', stage);
      const targetIn = $('[data-target]', stage);
      const targetLabel = $('[data-target-label]', stage);

      const chance = () => (over ? 100 - target : target);
      const multiplier = () => Math.floor((RTP / chance()) * 10000) / 10000;

      function setChance(c) {
        c = r2(clamp(c, MIN_CHANCE, MAX_CHANCE));
        target = over ? r2(100 - c) : c;
        refresh();
      }

      function refresh() {
        range.value = target;
        const t = target + '%';
        track.style.background = over
          ? `linear-gradient(90deg, var(--red) 0 ${t}, var(--green) ${t} 100%)`
          : `linear-gradient(90deg, var(--green) 0 ${t}, var(--red) ${t} 100%)`;
        targetLabel.textContent = over ? 'Rzut powyżej' : 'Rzut poniżej';
        targetIn.value = target.toFixed(2);
        if (document.activeElement !== multIn) multIn.value = multiplier().toFixed(4);
        if (document.activeElement !== chanceIn) chanceIn.value = chance().toFixed(2);
        $('input', profitField).value = r2(bet.value * (multiplier() - 1)).toFixed(2);
      }

      range.addEventListener('input', () => {
        target = r2(clamp(parseFloat(range.value), 2, 98));
        refresh();
      });
      $('[data-swap]', stage).addEventListener('click', () => {
        if (auto.running) return;
        over = !over;
        target = r2(100 - target);
        refresh();
      });
      multIn.addEventListener('change', () => {
        const m = clamp(parseFloat(multIn.value) || 2, RTP / MAX_CHANCE, RTP / MIN_CHANCE);
        setChance(RTP / m);
        multIn.value = multiplier().toFixed(4);
      });
      chanceIn.addEventListener('change', () => {
        setChance(parseFloat(chanceIn.value) || 50);
        chanceIn.value = chance().toFixed(2);
      });
      bet.onChange(refresh);

      function playOnce(amount) {
        if (!App.placeBet(amount)) return null;
        const roll = App.randInt(10001) / 100;
        const win = over ? roll > target : roll < target;
        const m = multiplier();
        const payout = win ? r2(amount * m) : 0;
        if (payout) wallet.credit(payout);
        App.recordBet({ game: 'dice', wagered: amount, payout, multiplier: win ? m : 0 });

        result.classList.remove('hidden', 'win', 'lose');
        result.classList.add(win ? 'win' : 'lose');
        result.style.left = roll + '%';
        $('span', result).textContent = roll.toFixed(2);
        recent.push(roll.toFixed(2), win ? 'win' : 'lose');
        return { wagered: amount, payout };
      }

      function lock(running) {
        bet.setDisabled(running);
        tabs.setLocked(running);
        [range, multIn, chanceIn].forEach((x) => (x.disabled = running));
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
