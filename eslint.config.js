import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import configPrettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    name: 'app/ignores',
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-ssr/**',
      '**/.nuxt/**',
      '**/.output/**',
      '**/.nitro/**',
      '**/.data/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  configPrettier,

  {
    name: 'app/shared-rules',
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },

  {
    name: 'app/vue-sfc',
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
      },
    },
  },

  {
    name: 'app/web',
    files: ['apps/web/**/*.{ts,mts,tsx,vue}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      // Nuxt авто-импортирует ref/computed/useFetch и компоненты: их отсутствие
      // ловит vue-tsc по типам из .nuxt, а no-undef только шумит.
      'no-undef': 'off',
    },
  },

  {
    name: 'app/web-nuxt-conventions',
    files: [
      'apps/web/app/app.vue',
      'apps/web/app/error.vue',
      'apps/web/app/pages/**/*.vue',
      'apps/web/app/layouts/**/*.vue',
    ],
    rules: {
      // Имена файлов страниц и лейаутов диктует роутинг Nuxt.
      'vue/multi-word-component-names': 'off',
    },
  },

  {
    name: 'app/api',
    files: ['apps/api/**/*.{ts,mts}'],
    languageOptions: {
      globals: { ...globals.node, Bun: 'readonly' },
    },
  },

  {
    name: 'app/configs',
    files: ['**/*.config.{js,ts,mjs,mts}', 'eslint.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
)
