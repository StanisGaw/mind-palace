# Plan: materiały i kolory, okna z elewacji, ścieżki, przytulne wnętrza

Data: 2026-09-08. Worktree `../claude-mind-palace-materialy`, gałąź `materialy-i-okna`. Wszystko proceduralne.

## Decyzje użytkownika

1. Okna w pokojach ładowanych powstają **automatycznie z elewacji** budynku (ten sam spis okien dla bryły
   z zewnątrz, powłoki w miejscu i pokoju ładowanego); dekoracyjne okienka budynków w miejscu stają się
   prawdziwymi otworami z szybą.
2. Ścieżki rysuje się **odcinek po odcinku** jak ściankę; ciąg to jedna grupa; nawierzchnia i szerokość w panelu.
3. Kolory obiektów **per warstwa materiału** (drewno, ciemne drewno, kamień, tkanina…) plus gotowe odcienie drewna.
4. Tekstury: podłoga i ściany wnętrz ładowanych, podłoga i ściany per budynek w miejscu, więcej nawierzchni
   zewnętrznych (także dla ścieżek), słoje drewna na warstwach drewnianych obiektów.

## Model danych (pola opcjonalne — bez migracji)

- `PalaceObject.colors?: Record<string, string>` — nadpisane kolory warstw (klucz = rola z `lib/materials.ts`).
- `PalaceObject.finish?: { floor?: string; wall?: string }` — budynek w miejscu: tekstura podłogi i ścian
  wnętrza; ścieżka: `floor` = nawierzchnia.
- `PalaceSettings.wallTexture?: string` — ściany pokoju ładowanego (podłoga to istniejące `groundTexture`).
- Nowe wnętrza i nowe budynki w miejscu dostają domyślnie parkiet i tynk (przytulniej); stare bez zmian.

## Etap 1 — Tekstury i materiały (`three/textures.ts`, `lib/materials.ts`)

- `TextureDef.kinds: ('ground' | 'floor' | 'wall')[]`. Nowe wzory: parkiet (jodełka), panele (szerokie deski),
  beton, płytki, terakota, dywan; tynk, boazeria, tapeta w pasy, cegła, mur kamienny; żwir, kamienie polne,
  kostka, kora. Istniejące dostają `kinds`.
- `lib/materials.ts`: `MATERIAL_ROLES` (id, polska nazwa, kolor domyślny), `WOOD_SHADES` (dąb, orzech, sosna,
  wiśnia, heban, bielone) → `{ wood, woodDark }`, `texturesOfKind`.
- `mat()` dostaje `map?: THREE.Texture` (klucz cache z `uuid` tekstury). `woodMat(color, opts)` = `mat` z teksturą
  słojów (jasna, mnożona przez kolor). `grainTexture()` w `textures.ts`.
- `finishMat(kind, id, tint)` — materiał z teksturą powtarzaną co 1 jednostkę UV; `scaleUv(geo, su, sv)` skaluje UV
  pudełek tak, by kafel = ~2,5 m świata.

## Etap 2 — Kolory warstw (`builders.ts`, `SceneManager`, `RightPanel`)

- `C` staje się obiektem z getterami: odczyt roli zapisuje ją w zbiorze użytych ról i zwraca kolor bieżącej palety
  (`ctx.colors` scalone z domyślnymi). `buildModel` ustawia paletę na czas budowy i zapisuje `g.userData.roles`.
- `rolesOf(type)` (cache): role, których model używa — panel pokazuje tylko te warstwy.
- `modelCtx` dokłada `colors` (klucz przebudowy). Duch bez kolorów. Kopiowanie zachowuje `colors` (spread).
- Panel: sekcja „Materiały” — wiersz na rolę: próbka `<input type="color">`, nazwa, „↺” przywraca; chipy odcieni
  drewna, gdy model ma warstwy drewniane.

## Etap 3 — Okna z elewacji (`lib/rooms.ts`, `builders.ts`, `interior.ts`)

- `SHELL_WINDOWS[type]: { wall: 'front'|'back'|'left'|'right'|'segN', u, w, h, sill }[]` w jednostkach modelu
  (u od środka ściany). Bryła z zewnątrz: `shellDecorWindows` rysuje z tego spisu (otwór w murze przez `facade`
  + ramka + szyba) — dla powłok w miejscu otwory są prawdziwe. Budynki ładowane (`nested`) też wycinają — model
  jest ten sam, więc ich elewacja ma szyby.
- `facadeHoles` dolicza okna elewacji do otworów muru (z `SHELL_WINDOWS`) i `facadeSlotFree` nie pozwala nałożyć
  własnego okna na wbudowane.
- Pokój ładowany: ściana z otworami (`wallGeometry` wyeksportowana z `builders`) zamiast pudełka; w otworze rama,
  szyba i za nią jasna płaszczyzna „dnia” (tekstura nieba z `art.ts`) — na każdym piętrze. Skalowanie:
  `u × room.w / inner.w`, wymiary × (room.w / inner.w), parapet × (room.h / inner.h). Wieża: segment
  najbliższy kątowi okna. Kolidery ścian zostają pudełkami (parapet ≥ 0,9 m).
- Tekstury pokoju: podłoga (jak dziś), ściany z `settings.wallTexture` (klucz `roomKey`/`lastTextureKey`).
  Powłoka w miejscu: `ctx.finish` → `shellBox` używa `finishMat` na podłodze, stropach i ścianach.

## Etap 4 — Ścieżki (`catalog.ts`, `builders.ts`, `SceneManager`, `store`)

- `path` „Ścieżka” (Konstrukcja, `boardOnly`, `collider: 'none'`, `maxScale` 12): płaski pas `WALL_SEGMENT × 0,03`
  o szerokości 1,2 × `scale[2]`, z półokrągłymi końcami (bez szwów), tekstura z `finish.floor ?? 'gravel'`.
- Rysowanie: tryb ścianki uogólniony na `isDraw(type)` (`wall` | `path`): start, koniec, kolejny odcinek od końca,
  Esc kończy; wszystkie odcinki jednego ciągu w jednej grupie (`groupId` nadany przy stawianiu). Bez scalania.
- Panel: „Nawierzchnia” (tekstury `ground`), szerokość = skala Z.

## Etap 5 — Pomoc, README, kontrola, commity

- `HelpModal`, `README`: materiały i kolory, okna, ścieżki, tekstury wnętrz.
- `npx tsc --noEmit`, `npm run build`, zrzuty: wnętrze domku z parkietem i oknami; budynek w miejscu z oknami;
  obiekt z przebarwioną warstwą; ścieżka żwirowa. Test wycieku 10× wejście/wyjście.
- Commity: (1) tekstury i materiały, (2) kolory warstw, (3) okna z elewacji i tekstury wnętrz, (4) ścieżki,
  (5) pomoc i README. Merge `--ff-only`, usunięcie worktree i gałęzi. Bez pusha bez prośby.

## Ryzyka

- 256 miejsc `mat(C.x)` — gettery zamiast przepisywania; koszt odczytu pomijalny (budowa raz na obiekt).
- Tekstury na ExtrudeGeometry: UV = współrzędne kształtu (jednostki modelu) — kafel co 1 jednostkę, przy skali 2
  to 2 m; dla pokoju ładowanego skalujemy UV ręcznie.
- Okna wbudowane zajmują miejsce na murze — `facadeSlotFree` musi je znać, inaczej otwory się nałożą.
