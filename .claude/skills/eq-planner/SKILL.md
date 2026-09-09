---
name: eq-planner
description: Plan wdrożenia funkcji w Mneme — etapy od najmniej ryzykownego, z migracją danych i sposobem sprawdzenia każdego kroku. Użyj przed większą zmianą obejmującą kilka warstw.
user-invocable: true
---

# Planowanie

Wczytaj `.claude/skills/eq-knowledge/SKILL.md` i instrukcje o warstwach oraz weryfikacji.

## Zasady

- **Etap = jedna kompilowalna całość.** Po każdym etapie `npx tsc --noEmit` przechodzi
  i da się zrobić zrzut pokazujący efekt.
- **Kolejność od najmniej ryzykownej.** Zmiany w typach i migracje idą wcześnie,
  bo kompilator wskaże wszystkie miejsca do poprawy.
- **Czystą logikę z `lib/` planuj z testami** (`vitest`, `src/lib/*.test.ts`), a to, co widać w scenie,
  sprawdzaj zrzutem z asercją `eval:`. Testy nie zastępują zrzutu.

## Kolejność zależności

1. `types.ts` — kształt danych
2. `lib/storage.ts` — migracja (idempotentna, w `normalizePalace`)
3. `catalog.ts` — nowe pozycje i ich właściwości
4. `store.ts` — akcje i stan
5. `three/` — scena, model, fizyka
6. `components/` — interfejs
7. `HelpModal.tsx` i `README.md` — opis dla użytkownika

## Zawartość planu

Dla każdego etapu:

- **Pliki** — nowe i zmieniane, z krótkim uzasadnieniem
- **Zmiany danych** — pola, wartości domyślne, migracja starych zapisów
- **Do reużycia** — funkcje, które już istnieją (`normalizePalace`, `PuffEmitter`,
  `makeTextPanel`, `colliderKind`, `clampToGround`, wzorzec `seq`)
- **Sprawdzenie** — konkretne polecenie zrzutu z akcjami i oczekiwanym odczytem
- **Ryzyko** — co może pójść źle i jak to rozpoznać

## Na koniec planu

Tabela zależności między etapami oraz lista czterech zrzutów regresji.

## Czego nie robić

Nie planuj przebudowy architektury przy okazji zadania. Jeśli coś wymaga większej
zmiany, opisz to osobno jako propozycję, nie wpychaj do bieżącego planu.
