# Nebula Casino (demo)

Gry kasynowe na wirtualne środki: **Dice, Keno, Mines, Plinko, Blackjack, Moles**.
Czysty HTML/CSS/JS — bez instalacji i bez budowania.

## Uruchomienie

Otwórz `index.html` w przeglądarce albo uruchom lokalny serwer:

```bash
py -m http.server 5173
```

i wejdź na http://localhost:5173.

## Saldo startowe

Zmień `startingBalance` w [js/config.js](js/config.js). Po zmianie saldo zresetuje się samo
przy następnym wczytaniu strony. Saldo możesz też ustawić w dowolnym momencie przyciskiem **Portfel**.

## Funkcje

- saldo zapisywane w `localStorage`, edycja i reset w oknie Portfel
- **Live stats**: przeciągane okno z zyskiem, kwotą postawioną, liczbą wygranych/przegranych i wykresem zysku
- tabela „Moje zakłady” dla każdej gry
- tryb **Auto** (Dice, Keno, Mines, Plinko): liczba zakładów, zmiana stawki po wygranej/przegranej, stop przy zysku/stracie
- przewaga kasyna 1% (RTP 99%) we wszystkich grach z mnożnikami

## Struktura

- `js/core.js` — RNG, portfel, statystyki, wspólne komponenty UI, autobet
- `js/games/*.js` — po jednym pliku na grę
- `js/livestats.js` — okno Live stats
- `js/app.js` — nawigacja, lobby, portfel, historia
