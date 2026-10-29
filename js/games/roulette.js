(function () {
  'use strict';
  const { el, $, $$, r2, sleep, fmt, wallet, ui } = App;

  // Koło europejskie (jedno zero), kolejność numerów zgodnie z ruchem wskazówek zegara
  const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const CHIPS = [1, 5, 10, 50, 100, 1000];
  const SPIN_MS = 3200;

  const colorOf = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');

  // Zakład -> [czy wygrywa dla wyniku n, mnożnik zwrotu]
  function evalBet(key, n) {
    const [type, v] = key.split(':');
    if (type === 'n') return [+v === n, 36];
    if (n === 0) return [false, 0];
    switch (type) {
      case 'col': return [n % 3 === +v % 3, 3];
      case 'doz': return [Math.ceil(n / 12) === +v, 3];
      case 'low': return [n <= 18, 2];
      case 'high': return [n >= 19, 2];
      case 'even': return [n % 2 === 0, 2];
      case 'odd': return [n % 2 === 1, 2];
      case 'red': return [RED.has(n), 2];
      case 'black': return [!RED.has(n), 2];
    }
    return [false, 0];
  }
  const covers = (key) => [...Array(37).keys()].filter((n) => n > 0 && key.split(':')[0] !== 'n' && evalBet(key, n)[0]);

  function shortAmount(v) {
    if (v >= 1e6) return +(v / 1e6).toFixed(1) + 'M';
    if (v >= 1000) return +(v / 1000).toFixed(1) + 'K';
    return String(+v.toFixed(2));
  }

  function wheelSVG() {
    const seg = 360 / WHEEL.length;
    const pt = (r, a) => [r * Math.sin((a * Math.PI) / 180), -r * Math.cos((a * Math.PI) / 180)].map((x) => x.toFixed(2));
    const parts = WHEEL.map((n, i) => {
      const a0 = (i - 0.5) * seg, a1 = (i + 0.5) * seg;
      const [x0, y0] = pt(100, a0), [x1, y1] = pt(100, a1), [x2, y2] = pt(64, a1), [x3, y3] = pt(64, a0);
      const fill = n === 0 ? '#1fa85b' : RED.has(n) ? '#e5243e' : '#1b2633';
      const [tx, ty] = pt(85, i * seg);
      return `<path d="M${x0} ${y0} A100 100 0 0 1 ${x1} ${y1} L${x2} ${y2} A64 64 0 0 0 ${x3} ${y3}Z" fill="${fill}" stroke="#0b1520" stroke-width=".6"/>
        <text x="${tx}" y="${ty}" transform="rotate(${(i * seg).toFixed(2)} ${tx} ${ty})" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="9.5" font-weight="700">${n}</text>`;
    });
    return `<svg viewBox="-104 -104 208 208">
      <circle r="103" fill="#0b1520"/>${parts.join('')}
      <circle r="64" fill="#13212f"/><circle r="62" fill="none" stroke="#284058" stroke-width="2"/>
      ${WHEEL.map((_, i) => { const [x, y] = pt(58, i * seg); return `<circle cx="${x}" cy="${y}" r="1.4" fill="#3d5a78"/>`; }).join('')}
    </svg>`;
  }

  App.registerGame({
    id: 'roulette',
    name: 'Ruletka',
    desc: 'Europejska ruletka z jednym zerem. Postaw żetony na numerach lub zakładach zewnętrznych i zakręć kołem.',
    accent: '#e5243e',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="5"/><path d="M12 2.5V7M12 17v4.5M2.5 12H7M17 12h4.5"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/></svg>`,

    create(root) {
      let chip = 10;
      let bets = {};          // klucz zakładu -> kwota
      let actions = [];       // historia do "Cofnij"
      let busy = false;
      let rotation = 0;

      const { panel, stage } = ui.gameLayout(root, 'rl-stage');
      const chipField = ui.field('Wartość żetonu', `<div class="rl-chips">${CHIPS.map(
        (v, i) => `<button type="button" class="rl-chip-btn c${i}${v === chip ? ' active' : ''}" data-chip="${v}">${shortAmount(v)}</button>`
      ).join('')}</div>`);
      const totalField = ui.field('Łączny zakład', `<div class="bet-input">
        <div class="input-wrap readonly"><span class="input-prefix">${App.config.currency}</span><input type="text" readonly data-total></div>
        <button type="button" class="mini-btn" data-half>½</button>
        <button type="button" class="mini-btn" data-double>2×</button>
      </div>`);
      const editRow = el(`<div class="btn-row">
        <button type="button" class="btn btn-secondary" data-undo>Cofnij</button>
        <button type="button" class="btn btn-secondary" data-clear>Wyczyść</button>
      </div>`);
      const button = el(`<button class="btn btn-primary btn-bet rl-spin">Postaw</button>`);
      panel.append(chipField, totalField, editRow, button);

      const recent = ui.recentBar(stage, 10);
      const wheelWrap = el(`<div class="rl-wheel-wrap">
        <div class="rl-wheel">
          <div class="rl-rotor">${wheelSVG()}</div>
          <div class="rl-pointer"></div>
          <div class="rl-center"><span>–</span></div>
        </div>
      </div>`);
      const board = el(`<div class="rl-board"></div>`);
      const boardWrap = el(`<div class="board-wrap rl-board-wrap"></div>`);
      boardWrap.append(board);
      stage.append(wheelWrap, boardWrap);
      const rotor = $('.rl-rotor', wheelWrap);
      const center = $('.rl-center', wheelWrap);
      const popup = ui.winPopup(boardWrap);

      // ---------- plansza ----------
      // Pozycje w siatce poziomej (14 kolumn × 5 rzędów); na telefonie plansza jest obrócona pionowo.
      const cells = [];
      const addCell = (key, label, r, rs, c, cs, cls) => cells.push({ key, label, r, rs, c, cs, cls });
      addCell('n:0', '0', 1, 3, 1, 1, 'num green');
      for (let n = 1; n <= 36; n++) addCell('n:' + n, String(n), 3 - ((n - 1) % 3), 1, 2 + Math.floor((n - 1) / 3), 1, 'num ' + colorOf(n));
      [3, 2, 1].forEach((v, i) => addCell('col:' + v, '2:1', i + 1, 1, 14, 1, 'out'));
      ['1–12', '13–24', '25–36'].forEach((t, i) => addCell('doz:' + (i + 1), t, 4, 1, 2 + i * 4, 4, 'out'));
      [['low', '1–18'], ['even', 'Parzyste'], ['red', ''], ['black', ''], ['odd', 'Nieparzyste'], ['high', '19–36']].forEach(([k, t], i) =>
        addCell(k, t, 5, 1, 2 + i * 2, 2, 'out' + (k === 'red' || k === 'black' ? ' swatch ' + k : ''))
      );

      const cellEls = {};
      for (const c of cells) {
        const node = el(`<button type="button" class="rl-cell ${c.cls}" data-key="${c.key}"><span class="rl-label">${c.label}</span><span class="rl-chip hidden"></span></button>`);
        node.style.setProperty('--gr', `${c.r} / span ${c.rs}`);
        node.style.setProperty('--gc', `${c.c} / span ${c.cs}`);
        node.style.setProperty('--vgr', `${c.c} / span ${c.cs}`);
        node.style.setProperty('--vgc', `${6 - (c.r + c.rs - 1)} / span ${c.rs}`);
        node.addEventListener('click', () => place(c.key));
        const covered = covers(c.key);
        if (covered.length) {
          node.addEventListener('mouseenter', () => covered.forEach((n) => cellEls['n:' + n].classList.add('hl')));
          node.addEventListener('mouseleave', () => covered.forEach((n) => cellEls['n:' + n].classList.remove('hl')));
        }
        cellEls[c.key] = node;
        board.appendChild(node);
      }

      const total = () => r2(Object.values(bets).reduce((s, v) => s + v, 0));

      function render() {
        for (const [key, node] of Object.entries(cellEls)) {
          const chipEl = $('.rl-chip', node);
          const v = bets[key] || 0;
          chipEl.classList.toggle('hidden', !v);
          chipEl.textContent = v ? shortAmount(v) : '';
          // kolor żetonu wg największego nominału, który się w nim mieści
          const idx = Math.max(0, CHIPS.filter((c) => c <= v).length - 1);
          chipEl.className = 'rl-chip c' + idx + (v ? '' : ' hidden');
        }
        $('[data-total]', totalField).value = total().toFixed(2);
        $('.field-sub', totalField).textContent = fmt(total());
        button.textContent = total() ? `Postaw · ${fmt(total())}` : 'Postaw';
      }

      function place(key) {
        if (busy) return;
        if (r2(total() + chip) > wallet.balance + 1e-9) return App.toast('Niewystarczające saldo', 'error');
        clearResult();
        bets[key] = r2((bets[key] || 0) + chip);
        actions.push({ key, amount: chip });
        App.haptic(8);
        render();
      }

      function clearResult() {
        popup.hide();
        $$('.rl-cell.win, .rl-cell.hit', board).forEach((n) => n.classList.remove('win', 'hit'));
      }

      $$('[data-chip]', chipField).forEach((b) =>
        b.addEventListener('click', () => {
          chip = +b.dataset.chip;
          $$('[data-chip]', chipField).forEach((x) => x.classList.toggle('active', x === b));
        })
      );
      $('[data-undo]', editRow).addEventListener('click', () => {
        if (busy || !actions.length) return;
        const a = actions.pop();
        if (a.snapshot) bets = a.snapshot;
        else {
          bets[a.key] = r2(bets[a.key] - a.amount);
          if (bets[a.key] <= 0) delete bets[a.key];
        }
        render();
      });
      $('[data-clear]', editRow).addEventListener('click', () => {
        if (busy || !total()) return;
        actions.push({ snapshot: { ...bets } });
        bets = {};
        clearResult();
        render();
      });
      function scaleBets(f) {
        if (busy || !total()) return;
        if (f > 1 && r2(total() * f) > wallet.balance + 1e-9) return App.toast('Niewystarczające saldo', 'error');
        actions.push({ snapshot: { ...bets } });
        for (const k of Object.keys(bets)) {
          bets[k] = r2(bets[k] * f);
          if (bets[k] <= 0) delete bets[k];
        }
        render();
      }
      $('[data-half]', totalField).addEventListener('click', () => scaleBets(0.5));
      $('[data-double]', totalField).addEventListener('click', () => scaleBets(2));

      function setLocked(b) {
        busy = b;
        board.classList.toggle('locked', b);
        button.disabled = b;
        $$('button', editRow).forEach((x) => (x.disabled = b));
        $$('button', totalField).forEach((x) => (x.disabled = b));
      }

      // ---------- obrót ----------
      async function spin() {
        if (busy) return;
        const amount = total();
        if (!amount) return App.toast('Połóż żetony na planszy');
        if (!App.placeBet(amount)) return;
        setLocked(true);
        clearResult();
        center.className = 'rl-center';
        $('span', center).textContent = '';

        const n = WHEEL[App.randInt(WHEEL.length)];
        const seg = 360 / WHEEL.length;
        const targetMod = (360 - WHEEL.indexOf(n) * seg + (App.rand() - 0.5) * seg * 0.6) % 360;
        const current = ((rotation % 360) + 360) % 360;
        rotation += 360 * 5 + ((targetMod - current + 360) % 360);
        rotor.style.transition = `transform ${SPIN_MS}ms cubic-bezier(.15,.75,.2,1)`;
        rotor.style.transform = `rotate(${rotation}deg)`;
        await sleep(SPIN_MS);

        let payout = 0;
        for (const [key, v] of Object.entries(bets)) {
          const [win, mult] = evalBet(key, n);
          if (win) {
            payout += v * mult;
            cellEls[key].classList.add('win');
          }
        }
        payout = r2(payout);
        if (payout) wallet.credit(payout);
        App.recordBet({ game: 'roulette', wagered: amount, payout, multiplier: payout / amount });

        center.className = 'rl-center ' + colorOf(n);
        $('span', center).textContent = n;
        cellEls['n:' + n].classList.add('hit');
        recent.push(String(n), 'rl-' + colorOf(n));
        if (payout > amount) popup.show(payout / amount, payout, 2500);
        setLocked(false);
      }
      button.addEventListener('click', spin);

      render();
      return {};
    },
  });
})();
