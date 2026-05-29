/**
 * pwa-icon  — Sirve el ícono PWA del tenant con cabeceras CORS correctas.
 *
 * GET /.netlify/functions/pwa-icon?tenant=xxx&size=512
 *
 * 1. Lee el logoUrl del tenant desde Firestore REST API.
 * 2. Hace fetch de esa imagen y la reenvía con Access-Control-Allow-Origin: *
 *    → esto permite que el Canvas del cliente la dibuje sin tainting.
 * 3. Si el tenant no tiene logo, devuelve el SVG por defecto.
 *
 * El resultado se cachea en el CDN de Netlify 6 horas (s-maxage=21600).
 */

const DEFAULT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="96" fill="#2e5e3e"/>
  <rect x="116" y="240" width="280" height="196" rx="6" fill="#c8d9a8"/>
  <polygon points="88,248 256,112 424,248" fill="#a8c278"/>
  <rect x="210" y="300" width="92" height="136" rx="8" fill="#2e5e3e"/>
  <rect x="140" y="274" width="52" height="44" rx="5" fill="#2e5e3e" opacity=".7"/>
  <rect x="140" y="338" width="52" height="44" rx="5" fill="#2e5e3e" opacity=".7"/>
  <rect x="320" y="274" width="52" height="44" rx="5" fill="#2e5e3e" opacity=".7"/>
  <rect x="320" y="338" width="52" height="44" rx="5" fill="#2e5e3e" opacity=".7"/>
  <rect x="248" y="78" width="8" height="64" fill="#c8d9a8"/>
  <polygon points="256,82 256,118 302,100" fill="#ffffff" opacity=".9"/>
</svg>`;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, s-maxage=21600, max-age=3600',
  'Vary': 'Accept'
};

/**
 * Extrae el tenantId del parámetro ?tenant= o del header Referer/Origin.
 * El hostname de la app tiene la forma:  tenantId.bitacorapp.cl
 */
function extractTenant(event) {
  const params = event.queryStringParameters || {};
  if (params.tenant) return params.tenant.trim().toLowerCase();

  /* Intentar desde el Referer */
  const referer = (event.headers && event.headers.referer) || '';
  const origin  = (event.headers && event.headers.origin)  || '';
  const source  = referer || origin;
  try {
    const host = new URL(source).hostname; // ej: "liceo01.bitacorapp.cl"
    const parts = host.split('.');
    if (parts.length >= 3 && parts[1] === 'bitacorapp') return parts[0];
  } catch (_) {}

  return null;
}

/**
 * Consulta Firestore REST para obtener el logoUrl y colorPrimario del tenant.
 */
async function getTenantData(tenantId) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const apiKey    = process.env.FIREBASE_API_KEY;
  if (!projectId || !apiKey) return null;

  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/tenants/${tenantId}?key=${apiKey}&mask.fieldPaths=logoUrl&mask.fieldPaths=colorPrimario&mask.fieldPaths=nombre`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const json = await res.json();
    const fields = json.fields || {};
    return {
      logoUrl      : fields.logoUrl?.stringValue      || '',
      colorPrimario: fields.colorPrimario?.stringValue || '#2e5e3e',
      nombre       : fields.nombre?.stringValue        || ''
    };
  } catch (_) {
    return null;
  }
}

export const handler = async (event) => {
  /* Preflight CORS */
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  const tenantId = extractTenant(event);
  const data     = tenantId ? await getTenantData(tenantId) : null;
  const logoUrl  = data?.logoUrl || '';

  /* ── Sin logo → devolver SVG por defecto ── */
  if (!logoUrl) {
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'image/svg+xml' },
      body: DEFAULT_SVG
    };
  }

  /* ── Con logo → hacer proxy de la imagen ── */
  try {
    const imgRes = await fetch(logoUrl, {
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'Bitacorapp-PWA-Icon/1.0' }
    });

    if (!imgRes.ok) throw new Error('upstream ' + imgRes.status);

    const contentType = imgRes.headers.get('content-type') || 'image/png';
    const buffer      = await imgRes.arrayBuffer();
    const base64      = Buffer.from(buffer).toString('base64');

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': contentType },
      body: base64,
      isBase64Encoded: true
    };
  } catch (err) {
    console.error('[pwa-icon] Error proxying logo:', err.message);
    /* Fallback al SVG por defecto */
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'image/svg+xml' },
      body: DEFAULT_SVG
    };
  }
};
