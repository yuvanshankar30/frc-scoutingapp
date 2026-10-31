// Lint rules for the app (npm run lint). Formatting is Prettier's job (npm run format), so this
// only catches real mistakes: undefined names, unused code, and Svelte-specific problems.
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

export default [
  {
    ignores: ['.svelte-kit/', 'build/', 'node_modules/', 'static/', 'supabase/', 'docs/']
  },
  js.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Input sanitizers match control characters on purpose, to reject or strip them.
      'no-control-regex': 'off',
      // Svelte's own checks run in svelte-check; these overlap or fight the codebase's patterns.
      'svelte/no-at-html-tags': 'off',
      'svelte/valid-compile': 'off'
    }
  },
  {
    files: ['**/*.test.js'],
    languageOptions: { globals: { ...globals.vitest } }
  }
];
