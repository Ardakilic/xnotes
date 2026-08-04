import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['.output/**', '.wxt/**', 'node_modules/**', 'package-lock.json', 'demo/dist/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['**/*.mjs', 'docker/**/*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/**/*.ts', 'entrypoints/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='chrome']",
          message: 'Use the promise-based browser.* API from wxt/browser instead of chrome.*',
        },
      ],
    },
  },
];
