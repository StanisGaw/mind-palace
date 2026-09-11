# Dobór brył

Zanim wybierzesz geometrię, nazwij rodzaj powierzchni. Najczęstszy błąd to pudełko
w miejscu formy ciągłej — sylwetka jest wtedy blisko, a rzecz i tak czyta się jak zabawka.

## Sześć rodzajów powierzchni

| Rodzaj | Co to | Czym budować |
|---|---|---|
| bryła złożona | sztywna część o płaskich ścianach: skrzynia, panel, słup | `box`, `cyl`, `cone`, `prism` |
| forma ciągła | jedna gładko zmienna masa: dzban, róg, kamień, owoc | `THREE.LatheGeometry` (obrotowa), `THREE.ExtrudeGeometry` (profil z głębokością), `sphere`, `dodeca` |
| powłoka | cienka skorupa przylegająca do czegoś pod spodem: dach, okap, poszycie | `prism`, cienkie `box` pod kątem, `THREE.ExtrudeGeometry` |
| relief | detal zmieniający powierzchnię, nie sylwetkę: listwy, nity, żłobienia | tylko gdy widać go z 5 m — inaczej zostaw materiałowi |
| włókno | cienkie, długie, często powtórzone: lina, kabel, gałąź, łodyga | `THREE.TubeGeometry` po krzywej, wąski `cyl`, powtórzenie w pętli |
| naklejka | płaski znak bez własnej objętości | cienki `box` albo `THREE.PlaneGeometry` z materiałem |

Rodzaju nie wyznacza wielkość. Duży gładki głaz i mały kamyk to obie formy ciągłe;
duży płaski panel i mała płytka to obie bryły złożone.

## Wzorce, które ratują podobieństwo

- **Siatka prętów zamiast jednej krzywej.** Rama, stelaż, kozioł to zbiór prostych
  odcinków. Każdy jako osobny `cyl` obrócony między dwoma punktami. Jedna zamknięta
  krzywa wygładza się w kroplę.
- **Bryła musi zawierać wszystkie duże części.** Model bez jednej dużej części (koła,
  dachu, blatu) nie czyta się jako ta rzecz, a porównanie sylwetki tego nie wyłapie.
- **Zaokrąglaj drobnicę.** Ząbki, karby i łuski z prostokątnych pudełek wyglądają źle.
  `sphere` o małej liczbie segmentów albo `cyl` lekko przechylony naprzemiennie ±kąt.
- **Fakturę chwytu rób geometrią.** Owinięcie, karbowanie, pierścienie: cienki rdzeń
  i kilka krótkich obręczy ledwie grubszych od niego. Obręcz wyraźnie grubsza czyta się
  jak sprężyna.
- **Zbieżność do punktu.** `THREE.TubeGeometry` ma stały promień — rogu, kła ani szpica
  z niego nie zrobisz. Do zwężenia użyj `cone` albo łańcucha `cyl` o malejących promieniach.
- **Grupa pomocnicza ma skalę `[1,1,1]`.** Dzieci dziedziczą przekształcenie rodzica;
  skalowanie grupy „żeby pasowała" psuje wszystkie proporcje wewnątrz.

## Zasady tego projektu

- Materiały tylko przez `mat()`, `woodMat()`, `finishMat()` — są współdzielone i nie wolno
  ich modyfikować po utworzeniu (`eq-knowledge/instructions/three-pitfalls.md`).
- Płaskie cieniowanie (`flat: true`) jest domyślne i trzyma styl sceny. `flat: false`
  tylko tam, gdzie forma ma być naprawdę gładka (szkło, woda, wypolerowany metal).
- Kolory bierz z ról w `C`. Nowy odcień dodawaj dopiero, gdy żadna rola nie pasuje —
  paleta jest tym, co spina scenę.
- Liczba segmentów: `cyl` domyślnie 12, `sphere` 10. Podnoś tylko dla części, na którą
  patrzy się z bliska; każdy segment kosztuje w scenie z setkami obiektów.
- Osobne geometrie twórz raz, nie w pętli po klatce — `buildNazwa` woła się przy budowie
  modelu, ale wynik żyje tak długo jak obiekt w scenie.

## Kiedy przerwać

Gdy do podobieństwa potrzeba tekstury ze zdjęcia, napisu, wzoru albo siatki z pliku —
to jest granica tej metody. Napisz, czego brakuje, i zaproponuj najbliższe uproszczenie
(np. jednolity kolor zamiast wzoru), zamiast mnożyć bryły.
