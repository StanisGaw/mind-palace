---
name: eq-zoom-out
description: Mapa projektu Mneme z lotu ptaka — moduły, przepływ danych i miejsca styku. Użyj, wchodząc w nieznany obszar kodu albo przed dużą zmianą.
user-invocable: true
---

# Spojrzenie z góry

Zanim zaczniesz czytać pliki po kolei, ustal, gdzie w przepływie danych leży Twój problem.

## Przepływ danych

```
localStorage ──loadData/normalizePalace──▶ store (zustand)
                                             │
        interfejs React ◀──hooki useStore────┤
                                             │
        SceneManager.onState ◀──subskrypcja──┘
              │
              ├─ syncObjects      → wpisy obiektów (model, etykieta, panel, emiter, kolider)
              ├─ applyEnvironment → płyta, teren, pogoda, wnętrze
              ├─ syncWildlife     → zwierzęta (tylko poza edytorem)
              └─ frame()          → kamera, fizyka, cząsteczki, render
```

## Gdzie czego szukać

| Pytanie | Plik |
|---|---|
| jakie obiekty można postawić | `src/catalog.ts` |
| jak wygląda obiekt | `src/three/builders.ts` |
| co się dzieje po kliknięciu w scenę | `SceneManager.onPointerDown/Up` |
| skąd się bierze pozycja stawianego obiektu | `SceneManager.placementPoint` |
| jak działa chodzenie i skok | `SceneManager.updateFp` + `src/three/physics.ts` |
| jak zapisują się dane i jak migrują | `src/lib/storage.ts` |
| jak liczona jest trasa spaceru | `src/lib/review.ts` |
| kształt planszy i granice | `src/lib/ground.ts` |
| wnętrza budynków | `src/three/interior.ts` + `enterInterior` w `store.ts` |
| zwierzęta | `src/three/wildlife.ts` |

## Pojęcia domenowe

- **pałac** — jedna scena z obiektami; wnętrze budynku to osobny pałac z `parentId`
- **wpis (entry)** — obiekt sceny odpowiadający obiektowi z danych
- **ścieżka pamięci** — uporządkowana lista przystanków w obrębie jednego pałacu
- **spacer** — przejście po spłaszczonej trasie, schodzące także do wnętrz
- **kotwica (anchorId)** — obiekt, na którym stoi inny obiekt
- **płyta** — obszar, po którym można chodzić; teren wokół jest tylko dekoracją

## Kolejność czytania przy nowym zadaniu

1. `src/types.ts` — kształt danych
2. odpowiedni fragment `store.ts` — kto zmienia te dane
3. miejsce w `SceneManager`, które na tę zmianę reaguje
4. komponent, który ją wywołuje
