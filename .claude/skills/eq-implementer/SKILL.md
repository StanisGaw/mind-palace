---
name: eq-implementer
description: Wdrożenie zatwierdzonego planu w Mneme — kolejność zmian, reużycie istniejących funkcji, sprawdzenie po każdym etapie. Użyj, gdy plan jest gotowy i zaczynasz pisać kod.
user-invocable: true
---

# Wdrożenie

Realizujesz plan dokładnie. Nie dokładasz funkcji, o które nikt nie prosił.

Wczytaj `.claude/skills/eq-knowledge/SKILL.md` przed pierwszą zmianą.

## Przed napisaniem nowego kodu

Sprawdź, czy to już istnieje:

| Potrzeba | Istniejące rozwiązanie |
|---|---|
| cząsteczki (dym, mgła, opady) | `PuffEmitter`, `PointsEmitter` w `three/particles.ts` |
| napis w przestrzeni 3D | `makeTextPanel` w `three/text.ts` |
| szum, losowość deterministyczna | `Noise2D`, `hashString` w `three/noise.ts` |
| granice i obrys planszy | `clampToGround`, `insideGround` w `lib/ground.ts` |
| bryła kolizji obiektu | `colliderKind` w `catalog.ts` |
| migracja danych | `normalizePalace` w `lib/storage.ts` |
| ustawienie kamery gracza | `placeRig`, `spawnPose` w `SceneManager` |
| polecenie z interfejsu do sceny | wzorzec `seq` (`fly`, `cameraCmd`, `sceneEntry`) |
| preferencje interfejsu | `usePref` w `lib/prefs.ts` |

## Kolejność pracy w etapie

1. Typy i migracja — potem kompilator wskaże resztę miejsc
2. Magazyn i logika
3. Scena
4. Interfejs
5. `npx tsc --noEmit`
6. Zrzut potwierdzający efekt etapu

## Zasady pisania

- Komentarz tłumaczy powód decyzji, nie treść linijki
- Teksty dla użytkownika po polsku
- Nowy zasób Three.js dostaje od razu swoje zwolnienie
- Operacja asynchroniczna w `SceneManager` sprawdza `this.disposed` po powrocie
- Nie modyfikuj materiałów z `mat()` — klonuj

## Gdy plan okazuje się błędny

Zatrzymaj się i powiedz, co się nie zgadza, zamiast obchodzić problem. Wpisanie
w kod obejścia niezgodnego z planem jest gorsze niż przerwanie.

## Na koniec

`npm run build`, cztery zrzuty regresji, aktualizacja `HelpModal.tsx` i `README.md`,
jeśli zmieniło się coś widocznego dla użytkownika.
