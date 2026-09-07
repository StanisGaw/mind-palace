---
name: eq-knowledge
description: Baza wiedzy o projekcie Mneme — stack, warstwy, nazewnictwo, pułapki Three.js i sposób weryfikacji zmian. Wczytaj przed planowaniem, wdrażaniem i przeglądem kodu.
---

# Wiedza o projekcie Mneme

Mneme to edytor pałacu pamięci 3D działający w całości w przeglądarce. Brak backendu,
brak logowania, brak zewnętrznych zasobów graficznych — wszystkie modele są proceduralne.

## Instrukcje szczegółowe

| Plik | Kiedy czytać |
|---|---|
| `instructions/stack.md` | zawsze na starcie |
| `instructions/layers.md` | przed dodaniem pliku albo importu |
| `instructions/naming.md` | przed nazwaniem pliku, typu lub funkcji |
| `instructions/three-pitfalls.md` | przed każdą zmianą w `src/three/` |
| `instructions/verification.md` | przed zgłoszeniem, że zmiana działa |
| `instructions/git-workflow.md` | przed commitem i pushem |

## Skrót najważniejszych zasad

1. **Interfejs jest po polsku**, identyfikatory w kodzie po angielsku.
2. **Nie ma testów jednostkowych ani lintera.** Weryfikacja to `npx tsc --noEmit`,
   `npm run build` i zrzut ekranu z przeglądarki.
3. **Każdy zasób Three.js utworzony w kodzie musi być zwolniony** w odpowiedniej metodzie
   sprzątającej — inaczej przełączanie scen wycieka pamięcią.
4. **Migracje danych żyją wyłącznie w `normalizePalace`** (`src/lib/storage.ts`) i muszą być
   idempotentne.
5. **Komentarz tłumaczy powód, nie treść linijki.** Jeśli linijka jest oczywista, nie komentuj.
