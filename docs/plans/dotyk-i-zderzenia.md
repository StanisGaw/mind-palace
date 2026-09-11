# Propozycja: multitouch na telefonie i miękkie zderzenia pojazdów

Data: 2026-09-11. Stan wyjściowy: `main` 852839e. Bez zmian w danych pałacu — żadnej migracji.

## Co zmierzono

Test dwoma palcami przez CDP (`Input.dispatchTouchEvent`, telefon 390 × 844) na dzisiejszym `main`:

| Próba | Wynik |
|---|---|
| gałka + rozglądanie po prawej | **działa** (gałka trzyma −0,88, yaw 0,785 → 0,425) |
| gałka + przycisk „Skok" | **działa** (gałka nie gubi się) |
| gałka + „W górę" w taksówce | **działa** (gaz 0,50 → 0,75, maszyna wznosi się) |
| **rozglądanie po lewej 35% ekranu** | **Δyaw = 0,000 — martwa strefa** |

Hitboxy przeszkód w mieście (`obstacles()`), w metrach:

| Obiekt | hitbox | wysokość | ile naprawdę ma bryła na tej wysokości |
|---|---|---|---|
| **megawieżowiec** | 12,4 × 12,4 | 0 … 45,6 | u góry **5 × 5** — pudło jest 2,5× za szerokie |
| **wieżowiec** (skala 1,1) | 9,2 × 9,2 | 0 … 40,9 | trzon **6,6 × 6,6** — pudło 40% za szerokie |
| fontanna (skala 1,8) | 4,7 × 4,7 | 0 … 3,7 | misa 4,7 — zgodne |
| blok (skala 2) | 11,8 × 12,0 | 0 … 7,0 | 11,8 — zgodne |

Margines pojazdu to `footprint × 0,5 × skala`: samolot i taksówka 1,2 m, smok 1,8 m, koń 0,6 m.

