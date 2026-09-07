---
name: eq-pr-agent
description: Operacje gitowe w Mneme — gałęzie, commity tematyczne po polsku, push i pull requesty. Użyj, gdy trzeba zapisać pracę w repozytorium.
user-invocable: true
---

# Git

Wczytaj `.claude/skills/eq-knowledge/instructions/git-workflow.md`.

## Zanim cokolwiek zapiszesz

```bash
npx tsc --noEmit && npm run build
git status --short
```

Kod, który się nie kompiluje, nie trafia do repozytorium.

## Podział na commity

Dziel tematycznie, nie chronologicznie. W tym projekcie naturalne granice to:
model danych (`types`, `store`, `lib`), scena (`three`), interfejs (`components`, `styles`),
dokumentacja, skille. Jeden commit ma dać się opisać jednym zdaniem bez spójnika „oraz".

Dodawaj wybrane ścieżki (`git add src/three/`), nie `git add -A`.

## Treść commita

```
Krótki opis skutku zmiany

Akapit tłumaczący powód: jaki problem to rozwiązuje i jakie decyzje podjęto.
Bez wyliczania plików — to widać w różnicy.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

Po polsku, pierwsza linia do 72 znaków, bez kropki na końcu.

## Czego nie commitować

`node_modules/`, `dist/`, `.claude/settings.local.json`, pliki robocze i zrzuty testowe.

## Push i pull request

Rób je wyłącznie na wyraźną prośbę. Repozytorium `StanisGaw/mind-palace` jest prywatne.

```bash
gh pr create --title "..." --body "..."
```

Opis PR-a: co się zmienia i dlaczego, jak to sprawdzić, co pozostało niesprawdzone.
Stopka:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```
