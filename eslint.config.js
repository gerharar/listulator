// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'],
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
    // Tooling config files must default-export; the named-exports rule is for
    // application code.
    files: ['**/*.config.js', '**/*.config.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
)
