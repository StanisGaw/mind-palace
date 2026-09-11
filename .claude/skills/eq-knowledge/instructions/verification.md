# Jak sprawdzać, że zmiana działa

Kolejność jest obowiązkowa: bez zrzutu ekranu nie twierdź, że funkcja wizualna działa.

## 1. Typy i testy

```bash
npx tsc --noEmit
npm test             # układy pokoi: schody, przejścia, meble (src/lib/layout.test.ts)
```

Zmieniając wymiary budynków (`SHELLS`), układy (`ROOM_PRESETS`) albo geometrię schodów, uruchom `npm test`
— testy pilnują, że gracz zmieści się przy schodach i dojdzie do każdego mebla.

## 2. Zrzut z przeglądarki

Serwer deweloperski musi działać (`npm run dev`). Skrypt zrzutów jest w repozytorium
(`tools/shot.mjs`, puppeteer-core sterujący systemowym Chrome):

```bash
npm run shot -- http://127.0.0.1:5187/ wynik.png "akcja@@akcja@@akcja"
```

Ścieżkę do przeglądarki można nadpisać zmienną `CHROME_PATH`.

Akcje rozdziela `@@` (nie średnik, bo kod JS zawiera średniki):
`click:<selektor>`, `clickText:<tekst>`, `canvas:x,y`, `move:x,y`, `drag:x1,y1,x2,y2`,
`rightclick:x,y`, `shiftclick:x,y`, `wheel:<delta>`, `key/down/up:<KodKlawisza>`,
`wait:<ms>`, `upload:<selektor>,<plik>`, `eval:<js>`.

W trybie deweloperskim dostępne są `window.__mneme` (magazyn), `window.__scene`
(SceneManager, także pola prywatne), `window.__mnemeStorage`, `window.__mnemeLandscapes`.

Przy oknie 1600×1000 scena zajmuje x ∈ [300, 1280], y ∈ [110, 1000], środek to `790,555`.
Każde uruchomienie startuje z czystym profilem, więc dane są zawsze te same.

Sam model biblioteki ocenia się obrotówką — obiekt na pustej planszy, zrzut z czterech stron:

```bash
npm run model-shot -- well zrzuty/studnia
```

## 3. Regresja

Cztery zrzuty po każdej większej zmianie: edytor, „Z oczu", wnętrze budynku
(`enterInterior`), rzut z góry (`key:KeyT`).

## 4. Budowanie

```bash
npm run build
```

Rapier musi zostać w osobnej paczce.

## Czego nie robić

Nie pisz „powinno działać". Jeśli czegoś nie dało się sprawdzić (WebXR w goglach,
czujniki telefonu), napisz wprost, co pozostało niesprawdzone.
