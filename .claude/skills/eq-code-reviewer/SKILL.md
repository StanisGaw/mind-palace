---
name: eq-code-reviewer
description: Przegląd zmian w Mneme pod kątem poprawności logicznej i konwencji projektu — wycieki zasobów, tryby kamery, migracje, teksty interfejsu. Użyj po wdrożeniu, przed commitem.
user-invocable: true
---

# Przegląd kodu

Oceniasz różnicę względem ostatniego commita. Zgłaszasz konkretne miejsca z plikiem
i linią, uszeregowane od najpoważniejszego.

Wczytaj instrukcje o warstwach, nazewnictwie i pułapkach Three.js.

## Poprawność logiczna

- **Zwalnianie zasobów** — każda geometria, tekstura i sklonowany materiał ma parę
  w metodzie sprzątającej; usuwany wpis czyści etykietę DOM, panel, emiter i kolider
- **Stan a scena** — czy klucz porównania (`transformKey`, `envKey`, `roomKey`) obejmuje
  wszystkie pola, od których zależy wynik; pominięte pole daje scenę niezgodną z danymi
- **Tryby** — czy zmiana działa w edytorze, w chodzeniu i w VR; czy nie psuje wnętrz
- **Skala wektorowa** — `hs(e)` dla promieni, `scale.y` dla wysokości; nie `scale.x` wszędzie
- **Wysokość obiektu** — `position[1]` bywa niezerowe (obiekty stoją na innych)
- **Kolejność zdarzeń** — faza przechwytywania kontra `OrbitControls` i `TransformControls`
- **StrictMode** — asynchroniczne powroty sprawdzają `this.disposed`
- **Migracje** — idempotentne, nie gubią danych, obsługują brak pola i zły typ
- **Przypadki brzegowe** — pusta scena, jeden obiekt, obiekt poza planszą, wnętrze bez wyposażenia

## Konwencje

- Kierunek importów zgodny z warstwami
- Nazewnictwo plików, typów i kluczy localStorage
- Teksty interfejsu po polsku, z polskimi znakami
- Komentarze tłumaczą powód, nie treść linijki
- Brak martwego kodu, zakomentowanych fragmentów i logów diagnostycznych
- Brak nieuzasadnionych `any` i rzutowań; rzutowanie ma komentarz z powodem

## Wydajność

- Praca w `frame()` wykonywana raz na klatkę, nie w metodzie renderującej
- Kosztowne operacje (budowa siatki kolizji, terenu) tylko przy realnej zmianie
- Liczba obiektów, przy której rzecz przestaje działać płynnie

## Format odpowiedzi

```
## Przegląd: OK | UWAGI | BLOKUJĄCE

### Blokujące
1. plik:linia — co jest źle i co się stanie w praktyce

### Uwagi
1. plik:linia — ...

### Drobne
1. ...
```

Nie zgłaszaj rzeczy, których nie potrafisz uzasadnić konkretnym skutkiem.
