(function () {
  'use strict';
  const { el, r2, wallet, ui } = App;

  const RISKS = {
    low: { label: 'Niskie', g: 0.3, cap: 50 },
    medium: { label: 'Średnie', g: 0.55, cap: 300 },
    high: { label: 'Wysokie', g: 0.9, cap: 1000 },
  };
  const SEG_MS = 95;     // czas przelotu między rzędami kołków
  const DROP_MS = 180;   // pierwszy spadek na górny kołek

  // Kolor kubełka: żółty w środku, czerwony na krawędziach
  function bucketColor(i, n) {
    const t = Math.abs(i - n / 2) / (n / 2);
    const r = 255, g = Math.round(192 - 192 * t), b = Math.round(63 * t);
    return `rgb(${r},${g},${b})`;
  }
  function multLabel(m) {
    return m >= 100 ? String(Math.round(m)) : m >= 10 ? m.toFixed(1).replace(/\.0$/, '') : String(+m.toFixed(2));
  }

  App.registerGame({
    id: 'plinko',
    name: 'Plinko',
    desc: 'Upuść kulkę i patrz, w który kubełek wpadnie.',
    accent: '#ff3d8b',
    icon: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="4" r="2.2"/><circle cx="7" cy="10" r="1.5"/><circle cx="12" cy="10" r="1.5"/><circle cx="17" cy="10" r="1.5"/><circle cx="4.5" cy="16" r="1.5"/><circle cx="9.5" cy="16" r="1.5"/><circle cx="14.5" cy="16" r="1.5"/><circle cx="19.5" cy="16" r="1.5"/><rect x="3" y="20" width="18" height="2.5" rx="1"/></svg>`,

    create(root) {
      let rows = 16;
      let risk = 'medium';
      const balls = [];
      const pegFlash = new Map();   // "r:j" -> czas
      const bucketHit = new Map();  // i -> czas
      const cache = {};
      let visible = false;
      let raf = null;

      function table(n = rows, rk = risk) {
        const key = rk + n;
        if (!cache[key]) {
          const probs = [...Array(n + 1)].map((_, i) => App.comb(n, i) / 2 ** n);
          cache[key] = App.rarityTable(probs, { g: RISKS[rk].g, cap: RISKS[rk].cap });
        }
        return cache[key];
      }

      const { panel, stage } = ui.gameLayout(root, 'plinko-stage');
      const tabs = ui.modeTabs((m) => { auto.node.classList.toggle('hidden', m !== 'auto'); updateButton(); });
      const bet = ui.betControl();
      const riskSel = ui.selectField('Ryzyko', Object.entries(RISKS).map(([k, v]) => [k, v.label]), risk);
      const rowsSel = ui.selectField('Rzędy', [8, 9, 10, 11, 12, 13, 14, 15, 16].map((n) => [n, n]), rows);
      const auto = ui.autobet({ bet, play: playOnce, delay: 260, onState: lock });
      auto.node.classList.add('hidden');
      const button = el(`<button class="btn btn-primary btn-bet">Postaw</button>`);
      panel.append(tabs.node, bet.node, riskSel.node, rowsSel.node, auto.node, button);

      const wrap = el(`<div class="plinko-wrap"><canvas class="plinko-canvas"></canvas><div class="plinko-recent"></div></div>`);
      stage.appendChild(wrap);
      const canvas = wrap.querySelector('canvas');
      const recentCol = wrap.querySelector('.plinko-recent');
      const ctx = canvas.getContext('2d');

      // ---------- geometria ----------
      let W = 0, H = 0, L = null;
      function layout() {
        const rect = canvas.getBoundingClientRect();
        if (!rect.width) return;
        const dpr = window.devicePixelRatio || 1;
        W = rect.width;
        H = rect.height;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const n = rows;
        const s = Math.min((W * 0.96) / (n + 2), (H * 0.96) / (n + 1.4));
        const y0 = (H - (n + 1.4) * s) / 2 + s * 0.9;
        L = {
          n, s, cx: W / 2, y0,
          pegR: Math.max(2, s * 0.1),
          ballR: Math.max(3, s * 0.22),
          startY: y0 - s * 0.85,
          bucketY: y0 + (n - 1) * s + s * 0.85,
        };
        draw();
      }
      new ResizeObserver(layout).observe(canvas);

      const contactY = (r) => L.y0 + r * L.s - L.pegR - L.ballR;

      function ballPos(b) {
        const { cx, s, n } = L;
        const t = Math.min(b.t, 1);
        if (b.seg === 0) return { x: cx, y: L.startY + (contactY(0) - L.startY) * t * t };
        const k = b.seg;
        const x0 = cx + b.offs[k - 1] * s, x1 = cx + b.offs[k] * s;
        const ya = contactY(k - 1), yb = k === n ? L.bucketY - L.ballR : contactY(k);
        return { x: x0 + (x1 - x0) * t, y: ya + (yb - ya) * t - s * 0.35 * 4 * t * (1 - t) };
      }

      // ---------- rysowanie ----------
      function roundRect(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
      }

      function draw() {
        if (!L) return;
        const now = performance.now();
        const { n, s, cx, y0, pegR, ballR } = L;
        ctx.clearRect(0, 0, W, H);

        for (let r = 0; r < n; r++) {
          for (let j = 0; j < r + 3; j++) {
            const x = cx + (j - (r + 2) / 2) * s, y = y0 + r * s;
            const f = pegFlash.get(r + ':' + j);
            const glow = f ? Math.max(0, 1 - (now - f) / 300) : 0;
            if (glow > 0) {
              ctx.fillStyle = `rgba(255,255,255,${0.25 * glow})`;
              ctx.beginPath();
              ctx.arc(x, y, pegR * 2.6, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(x, y, pegR, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        const tbl = table();
        const bw = s * 0.9, bh = Math.max(12, s * 0.72);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const fontPx = Math.min(13, Math.max(6, s * 0.34));
        for (let i = 0; i <= n; i++) {
          const x = cx + (i - n / 2) * s;
          const hit = bucketHit.get(i);
          const p = hit ? Math.max(0, 1 - (now - hit) / 300) : 0;
          const dy = Math.sin(p * Math.PI) * s * 0.18;
          const top = L.bucketY - bh / 2 + dy;
          const color = bucketColor(i, n);
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          roundRect(x - bw / 2, top + 3, bw, bh, 4);
          ctx.fill();
          ctx.fillStyle = color;
          roundRect(x - bw / 2, top, bw, bh, 4);
          ctx.fill();
          // na wąskich ekranach zmniejszamy napis, żeby zmieścił się w kubełku
          const label = multLabel(tbl[i]);
          ctx.font = `700 ${fontPx}px Inter, system-ui, sans-serif`;
          const fit = Math.min(1, (bw * 0.9) / ctx.measureText(label).width);
          if (fit < 1) ctx.font = `700 ${fontPx * fit}px Inter, system-ui, sans-serif`;
          ctx.fillStyle = '#1a0f05';
          ctx.fillText(label, x, top + bh / 2 + 0.5);
        }

        for (const b of balls) {
          const { x, y } = ballPos(b);
          ctx.fillStyle = '#ff2d55';
          ctx.beginPath();
          ctx.arc(x, y, ballR, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.35)';
          ctx.beginPath();
          ctx.arc(x - ballR * 0.3, y - ballR * 0.3, ballR * 0.35, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ---------- symulacja ----------
      let last = performance.now();
      function tick(now) {
        const dt = Math.min(64, now - last);
        last = now;
        for (let idx = balls.length - 1; idx >= 0; idx--) {
          const b = balls[idx];
          b.t += dt / (b.seg === 0 ? DROP_MS : SEG_MS);
          while (b.t >= 1 && b.seg <= L.n) {
            b.t -= 1;
            if (b.seg < L.n) pegFlash.set(b.seg + ':' + (b.offs[b.seg] + (b.seg + 2) / 2), now);
            b.seg++;
          }
          if (b.seg > L.n) {
            balls.splice(idx, 1);
            land(b, now);
          }
        }
        draw();
        raf = visible || balls.length ? requestAnimationFrame(tick) : null;
      }
      function ensureLoop() {
        if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
      }

      function land(b, now = performance.now()) {
        bucketHit.set(b.bucket, now);
        if (b.payout) wallet.credit(b.payout);
        App.recordBet({ game: 'plinko', wagered: b.amount, payout: b.payout, multiplier: b.mult });
        const chip = el(`<div class="plinko-chip"></div>`);
        chip.textContent = multLabel(b.mult) + '×';
        chip.style.background = bucketColor(b.bucket, b.n);
        recentCol.prepend(chip);
        while (recentCol.children.length > 6) recentCol.lastElementChild.remove();
        if (b.mult >= 10) App.haptic(40);
        if (!balls.length) setConfigLocked(auto.running);
      }

      function playOnce(amount) {
        if (!L) return null;
        if (!App.placeBet(amount)) return null;
        const n = rows;
        const dirs = [...Array(n)].map(() => App.rand() < 0.5);
        const offs = [0];
        dirs.forEach((d) => offs.push(offs[offs.length - 1] + (d ? 0.5 : -0.5)));
        const bucket = dirs.filter(Boolean).length;
        const mult = table()[bucket];
        const payout = r2(amount * mult);
        balls.push({ n, dirs, offs, bucket, mult, amount, payout, seg: 0, t: 0 });
        setConfigLocked(true);
        ensureLoop();
        return { wagered: amount, payout };
      }

      function setConfigLocked(b) {
        riskSel.select.disabled = b;
        rowsSel.select.disabled = b;
      }
      function lock(running) {
        bet.setDisabled(running);
        tabs.setLocked(running);
        setConfigLocked(running || balls.length > 0);
        updateButton();
      }
      function updateButton() {
        button.textContent = tabs.mode === 'auto' ? (auto.running ? 'Zatrzymaj autobet' : 'Rozpocznij autobet') : 'Postaw';
        button.classList.toggle('btn-stop', auto.running);
      }

      riskSel.select.addEventListener('change', () => { risk = riskSel.select.value; draw(); });
      rowsSel.select.addEventListener('change', () => { rows = +rowsSel.select.value; layout(); });
      button.addEventListener('click', () => (tabs.mode === 'auto' ? auto.toggle() : playOnce(bet.value)));

      return {
        onShow() { visible = true; layout(); ensureLoop(); },
        onHide() {
          visible = false;
          // Kulki w locie lądują od razu, żeby nie zawiesić wypłat
          while (balls.length) land(balls.pop());
        },
      };
    },
  });
})();
