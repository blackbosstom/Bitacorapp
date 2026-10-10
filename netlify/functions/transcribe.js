/**
 * transcribe — Proxy seguro hacia Groq Speech-to-Text (Whisper).
 *
 * La API key vive SOLO en el servidor (GROQ_API_KEY). El cliente envía un WAV
 * en base64 y recibe { text }. NO se persiste audio ni texto.
 *
 * POST /api/transcribe
 * Body JSON: { audio: "<base64 wav>", language?: "es" }
 * 200: { text }
 * 4xx/5xx: { error: { message } }
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};
const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODELO = 'whisper-large-v3-turbo';
const TIMEOUT_MS = 28000;

function _err(statusCode, message) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify({ error: { message } }) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST')   return _err(405, 'metodo_no_permitido');

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return _err(400, 'JSON inválido'); }

  const b64 = typeof body.audio === 'string' ? body.audio : '';
  if (!b64) return _err(400, 'Falta "audio" (base64).');

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return _err(500, 'config_servidor: falta GROQ_API_KEY');

  let buf;
  try { buf = Buffer.from(b64, 'base64'); }
  catch { return _err(400, 'audio base64 inválido'); }
  if (!buf.length) return _err(400, 'audio vacío');

  const language = typeof body.language === 'string' ? body.language : 'es';

  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'audio/wav' }), 'audio.wav');
  form.append('model', MODELO);
  form.append('language', language);
  form.append('response_format', 'json');
  form.append('temperature', '0');

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey },
      body: form,
      signal: ctrl.signal,
    });
    const text = await resp.text();
    if (!resp.ok) {
      let detalle = text ? text.slice(0, 200) : ('HTTP ' + resp.status);
      try { const ej = JSON.parse(text); detalle = (ej.error && (ej.error.message || JSON.stringify(ej.error))) || detalle; } catch (_) {}
      const code = resp.status === 429 ? 429 : (resp.status >= 500 ? 503 : resp.status);
      return _err(code, detalle);
    }
    let out = {};
    try { out = JSON.parse(text); } catch (_) {}
    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ text: (out && out.text) || '' }) };
  } catch (e) {
    return _err(503, e && e.name === 'AbortError' ? 'timeout' : ('error de red: ' + (e && e.message || 'desconocido')));
  } finally {
    clearTimeout(t);
  }
};
