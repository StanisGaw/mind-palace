# Plan: koniec zacinania — stała pula świateł punktowych

Data: 2026-09-11. Stan wyjściowy: `main` 7870057 (po scaleniu „Neonowego miasta”). Bez zmian w danych
pałacu — żadnej migracji, żadnego nowego pola w `PalaceObject`.

## Co zmierzono (zanim cokolwiek zaplanowano)

Pomiar w prawdziwym Chrome z GPU (skrypt `tools/perf.mjs`, etap 0), na tym Macu (10 rdzeni), okno 1600 × 1000,
DPR 2 (Retina, bufor 1960 × 1746), szablon „Neonowe miasto” (125 obiektów, 948 siatek, 55 świateł punktowych):

| Scenariusz | fps | p95 | max klatki | zacięcia > 50 ms | programy shaderów |
|---|---|---|---|---|---|
| edytor, kamera stoi | 60 | 18,8 ms | 20 ms | 0 | 50 → 50 |
| edytor, **obrót widoku 3 s** | 20 | 88 ms | **847 ms** | 5 | **51 → 91** |
| spacer, stoi przy bramie | 60 | 18,4 ms | 19 ms | 0 | 123 → 123 |
| spacer, idzie aleją 5 s | 60 | 18,6 ms | 19,5 ms | 0 | 123 → 123 |
| spacer, `pointLights = 0` | 60 | 18,4 ms | 19 ms | 0 | 123 → **155** |

Bisekcja z pierwszego przebiegu (wyłączanie po jednym: deszcz, zwierzęta, panorama poza planszą, wieżowce,
`castShadow`, DPR 1) — **żaden** z tych wyłączników nie zmienia stałego czasu klatki: scena trzyma 60 kl./s.
Liczba wywołań rysowania 300–600, trójkątów 40–50 tys. — to nie jest scena, którą trzeba upraszczać ani
dodatkowo przycinać (Three.js i tak odrzuca bryły poza stożkiem kamery — `frustumCulled` jest domyślnie włączone).

**Zacięcia biorą się z kompilacji shaderów.** `updatePointLights` (`SceneManager.ts:3350-3372`) zapala tylko
`qspec.pointLights` najbliższych świateł i po wygaszeniu ustawia `l.visible = false`. Three.js buduje program
shadera osobno dla każdej liczby widocznych świateł punktowych, więc każda zmiana tej liczby (a przy płynnym
przenikaniu bywa 8 → 9 → 7 → 8 co kilka kroków) to nowy program na **każdy** materiał w scenie — 40 programów
w 3 sekundy obracania widoku, każdy po kilkanaście–kilkadziesiąt ms. Dowód: łatka, która trzyma wszystkie 55
świateł stale widoczne, daje stałą liczbę programów (66 → 67) i zero kompilacji podczas obrotu i marszu
(fps spada wtedy do 7–12, bo 55 świateł liczy się w każdym pikselu — to potwierdza, że pula musi być mała,
a nie że pomysł jest zły).

Wniosek: **liczba widocznych świateł ma być stała** — tyle, ile mówi jakość (3/6/8/10) — a zmieniać się ma
tylko to, *które* źródło świeci z danego miejsca puli. Sugestie „rysować tylko to, co widać” i „upraszczać
modele w edytorze” nie adresują zmierzonej przyczyny; opisane osobno na końcu.

## Rozumienie zadania

1. W scenie zostaje stała pula `N = qspec.pointLights` obiektów `THREE.PointLight`, zawsze `visible`, o zmiennym
   `intensity` (0 = zgaszone, ale nadal liczone jako światło → program się nie zmienia).
2. Światła z modeli (`buildLantern`, `buildTorch`, lampy sufitowe, neon, latarnia uliczna, taksówka…) stają się
   **źródłami danych**: pozycja w świecie, kolor, `distance`, `decay`, natężenie bazowe. W scenie są stale
   `visible = false`, więc nie liczą się do programu. `buildModel` nie zmienia się — źródła nadal powstają
   w `builders.ts`, zbiera je istniejąca pętla przy budowie wpisu (`SceneManager.ts:1039-1044`).
