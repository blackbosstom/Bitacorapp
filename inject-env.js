#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════
 *  SGCE — inject-env.js
 *  Script de build: genera public/firebase-config.js con los
 *  valores reales de las variables de entorno de Netlify.
 *
 *  ¿Por qué este enfoque?
 *  Netlify secrets-scan escanea TODOS los archivos del output.
 *  Si inyectamos los valores directamente en los HTML, el scan
 *  los detecta y falla el deploy. En cambio, concentramos los
 *  valores en UN solo archivo JS generado y lo excluimos del
 *  scan vía SECRETS_SCAN_OMIT_PATHS en netlify.toml.
 *
 *  Los HTML cargan ese archivo como:
 *    <script src="/firebase-config.js"></script>
 *  y acceden a window.FIREBASE_CONFIG (objeto global).
 * ═══════════════════════════════════════════════════════════
 */

const fs   = require('fs');
const path = require('path');

// ── Variables OBLIGATORIAS — el build falla si no están ─────
const REQUIRED = {
  FIREBASE_API_KEY:             process.env.FIREBASE_API_KEY,
  FIREBASE_AUTH_DOMAIN:         process.env.FIREBASE_AUTH_DOMAIN,
  FIREBASE_PROJECT_ID:          process.env.FIREBASE_PROJECT_ID,
  FIREBASE_STORAGE_BUCKET:      process.env.FIREBASE_STORAGE_BUCKET,
  FIREBASE_MESSAGING_SENDER_ID: process.env.FIREBASE_MESSAGING_SENDER_ID,
  FIREBASE_APP_ID:              process.env.FIREBASE_APP_ID,
  FIREBASE_MEASUREMENT_ID:      process.env.FIREBASE_MEASUREMENT_ID,
};

// Keys en el formato que espera el SDK de Firebase
const FIREBASE_CONFIG = {
  apiKey:            process.env.FIREBASE_API_KEY,
  authDomain:        process.env.FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.FIREBASE_PROJECT_ID,
  storageBucket:     process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.FIREBASE_APP_ID,
  measurementId:     process.env.FIREBASE_MEASUREMENT_ID,
};

// ── Variables OPCIONALES — advertencia si faltan ─────────────
const OPTIONAL = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
};

// ── Verificar obligatorias ───────────────────────────────────
const missing = Object.entries(REQUIRED)
  .filter(([, v]) => !v)
  .map(([k]) => k);

if (missing.length > 0) {
  console.error(
    '[inject-env] ❌ Faltan variables obligatorias en Netlify:\n  ' +
    missing.join('\n  ') +
    '\n\nConfigúralas en: Netlify → Site configuration → Environment variables'
  );
  process.exit(1);
}

Object.entries(OPTIONAL).forEach(([k, v]) => {
  if (!v) console.warn(`[inject-env] ⚠️  ${k} no configurada — funcionalidad asociada desactivada.`);
});

// ── Generar public/firebase-config.js ───────────────────────
//    Este archivo es excluido del secrets-scan via netlify.toml:
//    SECRETS_SCAN_OMIT_PATHS = "public/firebase-config.js,..."
const outPath = path.join(__dirname, 'public', 'firebase-config.js');

const configJS = `/* AUTO-GENERADO por inject-env.js — no editar manualmente */
window.FIREBASE_CONFIG = ${JSON.stringify(FIREBASE_CONFIG, null, 2)};
${OPTIONAL.GEMINI_API_KEY ? `window.GEMINI_API_KEY = ${JSON.stringify(OPTIONAL.GEMINI_API_KEY)};` : '/* GEMINI_API_KEY no configurada */'}
`;

try {
  fs.writeFileSync(outPath, configJS, 'utf8');
  console.log('[inject-env] ✅ public/firebase-config.js generado correctamente.');
} catch (err) {
  console.error('[inject-env] ❌ No se pudo escribir firebase-config.js:', err.message);
  process.exit(1);
}

// ── Verificar que los HTML referencian el script ─────────────
//    (Aviso útil durante migración)
const publicDir = path.join(__dirname, 'public');
const htmlFiles = fs.readdirSync(publicDir, { recursive: true })
  .filter(f => f.endsWith('.html'))
  .map(f => path.join(publicDir, f));

let warned = false;
for (const file of htmlFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const hasScript  = content.includes('firebase-config.js');
  const hasOldKey  = content.includes('__FIREBASE_API_KEY__');

  if (hasOldKey) {
    console.warn(
      `[inject-env] ⚠️  ${path.relative(__dirname, file)} aún tiene placeholders __FIREBASE_*__.\n` +
      `             Reemplázalos por window.FIREBASE_CONFIG (ver README de migración).`
    );
    warned = true;
  }

  if (!hasScript && content.includes('initializeApp')) {
    console.warn(
      `[inject-env] ⚠️  ${path.relative(__dirname, file)} usa Firebase pero no carga /firebase-config.js.`
    );
    warned = true;
  }
}

if (!warned) {
  console.log('[inject-env] ✅ Todos los HTML están correctamente configurados.');
}

console.log('[inject-env] ✅ Build listo.');