Zderzenie ([SceneManager.ts:4321](src/three/SceneManager.ts#L4321)):
```ts
if (bump.hit) { s.x = bump.x; s.z = bump.z; s.speed = 0; if (spec.kind === 'air') s.throttle = 0; … }
```
Prędkość kasowana do zera niezależnie od kąta natarcia i od tego, czy to muśnięcie, czy uderzenie czołowe.

## Trzy przyczyny

1. **Martwa strefa dotyku.** [SceneManager.ts:2838](src/three/SceneManager.ts#L2838) rejestruje palec do rozglądania
   tylko gdy `ev.clientX - r.left > r.width * 0.35`. Reguła miała chronić gałkę, ale gałka jest osobnym elementem
   DOM z własnym `setPointerCapture` i tak czy owak nie dostaje tych zdarzeń (`isUiTarget` odsiewa je wcześniej).
   Przy okazji `touchLook` to jedno pole, więc drugi palec po prawej odbiera pierwszemu rozglądanie.
2. **Strona daje się rozsuwać dwoma palcami.** `index.html` ma `width=device-width, initial-scale=1.0,
   viewport-fit=cover`, a `.viewport` nie ma `touch-action`. Na iOS dwa palce zaczynające na scenie uruchamiają
   powiększanie strony i przeglądarka wysyła `pointercancel` — palce znikają w połowie ruchu. **Tego nie da się
   odtworzyć w Chrome na Macu**, więc to hipoteza wyprowadzona z kodu, nie pomiar; jest jednak najbardziej
   prawdopodobnym wyjaśnieniem „braku multitouch", skoro sama logika dwóch palców w teście działa.
3. **Jedno pudło na całą wysokość bryły.** `obstacles()` bierze ramkę całego modelu, więc wieża, która zwęża się
   ku górze, ma na szczycie obrys swojego cokołu. Do tego w ramce siedzą ozdoby wystające poza mur
   (neonowe obręcze, gzymsy, maszty).

## Propozycja UX

### A. Dotyk: cała scena rozgląda, każdy palec liczy się osobno

- Skasować próg 35%. Rozglądać ma każde przeciągnięcie po płótnie — gałka i przyciski to elementy DOM,
  które i tak nie trafiają do `onPointerDown` sceny.
- `touchLook` zamienić na `Map<pointerId, …>`: dwa palce po prawej stronie działają niezależnie, a podniesienie
  jednego nie przerywa ruchu drugiego. Obrót liczymy z sumy przesunięć — dzięki temu „przekładanie" palców
  (typowe przy dłuższym obrocie) jest płynne, bez skoku kamery.
- `.viewport { touch-action: none }` — dwa palce **zaczynające na scenie** nie rozsuwają strony. Panele
  i teksty poza sceną dalej dają się powiększać, więc nie odbieramy dostępności (to lepsze niż
  `user-scalable=no` w `<meta>`, które wyłączyłoby powiększanie całej aplikacji).

### B. Zderzenie: ślizg, odbicie albo zatrzymanie — zależnie od kąta

Zamiast jednego „stop" trzy zachowania, wybierane kątem między kierunkiem lotu a normalną ściany
(`n` z `contact()`, `f` = kierunek maszyny, `d = f · n`):

| Sytuacja | Warunek | Co się dzieje |
|---|---|---|
| **Muśnięcie** | `d > −0,7` (kąt do ściany < 45°) | maszyna **ślizga się wzdłuż elewacji**: `yaw` dochodzi płynnie (λ ≈ 8) do stycznej bliższej obecnemu kursowi, prędkość spada tylko o 3% na klatkę kontaktu. Lecąc ulicą i ocierając się o wieżowiec, płyniesz dalej wzdłuż niego. |
| **Uderzenie czołowe** | `d ≤ −0,7`, prędkość > 6 m/s | **odbicie**: prędkość spada do 25%, `yaw` odchyla się o 50–70° w stronę bliższej stycznej, przez 0,6 s sterowanie jest przytłumione (`oszołomienie`), kamera lekko drga, w punkcie styku leci obłok (`PuffEmitter`, już istnieje). Potem lecisz dalej — nie ma zatrzymania w miejscu. |
| **Dojechanie** | prędkość ≤ 6 m/s | jak dziś: maszyna staje przy ścianie. Przy małej prędkości nagłe zatrzymanie nie razi. |

Dodatkowo:
- **Gaz zostaje.** Dziś `s.throttle = 0` przy zderzeniu samolotu — po odbiciu trzeba dodawać gaz od zera.
  Po zmianie gaz zostaje, bo maszyna dalej leci; to on utrzymuje „nie tracę lotu".
- **Koń i czerw**: sam ślizg, bez odbicia (koń ocierający się o mur wygląda naturalnie, odbijający — nie).
- **Komunikat raz na zderzenie.** Dziś toast leci przy każdej nowej przeszkodzie, więc ślizg wzdłuż rzędu
  wieżowców zasypuje ekran. Toast tylko przy uderzeniu czołowym, i nie częściej niż raz na 3 s.

Technicznie: `stepRide` zostaje bez zmian, cała rzecz dzieje się po `pushOut` w `updateRide`. Nowa czysta
funkcja w `lib/ride.ts`:
```ts
export function resolveBump(r: RideState, nx: number, nz: number, spec: MountSpec, dt: number): 'slide' | 'bounce' | 'stop'
```
— z testami na trzy kąty i dwie prędkości. `RideState` dostaje jedno pole `stun: number` (sekundy
przytłumionego sterowania); to stan jazdy, nie dane pałacu, więc **bez migracji**.

### C. Hitbox: pudło na tej wysokości, na której lecisz

- `modelBounds` → `modelSlices(model, 4)`: cztery poziome plastry ramki modelu (union ramek siatek, które
  sięgają danego pasma wysokości). Megawieżowiec dostaje wtedy u góry 5 × 5 zamiast 12,4 × 12,4.
- `Obstacle` dostaje `slices: { bottom, top, hx, hz, cx, cz }[]`; `contact()` wybiera plaster po `y`.
  Gdy `y` nieznane (zwierzęta chodzące po ziemi) — plaster przy gruncie, czyli dzisiejsze zachowanie.
- Ozdoby wystające poza mur: przy składaniu plastra pomijamy siatki cieńsze niż 0,25 m w obu osiach poziomych
  (neonowe rurki, maszty, linki) — nie da się o nie zahaczyć, a potrafią rozdąć pudło o metr z każdej strony.
- Margines pojazdu z `footprint × 0,5` na **`footprint × 0,4`**: przy samolocie 0,96 m zamiast 1,2 m.
  Nie schodzimy niżej, bo skrzydła samolotu i tak są szersze niż margines — to świadomy kompromis
  (kadłub ma nie wjeżdżać w mur, końcówka skrzydła może wizualnie musnąć).

## Etapy

| Etap | Pliki | Sprawdzenie |
|---|---|---|
| 1. Dotyk | `SceneManager.ts` (próg i `Map`), `styles.css` | test CDP dwoma palcami: rozglądanie po lewej Δyaw ≠ 0; dwa palce po prawej naraz |
| 2. `resolveBump` + testy | `lib/ride.ts`, `lib/ride.test.ts` | `npm test` — trzy kąty × dwie prędkości |
| 3. Zderzenia w scenie | `SceneManager.ts` | zrzut: lot taksówką w ścianę wieżowca — prędkość po 1 s > 0, maszyna wzdłuż elewacji |
| 4. Plastry hitboxa | `three/builders.ts` (`modelSlices`), `lib/obstacles.ts`, `obstacles.test.ts` | test: megawieżowiec na 35 m ma `hx` ≈ 2,5; przelot nad tarasem nie blokuje |
| 5. Pomoc i README | `HelpModal.tsx`, `README.md` | — |

Etapy 1, 2 i 4 są niezależne. Zrzuty regresji jak zwykle: edytor, „Z oczu", wnętrze, rzut z góry —
plus lot taksówką wzdłuż alei i marsz konia wzdłuż muru.

## Czego nie proponuję

- **Pełnej fizyki pojazdów w Rapierze.** Wierzchowce liczą się dziś czystą arytmetyką w `lib/ride.ts`
  i to jest zaleta (testy bez sceny). Odbicie z ciałem sztywnym dałoby efekt trudniejszy do przewidzenia,
  a przy 22 m/s i mapie 80 m łatwo o wystrzelenie poza planszę.
- **Obrysów wypukłych zamiast prostokątów.** Przy bryłach tego projektu (prostopadłościenne wieżowce, okrągłe
  wieże) plastry załatwiają sprawę taniej i bez nowej matematyki w `contact()`.
