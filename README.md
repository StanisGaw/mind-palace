# Mneme — pałac pamięci 3D

Edytor „mind palace” w przeglądarce: budynki, przedmioty i rośliny, notatki przypisane do obiektów,
ścieżka pamięci, tryb powtórek (spaced repetition), widok z oczu oraz VR z telefonu.

## Uruchomienie

```bash
npm install
npm run dev          # http://localhost:5187 (serwer nasłuchuje też w sieci lokalnej)
npm run dev:https    # wersja HTTPS — wymagana do WebXR i czujników ruchu na telefonie
npm run build        # produkcyjny build do dist/
```

## Funkcje

- **Edytor** — widok izometryczny (Three.js). Kliknięcie elementu w bibliotece włącza podgląd stawiania
  (duch obiektu z okręgiem pod kursorem; `R` lub kółko obraca, `Shift`+klik stawia kilka, `Esc` anuluje).
  Narzędzia: `V` zaznacza (nie rusza kamery; ramka i `Shift`+klik zaznaczają kilka obiektów, które można
  razem przesunąć, usunąć albo rozstawić w siatce), `M` daje uchwyt ze strzałkami i pierścieniami obrotu
  wokół osi X/Y/Z. Skalowanie i obrót osobno na każdej osi. Kamera: środkowy przycisk obraca, prawy
  przesuwa, kółko przybliża; w rzucie z góry (`T`) przytrzymanie środkowego przycisku chwilowo pochyla widok.
  Przyciski kamery: wyśrodkuj (`F`), rzut z góry (`T`), pełny ekran. Podpowiedzi po najechaniu na przyciski.
- **Rozmiary budynków** — wnętrza mają powierzchnię prawdziwych pomieszczeń (domek 10,4 × 9,6 m przy skali 2,
  pałac 11,2 × 9,8 m, biblioteka 10,2 × 9,5 m, świątynia 7,7 × 6,4 m, wieża 10 m średnicy), więc mieszczą klatkę
  schodową, ścianki działowe i meble. Starsze pałace przechodzą migrację (`shellVersion: 5`): elewacja wraca na
  nowe lico muru, a plansza rośnie tak, by pomieścić bryły.
- **Układanie i kotwiczenie** — obiekty można stawiać na innych; postawiony przedmiot przesuwa się
  i obraca razem z podstawą. Stawianie działa też poza planszą, na okolicznym terenie.
- **Rysowana plansza** — przycisk „Rysuj planszę" w Otoczeniu zamienia płytę na kafle 4 × 4 m: przeciągnięcie
  po scenie dokłada kafle, z `Shift` wymazuje, `Esc` kończy. Plansza może być wtedy dowolnego kształtu (litera L,
  z dziurą w środku, z odnogami); kafle scalają się w możliwie duże prostokąty, z których powstają blat płyty,
  linie siatki i kolidery fizyki (`lib/rects.ts`, `lib/ground.ts`). Kafla, na którym coś stoi, nie da się wymazać,
  a „Wróć do kształtu" przywraca prostokąt, koło albo sześciokąt.
- **Plansza i nawierzchnia** — kształt płyty (prostokąt, koło, sześciokąt), jej wymiary, kilkanaście
  proceduralnych nawierzchni (trawa, żwir, kostka, kamienie polne, kora…) oraz własne obrazy jako
  tekstura. Zestawy otoczenia można zapisywać i wczytywać jako „krajobrazy". **Ścieżki** rysuje się
  odcinek po odcinku jak ścianki — z własną nawierzchnią i szerokością. Odcinki w jednej linii, o zgodnej
  szerokości i nawierzchni, scalają się w jeden obiekt (nakładające się kawałki znikają), a ciągi stykające się
  końcami dostają wspólną grupę — także wtedy, gdy powstały w różnych sesjach; stare zapisy scalają się przy
  wczytaniu. Odcinek z notatką nigdy nie znika po cichu.
- **Materiały i kolory** — każdy obiekt pokazuje w panelu swoje warstwy materiału (drewno, kamień,
  tkanina, dach…) z wyborem koloru i gotowymi odcieniami drewna (dąb, sosna, orzech, wiśnia, heban,
  bielone); warstwy drewniane mają słoje. Wnętrza mają tekstury podłogi (parkiet, panele, marmur,
  beton, płytki, dywan) i ścian (tynk, boazeria, tapety, cegła, kamień) — osobno dla pokoju ładowanego
  i dla każdego budynku z wnętrzem w miejscu.
