import { defineConfig, globalIgnores } from 'eslint/config';
import eslintConfigPrettier from 'eslint-config-prettier';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  eslintConfigPrettier,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-globals': [
        'error',
        {
          message:
            'Use the typed API boundary instead of calling fetch directly.',
          name: 'fetch',
        },
        {
          message:
            'Guest credentials must never be stored in origin-wide localStorage.',
          name: 'localStorage',
        },
        {
          message: 'Guest credentials must never be stored in IndexedDB.',
          name: 'indexedDB',
        },
      ],
    },
  },
  {
    files: ['src/lib/api/api-fetch.ts'],
    rules: {
      'no-restricted-globals': 'off',
    },
  },
  globalIgnores([
    '.next/**',
    'coverage/**',
    'next-env.d.ts',
    'playwright-report/**',
    'storybook-static/**',
    'test-results/**',
  ]),
]);