3. Przydział źródeł do miejsc w puli to czysta logika z histerezą i przenikaniem — trafia do `lib/` z testami.
4. Zmiana jakości zmienia `N` → jedna rekompilacja materiałów (jak dziś przy przełączeniu cieni) — akceptowalne.

Założenia przyjęte wprost:
- Miejsce w puli, którego źródło wypadło z czołówki, najpierw **gaśnie** (jak dziś, `k = 1 − e^(−8·dt)`), a dopiero
  ciemne dostaje nowe źródło i rozjaśnia się. Przez ułamek sekundy świeci więc mniej niż `N` świateł — dziś przy
  przenikaniu świeci ich chwilowo *więcej* i właśnie to kosztuje.
- Histereza: źródło trzyma miejsce, dopóki jest w czołówce `N + 2` (po tej samej mierze co dziś: odległość minus
  zasięg). Bez tego dwa źródła na granicy zamieniałyby się miejscami co 6 klatek i mrugały.
- Ruchome źródła (światło pod taksówką, latarka na wierzchowcu) — pozycja kopiowana co klatkę dla zajętych
  miejsc puli; to `N` wywołań `getWorldPosition`, pomijalne.
- Podgląd „ducha” z biblioteki (`SceneManager.ts:1571`, `light.intensity = 0`) nie trafia do puli, bo duch nie
  jest wpisem `entries` — bez zmian.
- Błysk pioruna (`applyLighting`, `:662-664`) rusza tylko `hemi`/`ambient`/`sun` — bez zmian.

## Etap 0 — narzędzie pomiarowe `tools/perf.mjs`

**Pliki**
- `tools/perf.mjs` (nowy) — puppeteer-core na systemowym Chrome **bez** swiftshadera (`headless: false`,
  `deviceScaleFactor` z argumentu), buduje pałac z szablonu, mierzy przez `requestAnimationFrame` średnią,
  p95 i maksimum klatki, liczbę zacięć > 50 ms, `renderer.info.programs.length` przed i po, `renderScale`;
  scenariusze: edytor statycznie, obrót widoku (środkowy przycisk), spacer stojąc, marsz `W` 5 s (klawisze
  przez `__scene.keys`, bo bez pointer lock zdarzenia klawiatury są ignorowane). Wypisuje tabelę na stdout.
- `package.json` — skrypt `"perf": "node tools/perf.mjs"`.
- `README.md` — jedno zdanie obok opisu `npm run shot`.

**Do reużycia** — struktura `tools/shot.mjs` (uruchomienie, `__mneme`, `__scene`), `createPalace(name, template)`.

**Sprawdzenie**
```bash
npm run perf -- http://127.0.0.1:5187/ city 2
```
Oczekiwane dziś: wiersz „obrót widoku” z rosnącą liczbą programów i zacięciami — to jest linia bazowa.

**Ryzyko** — skrypt otwiera prawdziwe okno Chrome na pierwszym planie; dokument mówi o tym w nagłówku.

## Etap 1 — `lib/lightpool.ts`: przydział źródeł do miejsc puli

**Pliki**
- `src/lib/lightpool.ts` (nowy):
  ```ts
  export interface LightSource { id: string; score: number } // odległość od kamery minus zasięg
  export interface LightSlot { source: string | null; on: boolean } // on=false → gaśnie, po zgaśnięciu wolne
  export function assignSlots(slots: LightSlot[], sources: LightSource[], n: number, dark: (slot: number) => boolean): LightSlot[]
  ```
  Zasady: `sources` posortowane rosnąco po `score`; miejsce zachowuje źródło, jeśli jest w pierwszych `n + 2`;
  w przeciwnym razie `on = false`; miejsce z `on = false`, dla którego `dark(i)` (natężenie ≈ 0), dostaje
  najlepsze źródło spoza puli i `on = true`. Wynik ma zawsze `n` miejsc (skrócenie/wydłużenie przy zmianie jakości).
