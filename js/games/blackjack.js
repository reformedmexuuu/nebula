(function () {
  'use strict';
  const { el, $, r2, sleep, fmt, fmtMult, wallet, ui } = App;

  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const SUITS = [
    { s: '♠', red: false },
    { s: '♥', red: true },
    { s: '♣', red: false },
    { s: '♦', red: true },
  ];
  const DEAL_MS = 320;

  // Nieskończona talia — każda karta losowana niezależnie
  const drawCard = (hidden = false) => ({ rank: RANKS[App.randInt(13)], suit: SUITS[App.randInt(4)], hidden, fresh: true });
  const cardValue = (c) => (c.rank === 'A' ? 11 : ['J', 'Q', 'K', '10'].includes(c.rank) ? 10 : +c.rank);

  function handValue(cards) {
    let total = 0, aces = 0;
    for (const c of cards) {
      if (c.hidden) continue;
      total += cardValue(c);
      if (c.rank === 'A') aces++;
    }
    while (total > 21 && aces) { total -= 10; aces--; }
    return { total, soft: aces > 0 && total <= 21 };
  }
  const isBlackjack = (cards) => cards.length === 2 && handValue(cards).total === 21;

  App.registerGame({
    id: 'blackjack',
    name: 'Blackjack',
    desc: 'Krupier dobiera do 16 i staje na każdym 17. Blackjack płaci 3:2, ubezpieczenie 2:1.',
    accent: '#ffb02e',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="11" height="15" rx="2" transform="rotate(-10 8 12)"/><rect x="10" y="4" width="11" height="15" rx="2" transform="rotate(10 15 11)" fill="currentColor" fill-opacity=".25"/></svg>`,

    create(root) {
      let st = null;   // stan rozdania
      let busy = false;

      const { panel, stage } = ui.gameLayout(root, 'bj-stage');
      const bet = ui.betControl();
      const actions = el(`<div class="bj-actions">
        <button type="button" class="btn btn-secondary" data-act="hit">Dobierz</button>
        <button type="button" class="btn btn-secondary" data-act="stand">Stój</button>
        <button type="button" class="btn btn-secondary" data-act="split">Podziel</button>
        <button type="button" class="btn btn-secondary" data-act="double">Podwój</button>
      </div>`);
      const insurance = el(`<div class="bj-insurance hidden">
        <div class="bj-ins-title">Ubezpieczenie?</div>
        <div class="btn-row">
          <button type="button" class="btn btn-secondary" data-ins="yes">Tak</button>
          <button type="button" class="btn btn-secondary" data-ins="no">Nie</button>
        </div>
      </div>`);
      const button = el(`<button class="btn btn-primary btn-bet">Postaw</button>`);
      panel.append(bet.node, actions, insurance, button);

      stage.appendChild(el(`<div class="bj-table">
        <div class="bj-row bj-dealer"><div class="bj-hand" data-dealer></div></div>
        <div class="bj-felt">
          <div>BLACKJACK PŁACI 3 DO 2</div>
          <div class="muted">UBEZPIECZENIE PŁACI 2 DO 1</div>
        </div>
        <div class="bj-row bj-player" data-player></div>
      </div>`));
      const dealerEl = $('[data-dealer]', stage);
      const playerEl = $('[data-player]', stage);
      const tableEl = $('.bj-table', stage);
      const popup = ui.winPopup(tableEl);

      // ---------- render ----------
      function cardHTML(c) {
        const anim = c.fresh ? ' deal' : '';
        const flip = c.flipped ? ' flip' : '';
        c.fresh = false;
        c.flipped = false;
        if (c.hidden) return `<div class="card back${anim}"></div>`;
        return `<div class="card${c.suit.red ? ' red' : ''}${anim}${flip}">
          <span class="card-rank">${c.rank}</span><span class="card-suit">${c.suit.s}</span>
        </div>`;
      }
      function valueBadge(cards, cls = '') {
        if (!cards.length) return '';
        const v = handValue(cards);
        const hasHidden = cards.some((c) => c.hidden);
        const txt = v.soft && v.total < 21 && !hasHidden ? `${v.total - 10}, ${v.total}` : v.total;
        return `<div class="bj-value ${cls}">${txt}</div>`;
      }
      function render() {
        if (!st) { dealerEl.innerHTML = ''; playerEl.innerHTML = ''; return; }
        dealerEl.innerHTML = `${valueBadge(st.dealer)}<div class="bj-cards">${st.dealer.map(cardHTML).join('')}</div>`;
        playerEl.innerHTML = st.hands
          .map((h, i) => {
            const cls = h.result ? h.result : st.phase === 'player' && i === st.active && st.hands.length > 1 ? 'active' : '';
            const label = h.result ? `<div class="bj-result ${h.result}">${h.label}</div>` : '';
            return `<div class="bj-hand ${cls}">${valueBadge(h.cards, cls)}<div class="bj-cards">${h.cards.map(cardHTML).join('')}</div>${label}</div>`;
          })
          .join('');
        updateButtons();
      }

      function updateButtons() {
        const playing = st && st.phase === 'player' && !busy;
        const h = playing ? st.hands[st.active] : null;
        const canDouble = h && h.cards.length === 2 && wallet.canAfford(h.bet);
        const canSplit =
          h && st.hands.length === 1 && h.cards.length === 2 && h.cards[0].rank === h.cards[1].rank && wallet.canAfford(h.bet);
        const set = (act, on) => ($(`[data-act="${act}"]`, actions).disabled = !on);
        set('hit', !!h);
        set('stand', !!h);
        set('double', !!canDouble);
        set('split', !!canSplit);
        insurance.classList.toggle('hidden', !(st && st.phase === 'insurance'));
        const inRound = st && st.phase !== 'over';
        button.disabled = inRound || busy;
        bet.setDisabled(!!inRound || busy);
      }

      // ---------- przebieg rozdania ----------
      async function give(cards, hidden = false) {
        cards.push(drawCard(hidden));
        render();
        await sleep(DEAL_MS);
      }

      async function deal() {
        if (busy || (st && st.phase !== 'over')) return;
        const amount = bet.value;
        if (!App.placeBet(amount)) return;
        popup.hide();
        busy = true;
        st = {
          bet: amount,
          hands: [{ cards: [], bet: amount, units: 1, done: false }],
          dealer: [],
          active: 0,
          phase: 'dealing',
          wagered: amount,
          units: 1,       // stawki w jednostkach — mnożnik działa też przy zakładzie 0
          insurance: 0,
          insUnits: 0,
        };
        render();
        const hand = st.hands[0];
        await give(hand.cards);
        await give(st.dealer);
        await give(hand.cards);
        await give(st.dealer, true);
        busy = false;

        if (st.dealer[0].rank === 'A' && !isBlackjack(hand.cards)) {
          st.phase = 'insurance';
          render();
          return;
        }
        await afterInsurance();
      }

      async function afterInsurance() {
        const dealerUp = cardValue(st.dealer[0]);
        const hole = st.dealer[1];
        const dealerBJ = cardValue(hole) + dealerUp === 21;
        const playerBJ = isBlackjack(st.hands[0].cards);
        if ((dealerUp >= 10 && dealerBJ) || playerBJ) {
          await revealHole();
          return settle();
        }
        if (st.insUnits) App.toast('Krupier nie ma blackjacka — ubezpieczenie przepada');
        st.phase = 'player';
        render();
      }

      async function revealHole() {
        const hole = st.dealer[1];
        if (hole.hidden) {
          hole.hidden = false;
          hole.flipped = true;
          render();
          await sleep(DEAL_MS);
        }
      }

      async function nextHand() {
        st.hands[st.active].done = true;
        // ręka z 21 po podziale nie wymaga decyzji gracza
        st.hands.forEach((x) => { if (!x.done && handValue(x.cards).total === 21) x.done = true; });
        const next = st.hands.findIndex((x) => !x.done);
        if (next >= 0) {
          st.active = next;
          render();
          return;
        }
        await dealerPlay();
      }

      async function dealerPlay() {
        st.phase = 'dealer';
        busy = true;
        render();
        await revealHole();
        const anyLive = st.hands.some((h) => handValue(h.cards).total <= 21);
        if (anyLive) {
          while (handValue(st.dealer).total < 17) await give(st.dealer);
        }
        busy = false;
        settle();
      }

      function settle() {
        const d = handValue(st.dealer).total;
        const dealerBJ = isBlackjack(st.dealer);
        const single = st.hands.length === 1;
        let payout = 0, payoutUnits = 0;
        for (const h of st.hands) {
          const p = handValue(h.cards).total;
          const bj = single && isBlackjack(h.cards);
          let k; // mnożnik zwrotu dla tej ręki
          if (p > 21) { k = 0; h.label = 'Fura'; }
          else if (bj && dealerBJ) { k = 1; h.label = 'Remis'; }
          else if (bj) { k = 2.5; h.label = 'Blackjack!'; }
          else if (dealerBJ) { k = 0; h.label = 'Przegrana'; }
          else if (d > 21 || p > d) { k = 2; h.label = 'Wygrana'; }
          else if (p === d) { k = 1; h.label = 'Remis'; }
          else { k = 0; h.label = 'Przegrana'; }
          h.result = k > 1 ? 'win' : k === 1 ? 'push' : 'lose';
          payout += h.bet * k;
          payoutUnits += h.units * k;
        }
        if (st.insUnits && dealerBJ) {
          payout += st.insurance * 3;
          payoutUnits += st.insUnits * 3;
        }
        payout = r2(payout);
        if (payout) wallet.credit(payout);
        const mult = payoutUnits / (st.units + st.insUnits);
        App.recordBet({ game: 'blackjack', wagered: st.wagered, payout, multiplier: mult });
        st.phase = 'over';
        render();
        if (payout > st.wagered || (st.wagered === 0 && mult > 1)) popup.show(mult, payout, 2200);
      }

      // ---------- akcje gracza ----------
      async function act(type) {
        if (busy || !st || st.phase !== 'player') return;
        const h = st.hands[st.active];
        busy = true;
        updateButtons();
        if (type === 'hit') {
          await give(h.cards);
          const v = handValue(h.cards).total;
          busy = false;
          if (v >= 21) await nextHand();
          else render();
        } else if (type === 'stand') {
          busy = false;
          await nextHand();
        } else if (type === 'double') {
          if (!App.placeBet(h.bet)) { busy = false; return render(); }
          st.wagered += h.bet;
          st.units += h.units;
          h.bet *= 2;
          h.units *= 2;
          await give(h.cards);
          busy = false;
          await nextHand();
        } else if (type === 'split') {
          if (!App.placeBet(h.bet)) { busy = false; return render(); }
          st.wagered += h.bet;
          st.units += 1;
          const second = { cards: [h.cards.pop()], bet: h.bet, units: 1, done: false };
          second.cards[0].fresh = true;
          st.hands.push(second);
          render();
          await sleep(150);
          await give(h.cards);
          await give(second.cards);
          busy = false;
          if (h.cards[0].rank === 'A') {
            // Rozdzielone asy dostają po jednej karcie
            st.hands.forEach((x) => (x.done = true));
            st.active = 1;
            await dealerPlay();
          } else if (handValue(h.cards).total === 21) {
            await nextHand();
          } else render();
        }
      }

      actions.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act(b.dataset.act)));
      insurance.querySelectorAll('[data-ins]').forEach((b) =>
        b.addEventListener('click', async () => {
          if (!st || st.phase !== 'insurance') return;
          if (b.dataset.ins === 'yes') {
            const cost = r2(st.bet / 2);
            if (App.placeBet(cost)) {
              st.insurance = cost;
              st.insUnits = 0.5;
              st.wagered += cost;
            }
          }
          st.phase = 'checking';
          render();
          await afterInsurance();
        })
      );
      button.addEventListener('click', deal);

      render();
      updateButtons();
      return {};
    },
  });
})();
