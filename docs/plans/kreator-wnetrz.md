# Plan wdrożenia: kreator wnętrz

Data: 2026-09-07. Podstawa: doprecyzowanie z `/eq-grill` (decyzje użytkownika: piętra w jednej
scenie z prawdziwymi schodami, drzwi fizyczne bez zmiany sceny, preset tylko w pustym wnętrzu,
własne presety na urządzeniu i w eksporcie z wyborem przy imporcie; balkony i tarasy odłożone).

## Zasada przewodnia

Wnętrze pozostaje zagnieżdżonym pałacem. **Ściany działowe, drzwi, okna i schody to zwykłe
obiekty biblioteki** w nowej kategorii „Konstrukcja". Dzięki temu układ pokoju to lista
`PalaceObject`, a preset to ta sama lista w współrzędnych względnych. Gizmo, skala, kotwiczenie,
cofanie, kolizje i usuwanie działają bez nowego narzędzia.

Powłoka (podłoga, ściany obwodowe, stropy, sufit, drzwi wyjściowe) nadal jest proceduralna
w `three/interior.ts`, ale jej wymiary wynikają ze skali budynku, a liczba pięter z danych.

### Odstępstwa od założeń z doprecyzowania

- **Bez pola piętra w `PalaceObject`.** Piętro wynika z wysokości: `floorOf(y) = floor((y + 0.05) / H)`.
  Zero migracji, a przesunięcie gizmem w pionie samo zmienia piętro.
- **Bez stanu drzwi w danych.** Otwarcie drzwi to stan chwilowy w `SceneManager`, kasowany przy zmianie
  sceny. Drzwi zawsze zaczynają zamknięte. Nic nie trzeba zapisywać ani migrować.

## Model danych (docelowy)

```ts
// types.ts
export type Category = ... | 'structure';           // nowa kategoria
export interface Palace {
  ...
  interior?: { buildingType: string; floors: number }; // floors: 1..4, było tylko buildingType
}
```

Wymiary pokoju liczy czysta funkcja `roomSpecFor(palace, palaces): RoomSpec & { floors }`
w `lib/rooms.ts`: `width = clamp(ROOMS[typ].width × scale.x budynku, 4, 40)`, analogicznie
`depth` ze `scale.z`, `height` = wysokość jednej kondygnacji z `ROOMS`, `floors` z danych.
Gdy budynek-rodzic nie istnieje (osierocone wnętrze), skala = 1.

Preset (`lib/presets.ts`):

```ts
interface PresetObject {
  type: string; name?: string;
  u: number; v: number;         // -0.5..0.5 względem szerokości i głębokości pokoju
  floor: number; dy?: number;   // piętro i wysokość nad jego podłogą
  rotationY: number;
  scale?: Vec3;
  span?: { axis: 'x' | 'z'; frac: number }; // ściany: długość jako ułamek wymiaru pokoju
}
interface RoomPreset {
  id: string; name: string; description: string;
  buildingTypes?: string[];     // brak = dla wszystkich
  floors: number;
  objects: PresetObject[];
  custom?: boolean;
}
```

---

## Etap 1 — Dane, migracja, katalog, presety (bez zmian widocznych)

**Pliki**
- `src/types.ts` — `Category` + `'structure'`, `Palace.interior.floors`, typy `PresetObject`, `RoomPreset`.
- `src/catalog.ts` — cztery pozycje kategorii `structure`: `wall` „Ściana działowa" (collider `box`, maxScale 12),
  `door` „Drzwi" (collider `trimesh`), `window` „Okno" (collider `none`), `stairs` „Schody" (collider `trimesh`, maxScale 2).
  `CATEGORY_LABELS.structure = 'Konstrukcja'`, `CATEGORY_ORDER` z `structure` na początku.
  `RoomSpec.windows` zostaje tylko do migracji.
