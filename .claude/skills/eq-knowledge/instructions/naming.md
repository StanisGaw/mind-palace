# Nazewnictwo

- Pliki w `src/three/` i `src/lib/`: **camelCase** (`sceneManager` jest wyjątkiem historycznym
  jako `SceneManager.ts`, bo eksportuje klasę).
- Komponenty React: **PascalCase**, jeden komponent główny na plik.
- Typy i interfejsy: **PascalCase**; typy sumaryczne w liczbie pojedynczej (`Weather`, `Scenery`).
- Identyfikatory w katalogu obiektów: **snake_case dla punktów pojawiania** (`spawn_dog`),
  proste słowa dla reszty (`palace`, `lantern`).
- Klucze w localStorage: `mneme.<obszar>.v<numer>` (`mneme.data.v1`, `mneme.prefs.v1`).
- Teksty widoczne dla użytkownika: **po polsku**, bez skrótów, z polskimi znakami.
- Nazwy funkcji opisują skutek (`commitPlacement`, `snapAnchorUnder`), nie sposób działania.