- **Zwierzęta** — punkty pojawiania (ptaki, pies, kot, wiewiórka, wilk, smok) stawiane w edytorze
  ożywają w trybie chodzenia: pies podbiega i siada, kot ucieka, wiewiórka wspina się na drzewo,
  wilk warczy z dystansu, smok krąży, przelatuje nad głową i zionie ogniem. Świetliki, owady i motyle to roje
  cząstek krążące wokół znacznika (słoik, ul, kępa kwiatów).
- **Samolot** — obiekt z biblioteki (Przedmioty). W spacerze podejdź do kokpitu i naciśnij `F`, żeby wsiąść:
  kamera siada w otwartym kokpicie (tablica z zegarami, drążek, wiatrochron, kręcące się śmigło), a myszą
  rozglądasz się po kabinie. `Shift`/`Ctrl` — gaz, `W`/`S` — ster wysokości, `A`/`D` — przechył (przechył
  zakręca), `Q`/`E` — ster kierunku. Powyżej prędkości startowej maszyna odrywa się od ziemi; latasz nad
  planszą i okolicznym terenem (w locie mgła cofa się, żeby było widać krajobraz). Wysiadka (`F`) wymaga
  postoju na planszy — samolot zostaje tam, gdzie stanął.
- **Elewacja i dekoracje** — budynki mają wbudowane okna z szybami, te same na bryle, w powłoce
  w miejscu i w pokoju ładowanym (z widokiem „dnia” za szybą). Okno, balkon i taras z biblioteki
  stawia się na murze budynku z wnętrzem w miejscu (mur dostaje otwór; balkon na piętrze, taras przy
  parterze); każde piętro podwyższa bryłę budynku.
  Wyposażenie: obrazy z generowanym płótnem, popiersie, kominek, fotel, sofa, łóżko, biurko, kredens,
  zegar, lustro, wazon, zasłony, globus, naczynia; regał z tomami o złoconych grzbietach i tytułach,
  ułożonymi w każdym regale inaczej; piec kaflowy i szafka kuchenna z blatem i zlewem. Z nich zbudowane są
  gotowe zestawy mebli.
- **Wnętrza budynków** — dwa tryby. *W budynku* (domyślny dla nowych): wnętrze w tej samej scenie,
  w spacerze otwierasz drzwi (`F` lub klik) i wchodzisz; w edytorze klik w budynek chowa dach i ściany od
  strony kamery, obiekty stawia się na jego podłodze, piętra (1–4) i piętro do edycji są w panelu budynku.
  *Osobna scena*: własny pokój z osobnymi przedmiotami — „Wejdź do środka" albo dwuklik, z oczu `F` przy
  drzwiach; po wejściu stajesz za progiem, po wyjściu przed drzwiami. Element „Brama wejściowa" wyznacza
  start spaceru po planszy. Usunięcie budynku kasuje jego wnętrze i to, co w nim stoi.
- **Kreator wnętrz** — układ pokoju to zwykłe obiekty biblioteki z kategorii „Konstrukcja": ściana
  działowa (rysowana dwoma kliknięciami: początek i koniec, `Shift` ciągnie kolejną, `Esc` anuluje;
  współliniowe ścianki scalają się w jeden obiekt), drzwi (stawiane w ściance działowej — ścianka dostaje
  otwór, `R` zmienia stronę zawiasów), schody, lampa sufitowa. Obiekty można grupować („Grupuj" w panelu
  zaznaczenia): grupa zaznacza się, przesuwa i znika jako całość. Panel „Piętra" ustawia liczbę
  kondygnacji (1–4) budynku i piętro do edycji; schody robią otwór w stropie i prowadzą wyżej. Domek, pałac
  i biblioteka dostają schody same przy pierwszym piętrze — aplikacja szuka miejsca, gdzie bieg mieści się przy
  ścianie z podejściem i podestem, bez przecinania ścianek i mebli (`lib/layout.ts`). Usunięcie piętra zabiera
  ze sobą bieg, który prowadziłby w sufit, i otwór w stropie (`orphanStairs`) — jedno cofnięcie przywraca piętro
  razem ze schodami. Blokada „na usuwanym piętrze stoją obiekty" dotyczy tylko rzeczy użytkownika; lampy sufitowe
  i schody aplikacja dokłada i sprząta sama. Wieża
  ma jeden ciągły bieg kręconych schodów przez wszystkie kondygnacje i okrągłe izby na piętrach. Drzwi otwiera
  i zamyka `F` albo kliknięcie.