- `src/lib/rooms.ts` (nowy) — `roomSpecFor`, `floorOf(y, H)`, `FLOOR_MAX = 4`.
- `src/lib/presets.ts` (nowy) — `ROOM_PRESETS` (wbudowane, 2–3 na typ budynku), `instantiatePreset(preset, spec): PalaceObject[]`,
  `capturePreset(name, palace, spec): RoomPreset` (odwrotność: obiekty → współrzędne względne, bez notatek, ściany dostają `span`).
- `src/lib/presetStore.ts` (nowy) — `loadCustomPresets`, `saveCustomPresets`, klucz `mneme.presets.v1`, limit 30 (wzór `textureStore.ts`).
- `src/lib/storage.ts` — migracja i eksport/import (patrz niżej).

**Zmiany danych i migracja** (w `normalizePalace`, idempotentna)
- `interior` bez `floors` → `floors = 1`. Przy tej samej okazji **dawne okna z powłoki stają się obiektami `window`**
  w tych samych miejscach, w których rysował je `buildRoom` (parzyste po lewej, nieparzyste po prawej, tylne dla `w ≥ 10`).
  Warunek migracji to brak `floors`, więc drugi przebieg nic nie dodaje.
- `floors` spoza 1..4 → przycięcie.
- `exportPalaceJson(root, all, presets)` dodaje klucz `presets` (tylko własne). `parseImport` zwraca
  `{ palaces, presets }`; stare pliki bez klucza dają `presets: []`. Presety z pliku dostają nowe id (`uid('rp')`) i `custom: true`.

**Do reużycia**: `normalizePalace`, `uid`, `toScale`, wzór `textureStore.ts`, `hashString` niepotrzebny.

**Sprawdzenie**
```bash
npx tsc --noEmit
npm run shot -- http://127.0.0.1:5187/ e1.png "eval:(()=>{const s=window.__mnemeStorage;const p=s.normalizePalace({id:'x',name:'t',objects:[],path:[],interior:{buildingType:'palace'}});return [p.interior.floors,p.objects.filter(o=>o.type==='window').length]})()"
```
Oczekiwany odczyt: `[1, 5]` (cztery okna boczne i jedno tylne dla pałacu). Drugi `normalizePalace` na wyniku daje `[1, 5]` bez nowych obiektów.

**Ryzyko**: `normalizePalace` nie zna skali budynku, więc zmigrowane okna stoją w wymiarach bazowych.
To zgodne z dotychczasowym zachowaniem (skala nie wpływała na pokój). Rozpoznanie: okna „w powietrzu" poza ścianą
w przeskalowanym budynku — pomaga clamp z etapu 3.

---

## Etap 2 — Elementy konstrukcyjne w bibliotece (widoczne w edytorze)

**Pliki**
- `src/three/builders.ts` — `buildModel(type, ctx?: { floorHeight: number })`. Modele:
  - `wall`: pudełko 2.0 × H × 0.24 (skala X wydłuża).
  - `door`: segment 2.0 m: dwa słupki ściany, nadproże, framuga i skrzydło 0.9 × 2.1 obracające się wokół
    zawiasu (`userData.doorLeaf = true`, obrót przez pivot-`Group`). Skrzydło ma `userData.skipCollider = true`.
  - `window`: rama 0.1 głębokości i emisyjna tafla 1.2 × 1.5 na wysokości 1.4 m (wzór z `buildRoom`).
  - `stairs`: prosty bieg o długości `1.15 × H`, szerokości 1.2, stopnie co 0.2 m (widoczne, `skipCollider`)
    oraz **niewidoczna pochylnia** (`visible = false`, bez `skipCollider`) jako jedyna bryła kolizji.
  Wszystkie wysokości z `ctx.floorHeight` (domyślnie 3.2, gdy `ctx` brak).
