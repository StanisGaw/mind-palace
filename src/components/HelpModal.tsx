import { I } from './Icons';

export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn close" onClick={onClose} title="Zamknij"><I.X /></button>
        <h2>Jak korzystać z Mneme</h2>
        <p>Pałac pamięci to miejsce, w którym wiedzę przypinasz do obiektów w przestrzeni. Potem „spacerujesz” po nim i przypominasz sobie treści w kolejności.</p>
        <h3>Edytor</h3>
        <ul>
          <li>Kliknij element w <b>Bibliotece</b>, aby dodać go na scenę. W trybie Przesuń przeciągnij obiekt, by go przestawić.</li>
          <li>Narzędzia: <kbd>V</kbd> zaznacz, <kbd>M</kbd> przesuń i obróć, <kbd>Del</kbd> usuń, <kbd>Ctrl</kbd>+<kbd>D</kbd> duplikuj (podgląd kopii jedzie za kursorem, klik stawia, <kbd>Shift</kbd> kolejne), <kbd>Ctrl</kbd>+<kbd>Z</kbd> cofnij, <kbd>F</kbd> wyśrodkuj widok, <kbd>T</kbd> rzut z góry. Podpowiedź do każdego przycisku pojawia się po najechaniu.</li>
          <li>Kamera: <b>środkowy przycisk</b> obraca widok, prawy przesuwa, kółko przybliża. W rzucie z góry przytrzymanie środkowego przycisku chwilowo pochyla kamerę — po puszczeniu wraca nad planszę.</li>
          <li>Kliknij obiekt i wpisz w prawym panelu tytuł oraz treść wspomnienia. Obiekt z notatką trafia automatycznie na ścieżkę pamięci — kolejność zmienisz strzałkami.</li>
        </ul>
        <h3>Widok z oczu</h3>
        <ul>
          <li>Kliknij scenę, aby zablokować kursor. <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> — chodzenie, <kbd>Shift</kbd> — bieg, <kbd>Q</kbd>/<kbd>E</kbd> — obrót, <kbd>Spacja</kbd> — skok.</li>
          <li>Obowiązuje grawitacja i kolizje: da się wejść po schodach, wskoczyć na ławkę czy głaz i wspiąć się na wzgórze.</li>
          <li>W spacerze też stawiasz obiekty: wybierz coś z Biblioteki, a półprzezroczysty podgląd idzie za celownikiem — klik stawia, <kbd>R</kbd> obraca, <kbd>Esc</kbd> albo prawy przycisk anuluje. Wewnątrz budynku biblioteka pokazuje tylko to, co pasuje do pokoju (bez drzew, gór czy studni; kot i pies mogą wejść), a elewację (okno, balkon, taras) stawiasz na murze od środka.</li>
          <li>Na telefonie: joystick po lewej, przeciąganie po prawej, przycisk <b>Skok</b> po prawej na dole, dotknięcie obiektu — wybór. W edytorze pasek stawiania ma „Obróć”, „Wiele” i „Anuluj”, a w rzucie z góry palec przesuwa planszę. Obróć telefon poziomo: belki znikają, menu i panele są pod ikonami przy lewej krawędzi.</li>
        </ul>
        <h3>Stawianie i układanie</h3>
        <ul>
          <li>Kliknięcie elementu w bibliotece włącza <b>podgląd</b>: półprzezroczysty obiekt z okręgiem idzie za kursorem. Kliknij scenę, aby postawić, <kbd>R</kbd> lub kółko myszy obraca, <kbd>Shift</kbd>+klik stawia kilka sztuk, <kbd>Esc</kbd> albo prawy przycisk anuluje.</li>
          <li>Gdy okrąg zmieni kolor na niebieski, obiekt stanie <b>na wierzchu</b> tego pod kursorem i będzie się z nim przesuwał. „Postaw na ziemi" w prawym panelu zdejmuje go z podstawy.</li>
          <li>Obiekty można stawiać także <b>poza planszą</b>, w krajobrazie — chodzić da się nadal tylko po płycie.</li>
        </ul>
        <h3>Narzędzia edytora</h3>
        <ul>
          <li><kbd>V</kbd> zaznacza i nigdy nie rusza kamery: przeciągnięcie po pustym miejscu rysuje <b>ramkę</b>, <kbd>Shift</kbd>+klik dodaje lub odejmuje obiekt. Kilka zaznaczonych obiektów przesuwasz razem, usuwasz <kbd>Del</kbd> albo rozstawiasz w siatce (kolumny i odstępy w prawym panelu).</li>
          <li><kbd>M</kbd> pokazuje uchwyt: <b>strzałki</b> przesuwają, <b>pierścień</b> obraca w poziomie. Przechył w przód i na boki ustawisz suwakami w prawym panelu.</li>
          <li><b>Grupy</b>: zaznacz kilka obiektów i kliknij „Grupuj” — odtąd klik w dowolny z nich zaznacza całość, a przesuwanie, duplikowanie i usuwanie działają na wszystkie. Dwuklik wybiera jeden element (np. do notatki), „Rozgrupuj” rozdziela. Współliniowe ścianki scala „Scal ścianki”.</li>
          <li>W prawym panelu skalujesz osobno szerokość, wysokość i głębokość; kłódka trzyma proporcje.</li>
        </ul>
        <h3>Plansza, nawierzchnia i krajobrazy</h3>
        <ul>
          <li>Przycisk <b>Otoczenie</b> zawiera kształt planszy (prostokąt, koło, sześciokąt) i jej wymiary, wybór nawierzchni (w tym własne obrazy) oraz zapisane zestawy krajobrazu.</li>
          <li>Zestaw można zapisać („Zapisz bieżący jako…") i zastosować jednym kliknięciem w innym pałacu.</li>
          <li><b>Ścieżki</b> (Konstrukcja) rysujesz jak ścianki: klik początek, klik koniec, z <kbd>Shift</kbd> kolejny odcinek od końca poprzedniego. Cały ciąg jest jedną grupą; nawierzchnię (żwir, kostka, kamienie, deski…) i szerokość (skala Z) ustawisz w panelu odcinka.</li>
        </ul>
        <h3>Materiały i kolory</h3>
        <ul>
          <li>Sekcja <b>Materiały</b> w panelu obiektu pokazuje warstwy, z których zbudowany jest model (drewno, kamień, tkanina, dach…). Każdej zmienisz kolor; „↺” przywraca domyślny. Obiekty z drewnem mają szybkie odcienie: dąb, sosna, orzech, wiśnia, heban, bielone. Kopie dziedziczą kolory.</li>
          <li>Wnętrze budynku w miejscu ma w panelu budynku wybór <b>podłogi</b> (parkiet, panele, marmur, beton, płytki, dywan…) i <b>ścian</b> (tynk, boazeria, tapety, cegła, kamień). W pokoju ładowanym to samo ustawisz w Otoczeniu („Podłoga”, „Ściany”). Własne obrazy działają wszędzie.</li>
        </ul>
        <h3>Zwierzęta</h3>
        <ul>
          <li>W bibliotece, w kategorii <b>Zwierzęta</b>, stawiasz punkty pojawiania. W edytorze widać znacznik, a w trybie chodzenia zwierzę ożywa.</li>
          <li>Pies podbiega i siada obok Ciebie, kot ucieka, wiewiórka wspina się na drzewo, wilk warczy z dystansu, ptaki krążą, a smok co jakiś czas przelatuje nad głową i zionie ogniem. Kliknięcie zwierzęcia wywołuje reakcję.</li>
          <li><b>Świetliki</b> (słoik), <b>owady</b> (ul z pszczołami) i <b>motyle</b> (kępa kwiatów) to roje krążące wokół znacznika — także w edytorze. Świetliki mrugają i najładniej wyglądają nocą.</li>
        </ul>
        <h3>Wnętrza budynków</h3>
        <ul>
          <li>Budynek ma wnętrze w jednym z dwóch trybów (panel budynku, „Wnętrze”). <b>W budynku</b> (domyślnie dla nowych): wnętrze jest w tej samej scenie — w widoku z oczu podchodzisz do drzwi, naciskasz <kbd>F</kbd> albo klikasz i po prostu wchodzisz. W edytorze kliknięcie budynku chowa mu dach i ściany od strony kamery; obiekty stawiasz na jego podłodze (jadą z nim razem), piętra dodajesz w panelu i przełączasz, które edytujesz — każde piętro podwyższa bryłę (domek, biblioteka i pałac do 2, wieża do 4). Klik w pustkę przywraca dach.</li>
          <li>Każdy budynek ma <b>wbudowane okna</b> z szybami — te same na bryle, od środka w budynku w miejscu i w pokoju ładowanym (za szybą widać dzień). <b>Elewacja</b>: okno, balkon i taras z Konstrukcji stawia się dodatkowo na murze budynku z wnętrzem w miejscu — podgląd przyciąga się do ściany na edytowanym piętrze, a mur dostaje otwór. Balkon tylko na piętrze (z wyjściem), taras tylko przy parterze (z wyjściem i schodkami), okno wszędzie poza miejscem wbudowanych okien.</li>
          <li><b>Osobna scena</b> (dla dużych wnętrz i starszych pałaców): wnętrze to własny pokój z osobnymi przedmiotami. W edytorze „Wejdź do środka” albo dwuklik; z oczu <kbd>F</kbd> przy drzwiach. Po wejściu stajesz tuż za progiem, po wyjściu przed drzwiami. Ścieżka okruszków u góry pokazuje, gdzie jesteś.</li>
          <li>Skala budynku z wnętrzem w miejscu jest podnoszona do minimum, przy którym mieścisz się w drzwiach; większa skala daje przestronniejsze wnętrze. Usunięcie budynku kasuje też to, co w nim stoi.</li>
        </ul>
        <h3>Kreator wnętrz</h3>
        <ul>
          <li>Kategoria <b>Konstrukcja</b> (ściana działowa, drzwi, schody) jest dostępna we wnętrzu i na planszy — na planszy służy budynkom z wnętrzem w miejscu. To zwykłe obiekty — można je przesuwać, cofać i usuwać jak wszystko inne. Lampy sufitowe („Lampa sufitowa” w Oświetleniu) też są obiektami: stoją na podłodze piętra, a świecą pod jego sufitem. W Wyposażeniu są obrazy (każdy z innym płótnem), popiersie, kominek, fotel, sofa, łóżko, biurko, kredens, zegar, lustro, wazon, zasłony, globus i naczynia — z nich zbudowane są układy: salon, sypialnia, gabinet, jadalnia, sala tronowa, galeria, pracownia. Regał ma tomy ze złoconymi grzbietami i tytułami, ułożone w każdym regale inaczej (stojące, pochylone, w stosach); „Książki” to stos z otwartą księgą.</li>
          <li><b>Ścianę działową</b> rysujesz dwoma kliknięciami: pierwsze wskazuje początek, drugie koniec (można też przeciągnąć). Końce przyciągają się do siatki, innych ścianek i ścian pokoju, a kąt do wielokrotności 15°. Z <kbd>Shift</kbd> kolejna ścianka zaczyna się tam, gdzie skończyła poprzednia; <kbd>Esc</kbd> cofa początek albo kończy rysowanie.</li>
          <li><b>Drzwi</b> stawia się w ściance działowej — podgląd sam przyciąga się do jej osi, a ścianka dostaje otwór. <kbd>R</kbd> albo kółko myszy w trakcie stawiania (i przycisk „Zawiasy z drugiej strony" w panelu) zmienia stronę, w którą otwiera się skrzydło. Przesuwane drzwi jadą po ściance; usunięcie ścianki usuwa też jej drzwi.</li>
          <li>Gotowe <b>układy pokoju</b> są w zakładce „Układy" obok Biblioteki — we wnętrzu ładowanym osobno i dla odsłoniętego budynku z wnętrzem w miejscu (kliknij budynek). Wybierz jeden i kliknij „Zastosuj". Układ zastąpi obiekty bez notatek; te z notatkami zawsze zostają. Przycisk „Zapisz obecny układ" (w pokoju ładowanym) zachowuje bieżące rozmieszczenie do ponownego użycia w innym budynku.</li>
          <li>Drzwi (obiekt z Konstrukcji) otwierasz i zamykasz klawiszem <kbd>F</kbd> albo kliknięciem — zamknięte blokują przejście, otwarte przepuszczają.</li>
          <li>Panel „Piętra" (zamiast planszy w Otoczeniu) ustawia liczbę kondygnacji budynku (1–4) i piętro do edycji. Schody postawione na danym piętrze robią w stropie otwór i prowadzą wyżej — w widoku z oczu wystarczy nimi wejść. Domek, pałac i biblioteka dostają przy pierwszym piętrze schody same (zwykły obiekt wzdłuż tylnej ściany, z miejscem na podejście i podestem za szczytem — możesz je przesunąć albo usunąć). Wieża ma wbudowane kręcone schody wzdłuż muru jako jeden ciągły bieg przez wszystkie kondygnacje: parter to przedsionek, każde piętro to okrągła izba ze stropem wyciętym tylko nad schodami, a bieg idzie dalej w górę. Wnętrza są na tyle duże, by zmieścić klatkę i wejście (domek 5,2 × 4,8 m przy skali 2).</li>
          <li>Eksport pałacu dołącza Twoje własne układy pokoi; przy imporcie pliku z układami możesz osobno wybrać, co zrobić z pałacem, a co z presetami.</li>
        </ul>
        <h3>Krajobraz i pogoda</h3>
        <ul>
          <li>Przycisk <b>Otoczenie</b> (prawy górny róg sceny) ustawia porę dnia, pogodę (deszcz, śnieg, mgła, burza) i rodzaj krajobrazu wokół planszy. Przyciskiem obok wylosujesz nowe ukształtowanie terenu.</li>
          <li>Kategoria <b>Krajobraz</b> w bibliotece zawiera góry, wulkan, głazy, wzgórza i wodę do postawienia na planszy.</li>
        </ul>
        <h3>Spacer pamięci (powtórki)</h3>
        <ul>
          <li>Kamera prowadzi Cię od przystanku do przystanku. Najpierw spróbuj sobie przypomnieć, potem odsłoń notatkę i oceń, jak poszło.</li>
          <li>Oceny sterują terminami kolejnych powtórek (algorytm w stylu SM-2). Licznik na przycisku pokazuje, ile obiektów czeka na powtórkę.</li>
        </ul>
        <h3>Początek spaceru</h3>
        <ul>
          <li>Element <b>Brama wejściowa</b> (kategoria Specjalne) wyznacza miejsce, w którym zaczynasz spacer. Bez bramy startujesz na krawędzi planszy, twarzą do środka.</li>
        </ul>
        <h3>VR z telefonu</h3>
        <ul>
          <li>Otwórz aplikację na telefonie (na tym samym Wi-Fi) i wybierz <b>VR</b>. Jeśli przeglądarka obsługuje WebXR (Chrome na Androidzie), uruchomi się tryb immersyjny. W innym razie włączy się tryb stereo sterowany czujnikami — włóż telefon do gogli typu Cardboard.</li>
          <li>W VR jedno kliknięcie/naciśnięcie odsłania notatkę, kolejne przenosi do następnego przystanku; przycisk chwytu (grip) to skok. Czujniki i WebXR wymagają połączenia HTTPS: uruchom <kbd>npm run dev:https</kbd>.</li>
        </ul>
        <h3>Zapis i przenoszenie</h3>
        <p>Wszystko zapisuje się automatycznie w tej przeglądarce (localStorage). <b>Eksportuj</b> tworzy plik JSON, a <b>Importuj</b> wczytuje go na innym urządzeniu.</p>
      </div>
    </div>
  );
}