- **Zestawy mebli** — zakładka „Zestawy" obok Biblioteki. Zestaw to nazwana grupa mebli o stałych wymiarach
  w metrach, taka sama w każdym rodzaju budynku: salon, kuchnia, jadalnia, sypialnia, gabinet i kącik czytelniczy
  we wnętrzu, ogród na planszy. „Postaw" włącza podgląd, który jedzie za kursorem (kółko myszy obraca), a klik
  stawia cały zestaw jako jedną grupę — przesuwa się i znika w całości. Zestaw z tyłem sam ustawia się plecami
  do najbliższej ściany w promieniu 1,6 m; ręczny obrót wyłącza to przyciąganie. Zestaw niczego nie kasuje, tylko
  dokłada, więc w jednym wnętrzu można wydzielić salon, kuchnię i gabinet jak w lofcie. „Zapisz zaznaczenie jako
  zestaw" zachowuje własne rozmieszczenie (`localStorage`, klucz `mneme.sets.v1`); dawne układy pokoi z poprzedniej
  wersji przeliczają się na zestawy przy pierwszym wczytaniu.
- **Piwnica** — budynek z wnętrzem w miejscu może dostać kondygnację pod ziemią (poziom −1). Przycisk
  „+ Piwnica" pogłębia bryłę o jedną kondygnację, dokłada lampy i bieg schodów z parteru, a w płycie świata
  i w pierścieniu terenu wycina otwór pod wnętrzem budynku (`basementHoles`, `basementQuads`). Bez tego drugiego
  teren — leżący kilkanaście centymetrów pod zerem, a więc w środku piwnicy — zamykałby ją niewidzialną pokrywą,
  bo jest też bryłą kolizji. Piwnica nie ma okien ani
  elewacji, a wybieraki piętra dostają pozycję „Piwnica". Wyłączenie działa jak usunięcie piętra: blokuje je
  własne wyposażenie stojące na dole, a lampy i schody znikają same.
- **Elewacja** — budynek z wnętrzem w miejscu ma osobne pole „Elewacja" obok podłogi i ścian wnętrza:
  tynk, cegła, cegła klinkierowa, mur kamienny, cios kamienny, płyty kamienne, deski pionowe, ciemne deski,
  beton, marmur i własne obrazy. Faktura jest mnożona przez kolor warstwy muru, więc paleta materiałów dalej
  działa; cokoły, gzymsy, kolumny i dachy zostają w swoich kolorach.
- **Reguły rozmieszczenia** — `placementBlock` w `lib/layout.ts` to jedno źródło prawdy dla podglądu,
  przeciągania i listy problemów układu: otwarty ogień (kandelabr, pochodnia, latarnia) nie stoi na blacie,
  książki nie leżą na biurku, a to, co wisi (obraz, lustro, zegar, zasłony), nie zasłania okna — także okna
  postawionego z biblioteki. Podgląd robi się czerwony, klik nie stawia obiektu, a przeciągnięty mebel spada
  na podłogę swojego piętra.
- **Krajobraz** — proceduralny pierścień terenu wokół planszy (łąki, góry, wybrzeże, pustynia) z losowanym
  ukształtowaniem oraz kategoria „Krajobraz" w bibliotece: góra, wulkan z dymem, głaz, wzgórze, staw, wodospad.
- **Pogoda i pora dnia** — niezależne ustawienia: cztery klimaty i sześć rodzajów pogody (chmury, deszcz,
  śnieg, mgła, burza z błyskawicami).
- **Fizyka** — silnik Rapier (WASM, ładowany dopiero przy wejściu w tryb chodzenia): grawitacja, skok
  (`Spacja`, przycisk na telefonie, grip w VR), wchodzenie po schodach i wskakiwanie na ławkę, głaz czy wzgórze.
  W spacerze można też stawiać obiekty z biblioteki: podgląd idzie za celownikiem, klik stawia, `R` obraca; wewnątrz
  budynku biblioteka ogranicza się do wyposażenia wnętrz.