- `src/three/SceneManager.ts` — `Entry.buildKey = type|floorHeight`; `syncObjects` przebudowuje wpis, gdy klucz się zmienia
  (tak samo jak przy zmianie `type`). `setGhost` też dostaje `ctx`. W `updateGhost` we wnętrzu obiekt `window`
  **przyciąga się do najbliższej ściany obwodowej**: `x` lub `z` ustawione na płaszczyznę ściany minus 0.06, obrót do środka.
- `src/components/LeftPanel.tsx` — kategoria `structure` widoczna tylko we wnętrzu (na planszy ukryta);
  `cats` we wnętrzu: `['structure', 'furniture', ...]`.

**Do reużycia**: `mat()` (materiały współdzielone, bez modyfikacji), `add()`/`box()` z `builders.ts`, `updateGhost`, `commitPlacement`.

**Sprawdzenie**
```bash
npm run shot -- http://127.0.0.1:5187/ e2.png "eval:__mneme.getState().addObject('house',[0,0,6])@@eval:__mneme.getState().enterInterior(__mneme.getState().palace().objects.at(-1).id)@@wait:600@@eval:['wall','door','window','stairs'].forEach((t,i)=>__mneme.getState().addObject(t,[i*1.8-2.7,0,i%2?1:-1]))@@wait:400@@eval:__mneme.getState().palace().objects.map(o=>o.type)"
```
Zrzut: w domku widać ścianę, segment z drzwiami, okno i schody. Odczyt: tablica zawiera cztery nowe typy (oprócz zmigrowanych okien — nowe wnętrze ich nie ma, bo powstaje już z `floors`).

**Ryzyko**: `modelHeight` dla schodów zawiera pochylnię, etykieta wyżej — bez znaczenia. Skrzydło drzwi z pivotem
zmienia `Box3` modelu; `placementPoint` używa `Box3` tylko do kotwiczenia — dopuszczalne.

---

## Etap 3 — Powłoka skalowana i piętra

**Pliki**
- `src/three/interior.ts` — `buildRoom(spec, type, opts: { floors, openings: Opening[] })`.
  Ściany obwodowe budowane **osobno na każdą kondygnację** (`userData.floorIndex`), między kondygnacjami strop
  (`slabs[k]`, grubość 0.24) złożony z pudełek omijających `openings[k]` (obrys schodów z kondygnacji niżej);
  na wierzchu sufit. Okna z `spec.windows` **nie są już rysowane** (są obiektami). Dekoracyjne schody wieży znikają
  (wieża dostaje preset z prawdziwymi schodami). Lampy na każdej kondygnacji. `colliders` obejmują stropy z otworami.
  `Room` zwraca `walls`, `slabs`, `floorHeight`.
- `src/lib/rooms.ts` — `stairOpenings(objects, H): Opening[][]` (obrys obrotu schodów jako prostokąt osiowy, z zapasem 0.15).
- `src/store.ts` — stan `editFloor: number` (nieutrwalany, zerowany w `enterInterior`, `exitInterior`, `switchPalace`),
  akcje `setEditFloor(n)`, `setFloors(n)` (mutacja `interior.floors` przez `setPalace`, `undo: false`; zmniejszenie
  odmawia z toastem, gdy na kasowanym piętrze stoją obiekty). `enterInterior` odświeża `settings.ground`
  z `roomSpecFor` i **dociąga obiekty do wnętrza** (`|x| ≤ w/2 − 0.4`, `|z| ≤ d/2 − 0.4`). `dropToGround` i opadanie
  w `removeObject` używają podłogi piętra (`floorOf(y) × H`), nie zera.
