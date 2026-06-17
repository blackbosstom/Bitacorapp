/**
 * registrar-curso — Guarda una participación del curso de convivencia
 * y crea su certificado verificable por código.
 *
 * POST /api/registrar-curso
 * Body JSON: { nombre, colegio, cargo, email, telefono, puntaje,
 *              curso_version, codigo, consentimiento, honeypot }
 *
 * Guarda en:
 *   - curso_participaciones (privado): todos los datos + código.
 *   - curso_certificados/{codigo} (verificable por GET): nombre, colegio,
 *     curso, fecha y puntaje (sin email ni teléfono).
 *
 * 200: { success: true, codigo }
 * 400: { error: 'campos_faltantes' | 'consentimiento_requerido' | 'codigo_invalido' | 'json_invalido' }
 * 500: { error: 'config_servidor' | 'error_firestore', detail }
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// Rate limiting: máx 5 registros por IP cada 10 minutos
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX       = 5;
const _rateMap       = new Map();
function checkRate(ip) {
  const now   = Date.now();
  const entry = _rateMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_WINDOW_MS) { entry.count = 0; entry.start = now; }
  entry.count++;
  _rateMap.set(ip, entry);
  // Limpieza periódica para no acumular IPs viejas
  if (_rateMap.size > 2000) {
    for (const [k, v] of _rateMap) { if (now - v.start > RATE_WINDOW_MS) _rateMap.delete(k); }
  }
  return entry.count <= RATE_MAX;
}

function toFirestoreDoc(fields){
  function cv(v){
    if(v===null||v===undefined) return {nullValue:null};
    if(typeof v==='boolean') return {booleanValue:v};
    if(typeof v==='number')  return {integerValue:String(Math.round(v))};
    if(typeof v==='string')  return {stringValue:v};
    return {stringValue:String(v)};
  }
  return { fields: Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,cv(v)])) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST')   return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'metodo_no_permitido' }) };

  const h  = event.headers || {};
  const ip = (h['x-nf-client-connection-ip'] || h['client-ip'] || (h['x-forwarded-for']||'').split(',')[0] || '').trim();
  if (!checkRate(ip)) return { statusCode: 429, headers: CORS_HEADERS, body: JSON.stringify({ error: 'demasiadas_solicitudes' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'json_invalido' }) }; }

  const { nombre, colegio, cargo, email, telefono, puntaje, curso_version, codigo, consentimiento, honeypot } = body;

  if (honeypot) return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ success: true }) };
  if (consentimiento !== true) return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'consentimiento_requerido' }) };
  if (!nombre || !colegio || !cargo || !email || !telefono) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'campos_faltantes' }) };
  }
  // Validar el formato del código (BIT-XXXX-XXXX, mayúsculas/dígitos sin ambiguos)
  if (typeof codigo !== 'string' || !/^BIT-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(codigo)) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'codigo_invalido' }) };
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const apiKey    = process.env.FIREBASE_API_KEY;
  if (!projectId || !apiKey) return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'config_servidor' }) };

  const ua = (h['user-agent'] || '').slice(0, 400);
  const ahora = Date.now();
  const cursoV = (typeof curso_version === 'string' && curso_version) ? curso_version : '1.0';
  const pts = typeof puntaje === 'number' ? puntaje : 0;

  // Documento privado (todos los datos)
  const participacion = {
    nombre: String(nombre).trim(),
    colegio: String(colegio).trim(),
    cargo: String(cargo).trim(),
    email: String(email).trim().toLowerCase(),
    telefono: String(telefono).trim(),
    puntaje: pts,
    total_preguntas: 10,
    curso_version: cursoV,
    codigo: codigo,
    completado_at: ahora,
    consentimiento: true,
    ip: ip,
    userAgent: ua
  };

  // Documento verificable (sin datos de contacto sensibles); el ID es el código
  const certificado = {
    codigo: codigo,
    nombre: String(nombre).trim(),
    colegio: String(colegio).trim(),
    puntaje: pts,
    total_preguntas: 10,
    curso_version: cursoV,
    completado_at: ahora
  };

  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  try {
    // 1) Participación (colección, ID autogenerado)
    const r1 = await fetch(`${base}/curso_participaciones?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toFirestoreDoc(participacion)),
      signal: AbortSignal.timeout(8000)
    });
    if (!r1.ok) {
      const t = await r1.text();
      return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'error_firestore', detail: t.slice(0,300) }) };
    }
    // 2) Certificado (ID = código). PATCH crea/sobrescribe el documento con ese ID.
    const r2 = await fetch(`${base}/curso_certificados/${encodeURIComponent(codigo)}?key=${apiKey}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toFirestoreDoc(certificado)),
      signal: AbortSignal.timeout(8000)
    });
    if (!r2.ok) {
      const t = await r2.text();
      return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'error_firestore', detail: t.slice(0,300) }) };
    }
    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ success: true, codigo: codigo }) };
  } catch (e) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'error_firestore', detail: e.message }) };
  }
};
