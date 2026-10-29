// Nawigacja, lobby, saldo, portfel i tabela zakładów.
(function () {
  'use strict';
  const { el, $, $$, fmt, fmtSigned, fmtMult, wallet, games } = App;

  const HOME = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>`;

  // ---------- menu boczne ----------
  const nav = $('#nav');
  nav.appendChild(el(`<a class="nav-item" href="#/" data-route="">${HOME}<span>Lobby</span></a>`));
  nav.appendChild(el(`<div class="nav-label">Gry</div>`));
  games.forEach((g) => nav.appendChild(el(`<a class="nav-item" href="#/${g.id}" data-route="${g.id}" style="--accent:${g.accent}">${g.icon}<span>${g.name}</span></a>`)));

  // dolny pasek nawigacji na telefonach
  const bottomNav = $('#bottomNav');
  bottomNav.appendChild(el(`<a class="bn-item" href="#/" data-route="">${HOME}<span>Lobby</span></a>`));
  games.forEach((g) => bottomNav.appendChild(el(`<a class="bn-item" href="#/${g.id}" data-route="${g.id}" style="--accent:${g.accent}">${g.icon}<span>${g.name}</span></a>`)));

  // ---------- strony ----------
  const view = $('#view');
  const lobby = el(`<section class="lobby">
    <div class="hero">
      <div>
        <h1>Gry kasynowe w trybie demo</h1>
        <p>Graj wirtualnymi środkami. Saldo startowe: <b>${fmt(App.config.startingBalance)}</b> — zmienisz je w <code>js/config.js</code> albo w portfelu.</p>
      </div>
    </div>
    <div class="game-grid">
      ${games
        .map(
          (g) => `<a class="game-card" href="#/${g.id}" style="--accent:${g.accent}">
            <div class="game-card-icon">${g.icon}</div>
            <div class="game-card-name">${g.name}</div>
            <div class="game-card-desc">${g.desc}</div>
          </a>`
        )
        .join('')}
    </div>
  </section>`);
  view.appendChild(lobby);

  const pages = {};
  games.forEach((g) => {
    const page = el(`<section class="game-page hidden">
      <div class="game-head"><span class="game-head-icon" style="color:${g.accent}">${g.icon}</span><h2>${g.name}</h2><span class="muted">${g.desc}</span></div>
      <div class="game-root"></div>
    </section>`);
    view.appendChild(page);
    pages[g.id] = page;
    g.instance = g.create($('.game-root', page)) || {};
  });

  let current = null;
  function route() {
    const id = location.hash.replace(/^#\/?/, '');
    const game = games.find((g) => g.id === id) || null;
    if (current && current !== game && current.instance.onHide) current.instance.onHide();
    lobby.classList.toggle('hidden', !!game);
    Object.entries(pages).forEach(([gid, p]) => p.classList.toggle('hidden', !game || game.id !== gid));
    current = game;
    if (game && game.instance.onShow) game.instance.onShow();
    $$('.nav-item, .bn-item').forEach((a) => a.classList.toggle('active', a.dataset.route === (game ? game.id : '')));
    // dolny pasek się przewija — pokaż aktywną grę
    const activeBn = $('.bn-item.active', bottomNav);
    if (activeBn && bottomNav.scrollWidth > bottomNav.clientWidth) {
      bottomNav.scrollLeft = activeBn.offsetLeft - bottomNav.clientWidth / 2 + activeBn.offsetWidth / 2;
    }
    document.title = (game ? game.name + ' · ' : '') + 'Nebula Casino';
    document.body.classList.remove('nav-open');
    renderBets();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  // ---------- saldo ----------
  const balanceEl = $('#balance');
  const renderBalance = () => (balanceEl.textContent = fmt(wallet.balance));
  App.on('balance', ({ delta }) => {
    renderBalance();
    if (!delta) return;
    balanceEl.classList.remove('flash-up', 'flash-down');
    void balanceEl.offsetWidth;
    balanceEl.classList.add(delta > 0 ? 'flash-up' : 'flash-down');
  });

  // ---------- tabela zakładów ----------
  const tbody = $('#betsBody');
  const betsTitle = $('#betsTitle');
  function renderBets() {
    const gid = current ? current.id : null;
    betsTitle.textContent = gid ? `Moje zakłady — ${current.name}` : 'Moje zakłady';
    const rows = App.history.filter((h) => !gid || h.game === gid).slice(0, 15);
    tbody.innerHTML = rows.length
      ? rows
          .map((h) => {
            const t = new Date(h.time).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const cls = h.profit > 0 ? 'pos' : h.profit < 0 ? 'neg' : '';
            return `<tr>
              <td>${App.gameName(h.game)}</td>
              <td class="muted">${t}</td>
              <td>${fmt(h.wagered)}</td>
              <td>${fmtMult(h.mult)}</td>
              <td class="${cls}">${fmtSigned(h.profit)}</td>
            </tr>`;
          })
          .join('')
      : `<tr><td colspan="5" class="empty">Brak zakładów — zagraj w coś!</td></tr>`;
  }
  App.on('bet', renderBets);

  // ---------- portfel ----------
  const modal = $('#walletModal');
  const walletInput = $('#walletInput');
  function openWallet() {
    $('#walletCurrent').textContent = fmt(wallet.balance);
    walletInput.value = wallet.balance.toFixed(2);
    modal.classList.remove('hidden');
    // na telefonie nie otwieramy od razu klawiatury
    if (!matchMedia('(pointer: coarse)').matches) {
      walletInput.focus();
      walletInput.select();
    }
  }
  const closeWallet = () => modal.classList.add('hidden');
  $('#walletBtn').addEventListener('click', openWallet);
  balanceEl.addEventListener('click', openWallet);
  $$('[data-close-modal]', modal).forEach((b) => b.addEventListener('click', closeWallet));
  modal.addEventListener('click', (e) => { if (e.target === modal) closeWallet(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeWallet(); });
  $('#walletSet').addEventListener('click', () => {
    const v = parseFloat(walletInput.value);
    if (!(v >= 0)) return App.toast('Podaj poprawną kwotę', 'error');
    wallet.set(v);
    App.toast('Saldo ustawione na ' + fmt(wallet.balance), 'success');
    closeWallet();
  });
  walletInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#walletSet').click(); });
  $$('[data-add]', modal).forEach((b) =>
    b.addEventListener('click', () => {
      wallet.credit(+b.dataset.add);
      $('#walletCurrent').textContent = fmt(wallet.balance);
      walletInput.value = wallet.balance.toFixed(2);
    })
  );
  $('#walletReset').textContent = 'Przywróć saldo startowe (' + fmt(App.config.startingBalance) + ')';
  $('#walletReset').addEventListener('click', () => {
    wallet.reset();
    App.toast('Przywrócono saldo startowe', 'success');
    closeWallet();
  });
  $('#statsReset').addEventListener('click', () => {
    App.resetStats();
    App.history.length = 0;
    App.store.set('nc.history', []);
    renderBets();
    App.toast('Wyczyszczono statystyki i historię', 'success');
  });

  // ---------- pozostałe ----------
  $('#statsBtn').addEventListener('click', () => App.liveStats.toggle());
  App.on('livestats', (open) => $('#statsBtn').classList.toggle('active', open));
  $('#menuBtn').addEventListener('click', () => document.body.classList.toggle('nav-open'));

  renderBalance();
  App.liveStats.init();
  route();
})();