- `src/three/SceneManager.ts`:
  - `applyEnvironment`: `roomKey = id|typ|w|d|floors|hash(openings)`, spec z `roomSpecFor`; `bounds` z powłoki.
  - `applyFloorVisibility()` (wołana z `onState` przy zmianie `editFloor`, trybu i pałacu): w edytorze widać ściany
    obwodowe kondygnacji `≤ editFloor`, stropy `≤ editFloor`, sufit ukryty; wpisy z `floorOf(y) > editFloor` mają
    `group.visible = false`. W spacerze i VR wszystko widoczne. Warunek dla markerów zwierząt łączy się z `syncWildlife`
    w jednym miejscu (funkcja `entryVisible(e)`).
  - `groundPlane.constant = −editFloor × H` oraz `updateGhost` ustawia `p.y = editFloor × H` zamiast 0.
  - `cameraCommand('center')` i `lookAtRoomFromDoor` celują w `y = editFloor × H + 0.5`.
  - `syncObjects` po zmianie schodów oznacza `physicsDirty` (powłoka się przebudowała).
- `src/components/Viewport.tsx` — nowa sekcja „Piętra" w panelu otoczenia dla wnętrz: stepper liczby pięter (1–4)
  i przyciski wyboru piętra do edycji („Parter", „Piętro 1"…). Sekcja wyświetlana zamiast `GroundSection`.

**Zmiany danych**: brak nowych pól (piętro z `y`, `floors` z etapu 1).

**Do reużycia**: `groundExtent`, `clampToGround` (nie pasuje do pokoju — clamp prosty w `lib/rooms.ts`), `cameraCommand`, wzór `roomKey`.

**Sprawdzenie**
```bash
npm run shot -- http://127.0.0.1:5187/ e3.png "eval:__mneme.getState().addObject('house',[0,0,6])@@eval:__mneme.getState().updateObject(__mneme.getState().palace().objects.at(-1).id,{scale:[2,1,1.5]})@@eval:__mneme.getState().enterInterior(__mneme.getState().palace().objects.at(-1).id)@@wait:600@@eval:__mneme.getState().setFloors(2)@@eval:__mneme.getState().addObject('stairs',[2,0,0])@@eval:__mneme.getState().setEditFloor(1)@@wait:500@@eval:[__scene.room.slabs.length, __scene.bounds.hx, __scene.bounds.hz, __scene.room.slabs[0].visible]"
```
Oczekiwany odczyt: `[1, ≈7.6, ≈5.1, true]` (szerokość 16 = 8 × 2, głębokość 10.5 = 7 × 1.5; jeden strop, widoczny na piętrze 1).
Zrzut: strop z otworem nad schodami, ściany kondygnacji 0 i 1, brak sufitu.

**Ryzyko**
- Obiekty zakotwiczone wysoko (regał + coś na nim) mogą liczyć się do wyższego piętra przy `H = 3.2`. Rozpoznanie: obiekt
  znika po zejściu na parter w edytorze. Akceptowalne, opis w pomocy.
- `flyTo` w spacerze może teleportować gracza na inne piętro bez schodów — to już istniejące zachowanie „skoku" do przystanku;
  `placeRig` przyjmuje tylko `x, z`, więc trzeba dodać `y` (stopy = `floorOf(y) × H`).

---

## Etap 4 — Fizyka: drzwi otwierane i schody

**Pliki**
- `src/three/physics.ts` — `buildTrimesh` pomija siatki z `userData.skipCollider`; nowa metoda
  `setLeaf(id, mesh | null, position, rotationY, scale)` = `setStatic(id + ':leaf', { kind: 'box', object: mesh })`.
- `src/three/SceneManager.ts`:
  - `openDoors: Set<string>`; `toggleDoor(id)`: obraca pivot skrzydła o 100° (krótki tween w `frame()`, lista `doorAnims`),
    po otwarciu `physics.removeStatic(id + ':leaf')`, po zamknięciu `setLeaf`. `removeEntry` i `rebuildPhysics` uwzględniają skrzydła.
    Zestaw `openDoors` czyszczony przy zmianie sceny.
  - `updateDoorPrompt` we wnętrzu: oprócz drzwi wyjściowych szuka najbliższego obiektu `door` w promieniu 2.2 m przed graczem
    → `doorPrompt = { kind: 'door', objectId, label: 'Otwórz drzwi' | 'Zamknij drzwi' }`. Drzwi wyjściowe mają pierwszeństwo, gdy bliżej.
  - `useDoor()` obsługuje `kind: 'door'` → `toggleDoor`. `fpInteract`: klik w obiekt `door` w zasięgu 2.6 m → `toggleDoor`
    (działa też z `onVrSelect`, bo idzie przez `pickRay`).
