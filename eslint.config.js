import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig([
  globalIgnores(['dist', 'dist-preview', '**/lib', 'coverage', '.firebase', '**/node_modules']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{js,ts,tsx}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['lucide*', 'react-icons', 'react-icons/*', '@heroicons/*', '@tabler/icons*', '@iconify/*', 'phosphor-react', '*.svg'], message: 'UIアイコンは公式 @phosphor-icons/react のみを使用してください。' }] }],
      'no-restricted-syntax': ['error', { selector: 'JSXOpeningElement[name.name="svg"]', message: 'アイコンはPhosphorコンポーネントを使用してください。QRはQRCodeSVGで生成します。' }],
    },
  },
])
