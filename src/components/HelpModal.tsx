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
          <li>Na <b>padzie</b> (DualSense, Xbox — podłącz przez Bluetooth i naciśnij dowolny przycisk, żeby przeglądarka go zobaczyła): lewa gałka chodzi, prawa rozgląda, <kbd>✕</kbd> skacze, <kbd>▢</kbd> albo <kbd>◯</kbd> otwiera drzwi i zsadza z pojazdu, spusty biegną. Pad działa w spacerze i w locie; edytorem sterujesz myszą albo dotykiem. Gdy pad zostanie zauważony, pasek na dole sceny pokazuje jego przyciski zamiast klawiszy.</li>
          <li>Na telefonie: joystick po lewej, przeciąganie po prawej, przycisk <b>Skok</b> po prawej na dole, dotknięcie obiektu — wybór. W edytorze pasek stawiania ma „Obróć”, „Wiele” i „Anuluj”, a w rzucie z góry palec przesuwa planszę. Obróć telefon poziomo: belki znikają, menu i panele są pod ikonami przy lewej krawędzi.</li>
        </ul>
        <h3>Pojazdy i wierzchowce</h3>
        <ul>
          <li>W bibliotece, w kategorii <b>Pojazdy</b>, są <b>Samolot</b>, <b>Smok wierzchowy</b>, <b>Koń</b> i <b>Czerw pustynny</b>. W widoku z oczu podejdź do siodła albo kabiny i naciśnij <kbd>F</kbd> (albo kliknij podpowiedź) — siadasz i ruszasz. Myszą rozglądasz się z siodła, także na boki i za siebie. Żeby <b>zsiąść</b>, zatrzymaj się na planszy i naciśnij <kbd>F</kbd>: wierzchowiec zostaje tam, gdzie go zostawisz, a Ty stajesz obok, twarzą do niego.</li>
          <li><b>Samolot</b> ma otwarty kokpit: tablicę z zegarami, drążek, wiatrochron i kręcące się śmigło. <kbd>Shift</kbd> dodaje gazu, <kbd>Ctrl</kbd> zmniejsza, <kbd>W</kbd>/<kbd>S</kbd> to ster wysokości (nos w dół i w górę), <kbd>A</kbd>/<kbd>D</kbd> przechyla — przechył zakręca maszyną — a <kbd>Q</kbd>/<kbd>E</kbd> to ster kierunku. Na ziemi samolot kołuje; po rozpędzeniu odrywa się od ziemi, gdy ściągniesz nos. Puszczone stery same wracają do lotu poziomego. Latasz nad planszą i okolicznym krajobrazem.</li>
          <li><b>Smok wierzchowy</b> steruje się jak samolot, ale nie potrzebuje rozbiegu: przy gazie unosi się pionowo, a przy małej prędkości zawisa w miejscu, machając skrzydłami. <kbd>Spacja</kbd> albo kliknięcie (na padzie <kbd>△</kbd>, na telefonie przycisk <b>Ogień</b>) każe mu zionąć ogniem.</li>
          <li><b>Koń</b> rusza od razu: <kbd>W</kbd> to stęp, <kbd>Shift</kbd> galop, <kbd>S</kbd> cofanie, <kbd>A</kbd>/<kbd>D</kbd> skręt — także w miejscu. <kbd>Spacja</kbd> (przycisk <b>Skok</b>) przeskakuje przeszkodę. Koń trzyma się gruntu: wjeżdża na wzgórza i schodzi w doliny wokół planszy.</li>
          <li><b>Czerw pustynny</b> stoi z głową uniesioną z ziemi, a reszta ciała ginie w piasku. Po dosiadnięciu prostuje głowę i płynie po powierzchni, ciągnąc za sobą segmenty ciała. <kbd>Shift</kbd> rozpędza go powoli, <kbd>Ctrl</kbd> hamuje, <kbd>A</kbd>/<kbd>D</kbd> skręcają szerokim łukiem, a <kbd>Spacja</kbd> (przycisk <b>Wyskok</b>) wyrzuca rozpędzonego czerwia łukiem z piasku, z rozwartą paszczą. Powiększ go suwakiem wielkości, żeby był naprawdę olbrzymi.</li>
          <li><b>Skok ze spadochronem</b>: w powietrzu, z samolotu albo ze smoka, <kbd>F</kbd> (na padzie <kbd>▢</kbd>, na telefonie przycisk zsiadania) wyrzuca Cię z siodła. Spadasz swobodnie, aż <kbd>Spacja</kbd> (<kbd>✕</kbd>, przycisk <b>Spadochron</b>) otworzy czaszę; poniżej 20 m nad ziemią otwiera się sama. Na czaszy sterujesz jak w spacerze (<kbd>WASD</kbd>, gałka), a spojrzenie wyznacza kierunek. Skoczyć można tylko nad planszą i przynajmniej 5 m nad ziemią. Maszyna leci dalej sama: krąży nad planszą, szybuje w dół i zostaje tam, gdzie się zatrzyma.</li>
          <li>Na <b>padzie</b>: <kbd>R2</kbd> dodaje gazu, <kbd>L2</kbd> ujmuje (spusty są analogowe, więc obroty zmieniają się płynnie — im mocniej wciśniesz, tym szybciej), lewa gałka to ster wysokości i przechył (na koniu jazda i skręt), <kbd>L1</kbd>/<kbd>R1</kbd> to ster kierunku, prawa gałka rozgląda, <kbd>✕</kbd> skacze na koniu i czerwiu, <kbd>△</kbd> to ogień smoka, a <kbd>▢</kbd> zsiada po zatrzymaniu. Krzyżak w górę i w dół nadal zmienia gaz skokowo, co dziesiątą część.</li>
          <li>Na telefonie joystick steruje przechyłem i nosem (na koniu jazdą i skrętem), a przyciski <b>Gaz +</b> i <b>Gaz −</b> po prawej zmieniają obroty; koń, smok i czerw mają zamiast nich przycisk <b>Skok</b>, <b>Ogień</b> albo <b>Wyskok</b>.</li>
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
          <li>Kategoria <b>Konstrukcja</b> (ściana działowa, drzwi, schody) jest dostępna we wnętrzu i na planszy — na planszy służy budynkom z wnętrzem w miejscu. To zwykłe obiekty — można je przesuwać, cofać i usuwać jak wszystko inne. Lampy sufitowe („Lampa sufitowa” w Oświetleniu) też są obiektami: stoją na podłodze piętra, a świecą pod jego sufitem. W Wyposażeniu są obrazy (każdy z innym płótnem), popiersie, kominek, fotel, sofa, łóżko, biurko, kredens, zegar, lustro, wazon, zasłony, globus i naczynia — z nich zbudowane są zestawy: salon, kuchnia, jadalnia, sypialnia, gabinet, kącik czytelniczy. Kuchnia ma własny piec i szafki z blatem. Regał ma tomy ze złoconymi grzbietami i tytułami, ułożone w każdym regale inaczej (stojące, pochylone, w stosach); „Książki” to stos z otwartą księgą.</li>
          <li><b>Ścianę działową</b> rysujesz dwoma kliknięciami: pierwsze wskazuje początek, drugie koniec (można też przeciągnąć). Końce przyciągają się do siatki, innych ścianek i ścian pokoju, a kąt do wielokrotności 15°. Z <kbd>Shift</kbd> kolejna ścianka zaczyna się tam, gdzie skończyła poprzednia; <kbd>Esc</kbd> cofa początek albo kończy rysowanie.</li>
          <li><b>Drzwi</b> stawia się w ściance działowej — podgląd sam przyciąga się do jej osi, a ścianka dostaje otwór. <kbd>R</kbd> albo kółko myszy w trakcie stawiania (i przycisk „Zawiasy z drugiej strony" w panelu) zmienia stronę, w którą otwiera się skrzydło. Przesuwane drzwi jadą po ściance; usunięcie ścianki usuwa też jej drzwi.</li>
          <li>Gotowe <b>zestawy mebli</b> są w zakładce „Zestawy" obok Biblioteki. Są takie same w każdym budynku: salon, kuchnia, jadalnia, sypialnia, gabinet i kącik czytelniczy we wnętrzu, ogród na planszy. Kliknij „Postaw", przesuń podgląd i kliknij w scenie — zestaw powstaje jako jedna grupa, więc przesuwasz go w całości. Zestaw z tyłem (salon, kuchnia, sypialnia) sam ustawia się plecami do najbliższej ściany; kółko myszy obraca go ręcznie i wyłącza to przyciąganie. Zestaw niczego nie kasuje — dokłada, więc możesz w jednym wnętrzu wydzielić salon, kuchnię i gabinet jak w lofcie. Przycisk „Zapisz zaznaczenie jako zestaw" zachowuje własne rozmieszczenie do ponownego użycia.</li>
          <li>Drzwi (obiekt z Konstrukcji) otwierasz i zamykasz klawiszem <kbd>F</kbd> albo kliknięciem — zamknięte blokują przejście, otwarte przepuszczają.</li>
          <li>Panel „Piętra" (zamiast planszy w Otoczeniu) ustawia liczbę kondygnacji budynku (1–4) i piętro do edycji. Schody postawione na danym piętrze robią w stropie otwór i prowadzą wyżej — w widoku z oczu wystarczy nimi wejść. Domek, pałac i biblioteka dostają przy pierwszym piętrze schody same: aplikacja szuka miejsca, w którym bieg mieści się przy ścianie razem z podejściem od dołu i podestem za szczytem, nie przecina ścianek ani mebli i nie zastawia drzwi. Schody są zwykłym obiektem — możesz je przesunąć albo usunąć. Zmniejszenie liczby pięter zabiera ze sobą bieg, który prowadziłby w sufit, razem z otworem w stropie; jedno cofnięcie przywraca piętro i schody naraz. Zablokuje Cię tylko własne wyposażenie stojące na znikającym piętrze — lampy i schody aplikacja sprząta sama. Wieża ma wbudowane kręcone schody wzdłuż muru jako jeden ciągły bieg przez wszystkie kondygnacje: parter to przedsionek, każde piętro to okrągła izba ze stropem wyciętym tylko nad schodami, a bieg idzie dalej w górę. Wnętrza są na tyle duże, by urządzić je jak prawdziwe pomieszczenia: domek to 10,4 × 9,6 m przy skali 2, pałac 11,2 × 9,8 m, biblioteka 10,2 × 9,5 m, wieża ma 10 m średnicy.</li>
          <li><b>Ścieżki</b> rysuje się jak ścianki — początek i koniec. Odcinki leżące w jednej linii, o tej samej szerokości i nawierzchni, scalają się w jeden obiekt: jeśli poprowadzisz ścieżkę po już narysowanej, nakładający się kawałek znika zamiast leżeć na wierzchu. Ciągi, które stykają się końcami, dostają wspólną grupę, więc przesuwają się i znikają razem — nawet jeśli rysowałeś je w różnych dniach. Odcinek, do którego przypisałeś wspomnienie, nigdy nie zniknie przy scalaniu.</li>
          <li>Budynek może mieć <b>piwnicę</b>: przycisk „+ Piwnica" w panelu budynku dokłada kondygnację pod ziemią (poziom −1) razem z lampami i schodami z parteru, a w płycie świata wycina otwór, żeby dało się tam zejść. Piwnica nie ma okien ani balkonów — jest pod ziemią, a teren i płyta świata są pod nią wycięte, żeby dało się zejść. Wybierak piętra dostaje wtedy pozycję „Piwnica"; wyłączenie zablokuje własne wyposażenie stojące na dole.</li>
          <li>Planszę można <b>narysować</b>: w Otoczeniu kliknij „Rysuj planszę" i przeciągnij po scenie — dokładasz kafle 4 × 4 m, z <kbd>Shift</kbd> je wymazujesz, <kbd>Esc</kbd> kończy. Dzięki temu plansza nie musi być prostokątem: może mieć kształt litery L, odnogi albo dziurę w środku. Kafla, na którym coś stoi, nie da się wymazać. „Wróć do kształtu" przywraca zwykły prostokąt, koło albo sześciokąt z suwakami.</li>
          <li>Budynek z wnętrzem w miejscu ma w panelu trzy wykończenia: podłogę wnętrza, ściany wnętrza i <b>elewację</b>. Elewacja to faktura muru z zewnątrz (tynk, cegła, klinkier, kamień, deski, beton, marmur albo Twój obraz); mnoży się przez kolor muru, więc kolor budynku dalej ustawiasz w Materiałach. Dach, kolumny i cokół zostają bez zmian.</li>
          <li>Kilka rzeczy aplikacja odradza wprost: kandelabra, pochodni ani latarni nie postawisz na stole, biurku, blacie, kredensie i regale (otwarty ogień nad papierami), książek nie położysz na biurku, a obrazu, lustra, zegara ani zasłon nie powiesisz na oknie. Podgląd robi się wtedy czerwony i nic nie powstaje, a przeciągnięty tam mebel spada na podłogę.</li>
          <li>Eksport pałacu dołącza Twoje własne zestawy; przy imporcie pliku możesz osobno wybrać, co zrobić z pałacem, a co z zestawami. Pliki i zapisy sprzed zestawów wczytują się dalej — dawne układy pokoi zamieniają się w zestawy.</li>
        </ul>
        <h3>Krajobraz i pogoda</h3>
        <ul>
          <li>Przycisk <b>Otoczenie</b> (prawy górny róg sceny) ustawia porę dnia, pogodę (deszcz, śnieg, mgła, burza) i rodzaj krajobrazu wokół planszy. Przyciskiem obok wylosujesz nowe ukształtowanie terenu.</li>
          <li>Kategoria <b>Krajobraz</b> w bibliotece zawiera góry, wulkan, głazy, wzgórza i wodę do postawienia na planszy.</li>
          <li><b>Jakość obrazu</b> (na dole tego samego panelu) dobiera się sama do sprzętu: na telefonie i tablecie maksymalna (pełna gęstość pikseli ekranu, największa mapa cienia, bez obniżania w locie), na komputerze wysoka. Możesz ją narzucić ręcznie — niska wyłącza cienie i rysuje w rozdzielczości logicznej ekranu. Poniżej maksymalnej, gdy obraz zaczyna się ciąć, rozdzielczość obniża się sama i wraca, kiedy jest lżej.</li>
          <li>Na dużej planszy pełnej obiektów świeci naraz tylko kilka <b>latarni i lamp</b> najbliższych kamerze (im wyższa jakość, tym więcej) — każde światło kosztuje w każdym pikselu obrazu. Dalsze gasną płynnie, więc idąc nocą widzisz, jak zapalają się przed Tobą.</li>
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
          <li><b>Pad działa też w VR</b> — w trybie stereo tak samo jak w spacerze, a w goglach równolegle z kontrolerami (prawa gałka obraca skokowo o 30°, jak kontroler; płynny obrót w goglach przyprawia o mdłości).</li>
          <li>Przełączanie <b>Z oczu</b> ↔ <b>VR</b> nie odsyła na punkt startu — zostajesz tam, gdzie stałeś. Na punkt startu trafiasz tylko, wchodząc do świata z edytora.</li>
          <li>Do <b>samolotu</b> wsiądziesz także w trybie stereo. W goglach nie: tam wysokość głowy podaje headset, więc nie usiadłbyś na fotelu, tylko stanął nad nim.</li>
        </ul>
        <h3>Nowy pałac</h3>
        <ul>
          <li>Przycisk z nazwą pałacu u góry (na telefonie: menu) rozwija listę pałaców i „Nowy pałac”. W oknie podajesz nazwę i wybierasz zawartość.</li>
          <li><b>Pusta plansza</b> to sama łąka 40 × 40 m. <b>Wioska w dolinie</b> to gotowa osada na planszy 80 × 80 m: brama, droga przez rynek ze studnią prosto do dworu, aleja cyprysów, biblioteka, wieża widokowa, kapliczka, trzy chaty, staw z altaną, sad, obozowisko przy lesie, a dookoła las, wzgórza, wodospad i góry. Do wszystkich budynków da się wejść — wystarczy dopisywać wspomnienia.</li>
        </ul>
        <h3>Zapis i przenoszenie</h3>
        <p>Wszystko zapisuje się automatycznie w tej przeglądarce (localStorage). <b>Eksportuj</b> tworzy plik JSON, a <b>Importuj</b> wczytuje go na innym urządzeniu.</p>
      </div>
    </div>
  );
}