- `src/store.ts` / `src/types.ts` — `doorPrompt.kind: 'enter' | 'exit' | 'door'`.
- `src/components/Viewport.tsx` — podpowiedź drzwi już renderuje `label`; bez zmian poza typem.

**Do reużycia**: `setStatic`/`removeStatic`, `updateDoorPrompt`, `useDoor`, `pickRay`, `fpInteract`, `enableAutostep`
(już 0.45 m — stopnie 0.2 m przeszłyby i bez pochylni, pochylnia daje płynność).

**Sprawdzenie** (fizyka ładuje się asynchronicznie — `wait:1500`)
```bash
# drzwi: ściana z drzwiami w poprzek pokoju, gracz idzie do przodu; zamknięte blokują, otwarte przepuszczają
npm run shot -- http://127.0.0.1:5187/ e4a.png "eval:__mneme.getState().addObject('house',[0,0,6])@@eval:__mneme.getState().enterInterior(__mneme.getState().palace().objects.at(-1).id)@@wait:500@@eval:__mneme.getState().addObject('door',[0,0,0])@@eval:__mneme.getState().addObject('wall',[-2,0,0],0)@@eval:__mneme.getState().updateObject(__mneme.getState().palace().objects.at(-1).id,{scale:[1.5,1,1]})@@eval:__mneme.getState().addObject('wall',[2,0,0],0)@@eval:__mneme.getState().updateObject(__mneme.getState().palace().objects.at(-1).id,{scale:[1.5,1,1]})@@eval:__mneme.getState().setViewMode('fp')@@wait:1500@@down:KeyW@@wait:1500@@up:KeyW@@eval:__scene.rig.position.z"
```
Oczekiwany odczyt: `z > 0.4` (gracz zatrzymany przed zamkniętymi drzwiami). Następnie z `eval:__scene.useDoor()` po
`updateDoorPrompt` (albo `eval:__scene.toggleDoor(id)`) i ponownym `down:KeyW` odczyt `z < −1`.

```bash
# schody: gracz wchodzi na piętro
... "@@eval:__mneme.getState().setFloors(2)@@eval:__mneme.getState().addObject('stairs',[0,0,-1],Math.PI)@@eval:__mneme.getState().setViewMode('fp')@@wait:1500@@down:KeyW@@wait:2500@@up:KeyW@@eval:__scene.rig.position.y"
```
Oczekiwany odczyt: `y ≈ 3.2` (wysokość stóp na piętrze; `rig.position.y` zawiera `headOffset`, w trybie fp równy 0).

**Ryzyko**
- Kapsuła o promieniu 0.32 w otworze drzwi 0.9 m — przejście jest, ale ciasne; jeśli gracz „zahacza", poszerzyć otwór do 1.0.
- Pochylnia o kącie > 50° (pałac, `H = 5.2`, długość 6.0 → 41°) mieści się; sprawdzić `setMaxSlopeClimbAngle`.
- Otwór w stropie: gracz może spaść ze schodów na parter — brak barierki to świadome uproszczenie (osobna propozycja).
- Podpowiedź drzwi liczona co 6 klatek — drzwi obiektowe dodają pętlę po `entries`; przy limicie 150 obiektów bez znaczenia.

---

## Etap 5 — Presety wbudowane i własne

**Pliki**
- `src/lib/presets.ts` — treść presetów: dla każdego typu (`house`, `temple`, `tower`, `library`, `palace`) 2–3 układy,
  np. domek: „Pusty pokój", „Dwa pokoje z korytarzem", „Poddasze" (2 piętra, schody). Pałac: „Sala i dwie komnaty",
  „Amfilada". Wieża: „Trzy kondygnacje". Obiekty presetu: ściany ze `span`, drzwi, okna przy ścianach obwodowych, meble.
