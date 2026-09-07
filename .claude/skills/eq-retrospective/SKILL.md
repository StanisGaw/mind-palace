---
name: eq-retrospective
description: Wnioski z sesji nad Mneme — wyłapuje powtarzające się poprawki użytkownika i luki w skillach, proponuje zmiany w bazie wiedzy. Użyj po dłuższej sesji z wieloma korektami.
---

# Wnioski z sesji

Cel: żeby ta sama pomyłka nie powtórzyła się w kolejnej sesji.

## Krok 1 — zbierz sygnały

Przejrzyj rozmowę i wypisz:

- **Korekty użytkownika** — miejsca, gdzie prostował kierunek pracy. Cytuj jego słowa.
- **Powtórzone błędy** — ta sama pomyłka więcej niż raz
- **Ślepe zaułki** — czas stracony na złe założenie i co je wywołało
- **Brakująca wiedza** — czego trzeba było szukać w kodzie, choć powinno być zapisane

## Krok 2 — odsiej

Zostaw tylko to, co spełnia oba warunki: powtórzy się w przyszłości i da się zapisać
jako konkretna zasada. Jednorazowe potknięcia pomiń.

## Krok 3 — zaproponuj zmiany

Dla każdego wniosku wskaż dokładne miejsce:

| Rodzaj | Gdzie |
|---|---|
| zasada techniczna projektu | `.claude/skills/eq-knowledge/instructions/*.md` |
| brak w procedurze | odpowiedni skill `eq-*` |
| preferencja użytkownika | pamięć projektu (`memory/`) |
| pułapka biblioteki | `instructions/three-pitfalls.md` |

Podaj proponowany tekst do wstawienia, nie ogólny opis.

## Krok 4 — przedstaw

Krótka lista z uzasadnieniem, dlaczego akurat to warto zapisać. Zmiany wprowadzasz
dopiero po akceptacji użytkownika.

## Format

```
## Wnioski

### Do zapisania
1. Obserwacja → plik → proponowany tekst

### Zaobserwowane, ale nie do zapisania
1. ... (dlaczego pominięto)
```
