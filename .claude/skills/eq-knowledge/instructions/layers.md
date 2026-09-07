# Warstwy i kierunek zależności

```
types.ts / catalog.ts        dane opisujące świat (bez importów z warstw wyższych)
        ↓
lib/                         czysta logika: storage, srs, review, ground, prefs, landscapes
        ↓
store.ts                     stan aplikacji (zustand), jedyne źródło prawdy
        ↓
three/                       scena 3D; czyta stan przez subskrypcję, nie trzyma własnej kopii
        ↓
components/                  interfejs React; czyta stan hookami, wywołuje akcje magazynu
```

## Zasady

- `lib/` nie importuje z `three/` ani z `components/`. Wyjątek: `storage.ts` korzysta
  z `three/noise.ts` dla deterministycznego ziarna — nie mnóż takich wyjątków.
- `components/` nie odwołuje się do wnętrza sceny poza `SceneManager` wystawionym w `Viewport`.
- `SceneManager` czyta stan przez `useStore.getState()` i subskrypcję w `onState`.
  Nie dodawaj drugiego mechanizmu synchronizacji.
- Polecenia z interfejsu do sceny przekazuje się przez licznik `seq` w magazynie
  (wzorzec `fly`, `cameraCmd`, `sceneEntry`), a nie przez bezpośrednie wywołania.
- Mutacje pałacu wyłącznie przez `setPalace` / `mutatePalace`, żeby działało cofanie i zapis.