- `src/store.ts` — stan `customPresets: RoomPreset[]` (ładowany z `presetStore`), akcje:
  `applyRoomPreset(id)` (przez `setPalace`: usuwa obiekty **bez notatek**, dopisuje `instantiatePreset`, ustawia `interior.floors`,
  filtruje `path`; cofanie działa), `saveCurrentAsPreset(name)`, `deleteCustomPreset(id)`, `importPresets(list)`.
  Presety trafiają do `presetStore` po każdej zmianie (wzór `SOUND_PREF`).
- `src/components/RoomPresets.tsx` (nowy) — lista układów dla `buildingType` (wbudowane + własne), przycisk „Zastosuj"
  (gdy w pokoju są obiekty bez notatek: `confirm('Układ zastąpi N obiektów bez notatek. Obiekty z notatkami zostaną. Kontynuować?')`),
  przycisk „Zapisz obecny układ" (`prompt` o nazwę), usuwanie własnych.
- `src/components/LeftPanel.tsx` — we wnętrzu nad kategoriami sekcja `RoomPresets`; przy pustym wnętrzu rozwinięta,
  z nagłówkiem „Wybierz układ pokoju".
- `src/components/RightPanel.tsx` — `Welcome` we wnętrzu bez obiektów pokazuje wskazówkę „Wybierz układ po lewej".

**Zmiany danych**: `interior.floors` ustawiane przez preset; brak nowych pól.

**Do reużycia**: `setPalace` (cofanie), `uid`, `usePref` nie (presety mają własny magazyn), `confirm` (już w projekcie).

**Sprawdzenie**
```bash
npm run shot -- http://127.0.0.1:5187/ e5.png "eval:__mneme.getState().addObject('house',[0,0,6])@@eval:__mneme.getState().enterInterior(__mneme.getState().palace().objects.at(-1).id)@@wait:500@@clickText:Zastosuj@@wait:600@@eval:(()=>{const p=__mneme.getState().palace();return [p.objects.filter(o=>o.type==='wall').length,p.objects.filter(o=>o.type==='door').length,p.objects.length]})()"
```
Oczekiwany odczyt: ścian ≥ 1, drzwi ≥ 1, obiektów > 4. Zrzut: dwa pokoje z meblami, domek. Drugi zrzut to samo dla `palace`
ze skalą `[1.5,1,1.5]` — ściany dłuższe (`span`), obiekty w środku.

Kontrola „notatki zostają": `setNote` na jednym obiekcie, potem `applyRoomPreset` innego układu → obiekt z notatką nadal w `objects`.

**Ryzyko**: preset zaprojektowany dla domku 8 × 7 w domku 4 × 4 (skala 0.5) da nakładające się meble — presety
projektować względnie i testować na skali 0.5 i 2. Ściany z `span` zawsze pasują.

---

## Etap 6 — Eksport i import presetów

**Pliki**
- `src/lib/storage.ts` — z etapu 1 (`presets` w pliku, `parseImport` zwraca oba).
- `src/components/TopBar.tsx` — po wczytaniu pliku, gdy zawiera presety **i** pałac: dialog `ImportDialog`
  (własny modal, wzór `HelpModal`) z wyborem: „Pałac: dodaj jako nowy / zastąp bieżący / pomiń" oraz „Presety (N): importuj / pomiń".
  Plik bez presetów → jak dziś, bez dialogu. „Zastąp bieżący" = `deletePalace(rootOf(current))` + `importPalaces`.
  Eksport przekazuje `customPresets` ze store.
- `src/store.ts` — `importPresets` z etapu 5.

