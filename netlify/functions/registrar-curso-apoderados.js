/**
 * registrar-curso-apoderados — Guarda una participación del curso de apoderados
 * (multi-tenant) y crea su certificado verificable por código.
 *
 * POST /api/registrar-curso-apoderados
 * Body JSON: { tenant_id, colegio, modulo_id, modulo_titulo, nivel,
 *              nombre, curso_estudiante, email, puntaje, total_preguntas,
 *              codigo, consentimiento, honeypot }
 *
 * Guarda en:
 *   - curso_apoderados_participaciones (privado): todos los datos + código.
 *   - curso_apoderados_certificados/{codigo} (verificable por GET): sin email.
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

// Rate limiting: máx 8 registros por IP cada 10 minutos
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX       = 8;
const _rateMap       = new Map();
function checkRate(ip) {
  const now = Date.now();
  const entry = _rateMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_WINDOW_MS) { entry.count = 0; entry.start = now; }
  entry.count++;
  _rateMap.set(ip, entry);
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

  const { tenant_id, colegio, modulo_id, modulo_titulo, nivel, nombre,
          curso_estudiante, email, puntaje, total_preguntas, codigo,
          consentimiento, honeypot } = body;

  if (honeypot) return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ success: true }) };
  if (consentimiento !== true) return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'consentimiento_requerido' }) };
  if (!nombre || !modulo_id || !modulo_titulo) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'campos_faltantes' }) };
  }
  if (typeof codigo !== 'string' || !/^APO-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(codigo)) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'codigo_invalido' }) };
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const apiKey    = process.env.FIREBASE_API_KEY;
  if (!projectId || !apiKey) return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'config_servidor' }) };

  const ua = (h['user-agent'] || '').slice(0, 400);
  const ahora = Date.now();
  const pts   = typeof puntaje === 'number' ? puntaje : 0;
  const tot   = typeof total_preguntas === 'number' ? total_preguntas : 0;
  const tid   = String(tenant_id || 'default').trim().toLowerCase();

  const participacion = {
    tenant_id: tid,
    colegio: String(colegio || '').trim(),
    modulo_id: String(modulo_id).trim(),
    modulo_titulo: String(modulo_titulo).trim(),
    nivel: String(nivel || '').trim(),
    nombre: String(nombre).trim(),
    curso_estudiante: String(curso_estudiante || '').trim(),
    email: String(email || '').trim().toLowerCase(),
    puntaje: pts,
    total_preguntas: tot,
    codigo: codigo,
    completado_at: ahora,
    consentimiento: true,
    ip: ip,
    userAgent: ua
  };

  const certificado = {
    codigo: codigo,
    tenant_id: tid,
    colegio: String(colegio || '').trim(),
    nombre: String(nombre).trim(),
    modulo_titulo: String(modulo_titulo).trim(),
    nivel: String(nivel || '').trim(),
    puntaje: pts,
    total_preguntas: tot,
    completado_at: ahora
  };

  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  try {
    // 1) Participación (colección, ID autogenerado)
    const r1 = await fetch(`${base}/curso_apoderados_participaciones?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toFirestoreDoc(participacion)),
    });
    if (!r1.ok) throw new Error('participaciones ' + r1.status + ' ' + (await r1.text()).slice(0,200));

    // 2) Certificado (ID = código; 409 si ya existe = idempotente)
    const r2 = await fetch(`${base}/curso_apoderados_certificados?documentId=${encodeURIComponent(codigo)}&key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toFirestoreDoc(certificado)),
    });
    if (!r2.ok && r2.status !== 409) throw new Error('certificados ' + r2.status + ' ' + (await r2.text()).slice(0,200));

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ success: true, codigo }) };
  } catch (e) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'error_firestore', detail: String(e.message || e).slice(0,300) }) };
  }
};
