// Pływające, przeciągalne okno "Live stats" z wykresem zysku sesji.
(function () {
  'use strict';
  const { el, $, fmt, fmtSigned, store } = App;

  const win = el(`<div class="ls-window hidden">
    <div class="ls-head">
      <span class="ls-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>Live stats</span>
      <div class="ls-actions">
        <button type="button" class="icon-btn sm" data-reset title="Resetuj statystyki">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>
        </button>
        <button type="button" class="icon-btn sm" data-close title="Zamknij">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
    </div>
    <div class="ls-body">
      <div class="ls-grid">
        <div class="ls-stat"><span>Zysk</span><b data-profit></b></div>
        <div class="ls-stat"><span>Wygrane</span><b class="pos" data-wins></b></div>
        <div class="ls-stat"><span>Postawiono</span><b data-wagered></b></div>
        <div class="ls-stat"><span>Przegrane</span><b class="neg" data-losses></b></div>
      </div>
      <div class="ls-chart">
        <canvas></canvas>
        <div class="ls-tip hidden"></div>
      </div>
    </div>
  </div>`);
  document.body.appendChild(win);

  const canvas = $('canvas', win);
  const ctx = canvas.getContext('2d');
  const tip = $('.ls-tip', win);
  let hover = -1;

  function renderNumbers() {
    const s = App.stats;
    const p = $('[data-profit]', win);
    p.textContent = fmtSigned(s.profit);
    p.className = s.profit > 0 ? 'pos' : s.profit < 0 ? 'neg' : '';
    $('[data-wagered]', win).textContent = fmt(s.wagered);
    $('[data-wins]', win).textContent = s.wins.toLocaleString('en-US');
    $('[data-losses]', win).textContent = s.losses.toLocaleString('en-US');
  }

  function geometry() {
    const series = App.stats.series;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const pad = 8;
    let min = Math.min(0, ...series), max = Math.max(0, ...series);
    if (min === max) { min -= 1; max += 1; }
    const range = max - min;
    min -= range * 0.08;
    max += range * 0.08;
    const n = series.length;
    const x = (i) => pad + (n <= 1 ? 0 : (i / (n - 1)) * (W - pad * 2));
    const y = (v) => pad + (1 - (v - min) / (max - min)) * (H - pad * 2);
    return { series, W, H, x, y, n };
  }

  function drawChart() {
    if (win.classList.contains('hidden')) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W) return;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const g = geometry();
    const zy = g.y(0);
    const css = getComputedStyle(document.documentElement);
    const green = css.getPropertyValue('--green').trim() || '#1fdc7a';
    const red = css.getPropertyValue('--red').trim() || '#ff3d5e';

    const path = () => {
      ctx.beginPath();
      g.series.forEach((v, i) => (i ? ctx.lineTo(g.x(i), g.y(v)) : ctx.moveTo(g.x(i), g.y(v))));
    };
    const area = () => {
      path();
      ctx.lineTo(g.x(g.n - 1), zy);
      ctx.lineTo(g.x(0), zy);
      ctx.closePath();
    };

    // nad zerem na zielono, pod zerem na czerwono
    [[0, zy, green], [zy, H - zy, red]].forEach(([top, h, color]) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, top, W, h);
      ctx.clip();
      area();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
      path();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();
    });

    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, zy);
    ctx.lineTo(W, zy);
    ctx.stroke();
    ctx.setLineDash([]);

    if (hover >= 0 && hover < g.n) {
      const v = g.series[hover];
      const px = g.x(hover), py = g.y(v);
      ctx.fillStyle = v >= 0 ? green : red;
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
      tip.textContent = `Zakład #${hover} · ${fmtSigned(v)}`;
      tip.classList.remove('hidden');
      tip.style.left = Math.min(Math.max(px, 60), W - 60) + 'px';
      tip.style.top = Math.max(py - 30, 0) + 'px';
    } else tip.classList.add('hidden');
  }

  canvas.addEventListener('pointermove', (e) => {
    const g = geometry();
    const r = canvas.getBoundingClientRect();
    const rel = (e.clientX - r.left - 8) / (r.width - 16);
    hover = Math.round(Math.min(1, Math.max(0, rel)) * (g.n - 1));
    drawChart();
  });
  canvas.addEventListener('pointerleave', () => { hover = -1; drawChart(); });
  canvas.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') { hover = -1; drawChart(); } });

  function render() { renderNumbers(); drawChart(); }

  // ---------- przeciąganie ----------
  const head = $('.ls-head', win);
  // Na telefonie okno jest przypięte nad dolnym paskiem (pozycję ustala CSS)
  const mobile = matchMedia('(max-width: 560px)');
  function place(x, y) {
    if (mobile.matches) {
      win.style.left = win.style.top = '';
      return { x: 0, y: 0 };
    }
    const maxX = window.innerWidth - win.offsetWidth;
    const maxY = window.innerHeight - win.offsetHeight;
    x = Math.min(Math.max(0, x), Math.max(0, maxX));
    y = Math.min(Math.max(0, y), Math.max(0, maxY));
    win.style.left = x + 'px';
    win.style.top = y + 'px';
    return { x, y };
  }
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || mobile.matches) return;
    const r = win.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    head.setPointerCapture(e.pointerId);
    const move = (ev) => place(ev.clientX - dx, ev.clientY - dy);
    const up = () => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      const b = win.getBoundingClientRect();
      store.set('nc.ls.pos', { x: b.left, y: b.top });
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
  });

  function setOpen(open) {
    win.classList.toggle('hidden', !open);
    store.set('nc.ls.open', open);
    App.emit('livestats', open);
    if (open) {
      const pos = store.get('nc.ls.pos', null);
      if (pos) place(pos.x, pos.y);
      else place(window.innerWidth - win.offsetWidth - 24, 84);
      render();
    }
  }

  $('[data-close]', win).addEventListener('click', () => setOpen(false));
  $('[data-reset]', win).addEventListener('click', () => App.resetStats());
  window.addEventListener('resize', () => {
    if (win.classList.contains('hidden')) return;
    const b = win.getBoundingClientRect();
    place(b.left, b.top);
    drawChart();
  });

  App.on('bet', render);
  App.on('stats', render);

  App.liveStats = {
    toggle: () => setOpen(win.classList.contains('hidden')),
    init: () => setOpen(store.get('nc.ls.open', false)),
  };
})();
