// @ts-check
// Next 16 menghapus perintah `next lint`, jadi ESLint dikonfigurasi eksplisit di
// sini (flat config) dan dijalankan lewat `npm run lint --workspace frontend`.
//
// File ini sengaja CommonJS: `frontend/package.json` tidak memakai
// `"type": "module"` (berbeda dari packages/shared dan backend), dan
// `eslint-config-next` juga dipublikasikan sebagai CommonJS.
const js = require('@eslint/js');
const nextCoreWebVitals = require('eslint-config-next/core-web-vitals');
const nextTypeScript = require('eslint-config-next/typescript');
const prettier = require('eslint-config-prettier');

module.exports = [
  { ignores: ['.next/', 'next-env.d.ts', 'node_modules/'] },
  js.configs.recommended,
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    // Versi React ditulis eksplisit, bukan 'detect': auto-detect eslint-plugin-react
    // 7.x masih memanggil context.getFilename() yang sudah dihapus di ESLint 10.
    settings: { react: { version: '19.3' } },
  },
  {
    // File config CommonJS: `require()` memang satu-satunya cara memuat
    // eslint-config-next di sini, jadi aturan ESM-only dimatikan untuk file ini.
    files: ['eslint.config.js', 'postcss.config.mjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
    languageOptions: { globals: { module: 'writable', require: 'readonly' } },
  },
  // Terakhir: mematikan aturan yang bentrok dengan Prettier (formatting repo).
  prettier,
];
