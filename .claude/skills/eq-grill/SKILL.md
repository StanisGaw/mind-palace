---
name: eq-grill
description: Doprecyzowanie niejasnego zadania w Mneme przed planowaniem — wyłapuje sprzeczne odczytania, ustala zakres i kryteria odbioru. Użyj, gdy prośba jest ogólna albo dotyczy wielu funkcji naraz.
user-invocable: true
---

# Doprecyzowanie zadania

Cel: zamienić ogólną prośbę w listę rozstrzygnięć, zanim powstanie plan.
Nie pytasz o wszystko — tylko o to, co zmienia wynik pracy.

## Krok 1 — przeczytaj zadanie dosłownie

Wypisz osobno: co użytkownik napisał wprost, co wynika z kontekstu, a co sobie dopowiadasz.
Trzecia lista jest najgroźniejsza.

## Krok 2 — sprawdź w kodzie

Zanim zapytasz, sprawdź, czy odpowiedź już istnieje w projekcie. Pytanie o coś,
co widać w `catalog.ts` albo `store.ts`, marnuje czas użytkownika.

## Krok 3 — znajdź rozwidlenia

Szukaj miejsc, w których dwa sensowne odczytania prowadzą do innej pracy:

- **zakres**: czy zmiana dotyczy edytora, trybu chodzenia, VR, czy wszystkich naraz
- **dane**: czy dochodzi nowe pole w `PalaceObject` lub `PalaceSettings` (wtedy migracja)
- **istniejące dane**: co ma się stać z pałacami zapisanymi wcześniej
- **wnętrza**: czy funkcja działa też wewnątrz budynków
- **telefon**: czy potrzebne jest sterowanie dotykiem
- **wydajność**: czy rzecz działa w `frame()` i ile obiektów obsłuży

## Krok 4 — zadaj maksymalnie cztery pytania

Każde pytanie: konkretne, z zaproponowaną odpowiedzią domyślną i krótkim uzasadnieniem,
dlaczego to zmienia pracę. Pytania zadaje się razem, nie po kolei.

Reszta niejasności idzie na listę założeń przyjętych wprost — nie do pytania.

## Krok 5 — kryteria odbioru

Zapisz, co konkretnie ma być widać na zrzucie albo w odczycie `eval:`, żeby uznać
zadanie za zrobione. Bez tego nie da się rzetelnie powiedzieć „gotowe".

## Wynik

```
## Rozumiem zadanie jako
...

## Rozstrzygnięte (założenia)
1. ...

## Do decyzji
(maksymalnie cztery pytania przez AskUserQuestion)

## Kryteria odbioru
1. ...
```
