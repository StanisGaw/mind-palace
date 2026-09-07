---
name: eq-create-object
description: Dodanie nowego elementu do biblioteki Mneme — wpis w katalogu, model proceduralny, bryła kolizji i ewentualne światło lub cząsteczki. Użyj, gdy trzeba dodać nowy budynek, roślinę, mebel, lampę lub element krajobrazu.
---

# Nowy element biblioteki

Cztery pliki, zawsze w tej kolejności.

## 1. Wpis w katalogu (`src/catalog.ts`)

```ts
{ id: 'nazwa', name: 'Nazwa po polsku', category: 'furniture', emoji: '🪑',
  description: 'Zdanie widoczne w podpowiedzi.', footprint: 0.8 }
```

- `id` — krótkie słowo bez polskich znaków; punkty pojawiania zwierząt: `spawn_<gatunek>`
- `category` — jedna z `CATEGORY_ORDER`; nowa kategoria wymaga wpisu w `CATEGORY_LABELS`
- `footprint` — przybliżony promień w metrach; steruje rozmieszczaniem, pierścieniem
  zaznaczenia i omijaniem przez zwierzęta
- `maxScale` — tylko gdy element ma się skalować powyżej 10×
- `collider` — `trimesh` dla brył, po których się chodzi (schody, zbocza), `cylinder`
  dla pni, `none` dla płaskich (dywan), w pozostałych razach pomiń (domyślnie prostopadłościan)
- `emitter` — `smoke` albo `mist`, jeśli element ma dymić
- `unique` — tylko jeden taki obiekt na pałac (jak brama)

## 2. Model (`src/three/builders.ts`)

Funkcja `buildNazwa(g: THREE.Group)` składająca bryły pomocnikami `box`, `cyl`, `cone`,
`sphere`, `dodeca`, `prism` i kolorami ze stałej `C`.

- Model stoi na `y = 0` i patrzy w `+Z` (spójnie z `DOORS`)
- Materiały wyłącznie przez `mat()` — są współdzielone, nie modyfikuj ich po utworzeniu
- Światło: `THREE.PointLight` dodany do grupy (skaluje się razem z obiektem)
- Wpis w `BUILDERS`, a przy emiterze także w `EMITTER_ANCHORS`

## 3. Zależności dodatkowe

- Budynek z wnętrzem: wpis w `ROOMS` (`src/catalog.ts`) i w `DOORS` (`builders.ts`)
- Zwierzę: rodzaj w `AnimalKind` i zachowanie w `src/three/wildlife.ts`

## 4. Sprawdzenie

```bash
npx tsc --noEmit
npm run shot -- http://127.0.0.1:5187/ nowy.png "eval:__mneme.getState().addObject('nazwa',[2,0,2])@@wait:900"
```

Obejrzyj zrzut: proporcje względem sąsiednich obiektów, cień, brak przenikania.
Dla elementu ze światłem zrób zrzut przy klimacie `night`.
Dla `trimesh` sprawdź w trybie chodzenia, czy da się na niego wejść albo go obejść.
