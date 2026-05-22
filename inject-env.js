#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════
 *  SGCE — inject-env.js
 *  Script de build: reemplaza los placeholders __NOMBRE__
 *  en public/index.html con las variables de entorno de Netlify.
 *  Se ejecuta automáticamente antes del deploy (ver netlify.toml).
 * ═══════════════════════════════════════════════════════════
 */

const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'public', 'index.html');

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

// Variables OPCIONALES — si no están, se deja el placeholder (no rompe el build)
const OPTIONAL = {
  '__GEMINI_API_KEY__': 'GEMINI_API_KEY',
};

// ── Leer archivo ────────────────────────────────────────────
let html;
try {
  html = fs.readFileSync(FILE, 'utf8');
} catch (err) {
  console.error(`[inject-env] ❌ No se pudo leer ${FILE}:`, err.message);
  process.exit(1);
}

// ── Reemplazar obligatorias ──────────────────────────────────
const missing = [];

for (const [placeholder, envVar] of Object.entries(REQUIRED)) {
  const value = process.env[envVar];
  if (!value) {
    missing.push(envVar);
    continue;
  }
  const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  html = html.replace(new RegExp(escaped, 'g'), value);
}

if (missing.length > 0) {
  console.error(
    '[inject-env] ❌ Faltan variables obligatorias en Netlify:\n  ' +
    missing.join('\n  ') +
    '\n\nConfigúralas en: Netlify → Site configuration → Environment variables'
  );
  process.exit(1);
}

// ── Reemplazar opcionales (advertencia si faltan) ────────────
for (const [placeholder, envVar] of Object.entries(OPTIONAL)) {
  const value = process.env[envVar];
  if (!value) {
    console.warn(`[inject-env] ⚠️  ${envVar} no configurada — la funcionalidad asociada estará desactivada.`);
    continue;
  }
  const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  html = html.replace(new RegExp(escaped, 'g'), value);
}

// ── Escribir resultado ──────────────────────────────────────
try {
  fs.writeFileSync(FILE, html, 'utf8');
} catch (err) {
  console.error(`[inject-env] ❌ No se pudo escribir ${FILE}:`, err.message);
  process.exit(1);
}

console.log('[inject-env] ✅ Variables inyectadas correctamente en index.html');
