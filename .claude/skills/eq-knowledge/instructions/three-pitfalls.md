# Pułapki Three.js w tym projekcie

Sprawdź tę listę przed każdą zmianą w `src/three/`.

## Zwalnianie zasobów

- Każda utworzona geometria, tekstura i sklonowany materiał musi zostać zwolniona
  w `dispose()` (`SceneManager`) albo w metodzie sprzątającej modułu.
- Materiały z `mat()` w `builders.ts` są **współdzielone** — nigdy ich nie modyfikuj.
  Jeśli potrzebujesz zmiany, sklonuj i oznacz klon do zwolnienia.
- Usuwając wpis obiektu, skasuj też etykietę CSS2D (element DOM), panel tekstowy,
  emiter cząsteczek i kolider fizyki.

## Wersja 0.169

- `TransformControls` dziedziczy po `Controls`, nie po `Object3D`. Do sceny dodaje się
  `getHelper()`, a `dispose()` biblioteki jest zepsute (woła `this.traverse`) — sprzątaj ręcznie.
- Moduły z `three/examples` wymagają `resolve.dedupe: ['three']` w konfiguracji Vite.
- Helper uchwytu zawiera niewidzialną płaszczyznę o ogromnym rozmiarze. Nigdy nie
  dodawaj go do celów raycastu.

## React StrictMode

Komponent montuje się dwa razy, więc `SceneManager` powstaje i jest niszczony w parze.
Każde wywołanie asynchroniczne (`Physics.load`, `enterVR`) musi po powrocie sprawdzić
`this.disposed`.

## Skala i pozycja

- Skala obiektu to wektor. Do promieni i odległości używaj `hs(e)` (większa z osi X/Z),
  do wysokości `scale.y`.
- `position[1]` nie jest już zawsze zerem — obiekty stoją także na innych obiektach.

## Wydajność

Aktualizacje w `frame()` wykonuj raz na klatkę. Tryb stereo renderuje scenę dwukrotnie,
więc logika w metodzie renderującej policzyłaby się podwójnie.