**Sprawdzenie**
```bash
npm run shot -- http://127.0.0.1:5187/ e6.png "eval:__mneme.getState().importPresets([{id:'t',name:'Test',description:'',floors:1,objects:[],custom:true}])@@eval:JSON.parse(window.__mnemeStorage.exportPalaceJson(__mneme.getState().palace(),__mneme.getState().data.palaces,__mneme.getState().customPresets)).presets.length"
```
Oczekiwany odczyt: `1`. Import pliku z presetem przez `upload:input[type=file],plik.json` → zrzut dialogu, po
`clickText:Importuj` odczyt `customPresets.length` rośnie, a `data.palaces.length` zależnie od wyboru.

**Ryzyko**: stare pliki bez `presets` muszą przechodzić bez dialogu — asercja: `parseImport` starego pliku daje `presets: []`.

---

## Etap 7 — Pomoc i README

- `HelpModal.tsx`, sekcja „Wnętrza budynków": układy pokoi, kategoria „Konstrukcja", drzwi (`F` lub klik), piętra i schody,
  zapis własnego układu, presety w eksporcie.
- `README.md`, punkt „Wnętrza budynków" i „Zapis" — to samo skrótowo.

**Sprawdzenie**: `npm run build`, Rapier w osobnej paczce (rozmiar `dist/assets/rapier*.js` osobno).

---

## Zależności między etapami

| Etap | Wymaga | Daje |
|---|---|---|
| 1 Dane | — | `floors`, kategoria, `roomSpecFor`, presety w `lib` |
| 2 Konstrukcja | 1 | modele i stawianie ścian, drzwi, okien, schodów |
| 3 Powłoka i piętra | 1, 2 (schody → otwory) | skalowany pokój, stropy, `editFloor` |
| 4 Fizyka | 2, 3 | przejście przez drzwi, wchodzenie po schodach |
| 5 Presety | 1, 2, 3 | wybór i zapis układów |
| 6 Eksport/import | 5 | presety w pliku |
| 7 Pomoc | 4, 5, 6 | opis dla użytkownika |

Etapy 4 i 5 są niezależne od siebie i mogą iść w dowolnej kolejności.

## Cztery zrzuty regresji (po etapach 3, 4, 5 i na koniec)

1. **Edytor, plansza główna** — `npm run shot -- http://127.0.0.1:5187/ r1.png "wait:800"` (stary pałac z seedem wygląda jak dotąd).
2. **Z oczu** — `"eval:__mneme.getState().setViewMode('fp')@@wait:1500"` (fizyka ładuje się, brak błędów w konsoli).
3. **Wnętrze budynku** — `"eval:__mneme.getState().enterInterior(__mneme.getState().palace().objects[0].id)@@wait:800"`
   (pałac odkryć: powłoka 14 × 12, zmigrowane okna jako obiekty, drzwi wyjściowe, brak dekoracji).
4. **Rzut z góry** — `"key:KeyT@@wait:900"`.

Dodatkowo test wycieku: dziesięć razy `enterInterior`/`exitInterior` i odczyt `__scene.renderer.info.memory.geometries`
przed i po — różnica ≤ 2.

## Czego nie da się sprawdzić automatycznie

- Otwieranie drzwi spustem w goglach i tryb stereo na telefonie (droga przez `onVrSelect` → `pickRay` → `fpInteract` jest
  wspólna z myszą, więc test myszą pokrywa logikę, nie sprzęt).
- Płynność wchodzenia po schodach na słabym telefonie.

## Propozycje poza tym planem (nie wchodzą do wdrożenia)

- **Balkony i tarasy** jako moduł doczepiany do ściany budynku widoczny z zewnątrz — osobne zadanie po decyzji użytkownika.
- **Barierka przy otworze w stropie** — mały element `railing` w kategorii „Konstrukcja".
- **Nadpisywanie pałacu przy imporcie** jest ujęte minimalnie (usuń + dodaj); scalanie z zachowaniem id nie.
- Kwestia urwanego zdania z prośby użytkownika („może powinniśmy dać…") pozostaje otwarta.
