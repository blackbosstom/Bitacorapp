#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════
 *  SGCE — inject-env.js
 *  Script de build: reemplaza los placeholders __NOMBRE__
 *  en los archivos HTML con las variables de entorno de Netlify.
 *  Se ejecuta automáticamente antes del deploy (ver netlify.toml).
 * ═══════════════════════════════════════════════════════════
 */

const fs   = require('fs');
const path = require('path');

// Archivos a procesar
const { globSync } = require('fs');

// Auto-descubrir todos los HTML bajo public/
const FILES = fs.readdirSync(path.join(__dirname, 'public'), { recursive: true })
  .filter(f => f.endsWith('.html'))
  .map(f => path.join(__dirname, 'public', f));

// Variables OBLIGATORIAS — el build falla si no están
const REQUIRED = {
  '__FIREBASE_API_KEY__'            : 'FIREBASE_API_KEY',
  '__FIREBASE_AUTH_DOMAIN__'        : 'FIREBASE_AUTH_DOMAIN',
  '__FIREBASE_PROJECT_ID__'         : 'FIREBASE_PROJECT_ID',
  '__FIREBASE_STORAGE_BUCKET__'     : 'FIREBASE_STORAGE_BUCKET',
  '__FIREBASE_MESSAGING_SENDER_ID__': 'FIREBASE_MESSAGING_SENDER_ID',
  '__FIREBASE_APP_ID__'             : 'FIREBASE_APP_ID',
  '__FIREBASE_MEASUREMENT_ID__'     : 'FIREBASE_MEASUREMENT_ID',
};

// Variables OPCIONALES — advertencia si faltan, no rompe el build
const OPTIONAL = {
  '__GEMINI_API_KEY__': 'GEMINI_API_KEY',
};

// ── Verificar variables obligatorias antes de tocar archivos ─
const missing = Object.entries(REQUIRED)
  .filter(([, envVar]) => !process.env[envVar])
  .map(([, envVar]) => envVar);

if (missing.length > 0) {
  console.error(
    '[inject-env] ❌ Faltan variables obligatorias en Netlify:\n  ' +
    missing.join('\n  ') +
    '\n\nConfigúralas en: Netlify → Site configuration → Environment variables'
  );
  process.exit(1);
}

// ── Procesar cada archivo ────────────────────────────────────
for (const FILE of FILES) {
  if (!fs.existsSync(FILE)) {
    console.warn(`[inject-env] ⚠️  Archivo no encontrado, se omite: ${FILE}`);
    continue;
  }

  let html;
  try {
    html = fs.readFileSync(FILE, 'utf8');
  } catch (err) {
    console.error(`[inject-env] ❌ No se pudo leer ${FILE}:`, err.message);
    process.exit(1);
  }

  // Reemplazar obligatorias
  for (const [placeholder, envVar] of Object.entries(REQUIRED)) {
    const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp(escaped, 'g'), process.env[envVar]);
  }

  // Reemplazar opcionales
  for (const [placeholder, envVar] of Object.entries(OPTIONAL)) {
    const value = process.env[envVar];
    if (!value) {
      console.warn(`[inject-env] ⚠️  ${envVar} no configurada — funcionalidad asociada desactivada.`);
      continue;
    }
    const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp(escaped, 'g'), value);
  }

  try {
    fs.writeFileSync(FILE, html, 'utf8');
    console.log(`[inject-env] ✅ ${path.basename(FILE)} procesado correctamente.`);
  } catch (err) {
    console.error(`[inject-env] ❌ No se pudo escribir ${FILE}:`, err.message);
    process.exit(1);
  }
}

console.log('[inject-env] ✅ Todos los archivos procesados.');
