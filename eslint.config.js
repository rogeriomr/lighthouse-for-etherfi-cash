// ESLint (flat config). Regra da casa: as regras de hooks do React são erro (quebram o app de verdade);
// todo o resto é aviso, para orientar sem travar ninguém. O tipo continua sendo checado pelo tsc (npm run typecheck).
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/** Rebaixa para aviso toda regra ligada de um preset (mantém as opções da regra). */
const asWarnings = (configs) =>
  configs.map((config) => ({
    ...config,
    rules: Object.fromEntries(
      Object.entries(config.rules ?? {}).map(([name, value]) => {
        const [severity, ...options] = Array.isArray(value) ? value : [value];
        const off = severity === 'off' || severity === 0;
        return [name, off ? value : ['warn', ...options]];
      }),
    ),
  }));

/** Todas as regras do preset recomendado de hooks, como erro. */
const hooksAsErrors = Object.fromEntries(
  Object.keys(reactHooks.configs.flat.recommended.rules).map((name) => [name, 'error']),
);

export default defineConfig(
  { ignores: ['dist/', 'node_modules/', 'fixtures/', 'coverage/'] },
  asWarnings(tseslint.configs.recommended),
  {
    // parâmetro com "_" na frente é de propósito (assinatura fixa de callback)
    rules: { '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: hooksAsErrors,
  },
  {
    linterOptions: { reportUnusedDisableDirectives: 'warn' },
  },
);
