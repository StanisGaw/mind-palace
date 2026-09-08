# Stack i uruchamianie

- **Vite 5** + **React 18** + **TypeScript** (tryb strict, `noEmit`)
- **Three.js 0.169** — scena, WebXR, moduły z `three/examples/jsm`
- **zustand 4** — cały stan aplikacji w jednym magazynie
- **@dimforge/rapier3d-compat 0.20** — fizyka, ładowana leniwie przez `import()`

## Polecenia

```bash
npm test             # vitest: testy integracyjne układów pokoi (src/lib/layout.test.ts)
npm run dev          # http://localhost:5187, nasłuch także w sieci lokalnej
npm run dev:https    # wymagane do WebXR i czujników ruchu na telefonie
npm run build        # tsc --noEmit + vite build
npx tsc --noEmit     # sama kontrola typów (szybka)
```

## Czego w tym projekcie nie ma

Nie ma backendu, API, DTO, mapperów, React Query ani lintera. Nie proponuj rozwiązań opartych
na tych elementach.

Testy są tylko tam, gdzie liczy się czysta geometria: `src/lib/layout.test.ts` sprawdza układy pokoi
(przestrzeń przy schodach, przejścia, meble przy ścianach). Warstwy `three/` i `components/` nadal
weryfikujemy zrzutami z przeglądarki.

## Rozmiar paczek

Rapier trafia do osobnej paczki i nie może wejść do głównego bundla — sprawdzaj to po
każdej zmianie importów w `src/three/physics.ts`.
