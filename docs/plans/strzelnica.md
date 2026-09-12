# Propozycja: strzelnica — łuk, tarcza i strzały, które zostają w celu

Data: 2026-09-12. Stan wyjściowy: `main` f3d3b44. **Bez zmian w `types.ts` — żadnej migracji**
(nowe typy w katalogu i tak nie wymagają `normalizePalace`; wynik i rekord idą do preferencji).

Ustalenia z rozmowy: łuk bierze się ze **stojaka** (F, jak wsiadanie na wierzchowca), strzelanie **liczy
punkty** z serii i pamięta rekord, strzały wbijają się **we wszystko trwałe** (nie tylko w tarczę).
Pierwszy krok to **prototyp do oceny wrażenia** — reszta etapów dopiero po Twojej ocenie naciągu i wbicia.

## Co już jest w kodzie i co z tego bierzemy

| Potrzeba | Co jest gotowe |
|---|---|
| „Podejdź i naciśnij F" | `doorPrompt` + `useDoor` — [SceneManager.ts:3740](src/three/SceneManager.ts#L3740), [:3812](src/three/SceneManager.ts#L3812). Stojak z łukiem to nowy rodzaj podpowiedzi, nie nowy mechanizm. |
| Trafienie w to, co **widać** | `pickRay` — [SceneManager.ts:2691](src/three/SceneManager.ts#L2691): `intersectObjects` po siatkach wpisów, `userData.objectId` na trafionej siatce, dokładny `h.point` i `h.face.normal`. |
| Czysta arytmetyka z testami | wzorzec `lib/ride.ts` (`stepRide`, `resolveBump`) + `ride.test.ts` — tak samo zrobimy `lib/archery.ts`. |
| Kurz przy chybieniu | `PuffEmitter` — [particles.ts:151](src/three/particles.ts#L151). |
| Model i zwalnianie | `BUILDERS` + `buildModel` — [builders.ts:2436](src/three/builders.ts#L2436), `disposeObject` — [builders.ts:2724](src/three/builders.ts#L2724). |
| Rekord bez migracji | `getPref` / `setPref` w [lib/prefs.ts](src/lib/prefs.ts) — klucz `mneme.prefs.v1`. |

Czego **nie** bierzemy: **Rapiera**. `Physics` nie ma raycastu i nie warto go dodawać — bryły kolizji to
w większości pudła z `localBox` ([physics.ts:73](src/three/physics.ts#L73)), więc strzała stawałaby
w powietrzu 40 cm przed pniem drzewa. Promień po siatkach modeli trafia tam, gdzie widać.

Wymiary, które ograniczają projekt (zmierzone): kamera w spacerze ma `fov` 70 i `near` **0,25 m**
([SceneManager.ts:2297](src/three/SceneManager.ts#L2297), [:431](src/three/SceneManager.ts#L431)),
oczy na 1,6 m (`EYE`), domyślna plansza **40 × 40 m** ([lib/storage.ts:12](src/lib/storage.ts#L12)).
Łuk trzymany 0,45 m przed okiem mieści się przed near-plane; strzelnica na 25 m mieści się na domyślnej planszy.

## Wrażenie: co dokładnie ma się dziać

To jest sedno prośby, więc liczby są częścią propozycji, a nie szczegółem wdrożenia.

### Naciąg (0,75 s od zera do pełna)

| Element | Zachowanie |
|---|---|
| **Cięciwa i strzała** | cięciwa cofa się o 0 → 0,26 m, strzała jedzie z nią, łuk skręca się o 4° w nadgarstku. Naciąg widać na modelu — **nie dokładamy paska postępu**. |
| **Celownik** | trzy kreski `.crosshair` rozchodzą się na 0 → 22 px i **schodzą do punktu** przy pełnym naciągu. Scena ustawia `--draw` na kontenerze (jedna linijka, bez rerenderu Reacta). |
| **Kamera** | `fov` 70 → 62 w 0,3 s; czułość rozglądania × 0,65. Świat na chwilę „przybliża się" — to najtańszy sposób, żeby naciąg był czuć. |
| **Zbyt długie trzymanie** | po 2 s pełnego naciągu wchodzi kołysanie oddechem, amplituda 0 → 0,4° przez 3 s, a kreski celownika znów się rozjeżdżają. Ręka drży, więc puszczasz — bez komunikatu i bez kary. |
| **Prędkość wylotowa** | 26 m/s przy ćwierć naciągu → **58 m/s przy pełnym**. Naciąg poniżej 0,15 nie wypuszcza strzały (przypadkowy klik). |

### Lot

Grawitacja 9,81 m/s², liniowy opór 0,12 1/s. Przy pełnym naciągu na 18 m strzała spada **0,5 m** —
widać, że trzeba mierzyć wyżej, ale nie trzeba tego liczyć. Strzała obraca się za wektorem prędkości
(lotki z tyłu, grot z przodu), więc pod koniec lotu wyraźnie opada nosem.

Trafienie liczymy promieniem **na odcinku jednej klatki** (`far` = długość kroku + 5 cm). Przy 58 m/s
i 60 Hz krok to 0,97 m — bez promienia odcinkowego strzała przelatywałaby przez ścianę.

### Wbicie — tu jest cały „sok"

1. Grot wchodzi **0,12 m (słoma, ziemia) do 0,05 m (kamień)** w powierzchnię, strzała zostaje w kierunku lotu,
   więc skos strzały pokazuje, skąd przyszła.
2. **Drganie:** ogon strzały waha się ±3,5°, 9 Hz, tłumione `e^(−7t)`, znika po 0,7 s. Jedna rzecz, którą
   najbardziej widać na zrzucie serii — i jedyna, która z „pociska w ścianie" robi strzałę.
3. **Tarcza się kołysze:** impuls kątowy proporcjonalny do prędkości i mimośrodu trafienia, 1,6 Hz, gaśnie w 1,2 s.
   Strzały już wbite kołyszą się razem z nią (patrz „strzały żyją osobno" niżej).
4. Chybienie w ziemię: obłoczek kurzu (`PuffEmitter`, 8 cząstek, 0,5 s) i głuchsze łupnięcie.
5. Strzały zostają, aż je wyciągniesz. Limit puli: **32** — najstarsza gaśnie w 0,4 s, żeby nie znikała skokiem.

### Dźwięk (etap 4)

`Soundscape` umie dziś tylko warstwy tła i `thunder()` ([soundscape.ts:72](src/three/soundscape.ts#L72)) —
dorzucamy do niego jednorazowe dźwięki syntezowane tym samym sposobem: skrzyp naciągu (narastający szum
pasmowy), trzask wystrzału, łupnięcie zależne od materiału (słoma 90 Hz, drewno 400 Hz, kamień stuk),
dzwonek przy dziesiątce. Bez plików — projekt nie ma zewnętrznych zasobów.

### Pętla: kołczan i wyciąganie strzał

Kołczan ma **10 strzał**. Pusty kołczan → podpowiedź prowadzi do tarczy: podejście pokazuje
„Wyciągnij strzały (7)", F zwraca je do kołczanu i kasuje z tarczy. Wynik serii (10 strzał) pokazuje się
na HUD, rekord ląduje w preferencjach. Bez ekranu końcowego i bez rankingów.

## Architektura

```
lib/archery.ts        czysta arytmetyka: naciąg, prędkość, krok lotu, pierścienie, kołczan  (+ testy)
three/archery.ts      moduł sceny: łuk w ręce, pula strzał w locie, strzały wbite, drganie, kołysanie
SceneManager          wejście/wyjście z trybu, promień trafienia (callback), podpowiedzi, HUD przez magazyn
```

- `lib/archery.ts` (bez importów z `three/`): `drawStrength(heldSeconds)`, `arrowSpeed(draw)`,
  `stepArrow(a, dt, wind)`, `ringScore(dx, dy, faceRadius)`, `quiverAfterShot(...)`.
  Testy `archery.test.ts`: spadek na 18 m, granice pierścieni, próg 0,15 naciągu, opróżnianie kołczanu.
- `three/archery.ts` — klasa `Archery` z `object: THREE.Group`, `update(dt, cam, cast)`, `dispose()`.
  Moduł **nie zna** `entries`: promień dostaje jako funkcję `cast(from, dir, dist) => Hit | null`
  wstrzykniętą przez `SceneManager`. To trzyma warstwy i pozwala testować bez sceny.
- `SceneManager`: pole `archery`, wywołanie w gałęzi `fp` pętli
  ([frame, SceneManager.ts:3533](src/three/SceneManager.ts#L3533)), dwa nowe rodzaje `doorPrompt`
  (`bow` — weź łuk, `pull` — wyciągnij strzały), LMB/dotyk przejęte na czas trybu łuku.
- Magazyn: `bow: { arrows: number; score: number; shots: number; best: number } | null` — same liczby,
  które zmieniają się rzadko. **Naciąg nie idzie przez magazyn** (60 rerenderów na sekundę);
  rysują go model łuku i `--draw` na kontenerze.

**Strzały żyją osobno.** Wbita strzała nie jest dzieckiem wpisu (przebudowa modelu przy zmianie
`buildKey` by ją zabrała), lecz siedzi we własnej grupie i pamięta `objectId` + pozycję w lokalnym
układzie wpisu. Co klatkę przepisuje transform z macierzy wpisu — dzięki temu jedzie z tarczą,
gdy ta się kołysze albo gdy przesuniesz ją w edytorze, a gdy wpis zniknie, strzała gaśnie.
Strzały to stan sceny, nie dane pałacu: zmiana pałacu je czyści.

## Nowe elementy biblioteki

| Id | Nazwa | Uwagi |
|---|---|---|
| `archery_target` | Tarcza łucznicza | Snop słomy Ø 1,22 m (wymiar FITA) na trójnogu, pięć pierścieni po 0,122 m promienia: złoty, czerwony, niebieski, czarny, biały → 10/8/6/4/2 punkty. `collider: 'trimesh'`, `footprint` 0,8. Tarcza stoi i na planszy, i we wnętrzu. |
| `bow_stand` | Stojak z łukiem | Kozioł z łukiem i wiadrem strzał. F bierze łuk, F przy stojaku go odkłada. `footprint` 0,5. |

Plus zestaw **„Strzelnica"** (`lib/sets.ts`, `outdoor: true`, 26 × 6 m): stanowisko z belek, stojak z łukiem,
trzy tarcze na **10, 18 i 25 m**, dwie latarnie. Mieści się na domyślnej planszy 40 × 40 m; na mniejszej
zestaw się nie postawi — zwykły komunikat „nie ma miejsca" wystarczy.

## Etapy

| Etap | Co powstaje | Jak sprawdzam |
|---|---|---|
| **1. Prototyp wrażenia** | `archery_target` w katalogu, `lib/archery.ts` + testy, `three/archery.ts` z łukiem w ręce, naciąg, lot, wbicie i drganie. Wejście w tryb **tymczasowo klawiszem `B`** (stojak dopiero w etapie 2), strzały bez limitu, bez punktów i dźwięków. | `npm test`; zrzuty: pełny naciąg, strzała w locie, trzy strzały w tarczy z 12 m; **seria zrzutów co 60 ms po trafieniu**, żeby ocenić drganie. Tu się zatrzymujemy i oceniasz. |
| 2. Stojak i kołczan | `bow_stand`, podpowiedzi `bow`/`pull`, 10 strzał, wyciąganie strzał z tarczy, wyjście z trybu (F albo `B`; **nie Esc** — Esc oddaje kursor), przycisk „Napnij" na telefonie zamiast „Skok". | zrzuty: podpowiedź przy stojaku, łuk w ręce, puste kołczan, podpowiedź przy tarczy |
| 3. Punkty | `ringScore`, punkty jako etykieta CSS2D unosząca się nad wbiciem, wynik serii na HUD, rekord w `prefs`. | test granic pierścieni; zrzut HUD po serii; rekord przeżywa odświeżenie |
| 4. Dźwięk | jednorazowe dźwięki w `Soundscape`: naciąg, wystrzał, łupnięcie po materiale, dzwonek dziesiątki. | odsłuch (ten jeden etap oceniasz uchem, nie zrzutem) |
| 5. Reakcja świata | kołysanie tarczy, kurz przy chybieniu, dryf od wiatru przy pogodzie `storm`/`rain`. | zrzuty: tarcza odchylona po trafieniu, kurz po strzale w ziemię |
| 6. Zestaw i teksty | zestaw „Strzelnica", `HelpModal`, `README`. | zrzut postawionego zestawu z góry (`key:KeyT`) |

Regresja po etapach 1, 2 i 5: cztery zrzuty jak zwykle (edytor, „Z oczu", wnętrze, rzut z góry).

## Ryzyka, które widzę

- **LMB w spacerze już coś robi** — `onPointerDown` w trybie `fp` woła `pick` + `fpInteract`
  ([SceneManager.ts:2860](src/three/SceneManager.ts#L2860)). W trybie łuku LMB musi przejąć naciąg,
  a `fpInteract` nie może się odpalać. Wyjście z trybu pod F/`B`, bo Esc w spacerze oddaje kursor.
- **Tryb łuku a wierzchowiec i stawianie obiektów** — wzajemnie się wykluczają: wejście w tryb łuku
  gasi `placing`, a wsiadanie na wierzchowca gasi łuk (strzelanie z konia to inna gra, patrz niżej).
- **StrictMode** — `Archery` powstaje i ginie w parze; `dispose()` musi zwolnić geometrię prototypu
  strzały i łuku (materiały z `mat()` są współdzielone — ich nie ruszamy).
- **Gogle i tryb stereo** — łuk przypięty do kamery zadziała, ale naciąg jednym kontrolerem to inna
  mechanika. W VR tryb łuku będzie **niedostępny**; napiszę to wprost, a nie zostawię zepsute.

## Czego nie proponuję

- **Strzał w Rapierze.** Promień po siatkach jest dokładniejszy od pudeł kolizji i testowalny bez sceny.
- **Strzelania do zwierząt.** Strzała przelatuje przez psa, kota i ptaki. Nie chcę w pałacu pamięci
  mechaniki zabijania, a „zwierzę ucieka od strzały" to osobny pomysł na `wildlife.ts`.
- **Łuku z wierzchowca.** Konna strzelnica to druga pętla sterowania (`updateRide` prowadzi kamerę)
  i osobny temat.
- **Zapisu strzał w danych pałacu.** Strzały mają być ulotne; trwałe wymagałyby migracji i rosłyby
  bez końca w `localStorage`.
