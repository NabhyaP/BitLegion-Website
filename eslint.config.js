import js from '@eslint/js';
import ts from 'typescript-eslint';

export default [
  { ignores: ['**/dist/**', '**/node_modules/**'] },
  js.configs.recommended,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        document: 'readonly',
        process: 'readonly',
        sessionStorage: 'readonly',
        URL: 'readonly',
        window: 'readonly',
      },
    },
  },
  ...ts.configs.recommended,
];
