// Rdzeń aplikacji: RNG, portfel, statystyki sesji, historia zakładów i wspólne elementy UI.
(function () {
  'use strict';
  const C = window.CONFIG;

  // ---------- narzędzia ----------
  const store = {
    get(k, d) {
      try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* brak dostępu do storage */ }
    },
  };

  const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

  // Kryptograficzny RNG z 53 bitami precyzji, wynik w [0, 1)
  function rand() {
    const a = new Uint32Array(2);
    crypto.getRandomValues(a);
    return (a[0] * 2 ** 21 + (a[1] >>> 11)) / 2 ** 53;
  }
  const randInt = (n) => Math.floor(rand() * n);
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  const sample = (n, k) => shuffle([...Array(n).keys()]).slice(0, k);

  function fmt(n) {
    return C.currency + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtSigned(n) {
    return (n < 0 ? '-' : n > 0 ? '+' : '') + fmt(Math.abs(n));
  }
  function fmtMult(m) {
    return (m >= 1000 ? m.toLocaleString('en-US', { maximumFractionDigits: 2 }) : m.toFixed(2)) + '×';
  }

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  // ---------- zdarzenia ----------
  const handlers = {};
  const on = (evt, fn) => (handlers[evt] = handlers[evt] || []).push(fn);
  const emit = (evt, data) => (handlers[evt] || []).forEach((fn) => fn(data));

  // ---------- portfel ----------
  const savedWallet = store.get('nc.wallet', null);
  let balance = savedWallet && savedWallet.start === C.startingBalance ? savedWallet.balance : C.startingBalance;
  const saveWallet = () => store.set('nc.wallet', { balance, start: C.startingBalance });
  saveWallet();

  const wallet = {
    get balance() { return balance; },
    set(v) { balance = r2(Math.max(0, Number(v) || 0)); saveWallet(); emit('balance', { balance, delta: 0 }); },
    reset() { wallet.set(C.startingBalance); },
    canAfford: (a) => a <= balance + 1e-9,
    debit(a) {
      if (!wallet.canAfford(a)) return false;
      balance = r2(balance - a);
      saveWallet();
      emit('balance', { balance, delta: -a });
      return true;
    },
    credit(a) {
      if (a <= 0) return;
      balance = r2(balance + a);
      saveWallet();
      emit('balance', { balance, delta: a });
    },
  };

  function placeBet(amount) {
    if (!(amount >= 0) || !isFinite(amount)) { toast('Nieprawidłowa kwota zakładu', 'error'); return false; }
    if (amount > C.maxBet) { toast('Maksymalny zakład to ' + fmt(C.maxBet), 'error'); return false; }
    if (!wallet.debit(amount)) { toast('Niewystarczające saldo', 'error'); return false; }
    return true;
  }

  // ---------- statystyki sesji i historia ----------
  const SERIES_MAX = 1000;
  const freshStats = () => ({ bets: 0, wagered: 0, profit: 0, wins: 0, losses: 0, series: [0] });
  let stats = store.get('nc.stats', null) || freshStats();
  const history = store.get('nc.history', []);

  function recordBet({ game, wagered, payout, multiplier }) {
    wagered = r2(wagered);
    payout = r2(payout);
    const profit = r2(payout - wagered);
    const mult = multiplier != null ? multiplier : wagered > 0 ? payout / wagered : 0;
    stats.bets++;
    stats.wagered = r2(stats.wagered + wagered);
    stats.profit = r2(stats.profit + profit);
    if (mult > 1) stats.wins++;
    else if (mult < 1) stats.losses++;
    stats.series.push(stats.profit);
    if (stats.series.length > SERIES_MAX) stats.series.splice(0, stats.series.length - SERIES_MAX);

    const entry = { id: Date.now().toString(36) + randInt(1e6), game, time: Date.now(), wagered, payout, profit, mult };
    history.unshift(entry);
    if (history.length > 100) history.length = 100;
    store.set('nc.stats', stats);
    store.set('nc.history', history);
    emit('bet', entry);
    return entry;
  }

  function resetStats() {
    stats = freshStats();
    store.set('nc.stats', stats);
    emit('stats');
  }

  // ---------- tabele wypłat ----------
  function comb(n, k) {
    if (k < 0 || k > n) return 0;
    let r = 1;
    for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
    return r;
  }
  function niceRound(x) {
    if (x >= 100) return Math.round(x);
    if (x >= 10) return Math.round(x * 10) / 10;
    return Math.round(x * 100) / 100;
  }
  // Mnożnik rośnie wraz z rzadkością wyniku: m(i) = c * p(i)^-g, skalowane do zadanego RTP.
  // g steruje ryzykiem (większe g = bardziej "płaskie" niskie wypłaty i wyższe maksima).
  // Powyżej progu `soft` mnożniki rosną logarytmicznie, `cap` to twardy limit.
  function rarityTable(probs, { g, eligible = () => true, cap = Infinity, soft = Infinity, rtp = 1 - C.houseEdge }) {
    const f = probs.map((p, i) => (eligible(i) && p > 0 ? Math.pow(p, -g) : 0));
    const shape = (x) => Math.min(cap, x <= soft ? x : soft * (1 + Math.log(x / soft)));
    const ev = (c) => probs.reduce((s, p, i) => s + p * shape(c * f[i]), 0);
    let lo = 0, hi = 1;
    while (ev(hi) < rtp && hi < 1e12) hi *= 2;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (ev(mid) < rtp) lo = mid; else hi = mid;
    }
    return f.map((v) => (v ? niceRound(shape(hi * v)) : 0));
  }

  // Krótka wibracja na telefonach (ignorowana tam, gdzie nie jest obsługiwana)
  function haptic(pattern = 15) {
    try { if (navigator.vibrate && matchMedia('(pointer: coarse)').matches) navigator.vibrate(pattern); } catch (e) { /* brak wsparcia */ }
  }

  // ---------- toasty ----------
  function toast(msg, type = 'info') {
    const box = $('#toasts');
    if (!box) return;
    const t = el(`<div class="toast ${type}"></div>`);
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2600);
  }

  // ---------- komponenty UI ----------
  function field(label, inner, sub = '') {
    return el(`<div class="field">
      <label class="field-label"><span>${label}</span><span class="field-sub">${sub}</span></label>
      ${inner}
    </div>`);
  }

  function selectField(label, options, value) {
    const node = field(label, `<div class="select-wrap"><select>${options
      .map(([v, t]) => `<option value="${v}"${String(v) === String(value) ? ' selected' : ''}>${t}</option>`)
      .join('')}</select></div>`);
    return { node, select: $('select', node) };
  }

  function betControl(opts = {}) {
    const node = field(opts.label || 'Kwota zakładu', `<div class="bet-input">
        <div class="input-wrap"><span class="input-prefix">${C.currency}</span><input type="number" inputmode="decimal" min="0" step="0.01"></div>
        <button type="button" class="mini-btn" data-half>½</button>
        <button type="button" class="mini-btn" data-double>2×</button>
      </div>`);
    const input = $('input', node);
    const sub = $('.field-sub', node);
    const listeners = [];
    let value = r2(opts.value != null ? opts.value : C.defaultBet);
    const notify = () => listeners.forEach((fn) => fn(value));
    const sync = () => { input.value = value.toFixed(2); sub.textContent = fmt(value); };
    function set(v) {
      v = Number(v);
      value = isFinite(v) && v > 0 ? r2(v) : 0;
      sync();
      notify();
    }
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      value = isFinite(v) && v > 0 ? r2(v) : 0;
      sub.textContent = fmt(value);
      notify();
    });
    input.addEventListener('blur', sync);
    $('[data-half]', node).addEventListener('click', () => set(value / 2));
    $('[data-double]', node).addEventListener('click', () => set(Math.min(value * 2, Math.max(wallet.balance, value))));
    sync();
    return {
      node,
      get value() { return value; },
      set value(v) { set(v); },
      onChange: (fn) => listeners.push(fn),
      setDisabled(b) {
        node.classList.toggle('disabled', b);
        $$('input,button', node).forEach((x) => (x.disabled = b));
      },
    };
  }

  function modeTabs(onChange) {
    const node = el(`<div class="tabs">
      <button type="button" class="tab active" data-mode="manual">Ręczny</button>
      <button type="button" class="tab" data-mode="auto">Auto</button>
    </div>`);
    let mode = 'manual';
    let locked = false;
    $$('.tab', node).forEach((b) =>
      b.addEventListener('click', () => {
        if (locked || b.dataset.mode === mode) return;
        mode = b.dataset.mode;
        $$('.tab', node).forEach((x) => x.classList.toggle('active', x === b));
        onChange(mode);
      })
    );
    return {
      node,
      get mode() { return mode; },
      setLocked(b) { locked = b; node.classList.toggle('disabled', b); },
    };
  }

  // Autobet: liczba zakładów, zmiana stawki po wygranej/przegranej, stop przy zysku/stracie.
  function autobet({ bet, play, delay = 300, onState = () => {} }) {
    const strategy = (key, label) => `
      <div class="field">
        <label class="field-label"><span>${label}</span></label>
        <div class="strategy">
          <div class="seg" data-${key}>
            <button type="button" class="seg-btn active" data-v="reset">Reset</button>
            <button type="button" class="seg-btn" data-v="inc">Zwiększ o</button>
          </div>
          <div class="input-wrap"><input type="number" step="1" value="0" data-${key}-pct disabled><span class="input-suffix">%</span></div>
        </div>
      </div>`;
    const node = el(`<div class="auto-fields">
      <div class="field">
        <label class="field-label"><span>Liczba zakładów</span><span class="field-sub">0 = bez limitu</span></label>
        <div class="input-wrap"><input type="number" min="0" step="1" value="0" data-count></div>
      </div>
      ${strategy('win', 'Przy wygranej')}
      ${strategy('loss', 'Przy przegranej')}
      <div class="field">
        <label class="field-label"><span>Stop przy zysku</span></label>
        <div class="input-wrap"><span class="input-prefix">${C.currency}</span><input type="number" min="0" step="0.01" value="0" data-stop-profit></div>
      </div>
      <div class="field">
        <label class="field-label"><span>Stop przy stracie</span></label>
        <div class="input-wrap"><span class="input-prefix">${C.currency}</span><input type="number" min="0" step="0.01" value="0" data-stop-loss></div>
      </div>
    </div>`);

    const modes = { win: 'reset', loss: 'reset' };
    ['win', 'loss'].forEach((key) => {
      const seg = $(`[data-${key}]`, node);
      const pct = $(`[data-${key}-pct]`, node);
      $$('.seg-btn', seg).forEach((b) =>
        b.addEventListener('click', () => {
          if (running) return;
          modes[key] = b.dataset.v;
          $$('.seg-btn', seg).forEach((x) => x.classList.toggle('active', x === b));
          pct.disabled = modes[key] === 'reset';
        })
      );
    });

    const num = (sel) => Math.max(0, parseFloat($(sel, node).value) || 0);
    let running = false;
    let stopRequested = false;

    function setRunning(b) {
      running = b;
      node.classList.toggle('running', b);
      $$('input,button', node).forEach((x) => {
        if (x.matches('[data-win-pct],[data-loss-pct]')) {
          x.disabled = b || modes[x.matches('[data-win-pct]') ? 'win' : 'loss'] === 'reset';
        } else x.disabled = b;
      });
      onState(b);
    }

    async function start() {
      if (running) return;
      const countInput = $('[data-count]', node);
      let left = Math.floor(num('[data-count]'));
      const unlimited = left === 0;
      const initialCount = left;
      const winPct = num('[data-win-pct]');
      const lossPct = num('[data-loss-pct]');
      const stopProfit = num('[data-stop-profit]');
      const stopLoss = num('[data-stop-loss]');
      const base = bet.value;
      let amount = base;
      let profit = 0;
      stopRequested = false;
      setRunning(true);
      try {
        while (!stopRequested) {
          const res = await play(amount);
          if (!res) break;
          profit += res.payout - res.wagered;
          if (res.payout > res.wagered) amount = modes.win === 'reset' ? base : r2(amount * (1 + winPct / 100));
          else if (res.payout < res.wagered) amount = modes.loss === 'reset' ? base : r2(amount * (1 + lossPct / 100));
          bet.value = amount;
          if (!unlimited) {
            left--;
            countInput.value = left;
            if (left <= 0) break;
          }
          if (stopProfit > 0 && profit >= stopProfit) { toast('Autobet: osiągnięto limit zysku', 'success'); break; }
          if (stopLoss > 0 && -profit >= stopLoss) { toast('Autobet: osiągnięto limit straty', 'error'); break; }
          await sleep(delay);
        }
      } finally {
        if (!unlimited) countInput.value = initialCount;
        setRunning(false);
      }
    }

    return {
      node,
      get running() { return running; },
      start,
      stop() { stopRequested = true; },
      toggle() { running ? (stopRequested = true) : start(); },
    };
  }

  // Okienko z wygraną pokazywane na środku planszy
  function winPopup(container) {
    const node = el(`<div class="win-popup hidden"><div class="win-mult"></div><div class="win-amount"></div></div>`);
    container.appendChild(node);
    let timer = null;
    return {
      show(mult, amount, autoHideMs = 0) {
        $('.win-mult', node).textContent = fmtMult(mult);
        $('.win-amount', node).textContent = fmt(amount);
        node.classList.remove('hidden');
        node.classList.remove('pop');
        void node.offsetWidth;
        node.classList.add('pop');
        haptic(25);
        clearTimeout(timer);
        if (autoHideMs) timer = setTimeout(() => node.classList.add('hidden'), autoHideMs);
      },
      hide() { clearTimeout(timer); node.classList.add('hidden'); },
    };
  }

  // Pasek ostatnich wyników (pigułki)
  function recentBar(container, max = 8) {
    const node = el(`<div class="recent"></div>`);
    container.appendChild(node);
    return {
      node,
      push(text, cls) {
        const pill = el(`<span class="pill ${cls}"></span>`);
        pill.textContent = text;
        node.prepend(pill);
        while (node.children.length > max) node.lastElementChild.remove();
      },
    };
  }

  // Standardowy układ gry: panel sterowania + plansza
  function gameLayout(root, stageClass = '') {
    const layout = el(`<div class="game-layout">
      <div class="panel"></div>
      <div class="stage ${stageClass}"></div>
    </div>`);
    root.appendChild(layout);
    return { panel: $('.panel', layout), stage: $('.stage', layout) };
  }

  const games = [];

  window.App = {
    config: C,
    store, r2, sleep, clamp, rand, randInt, shuffle, sample,
    fmt, fmtSigned, fmtMult, el, $, $$,
    on, emit,
    wallet, placeBet,
    recordBet, resetStats,
    get stats() { return stats; },
    history,
    comb, rarityTable, niceRound,
    toast, haptic,
    ui: { field, selectField, betControl, modeTabs, autobet, winPopup, recentBar, gameLayout },
    games,
    registerGame: (g) => games.push(g),
    gameName: (id) => (games.find((g) => g.id === id) || { name: id }).name,
  };
})();
