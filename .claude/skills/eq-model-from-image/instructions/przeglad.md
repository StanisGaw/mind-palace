# Przegląd etapu

Każdy etap kończy się obrotówką, porównaniem ze zdjęciem i jedną decyzją. Bez zrzutu
nie ma decyzji.

## Obrotówka

Serwer deweloperski musi działać (`npm run dev`).

```bash
npm run model-shot -- <typ> zrzuty/<typ>
```

Skrypt stawia obiekt na pustej planszy, kadruje kamerę na jego ramce i zapisuje zrzuty
przycięte do płótna sceny: `zrzuty/<typ>-0.png`, `-90`, `-180`, `-270`. Opcje:
`--kąty 0,45`, `--wzniesienie 22`, `--dystans auto|<m>`, `--skala 1`, `--klimat night`.
Jedno ujęcie od frontu nie jest dowodem: dziura z tyłu, część wisząca w powietrzu
i przesunięty detal przechodzą przez nie bez śladu.

Obejrzyj zrzuty obok zdjęcia i oceniaj po kolei:

1. **sylwetka** — obrys z każdego kąta, proporcje, wysokość względem człowieka (1,7 m)
2. **części** — czy każda duża część ze zdjęcia istnieje i siedzi we właściwym miejscu
3. **styki** — nic nie wisi, nic się nie przenika, nic nie kończy się w powietrzu
4. **cechy rozpoznawcze** — lista z warstwy 7 analizy, po jednej ocenie na cechę
5. **tonacja** — czy sąsiednie części dają się od siebie odróżnić

Cecha rozpoznawcza może być zła przy dobrej ocenie ogólnej. Wtedy etap nie przechodzi.

## Skala podobieństwa

| Ocena | Co to znaczy |
|---|---|
| 0,2 | zastępcze bryły we właściwych miejscach |
| 0,4 | sylwetka rozpoznawalna, budowa niepełna |
| 0,6 | duże i średnie formy zgodne, materiał i detal słaby |
| 0,75 | rzecz czyta się poprawnie, detale przybliżone |
| 0,85 | mocne podobieństwo w stylu sceny |
| 0,95 | prawie jak referencja — z jednego zdjęcia rzadko osiągalne |

Powyżej 0,9 nie deklaruj z jednego zdjęcia, chyba że przedmiot jest prosty i symetryczny.

## Decyzja

| Decyzja | Kiedy |
|---|---|
| dalej | etap przechodzi po wszystkich pięciu punktach |
| popraw rozbiór | brakuje części, zły rodzaj bryły, złe proporcje, zła skala |
| popraw kod | rozbiór dobry, wykonanie nie: pozycja, obrót, materiał, segmenty |
| poproś o dane | zdjęcie nie pokazuje tego, co trzeba (tył, spód, wnętrze, wielkość) |
| stop | podobieństwo wystarcza albo dalej potrzeba środków spoza tej metody |

Trzy poprawki na etap, sześć na model. Limit jest po to, żeby nie psuć tego,
co już działało — po jego wyczerpaniu wypisz, co nadal nie pasuje.

## Czego zrzut nie pokaże

- **Grubości i faz.** Sylwetka może się zgadzać, a rzecz czytać się jak wycinanka.
  Sprawdzaj na ujęciu z narożnika (`--kąty 45`), nie z frontu.
- **Zachowania w scenie.** Model osobno bywa dobry, a obok sąsiednich obiektów za duży
  albo za mały. Przed końcem zrób zrzut w normalnej scenie (`npm run shot`) i porównaj
  z sąsiadami.
- **Przechodzenia.** Kolizję i wejście na bryłę sprawdza się w trybie chodzenia,
  a nie na obrazku (`eq-create-object`).
- **Kosztu.** Liczba segmentów i osobnych brył nie widać na zrzucie — przy modelu
  z dziesiątkami części sprawdź `npm run perf`.

Zdjęcie referencyjne i render różnią się tłem, kadrem i światłem. Nie ścigaj się z tymi
różnicami: oceniasz kształt, podział i tonację, nie zgodność pikseli.