- `src/lib/lightpool.test.ts` (nowy) — przypadki: mniej źródeł niż miejsc; źródło na granicy nie mruga
  (histereza); miejsce nie zmienia źródła przed zgaśnięciem; zmiana `n` z 8 na 3 gasi nadmiar; brak źródeł.

**Zmiany danych** — brak.

**Sprawdzenie** — `npm test` (nowy plik), `npx tsc --noEmit`.

**Ryzyko** — nieznaczne; czysta funkcja bez Three.js.

## Etap 2 — pula w `SceneManager`

**Pliki**
- `src/three/SceneManager.ts`:
  - pole `private lightPool: THREE.PointLight[] = []` i `private lightSlots: LightSlot[] = []` obok `pointLights`
    (`:317`); `pointLights` zostaje jako lista **źródeł** (zbierana co 6 klatek jak dziś).
  - `private buildLightPool()` — woła się z konstruktora po `this.scene.add(this.sun)` (`:488`) i z `setQuality`
    (`:4540`): usuwa stare światła puli ze sceny, tworzy `qspec.pointLights` nowych (`intensity 0`,
    `castShadow = false`, `visible = true`), dodaje do sceny; `lightSlots` skraca/wydłuża.
  - zbieranie źródeł przy budowie wpisu (`:1039-1044`): dodatkowo `l.visible = false` — od tej chwili źródło
    nigdy nie liczy się do programu. Ta sama linia dla modeli z plików po `assetLoaded` (przebudowa wpisu i tak
    przechodzi przez tę pętlę).
  - `updatePointLights` (`:3350-3372`): co 6 klatek liczy `score` per źródło (jak dziś), woła `assignSlots`;
    co klatkę dla każdego miejsca: jeśli ma źródło — kopiuje `color`, `distance`, `decay`, pozycję świata źródła
    (`getWorldPosition`) do światła puli; natężenie dochodzi do `on ? baseIntensity : 0` z dzisiejszym `k`.
    Żadnego `visible = false`.
  - `dispose()` — światła puli usunięte ze sceny (nie mają zasobów GPU, ale porządek).
- `src/lib/quality.ts` — bez zmian (`pointLights` już jest w `QualitySpec`).

**Do reużycia** — `lightPosTmp`, `qspec`, `lightTick`, `baseIntensity` w `userData`, wzorzec `applyQuality`.

**Sprawdzenie**
```bash
npm run perf -- http://127.0.0.1:5187/ city 2
```
Oczekiwane: w wierszach „obrót widoku”, „marsz” i „marsz po zmianie na 0 świateł” liczba programów **nie rośnie**
(poza pierwszym wierszem, gdy scena kompiluje się raz), `stalls50ms = 0`, `max < 40 ms`.
Zrzuty nocne (`ambience: 'night'`, wioska i miasto): latarnie przy kamerze świecą, dalekie ciemne — jak dziś:
```bash
npm run shot -- http://127.0.0.1:5187/ noc.png "eval:__mneme.getState().createPalace('M','city')@@wait:14000@@clickText:Z oczu@@wait:2500@@eval:__scene.placeRig({x:0,z:37,yaw:0})@@wait:1500@@eval:document.title=[...__scene.lightPool].filter(l=>l.intensity>0.05).length"
```
Odczyt: `document.title` = liczba świecących miejsc puli ≤ `qspec.pointLights` (8 przy „wysokiej”).

**Ryzyko**
- Światło puli z `intensity 0` nadal kosztuje w pikselu — ale tyle samo, ile dziś kosztuje `N` zapalonych; nie
  więcej. Gdyby na słabym sprzęcie było za drogo, to jakość „niska” ma `pointLights: 3` — bez zmian w planie.
