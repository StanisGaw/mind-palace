# Analiza zdjęcia

Czytaj przed napisaniem pierwszej linijki modelu. Opis powstaje warstwami, od całości
do szczegółu — bez tego kolejne etapy poprawiają detale bryły, która ma złe proporcje.

Trzy zasady na cały opis:

1. **Najpierw obserwacja, potem wniosek.** Osobno „pionowy jasny pas na froncie",
   osobno „prawdopodobnie szczelina między deskami". Wniosek oznacz jako wniosek.
2. **Słownictwo bryłowe, nie odczucia.** „walec zwężający się ku górze", nie „zgrabny".
   Kolory nazywaj tonem i nasyceniem, nie marką („ciemny chłodny brąz", nie „palisander").
3. **Układ przedmiotu, nie kadru.** Front, tył, bok, góra, spód — nie „po lewej na zdjęciu".
   Model w Mneme stoi na `y = 0` i patrzy w `+Z`; front z opisu to `+Z`.

## Warstwy

| Warstwa | Co zapisujesz |
|---|---|
| 1. Czym to jest | rzeczownik i kategoria z `CATEGORY_ORDER`; pewność |
| 2. Sylwetka | ramka i rzut na ziemię jako kilka brył; symetria (dwustronna, obrotowa, brak) |
| 3. Podział | części główne → podzespoły → grupy detalu, jako drzewo rodzic–dziecko |
| 4. Styki | jak części się łączą: nasadzone, wpuszczone, oparte, zawieszone |
| 5. Powierzchnia | dla każdej części: matowa/gładka/metaliczna, chropowatość, przezroczystość |
| 6. Kolory | ton, jasność, nasycenie per część; który kolor z `C` jest najbliżej |
| 7. Cechy rozpoznawcze | to, po czym poznaje się tę rzecz, a nie dowolną z tej kategorii |
| 8. Czego nie widać | tył, spód, wnętrze, miejsca rozmyte — wprost jako niewiadome |

## Dokąd trafia każda warstwa

| Warstwa | Trafia do |
|---|---|
| 1 | `category` i `emoji` we wpisie katalogu |
| 2 | `footprint`, wysokość modelu, proporcje etapu „bryła" |
| 3 | podział na wywołania `add()` i grupy w `buildNazwa` |
| 4 | pozycje i obroty składników, `collider` (`trimesh` dla brył do wejścia) |
| 5 | argumenty `mat()`: `roughness`, `metalness`, `flat`, `opacity` |
| 6 | wybór roli koloru z `C` albo nowy odcień |
| 7 | lista rzeczy sprawdzanych na każdym porównaniu |
| 8 | to, co opisujesz użytkownikowi jako zgadnięte |

## Skala

Zdjęcie nie podaje wymiarów. Podaj wysokość w metrach przez odniesienie: człowiek 1,7 m,
drzwi w `SHELLS` ~2 m, ławka ~0,45 m siedziska. Zapisz przyjętą wysokość razem z tym,
z czego ją wziąłeś — to najczęstsza przyczyna modelu, który „wygląda dobrze osobno,
a źle w scenie".

## Czego unikać

- opisania przedmiotu jego nazwą zamiast kształtem („to studnia" nie mówi, z czego ją złożyć)
- wciskania formy ciągłej w jedną bryłę, gdy jest zlepkiem dwóch
- pominięcia poziomu podzespołów (skok z części głównych prosto w detal)
- dopisania detalu, którego na zdjęciu nie widać, bez oznaczenia go jako zgadnięty
