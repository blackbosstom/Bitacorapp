/**
 * groq — Proxy seguro hacia la API de Groq (chat completions).
 *
 * La API key vive SOLO en el servidor (variable de entorno GROQ_API_KEY),
 * nunca se expone al cliente. El frontend llama a /api/groq (redirigido
 * por netlify.toml) con el mismo cuerpo que espera Groq/OpenAI.
 *
 * POST /api/groq
 * Body JSON: { model, messages, temperature, max_tokens }
 *
 * 200: { choices: [{ message: { content } }], ... }   (respuesta de Groq tal cual)
 * 400: { error: { message } }   — JSON inválido o faltan messages
 * 429: { error: { message } }   — límite de solicitudes
 * 503: { error: { message } }   — todos los modelos ocupados/agotados
 * 500: { error: { message } }   — error interno / falta config
 *
 * Si el modelo solicitado falla con 429/503/5xx, se reintenta con
 * modelos de respaldo antes de rendirse.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Modelos de respaldo (en orden) por si el solicitado está saturado.
const MODELOS_FALLBACK = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
];

// Timeout por intento de modelo (ms). El cliente espera ~28 s por modelo.
const TIMEOUT_MODELO_MS = 28000;

function _err(statusCode, message) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: { message } }),
  };
}

/** Llama a Groq con un modelo concreto y un timeout abortable. */
async function _llamarGroq(apiKey, payload, modelo) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MODELO_MS);
  try {
    const resp = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...payload, model: modelo }),
      signal: ctrl.signal,
    });
    const text = await resp.text();
    return { ok: resp.ok, status: resp.status, text };
  } finally {
    clearTimeout(t);
  }
}

exports.handler = async (event) => {
  // ── Preflight CORS ──
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return _err(405, 'metodo_no_permitido');
  }

  // ── Parsear cuerpo ──
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return _err(400, 'JSON inválido');
  }

  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || messages.length === 0) {
    return _err(400, 'Faltan "messages" en la solicitud.');
  }

  // ── API key (solo servidor) ──
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return _err(500, 'config_servidor: falta GROQ_API_KEY');
  }

  // ── Construir payload base (se mantienen los parámetros del cliente) ──
  const payload = {
    messages,
    temperature: typeof body.temperature === 'number' ? body.temperature : 0.4,
    max_tokens:  typeof body.max_tokens  === 'number' ? body.max_tokens  : 2048,
  };

  // ── Lista de modelos a intentar: el solicitado primero, luego respaldos ──
  const modelos = [];
  if (body.model) modelos.push(body.model);
  for (const m of MODELOS_FALLBACK) {
    if (!modelos.includes(m)) modelos.push(m);
  }

  let ultimoStatus = 503;
  let ultimoError  = 'todos los modelos están ocupados';

  for (const modelo of modelos) {
    let r;
    try {
      r = await _llamarGroq(apiKey, payload, modelo);
    } catch (e) {
      // Timeout o error de red: probar el siguiente modelo.
      ultimoStatus = 503;
      ultimoError  = (e && e.name === 'AbortError')
        ? 'timeout del modelo ' + modelo
        : 'error de red: ' + (e && e.message ? e.message : 'desconocido');
      continue;
    }

    if (r.ok) {
      // Éxito: reenviar la respuesta de Groq tal cual (formato OpenAI/Groq).
      return { statusCode: 200, headers: CORS_HEADERS, body: r.text };
    }

    // 429 (rate limit) y 5xx (saturación) → probar siguiente modelo.
    if (r.status === 429 || r.status >= 500) {
      ultimoStatus = r.status;
      let detalle = r.text ? r.text.slice(0, 200) : '';
      try {
        const ej = JSON.parse(r.text);
        detalle = (ej.error && (ej.error.message || JSON.stringify(ej.error))) || detalle;
      } catch (_) {}
      ultimoError = detalle || ('HTTP ' + r.status);
      continue;
    }

    // Otros errores (400/401/403…) son del cliente/config: devolver de inmediato.
    return { statusCode: r.status, headers: CORS_HEADERS, body: r.text };
  }

  // ── Ningún modelo respondió correctamente ──
  if (ultimoStatus === 429) return _err(429, ultimoError);
  return _err(503, ultimoError);
};
