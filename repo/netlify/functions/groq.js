/**
 * ═══════════════════════════════════════════════════════════
 *  SGCE — Netlify Function: /api/groq
 *  Proxy seguro para la API de Groq.
 *  La GROQ_API_KEY nunca llega al cliente.
 * ═══════════════════════════════════════════════════════════
 */

const GROQ_API_URL  = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama3-8b-8192';  // Cambia según tu plan

// ── Dominios permitidos (CORS) ──────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

// ── Límite de tamaño del body (10 KB) ──────────────────────
const MAX_BODY_BYTES = 10 * 1024;

// ── Helper: respuesta de error ──────────────────────────────
function errorResponse(statusCode, message, origin) {
  return {
    statusCode,
    headers: corsHeaders(origin),
    body: JSON.stringify({ error: message }),
  };
}

// ── Helper: cabeceras CORS ──────────────────────────────────
function corsHeaders(origin) {
  const allowed =
    ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)
      ? origin || '*'
      : '';

  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowed || 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
}

exports.handler = async function (event) {
  const origin = event.headers['origin'] || event.headers['Origin'] || '';

  // ── Preflight CORS ──────────────────────────────────────
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(origin), body: '' };
  }

  // ── Solo POST ───────────────────────────────────────────
  if (event.httpMethod !== 'POST') {
    return errorResponse(405, 'Method Not Allowed', origin);
  }

  // ── Verificar API key configurada ───────────────────────
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error('[groq] GROQ_API_KEY no configurada en variables de entorno.');
    return errorResponse(500, 'Servicio no configurado', origin);
  }

  // ── Límite de tamaño ────────────────────────────────────
  const bodyStr = event.body || '';
  if (Buffer.byteLength(bodyStr, 'utf8') > MAX_BODY_BYTES) {
    return errorResponse(413, 'Payload demasiado grande', origin);
  }

  // ── Parsear y validar body ──────────────────────────────
  let payload;
  try {
    payload = JSON.parse(bodyStr);
  } catch {
    return errorResponse(400, 'JSON inválido', origin);
  }

  const { messages, temperature, max_tokens } = payload;

  if (!Array.isArray(messages) || messages.length === 0) {
    return errorResponse(400, 'El campo "messages" es obligatorio', origin);
  }

  // Sanitizar: solo se permiten roles válidos
  const VALID_ROLES = new Set(['system', 'user', 'assistant']);
  for (const m of messages) {
    if (!VALID_ROLES.has(m.role) || typeof m.content !== 'string') {
      return errorResponse(400, 'Mensaje con role o content inválido', origin);
    }
    // Limitar largo de cada mensaje
    if (m.content.length > 8000) {
      return errorResponse(400, 'Mensaje demasiado largo (máx 8000 chars)', origin);
    }
  }

  // ── Construir request hacia Groq ─────────────────────────
  const groqBody = {
    model       : DEFAULT_MODEL,
    messages,
    temperature : typeof temperature === 'number'
      ? Math.min(Math.max(temperature, 0), 2)
      : 0.3,
    max_tokens  : typeof max_tokens === 'number'
      ? Math.min(Math.max(max_tokens, 100), 4096)
      : 1500,
  };

  // ── Llamada a Groq ──────────────────────────────────────
  let groqRes;
  try {
    groqRes = await fetch(GROQ_API_URL, {
      method  : 'POST',
      headers : {
        'Content-Type' : 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body    : JSON.stringify(groqBody),
    });
  } catch (err) {
    console.error('[groq] Error de red al contactar Groq:', err.message);
    return errorResponse(502, 'Error al contactar el servicio de IA', origin);
  }

  // ── Manejar errores de Groq ─────────────────────────────
  if (!groqRes.ok) {
    const errText = await groqRes.text().catch(() => '');
    console.error(`[groq] Groq respondió ${groqRes.status}:`, errText.slice(0, 200));
    // No re-exponer detalles al cliente
    return errorResponse(groqRes.status >= 500 ? 502 : groqRes.status,
      'Error en el servicio de IA', origin);
  }

  // ── Reenviar respuesta al cliente ────────────────────────
  const data = await groqRes.json();
  return {
    statusCode : 200,
    headers    : corsHeaders(origin),
    body       : JSON.stringify(data),
  };
};
