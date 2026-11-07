import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'app/data/', 'app/assets/', '.shots/'] },
  js.configs.recommended,
  {
    files: ['app/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser } },
  },
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-cond-assign': ['error', 'except-parens'],
      'no-constant-condition': ['warn', { checkLoops: false }],
      'prefer-const': 'warn',
    },
  },
];
