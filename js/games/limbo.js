(function () {
  'use strict';
  const { el, $, $$, r2, clamp, fmt, wallet, ui } = App;

  const MIN_TARGET = 1.01, MAX_TARGET = 1000000;

  App.registerGame({
    id: 'limbo',
    name: 'Limbo',
    desc: 'Ustaw docelowy mnożnik. Jeśli wylosowany wynik będzie co najmniej taki sam — wygrywasz.',
    accent: '#ffb02e',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2c3 2.5 4.5 6 4.5 10l-2 4h-5l-2-4C7.5 8 9 4.5 12 2z"/><circle cx="12" cy="9.5" r="1.6"/><path d="M9.5 16l-3 2.5 1-4M14.5 16l3 2.5-1-4M10.5 19.5h3"/></svg>`,

    create(root) {
      const RTP = 1 - App.config.houseEdge;
      // dwa cele: drugi jest używany tylko z włączonym "Extra Bet"
      const targets = [2, 12];
      let extra = false;
      let busy = false;

      const { panel, stage } = ui.gameLayout(root, 'limbo-stage');
      const tabs = ui.modeTabs((m) => { auto.node.classList.toggle('hidden', m !== 'auto'); updateButton(); });
      const bet = ui.betControl();
      const extraToggle = el(`<label class="switch-row">
        <span>Extra Bet <span class="hint" title="Drugi zakład na inny mnożnik w tym samym losowaniu. Stawka pobierana jest osobno dla każdego celu.">i</span></span>
        <span class="switch"><input type="checkbox"><span class="switch-track"></span></span>
      </label>`);
      const extraInput = $('input', extraToggle);
      const totalField = ui.field('Łączny zakład', `<div class="input-wrap readonly"><span class="input-prefix">$</span><input type="text" readonly></div>`);
      totalField.classList.add('hidden');
      const profitField = ui.field('Zysk przy wygranej', `<div class="input-wrap readonly"><span class="input-prefix">$</span><input type="text" readonly></div>`);
      const auto = ui.autobet({ bet, play: playOnce, delay: 150, onState: lock });
      auto.node.classList.add('hidden');
      const button = el(`<button class="btn btn-primary btn-bet">Postaw</button>`);
      panel.append(tabs.node, bet.node, extraToggle, totalField, profitField, auto.node, button);

      const recent = ui.recentBar(stage);
      const display = el(`<div class="limbo-display"><div class="limbo-number">1.00×</div></div>`);
      const number = $('.limbo-number', display);
      stage.appendChild(display);
      const inputs = el(`<div class="limbo-targets"></div>`);
      targets.forEach((_, i) =>
        inputs.appendChild(el(`<div class="limbo-inputs${i ? ' hidden' : ''}" data-i="${i}">
          <div class="field"><label class="field-label"><span data-tlabel>Docelowy mnożnik</span></label>
            <div class="input-wrap"><input type="number" step="0.01" min="${MIN_TARGET}" data-target><span class="input-suffix">×</span></div></div>
          <div class="field"><label class="field-label"><span>Szansa wygranej</span></label>
            <div class="input-wrap"><input type="number" step="0.0001" data-chance><span class="input-suffix">%</span></div></div>
        </div>`))
      );
      stage.appendChild(inputs);
      const groups = $$('.limbo-inputs', inputs);
      const popup = ui.winPopup(display);

      const active = () => (extra ? targets : targets.slice(0, 1));
      const chance = (t) => (RTP * 100) / t;
      const fmtNum = (x) => x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '×';

      function refresh() {
        groups.forEach((g, i) => {
          const tIn = $('[data-target]', g), cIn = $('[data-chance]', g);
          if (document.activeElement !== tIn) tIn.value = targets[i].toFixed(2);
          if (document.activeElement !== cIn) cIn.value = +chance(targets[i]).toPrecision(6);
          g.classList.toggle('hidden', i > 0 && !extra);
          $('[data-tlabel]', g).textContent = extra ? `Cel zakładu ${i + 1}` : 'Docelowy mnożnik';
        });
        inputs.classList.toggle('double', extra);
        totalField.classList.toggle('hidden', !extra);
        $('input', totalField).value = r2(bet.value * active().length).toFixed(2);
        $('.field-sub', totalField).textContent = extra ? `2 × ${fmt(bet.value)}` : '';
        $('.field-label span', profitField).textContent = extra ? 'Zysk, gdy wygrają oba' : 'Zysk przy wygranej';
        $('input', profitField).value = r2(active().reduce((s, t) => s + bet.value * (t - 1), 0)).toFixed(2);
      }

      groups.forEach((g, i) => {
        const tIn = $('[data-target]', g), cIn = $('[data-chance]', g);
        tIn.addEventListener('change', () => {
          targets[i] = Math.round(clamp(parseFloat(tIn.value) || 2, MIN_TARGET, MAX_TARGET) * 100) / 100;
          tIn.value = targets[i].toFixed(2);
          refresh();
        });
        cIn.addEventListener('change', () => {
          const c = clamp(parseFloat(cIn.value) || 49.5, chance(MAX_TARGET), chance(MIN_TARGET));
          targets[i] = Math.round(clamp((RTP * 100) / c, MIN_TARGET, MAX_TARGET) * 100) / 100;
          cIn.value = +chance(targets[i]).toPrecision(6);
          refresh();
        });
      });
      extraInput.addEventListener('change', () => { extra = extraInput.checked; refresh(); });
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
        const goals = active().slice();
        // każdy cel to osobny zakład z tą samą stawką
        if (!App.placeBet(r2(amount * goals.length))) return null;
        busy = true;
        if (!auto.running) button.disabled = true;
        popup.hide();
        groups.forEach((g) => g.classList.remove('won', 'lost'));
        const result = roll();
        number.className = 'limbo-number';
        await animateTo(result, auto.running ? 220 : 450);

        let payout = 0;
        goals.forEach((t, i) => {
          const win = result >= t;
          const p = win ? r2(amount * t) : 0;
          payout += p;
          App.recordBet({ game: 'limbo', wagered: amount, payout: p, multiplier: win ? t : 0 });
          if (goals.length > 1) groups[i].classList.add(win ? 'won' : 'lost');
        });
        payout = r2(payout);
        const wagered = r2(amount * goals.length);
        if (payout) wallet.credit(payout);
        number.classList.add(payout > 0 ? 'win' : 'lose');
        recent.push(fmtNum(result), payout > 0 ? 'win' : 'lose');
        if (payout > wagered && !auto.running) popup.show(wagered ? payout / wagered : 0, payout, 1500);
        busy = false;
        button.disabled = false;
        return { wagered, payout };
      }

      function lock(running) {
        bet.setDisabled(running);
        tabs.setLocked(running);
        extraInput.disabled = running;
        $$('input', inputs).forEach((x) => (x.disabled = running));
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
