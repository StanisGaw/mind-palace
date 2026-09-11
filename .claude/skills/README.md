# Skille projektu Mneme

Procedury pracy nad tym repozytorium, dostosowane do jego realiów: brak testów
jednostkowych i lintera, weryfikacja przez zrzuty z przeglądarki, scena 3D z trzema
trybami i danymi w localStorage.

Wywołanie: `/eq-<nazwa>` albo poproszenie o daną procedurę wprost.

## Baza

| Skill | Do czego |
|---|---|
| `eq-knowledge` | konwencje projektu: stack, warstwy, nazewnictwo, pułapki Three.js, weryfikacja, git |

Pozostałe skille czytają tę bazę, więc zmiany zasad wprowadzaj w `eq-knowledge/instructions/`.

## Przebieg zadania

| Skill | Kiedy |
|---|---|
| `eq-grill` | zadanie jest ogólne albo wieloznaczne |
| `eq-zoom-out` | wchodzisz w nieznany obszar kodu |
| `eq-planner` | zmiana obejmuje kilka warstw |
| `eq-plan-reviewer` | plan gotowy, przed pierwszą zmianą |
| `eq-implementer` | piszesz kod według planu |
| `eq-sanity-checker` | zaraz po wdrożeniu, szybka kontrola |
| `eq-code-reviewer` | przed commitem, pełniejszy przegląd |
| `eq-pr-agent` | commity, push, pull request |

## Zadania szczegółowe

| Skill | Do czego |
|---|---|
| `eq-create-object` | nowy element biblioteki (budynek, roślina, mebel, lampa, zwierzę) |
| `eq-create-scene-module` | nowy moduł sceny (efekt, cząsteczki, warstwa świata) |
| `eq-model-from-image` | nowy element ma przypominać konkretną rzecz ze zdjęcia |
| `eq-diagnose` | trudny błąd, regresja wydajności |

## Koniec sesji

| Skill | Do czego |
|---|---|
| `eq-handoff` | podsumowanie dla następnej sesji |
| `eq-retrospective` | wnioski i propozycje zmian w bazie wiedzy |

## Pochodzenie

Zestaw powstał z prywatnych skilli `eq-*` z konfiguracji Cursora. Oryginały opisują
inny stack (React Query, DTO, Next.js, Playwright, ADR-y). Tutaj zostały przepisane
pod Mneme: zamiast testów jednostkowych i lintera weryfikacją są zrzuty z przeglądarki,
zamiast warstw backendowych obowiązuje kolejność `types → lib → store → three → components`,
doszły pułapki Three.js i zasady zwalniania zasobów. Pominięto skille związane
z Linear, ADR-ami i tworzeniem plików backendowych, bo nie mają tu zastosowania.

`eq-model-from-image` powstał na podstawie [img2threejs](https://github.com/img2threejs/img2threejs)
(Apache-2.0): stamtąd pochodzi metoda — analiza obrazu warstwami, budowa etapami od bryły
do detalu, ocena każdego etapu z kilku kątów i ograniczona pętla poprawek. Pominięto całą
warstwę skryptów w Pythonie, plików ze specyfikacją, bramek liczbowych i ścieżki postaci
z rigiem: w Mneme rolę weryfikacji pełni zrzut z przeglądarki, a modele są proceduralne
i niskopoligonowe, więc porównanie pikseli ze zdjęciem nie miałoby czego mierzyć.