- **Notatki** — każdemu obiektowi można przypisać tytuł i treść wspomnienia. Obiekt z notatką trafia na
  ścieżkę pamięci, której kolejność można zmieniać.
- **Spacer pamięci** — kamera prowadzi po przystankach; najpierw próbujesz sobie przypomnieć, potem
  odsłaniasz notatkę i oceniasz (algorytm w stylu SM-2 wyznacza termin kolejnej powtórki).
- **Widok z oczu** — WASD + mysz (pointer lock) na komputerze, joystick, przeciąganie i przycisk skoku na telefonie.
- **VR** — zwykły spacer w goglach: lewy joystick idzie, prawy obraca skokowo, spust działa jak
  kliknięcie, chwyt to skok. Kamera nie przenosi gracza samoczynnie. Gdy przeglądarka nie ma WebXR,
  włącza się tryb stereo (Cardboard): przytrzymanie ekranu idzie do przodu, krótkie dotknięcie to interakcja.
- **Zapis** — automatycznie w `localStorage` (wiele pałaców). **Eksport/Import** — plik JSON, dołącza
  własne zestawy mebli; import pliku pyta osobno o pałac (dodaj / zastąp / pomiń) i o zestawy
  (importuj / pomiń). Pliki sprzed zestawów wczytują się dalej — ich układy pokoi zamieniają się w zestawy.

## VR z telefonu — krok po kroku

1. Komputer i telefon w tej samej sieci Wi-Fi. Uruchom `npm run dev:https`.
2. Na telefonie otwórz adres `https://<IP-komputera>:5187` (zaakceptuj ostrzeżenie o certyfikacie).
3. Wybierz **VR**. Chrome na Androidzie uruchomi WebXR; Safari/iOS przejdzie w tryb stereo (zapyta o zgodę na czujniki).
4. Włóż telefon do gogli Cardboard. Dotknięcie ekranu / przycisk gogli = „dalej”.

## Podgląd fizyki

Dopisz `?physdebug=1` do adresu, aby zobaczyć bryły kolizji jako linie.

## Testy

```bash
npm test          # vitest: zestawy i układy, piętra i schody, plansza z kafli (src/lib/*.test.ts)
```

Testy sprawdzają geometrię w metrach: czy schody mieszczą się w pokoju razem z podejściem i podestem,
czy nie przecinają ścianek i mebli, czy od wejścia da się dojść do każdego mebla i do schodów (siatka przejść
z kapsułą gracza o promieniu 0,32 m), czy krzesła stoją przy stole, a obrazy przy ścianie. Każdy wbudowany zestaw
sprawdzany jest w pokoju na swoją miarę, w swoim obrysie oraz w domku, pałacu i bibliotece w dwóch skalach —
wtedy wystarczy, że gdzieś przy tylnym murze da się go postawić bez uwag.

## Struktura

```
src/
  catalog.ts          katalog elementów (budynki, przedmioty, rośliny, klimaty)
  store.ts            stan aplikacji (zustand): pałace, obiekty, ścieżka, powtórki, undo/redo
  lib/storage.ts      localStorage, eksport/import JSON
  lib/srs.ts          spaced repetition
  lib/review.ts       spłaszczanie trasy spaceru (schodzi do wnętrz)
  lib/ground.ts       kształt planszy: obrys, przycinanie, granice chodzenia
  lib/prefs.ts        preferencje interfejsu (zwinięte i ukryte kategorie)
  lib/landscapes.ts   zapisane zestawy otoczenia
  lib/textureStore.ts własne tekstury nawierzchni
  three/textures.ts   proceduralne nawierzchnie
  three/wildlife.ts   zwierzęta: modele, zachowania, animacja
  three/builders.ts   proceduralne modele low-poly + kotwice drzwi i emiterów
  three/interior.ts   proceduralne wnętrza budynków
  three/terrain.ts    pierścień krajobrazu (heightmapa z szumu)
  three/noise.ts      simplex 2D, fBm, grzbiety górskie
  three/weather.ts    chmury, opady, mgła, błyskawice
  three/particles.ts  systemy cząsteczek (opady, dym, mgiełka)
  three/physics.ts    Rapier: kontroler postaci, kolidery, teren i ściany
  three/SceneManager.ts  scena, kamera, edytor, widok z oczu, WebXR + stereo fallback
  three/text.ts       panele tekstowe 3D (dla widoku z oczu / VR)
  components/         interfejs React
```
