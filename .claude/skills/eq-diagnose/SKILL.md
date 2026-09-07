---
name: eq-diagnose
description: Uporządkowana diagnoza trudnych błędów w Mneme — sceny 3D, fizyki, trybów kamery i zapisu danych. Użyj przy błędzie wizualnym, zawieszeniu sceny albo regresji wydajności.
---

# Diagnoza

Kolejność faz jest obowiązkowa. Pominięcie fazy trzeba uzasadnić.

Wczytaj `.claude/skills/eq-knowledge/instructions/three-pitfalls.md` — większość
błędów w tym projekcie ma tam swój odpowiednik.

## Faza 1 — zbuduj pętlę zwrotną

Bez szybkiego, powtarzalnego sygnału „działa/nie działa" czytanie kodu nic nie da.
W tym projekcie pętlą jest zrzut z przeglądarki (`.claude/skills/eq-knowledge/instructions/verification.md`).

Kolejność prób:

1. **Zrzut z asercją** — `eval:` odczytujący stan zamiast oceniania obrazu na oko,
   np. `eval:JSON.stringify(__scene.rig.position.toArray())`
2. **Odczyt stanu magazynu** — `eval:__mneme.getState().palace().objects.length`
3. **Podgląd brył kolizji** — adres z `?physdebug=1`
4. **Log konsoli** — skrypt zrzutów zbiera `console` i `pageerror`; szukaj wyjątków
5. **Odtworzenie w izolacji** — mały fragment wywołujący samą funkcję z `lib/`

Gdy nie umiesz zbudować pętli: zatrzymaj się, wypisz, co próbowałeś, i poproś
użytkownika o kroki odtworzenia albo zrzut. Nie zgaduj przyczyny bez pętli.

## Faza 2 — odtwórz

- [ ] Objaw zgadza się z opisem użytkownika, a nie z podobnym błędem obok
- [ ] Powtarza się w kolejnych uruchomieniach
- [ ] Masz zapisany dokładny objaw (liczba, komunikat, zrzut)

## Faza 3 — hipotezy

Wypisz **3–5 hipotez uszeregowanych** od najbardziej prawdopodobnej. Każda musi być
falsyfikowalna: „jeśli przyczyną jest X, to Y sprawi, że objaw zniknie".

Typowe przyczyny w tym projekcie:
- zasób nie został zwolniony albo wpis obiektu nie został posprzątany
- podwójny montaż w StrictMode i wyścig z operacją asynchroniczną
- pomylona skala: użyto `scale.x` zamiast `hs(e)` albo `scale.y`
- stan sceny rozjechał się ze stanem magazynu (brak `seq` albo klucza porównania)
- migracja w `normalizePalace` nie jest idempotentna
- kolejność zdarzeń wskaźnika: faza przechwytywania kontra `OrbitControls`

## Faza 4 — sondowanie

Zmieniaj jedną rzecz naraz. Każdy log oznacz `[DEBUG-xxxx]`, żeby sprzątanie było
jednym `grep`. Dla wydajności najpierw zmierz (`renderer.info`, `performance.now()`).

## Faza 5 — naprawa

1. Zapisz pętlę z Fazy 1 jako polecenie, które ma przejść po naprawie
2. Zastosuj poprawkę
3. Uruchom pętlę i potwierdź zmianę objawu
4. `npx tsc --noEmit` oraz zrzuty regresji (edytor, z oczu, wnętrze, rzut z góry)

## Faza 6 — sprzątanie

- [ ] Pierwotny objaw nie występuje
- [ ] Wszystkie `[DEBUG-xxxx]` usunięte
- [ ] Pliki pomocnicze skasowane
- [ ] W opisie commita napisane, która hipoteza była trafna

Jeśli błąd ujawnił lukę w architekturze (brak miejsca na sprawdzenie, splątane moduły),
zanotuj to w podsumowaniu.
