import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'coverage/**',
      'dist/**',
      '.artifacts/**',
      'docs/frontend/**',
      'frontend/**',
      'load-tests/**',
      'node_modules/**',
      'packages/**',
      'src/generated/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports' },
      ],
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: true },
      ],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { arguments: false } },
      ],
      '@typescript-eslint/no-extraneous-class': [
        'error',
        { allowWithDecorator: true },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    extends: [tseslint.configs.disableTypeChecked],
    files: ['**/*.{js,mjs,cjs}'],
  },
  {
    files: [
      'src/modules/**/domain/**/*.ts',
      'src/modules/**/application/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@nestjs/**',
                '@prisma/**',
                'chess.js',
                'ioredis',
                'socket.io',
              ],
              message:
                'Domain/application code must depend on ports, not framework or infrastructure packages.',
            },
          ],
        },
      ],
    },
  },
  eslintConfigPrettier,
);
