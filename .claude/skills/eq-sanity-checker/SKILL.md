---
name: eq-sanity-checker
description: Szybka kontrola po wprowadzeniu zmian w Mneme — typy, budowanie, granice warstw i zwalnianie zasobów Three.js. Uruchom przed pełnym przeglądem kodu.
---

# Szybka kontrola

Krótkie sprawdzenie, nie pełny przegląd. Zgłaszasz problemy, nie naprawiasz ich.

Wczytaj `.claude/skills/eq-knowledge/instructions/layers.md` i `three-pitfalls.md`.

## Zakres

### 1. Typy i budowanie

```bash
npx tsc --noEmit
npm run build
```

Sprawdź w wyniku budowania, czy Rapier nadal jest w osobnej paczce, a główny bundel
nie urósł skokowo.

### 2. Granice warstw

- `lib/` nie importuje z `three/` ani `components/` (jedyny dopuszczony wyjątek:
  `storage.ts` → `three/noise.ts`)
- `components/` sięga do sceny wyłącznie przez `SceneManager` z `Viewport`
- mutacje pałacu tylko przez `setPalace` / `mutatePalace`
- nowe polecenia do sceny przekazane licznikiem `seq`, nie bezpośrednim wywołaniem

### 3. Zwalnianie zasobów

Dla każdej nowej geometrii, tekstury, sklonowanego materiału i emitera sprawdź,
czy istnieje odpowiadające zwolnienie w `dispose()` albo w metodzie sprzątającej.
Dla nowych wpisów obiektów: etykieta DOM, panel, emiter, kolider.

### 4. Teksty interfejsu

Nowe napisy widoczne dla użytkownika są po polsku i z polskimi znakami.

## Czego nie sprawdzasz

Poprawności logicznej, wydajności ani zgodności z planem — tym zajmuje się
`eq-code-reviewer`.

## Format odpowiedzi

```
## Kontrola: PRZESZŁA | ZNALEZIONO PROBLEMY

### Typy i budowanie
- npx tsc --noEmit: ...
- npm run build: ... (rapier w osobnej paczce: tak/nie)

### Granice warstw
1. plik:linia — opis

### Zwalnianie zasobów
1. plik:linia — opis

### Do zrobienia
- ...
```