- Lampa sufitowa wewnątrz budynku „w miejscu” ma mały zasięg; miara `odległość − zasięg` już to uwzględnia.
- Tryb wnętrza zagnieżdżonego (`p.interior`) buduje osobną scenę tych samych wpisów — pula żyje w `this.scene`,
  więc działa tam tak samo; sprawdzić zrzutem `enterInterior` w wiosce.
- VR/stereo: `frame()` woła `updatePointLights` raz na klatkę (już jest tak dla pogody) — bez zmian.

## Etap 3 — rozgrzanie shaderów pod ekranem ładowania

Pierwsza klatka po zbudowaniu pałacu kompiluje wszystkie materiały (dziś 50–120 programów, do 800 ms) — ekran
ładowania to zasłania, ale klatka i tak jest jedna, długa. Po etapie 2 liczba programów jest stała, więc można je
skompilować **zanim** ekran zniknie:

**Pliki**
- `src/three/SceneManager.ts` — po pełnej przebudowie sceny (tam, gdzie kończy się budowa wpisów po zmianie
  pałacu) `this.renderer.compile(this.scene, this.camera)` jedno wywołanie; `syncLoadingScreen` (`:3568`)
  trzyma ekran, dopóki `pendingLoads` niepuste — kompilacja jest synchroniczna, więc nic więcej nie trzeba.

**Sprawdzenie** — `npm run perf`: pierwszy wiersz („edytor statycznie”) ma `max < 40 ms`, bo kompilacja
odbyła się przed pomiarem; wizualnie: brak „skoku” zaraz po zniknięciu ekranu ładowania.

**Ryzyko** — `compile()` nie kompiluje wariantów materiałów, które pojawią się później (nowy typ obiektu
z biblioteki) — te nadal dadzą pojedyncze, krótkie zacięcie przy pierwszym postawieniu; to akceptowalne.

## Zależności

| Etap | Wymaga | Daje |
|---|---|---|
| 0 narzędzie | — | linia bazowa i pętla zwrotna dla 2 i 3 |
| 1 `lib/lightpool.ts` | — | przydział z testami |
| 2 pula w scenie | 0, 1 | koniec rekompilacji przy ruchu |
| 3 rozgrzanie | 2 (stała liczba programów) | brak skoku po ekranie ładowania |

Etapy 0 i 1 są niezależne i mogą iść równolegle.

## Zrzuty regresji (po etapie 2 i po 3)

1. Edytor — wioska w dzień (`clear`, `garden`): cienie i lampy jak przed zmianą.
2. „Z oczu” — miasto nocą przy bramie (polecenie wyżej): neony i latarnie przy graczu świecą.
3. Wnętrze — `enterInterior` dworu w wiosce: lampy sufitowe świecą (źródła w budynku dostają miejsca puli).
4. Rzut z góry (`key:KeyT`) — miasto: bez zmian względem `docs`/poprzednich zrzutów.

Do tego `npm run perf` dla wioski i miasta przy DPR 1 i 2 — tabela do opisu commita.

## Poza planem (osobna propozycja, jeśli będzie potrzeba)

- **Uproszczone modele w edytorze / LOD** — pomiar nie wskazuje na koszt geometrii (50 tys. trójkątów,
  ≤ 600 wywołań rysowania przy 60 kl./s). Gdyby kiedyś scena urosła do tysięcy obiektów, pierwszy ruch to
  `castShadow = false` dla brył poza kwadratem mapy cienia (panorama poza planszą) i scalanie statycznych
  wieżowców panoramy w jedną siatkę (`mergeByMaterial` już istnieje per model) — nie teraz.
- **Odrzucanie brył poza stożkiem kamery** — działa od zawsze w Three.js (`frustumCulled`), nie ma czego dodawać.
- **Automat rozdzielczości** (`nextScale`) reaguje na *średnią* z klatki, więc pojedyncze zacięcia kompilacji
  potrafią na sekundę obniżyć skalę renderu (widać w pomiarze z łatką: 1 → 0,7). Po etapie 2 przestaje to
  występować; gdyby nie — osobno rozważyć medianę zamiast średniej wykładniczej.
