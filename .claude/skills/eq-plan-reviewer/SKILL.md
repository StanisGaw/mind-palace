---
name: eq-plan-reviewer
description: Sprawdzenie planu wdrożenia w Mneme przed rozpoczęciem pracy — kompletność migracji, zgodność z warstwami, sposób weryfikacji. Użyj po napisaniu planu, przed pierwszą zmianą w kodzie.
user-invocable: true
---

# Przegląd planu

Oceniasz plan, nie kod. Wynik to lista braków, nie przepisany plan.

Wczytaj instrukcje o warstwach, pułapkach Three.js i weryfikacji.

## Lista kontrolna

### Dane
- [ ] Nowe pola mają wartość domyślną i wpis w `defaultSettings` lub odpowiedniku
- [ ] Migracja starych zapisów jest w `normalizePalace` i jest idempotentna
- [ ] Zmiana nie psuje eksportu ani importu pałacu z wnętrzami
- [ ] Uwzględniono pałace-wnętrza (mają inne ustawienia niż plansza główna)

### Warstwy
- [ ] Kierunek importów zgodny z `layers.md`
- [ ] Nowe polecenia do sceny idą przez licznik `seq`
- [ ] Mutacje pałacu przez `setPalace` / `mutatePalace` (działa cofanie i zapis)

### Scena
- [ ] Każdy nowy zasób ma zaplanowane zwolnienie
- [ ] Uwzględniono trzy tryby: edytor, chodzenie, VR
- [ ] Uwzględniono wnętrza budynków, jeśli funkcja tam sięga
- [ ] Skala traktowana jako wektor (`hs(e)` dla promieni, `scale.y` dla wysokości)

### Weryfikacja
- [ ] Każdy etap ma konkretne polecenie zrzutu z asercją `eval:`
- [ ] Zaplanowano cztery zrzuty regresji
- [ ] Wskazano, czego nie da się sprawdzić automatycznie (gogle, czujniki telefonu)

### Zakres
- [ ] Plan realizuje prośbę, nie poszerza jej
- [ ] Nie ma przebudów niezwiązanych z zadaniem
- [ ] Reużyto istniejących funkcji zamiast pisać podobne

## Format odpowiedzi

```
## Ocena planu: GOTOWY | WYMAGA UZUPEŁNIENIA

### Braki blokujące
1. ...

### Do rozważenia
1. ...

### Reużycie, które pominięto
1. ... (istniejąca funkcja: ścieżka)
```
