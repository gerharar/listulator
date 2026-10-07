// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    // docs/ holds Claude Design handoffs with their own bundled JS: reference, not app code.
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/target/**', 'docs/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      // Named exports only — keeps adapters and strategies greppable as they grow.
      // See SPEC.md §9.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message: 'Use named exports (SPEC.md §9).',
        },
      ],
    },
  },
  {
    // The isolation hook is a plain browser script that Tauri inlines into the isolation frame: no modules, the frame's globals.
    files: ['apps/desktop/isolation/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { window: 'readonly', console: 'readonly', URL: 'readonly' } },
  },
  {
    // Tooling config files must default-export; the named-exports rule is for
    // application code.
    files: ['**/*.config.js', '**/*.config.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
)
