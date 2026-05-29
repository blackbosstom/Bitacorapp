/**
 * pwa-manifest — Devuelve el Web App Manifest dinámico del tenant.
 *
 * GET /.netlify/functions/pwa-manifest?tenant=xxx
 *
 * A diferencia del manifest estático o los Blob URLs generados en el cliente,
 * este endpoint es una URL real que iOS Safari puede leer correctamente
 * y que permite la instalación como PWA en todos los navegadores.
 *
 * Los iconos apuntan a /.netlify/functions/pwa-icon?tenant=xxx
 * que hace de proxy CORS de la imagen real del colegio.
 *
 * Cacheable 6 horas en CDN, 1 hora en cliente.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/manifest+json',
  'Cache-Control': 'public, s-maxage=21600, max-age=3600'
};

function extractTenant(event) {
  const params = event.queryStringParameters || {};
  if (params.tenant) return params.tenant.trim().toLowerCase();

  const referer = (event.headers && event.headers.referer) || '';
  const origin  = (event.headers && event.headers.origin)  || '';
  const source  = referer || origin;
  try {
    const host  = new URL(source).hostname;
    const parts = host.split('.');
    if (parts.length >= 3 && parts[1] === 'bitacorapp') return parts[0];
  } catch (_) {}

  return null;
}

async function getTenantData(tenantId) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const apiKey    = process.env.FIREBASE_API_KEY;
  if (!projectId || !apiKey) return null;

  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/tenants/${tenantId}?key=${apiKey}&mask.fieldPaths=nombre&mask.fieldPaths=shortName&mask.fieldPaths=colorPrimario&mask.fieldPaths=colorFondo&mask.fieldPaths=logoUrl`;

  try {
    const res  = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const json = await res.json();
    const f    = json.fields || {};
    return {
      nombre       : f.nombre?.stringValue        || 'Convivencia Escolar',
      shortName    : f.shortName?.stringValue      || '',
      colorPrimario: f.colorPrimario?.stringValue  || '#2e5e3e',
      colorFondo   : f.colorFondo?.stringValue     || '#fafaf7',
      logoUrl      : f.logoUrl?.stringValue        || ''
    };
  } catch (_) {
    return null;
  }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  const tenantId = extractTenant(event);

  /* Datos del tenant (con fallbacks si no existe o falla Firebase) */
  const d = (tenantId ? await getTenantData(tenantId) : null) || {};
  const nombre       = d.nombre        || 'Convivencia Escolar';
  const shortName    = d.shortName     || nombre.substring(0, 12);
  const colorPrimario= d.colorPrimario || '#2e5e3e';
  const colorFondo   = d.colorFondo    || '#fafaf7';

  /* Base URL del site — se reconstruye desde el Referer o se usa el origen de la función */
  const origin = process.env.URL || 'https://bitacorapp.cl';

  /* URL del icono dinámico — apunta a la función proxy */
  const iconBase = tenantId
    ? `/.netlify/functions/pwa-icon?tenant=${encodeURIComponent(tenantId)}`
    : `/icons/icon.svg`;

  const manifest = {
    name            : `${nombre} — Bitacorapp`,
    short_name      : shortName,
    description     : `Sistema de Convivencia Escolar — ${nombre}`,
    start_url       : '/',
    scope           : '/',
    display         : 'standalone',
    orientation     : 'portrait-primary',
    background_color: colorFondo,
    theme_color     : colorPrimario,
    lang            : 'es',
    categories      : ['education', 'productivity'],
    icons           : [
      {
        src    : iconBase,
        sizes  : '192x192',
        type   : 'image/png',
        purpose: 'any'
      },
      {
        src    : iconBase,
        sizes  : '512x512',
        type   : 'image/png',
        purpose: 'any maskable'
      },
      /* Icono SVG estático como respaldo universal */
      {
        src    : '/icons/icon.svg',
        sizes  : 'any',
        type   : 'image/svg+xml',
        purpose: 'any'
      }
    ],
    shortcuts: [
      {
        name     : 'Protocolos',
        url      : '/#protocolos',
        icons    : [{ src: iconBase, sizes: '96x96' }]
      },
      {
        name     : 'Nuevo Registro',
        url      : '/#fichas',
        icons    : [{ src: iconBase, sizes: '96x96' }]
      }
    ]
  };

  return {
    statusCode: 200,
    headers   : CORS_HEADERS,
    body      : JSON.stringify(manifest)
  };
};
