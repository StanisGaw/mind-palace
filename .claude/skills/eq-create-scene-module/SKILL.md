---
name: eq-create-scene-module
description: Nowy moduł sceny 3D w Mneme (efekt, system cząsteczek, warstwa świata) z poprawnym cyklem życia i podpięciem do SceneManager. Użyj przy dodawaniu większego elementu wizualnego.
---

# Nowy moduł sceny

Moduły w `src/three/` są samodzielne: budują własne obiekty, aktualizują się w klatce
i potrafią po sobie posprzątać. `SceneManager` tylko je woła.

## Kształt modułu

```ts
export class NazwaSystemu {
  constructor(scene: THREE.Scene) {}
  apply(/* parametry z ustawień pałacu */): void {}   // przebudowa przy zmianie danych
  update(dt: number, camPos: THREE.Vector3): void {}  // raz na klatkę
  dispose(): void {}                                   // zwolnienie wszystkiego
}
```

Wzorce do naśladowania: `WeatherSystem` (`weather.ts`), `Wildlife` (`wildlife.ts`),
`buildTerrain` (`terrain.ts`) dla modułu bez klasy.

## Zasady

- **Klucz przebudowy** — `apply` wywołuj tylko przy realnej zmianie danych, porównując
  klucz tekstowy (jak `envKey`, `terrainKey`). Przebudowa co klatkę zabija wydajność.
- **Sprzątanie** — `dispose` zwalnia geometrie, tekstury i materiały niepochodzące z `mat()`,
  a `SceneManager.dispose()` wywołuje `dispose` modułu.
- **Aktualizacja** — w `frame()`, raz na klatkę, nie w metodzie renderującej
  (tryb stereo renderuje dwukrotnie).
- **Wnętrza** — moduł związany z otwartą przestrzenią musi dać się wyłączyć,
  gdy gracz wchodzi do budynku (`applyEnvironment`).
- **Brak zależności odwrotnych** — moduł nie importuje `store.ts`; potrzebne dane
  dostaje w argumentach.

## Podpięcie w SceneManager

1. Pole klasy i utworzenie w konstruktorze
2. Wywołanie `apply` w `applyEnvironment` za kluczem porównania
3. Wywołanie `update` w `frame()`
4. `dispose` w `dispose()`

## Sprawdzenie

- zrzut w edytorze i w trybie chodzenia
- przełączenie do wnętrza i z powrotem (moduł nie zostawia śladów)
- `renderer.info.render.calls` nie rośnie skokowo
