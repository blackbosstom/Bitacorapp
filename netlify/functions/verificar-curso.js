/**
 * verificar-curso — Comprueba un certificado del curso por su código.
 *
 * POST /api/verificar-curso
 * Body JSON: { codigo }
 *
 * Hace un GET (no list) a curso_certificados/{codigo}. Como el ID del
 * documento es el código, solo se puede verificar conociéndolo; no se
 * puede enumerar la lista de participantes.
 *
 * 200: { valido: true, nombre, colegio, puntaje, total_preguntas, fecha }
 *      { valido: false }   (código no encontrado)
 * 400: { error: 'codigo_invalido' | 'json_invalido' }
 * 500: { error: 'config_servidor' | 'error_firestore', detail }
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function fval(f){
  if(!f) return '';
  if('stringValue' in f) return f.stringValue;
  if('integerValue' in f) return Number(f.integerValue);
  if('booleanValue' in f) return f.booleanValue;
  return '';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST')   return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'metodo_no_permitido' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'json_invalido' }) }; }

  const codigo = (typeof body.codigo === 'string' ? body.codigo : '').trim().toUpperCase();
  if (!/^BIT-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(codigo)) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'codigo_invalido' }) };
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const apiKey    = process.env.FIREBASE_API_KEY;
  if (!projectId || !apiKey) return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'config_servidor' }) };

  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/curso_certificados/${encodeURIComponent(codigo)}?key=${apiKey}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (r.status === 404) {
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ valido: false }) };
    }
    if (!r.ok) {
      const t = await r.text();
      return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'error_firestore', detail: t.slice(0,300) }) };
    }
    const data = await r.json();
    const f = (data && data.fields) || {};
    const ts = Number(fval(f.completado_at)) || 0;
    const fecha = ts ? new Date(ts).toLocaleDateString('es-CL', {day:'2-digit',month:'long',year:'numeric'}) : '';
    return {
      statusCode: 200, headers: CORS_HEADERS,
      body: JSON.stringify({
        valido: true,
        nombre: fval(f.nombre),
        colegio: fval(f.colegio),
        puntaje: fval(f.puntaje),
        total_preguntas: fval(f.total_preguntas) || 10,
        fecha: fecha
      })
    };
  } catch (e) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'error_firestore', detail: e.message }) };
  }
};
