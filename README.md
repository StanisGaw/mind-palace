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
  Narzędzia: `V` zaznacza, `M` daje uchwyt ze strzałkami X/Y/Z, `R` pierścień obrotu. Skalowanie osobno
  na każdej osi. Trzy przyciski kamery: wyśrodkuj (`F`), widok z góry (`T`), pełny ekran.
- **Układanie i kotwiczenie** — obiekty można stawiać na innych; postawiony przedmiot przesuwa się
  i obraca razem z podstawą. Stawianie działa też poza planszą, na okolicznym terenie.
- **Plansza i nawierzchnia** — kształt płyty (prostokąt, koło, sześciokąt), jej wymiary, osiem
  proceduralnych nawierzchni oraz własne obrazy jako tekstura. Zestawy otoczenia można zapisywać
  i wczytywać jako „krajobrazy".
- **Zwierzęta** — punkty pojawiania (ptaki, pies, kot, wiewiórka, wilk, smok) stawiane w edytorze
  ożywają w trybie chodzenia: pies podbiega i siada, kot ucieka, wiewiórka wspina się na drzewo,
  wilk warczy z dystansu, smok krąży i przelatuje nad głową.
- **Wnętrza budynków** — każdy budynek ma własną scenę-pokój z osobnymi przedmiotami i notatkami.
  W edytorze: przycisk „Wejdź do środka" albo dwuklik na budynku. W widoku z oczu: podejdź do drzwi i `F`.
  Po wejściu stajesz tuż za progiem twarzą w głąb pomieszczenia, po wyjściu — przed drzwiami, plecami
  do budynku. Element „Brama wejściowa" wyznacza miejsce startu spaceru po głównej planszy.
  Ścieżka okruszków u góry pokazuje, gdzie jesteś; usunięcie budynku kasuje jego wnętrze.
- **Krajobraz** — proceduralny pierścień terenu wokół planszy (łąki, góry, wybrzeże, pustynia) z losowanym
  ukształtowaniem oraz kategoria „Krajobraz" w bibliotece: góra, wulkan z dymem, głaz, wzgórze, staw, wodospad.
- **Pogoda i pora dnia** — niezależne ustawienia: cztery klimaty i sześć rodzajów pogody (chmury, deszcz,
  śnieg, mgła, burza z błyskawicami).
- **Fizyka** — silnik Rapier (WASM, ładowany dopiero przy wejściu w tryb chodzenia): grawitacja, skok
  (`Spacja`, przycisk na telefonie, grip w VR), wchodzenie po schodach i wskakiwanie na ławkę, głaz czy wzgórze.
- **Notatki** — każdemu obiektowi można przypisać tytuł i treść wspomnienia. Obiekt z notatką trafia na
  ścieżkę pamięci, której kolejność można zmieniać.
- **Spacer pamięci** — kamera prowadzi po przystankach; najpierw próbujesz sobie przypomnieć, potem
  odsłaniasz notatkę i oceniasz (algorytm w stylu SM-2 wyznacza termin kolejnej powtórki).
- **Widok z oczu** — WASD + mysz (pointer lock) na komputerze, joystick, przeciąganie i przycisk skoku na telefonie.
- **VR** — zwykły spacer w goglach: lewy joystick idzie, prawy obraca skokowo, spust działa jak
  kliknięcie, chwyt to skok. Kamera nie przenosi gracza samoczynnie. Gdy przeglądarka nie ma WebXR,
  włącza się tryb stereo (Cardboard): przytrzymanie ekranu idzie do przodu, krótkie dotknięcie to interakcja.
- **Zapis** — automatycznie w `localStorage` (wiele pałaców). **Eksport/Import** — plik JSON.

## VR z telefonu — krok po kroku

1. Komputer i telefon w tej samej sieci Wi-Fi. Uruchom `npm run dev:https`.
2. Na telefonie otwórz adres `https://<IP-komputera>:5187` (zaakceptuj ostrzeżenie o certyfikacie).
3. Wybierz **VR**. Chrome na Androidzie uruchomi WebXR; Safari/iOS przejdzie w tryb stereo (zapyta o zgodę na czujniki).
4. Włóż telefon do gogli Cardboard. Dotknięcie ekranu / przycisk gogli = „dalej”.

## Podgląd fizyki

Dopisz `?physdebug=1` do adresu, aby zobaczyć bryły kolizji jako linie.

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
