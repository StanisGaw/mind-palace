---
name: eq-model-from-image
description: Odtworzenie przedmiotu ze zdjęcia referencyjnego jako proceduralnego modelu w `builders.ts` — etapami, z obrotówką i porównaniem do referencji po każdym etapie. Użyj, gdy nowy element biblioteki ma przypominać konkretną rzecz ze zdjęcia.
user-invocable: true
---

# Model ze zdjęcia

Zdjęcie jest referencją, nie źródłem danych. Model powstaje wyłącznie z kodu: bryły,
pomocniki i materiały z `builders.ts`. Nie ma importu siatek, fotogrametrii ani tekstur
z pliku. Jeśli przedmiotu nie da się złożyć z dostępnych brył — napisz to wprost,
zamiast obiecywać podobieństwo.

Ten skill dotyczy samego modelowania. Wpis w katalogu, kolider, emiter i sprawdzenie
w scenie robisz według `eq-create-object` — tutaj zaczynasz po decyzji, że element ma
wyglądać jak konkretna rzecz ze zdjęcia.

## Czy to dobry cel

Odmów albo poproś o inne zdjęcie, gdy: na obrazie jest scena zamiast jednego przedmiotu,
przedmiot jest ucięty kadrem, sylwetka ginie w cieniu lub tle, albo całą tożsamość rzeczy
niosą napisy, logo i wzór na powierzchni (Mneme nie renderuje tekstur z obrazu — zostanie
płaska plama). Styl sceny to low-poly z płaskim cieniowaniem: detal poniżej kilku
centymetrów i tak zniknie, więc nie obiecuj go.

## Kolejność

Nigdy nie pisz całego modelu na raz. Każdy etap kończy się zrzutem i decyzją.

| Etap | Co ma być gotowe | Czego szukasz na porównaniu |
|---|---|---|
| 1. Analiza | opis obrazu warstwami → `instructions/analiza-obrazu.md` | nic — to jeszcze nie kod |
| 2. Bryła | wszystkie części wyznaczające sylwetkę, w proporcjach, bez detalu | proporcje, wysokość względem człowieka (1,7 m), brak brakującej dużej części |
| 3. Struktura | podział na części, osadzenie jednej na drugiej, obroty | styki części, nic nie wisi w powietrzu, nic się nie przenika |
| 4. Forma | właściwe rodzaje brył zamiast zastępczych pudełek → `instructions/dobor-bryl.md` | sylwetka z czterech stron, zbieżności i zaokrąglenia |
| 5. Materiał | kolory z `C`, `mat()`/`woodMat()`, `roughness`, `flat` | tonacja, rozróżnialność sąsiednich części, brak jednej płaskiej plamy |
| 6. Detal i światło | drobne bryły, `PointLight`, emiter | czy detal coś dodaje przy normalnym oddaleniu |

Etapu nie zaczynasz, dopóki poprzedni nie przeszedł przeglądu
(`instructions/przeglad.md`). Etap 2 z brakującą dużą częścią przepuści każde dalsze
porównanie — bryła to jedyny moment, żeby to wyłapać.

## Pętla poprawek

Po każdym etapie jedna decyzja: **dalej**, **popraw rozbiór** (zła część, zły rodzaj bryły,
złe proporcje), **popraw kod** (rozbiór dobry, wykonanie nie), **poproś o dane** (zdjęcie
nie pokazuje tego, co trzeba), **stop**.

Limit: trzy poprawki na etap, sześć na cały model. Po wyczerpaniu zatrzymaj się i napisz,
co nadal nie pasuje i czego brakuje — dalsze krążenie po tym samym etapie tylko psuje to,
co już było dobre.

## Co napisać na koniec

- ocena podobieństwa w skali z `instructions/przeglad.md` wraz z uzasadnieniem
- co zmieniłeś na każdym etapie, z wartościami (nie „poprawiłem dach", tylko
  „nachylenie dachu z 25° na 38°, okap z 0,1 na 0,25 m")
- czego jedno zdjęcie nie pokazało (tył, spód, wnętrze) i co w tych miejscach zgadłeś
- czego świadomie nie odtworzyłeś, bo wypada ze stylu sceny

Nie pisz „gotowe", gdy jest „bliżej".
