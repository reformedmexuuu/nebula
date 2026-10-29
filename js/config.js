// ============================================================
//  USTAWIENIA STRONY
//  Zmień startingBalance, aby ustawić inne saldo startowe.
//  Po zmianie wartości saldo zresetuje się automatycznie
//  przy następnym otwarciu strony.
// ============================================================
window.CONFIG = {
  startingBalance: 10000, // saldo startowe w $
  currency: '$',
  defaultBet: 10,         // domyślna kwota zakładu
  houseEdge: 0.01,        // przewaga kasyna (1% => RTP 99%)
  maxBet: 1000000,
};
