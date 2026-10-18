import { defineConfig } from 'vitest/config'

/**
 * The by-hand performance runs (Phase 25.8): the `*.perf.test.ts` files the normal config (`vite.config.ts`) leaves out.
 *   cd web && npx vitest run --config vitest.perf.config.ts
 */
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify('perf') },
  test: { include: ['src/**/*.perf.test.ts'], testTimeout: 15 * 60_000 },
})
