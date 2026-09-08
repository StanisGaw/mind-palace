import { defineConfig } from 'vitest/config';

// Testy układów: czysta geometria z `src/lib`, bez przeglądarki i Three.js.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
