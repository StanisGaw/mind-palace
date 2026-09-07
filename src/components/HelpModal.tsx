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
          <li>Kliknij element w <b>Bibliotece</b>, aby dodać go na scenę. Przeciągnij obiekt, by go przesunąć.</li>
          <li>Narzędzia: <kbd>V</kbd> zaznacz, <kbd>M</kbd> przesuń, <kbd>R</kbd> obróć (przeciągnij w poziomie), <kbd>Del</kbd> usuń, <kbd>Ctrl</kbd>+<kbd>D</kbd> duplikuj, <kbd>Ctrl</kbd>+<kbd>Z</kbd> cofnij, <kbd>F</kbd> wyśrodkuj widok, <kbd>T</kbd> widok z góry.</li>
          <li>Kliknij obiekt i wpisz w prawym panelu tytuł oraz treść wspomnienia. Obiekt z notatką trafia automatycznie na ścieżkę pamięci — kolejność zmienisz strzałkami.</li>
        </ul>
        <h3>Widok z oczu</h3>
        <ul>
          <li>Kliknij scenę, aby zablokować kursor. <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> — chodzenie, <kbd>Shift</kbd> — bieg, <kbd>Q</kbd>/<kbd>E</kbd> — obrót, <kbd>Spacja</kbd> — skok.</li>
          <li>Obowiązuje grawitacja i kolizje: da się wejść po schodach, wskoczyć na ławkę czy głaz i wspiąć się na wzgórze.</li>
          <li>Na telefonie: joystick po lewej, przeciąganie po prawej, przycisk <b>Skok</b> po prawej na dole, dotknięcie obiektu — wybór.</li>
        </ul>
        <h3>Stawianie i układanie</h3>
        <ul>
          <li>Kliknięcie elementu w bibliotece włącza <b>podgląd</b>: półprzezroczysty obiekt z okręgiem idzie za kursorem. Kliknij scenę, aby postawić, <kbd>R</kbd> lub kółko myszy obraca, <kbd>Shift</kbd>+klik stawia kilka sztuk, <kbd>Esc</kbd> albo prawy przycisk anuluje.</li>
          <li>Gdy okrąg zmieni kolor na niebieski, obiekt stanie <b>na wierzchu</b> tego pod kursorem i będzie się z nim przesuwał. „Postaw na ziemi" w prawym panelu zdejmuje go z podstawy.</li>
          <li>Obiekty można stawiać także <b>poza planszą</b>, w krajobrazie — chodzić da się nadal tylko po płycie.</li>
        </ul>
        <h3>Narzędzia edytora</h3>
        <ul>
          <li><kbd>V</kbd> zaznacza (nie przesuwa), <kbd>M</kbd> pokazuje uchwyt ze strzałkami X/Y/Z, <kbd>R</kbd> pierścień obrotu. Przeciąganie obiektu myszą działa w trybie Przesuń.</li>
          <li>W prawym panelu skalujesz osobno szerokość, wysokość i głębokość; kłódka trzyma proporcje.</li>
        </ul>
        <h3>Plansza, nawierzchnia i krajobrazy</h3>
        <ul>
          <li>Przycisk <b>Otoczenie</b> zawiera kształt planszy (prostokąt, koło, sześciokąt) i jej wymiary, wybór nawierzchni (w tym własne obrazy) oraz zapisane zestawy krajobrazu.</li>
          <li>Zestaw można zapisać („Zapisz bieżący jako…") i zastosować jednym kliknięciem w innym pałacu.</li>
        </ul>
        <h3>Zwierzęta</h3>
        <ul>
          <li>W bibliotece, w kategorii <b>Zwierzęta</b>, stawiasz punkty pojawiania. W edytorze widać znacznik, a w trybie chodzenia zwierzę ożywa.</li>
          <li>Pies podbiega i siada obok Ciebie, kot ucieka, wiewiórka wspina się na drzewo, wilk warczy z dystansu, ptaki krążą, a smok co jakiś czas przelatuje nad głową. Kliknięcie zwierzęcia wywołuje reakcję.</li>
        </ul>
        <h3>Wnętrza budynków</h3>
        <ul>
          <li>Każdy budynek ma własne wnętrze — osobną scenę z własnymi przedmiotami i notatkami. W edytorze kliknij budynek i wybierz <b>Wejdź do środka</b> albo kliknij go dwukrotnie.</li>
          <li>W widoku z oczu podejdź do drzwi i naciśnij <kbd>F</kbd> lub kliknij drzwi. Po wejściu stajesz tuż za progiem twarzą w głąb pomieszczenia, a po wyjściu — przed drzwiami, plecami do budynku.</li>
          <li>Ścieżka okruszków u góry pokazuje, gdzie jesteś. Usunięcie budynku kasuje też jego wnętrze.</li>
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
