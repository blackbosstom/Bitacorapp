/**
 * register-demo — Crea un nuevo tenant en modo demo (3 días).
 *
 * POST /api/register-demo
 * Body JSON: { nombreColegio, region, comuna, rbd, slug, adminNombre, adminEmail,
 *              adminPassword, honeypot, terminos_aceptados, terminos_version }
 *
 * Guarda evidencia de consentimiento (Ley 21.719) en el doc del tenant:
 *   terminos_aceptados_at (timestamp servidor), terminos_version, y
 *   consentimiento_terminos { aceptado, version, aceptado_at, ip, userAgent, aceptado_por }.
 *
 * 200: { success: true, slug, demoUrl, demoExpiresAt }
 * 400: { error: 'campos_faltantes' | 'slug_invalido' | 'slug_reservado' | 'password_corto' | 'terminos_no_aceptados' }
 * 409: { error: 'slug_taken' | 'email_taken' }
 * 500: { error: 'error_interno', detail: '...' }
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const SLUGS_RESERVADOS = [
  'demo','admin','superadmin','default','app','api','www','mail',
  'test','staging','bitacorapp','sgce','pago','login','denuncias',
  'presentacion','register','registro','auth','firebase','netlify','cdn'
];

const ADMIN_PERMISOS = [
  'ver_nueva_mediacion','ver_historial','ver_seguimiento',
  'ver_citaciones','ver_bitacora','ver_anotaciones',
  'ver_suspension','ver_condicionalidad','ver_expediente',
  'ver_coordinacion','ver_compromisos','ver_protocolos',
  'ver_derivaciones','ver_denuncias','ver_informes','ver_agenda',
  'ver_configuracion'
];

const MODULOS_TODOS = {
  mediaciones:true, historial:true, seguimiento:true, bitacora:true,
  citaciones:true, suspensiones:true, denuncias:true, expedientes:true,
  condicionalidades:true, compromisos:true, derivaciones:true,
  protocolos:true, informes:true, anotaciones:true, agenda:true
};

/** Convierte un objeto JS plano al formato de campos de Firestore REST API */
function toFirestoreDoc(fields) {
  function convertValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'boolean')        return { booleanValue: v };
    if (typeof v === 'number')         return { integerValue: String(Math.round(v)) };
    if (typeof v === 'string')         return { stringValue: v };
    if (Array.isArray(v))              return { arrayValue: { values: v.map(convertValue) } };
    if (typeof v === 'object') {
      return {
        mapValue: {
          fields: Object.fromEntries(
            Object.entries(v).map(([k, val]) => [k, convertValue(val)])
          )
        }
      };
    }
    return { nullValue: null };
  }
  return {
    fields: Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, convertValue(v)])
    )
  };
}

export const handler = async (event) => {
  /* ── CORS preflight ── */
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'metodo_no_permitido' }) };
  }

  /* ── Parsear body ── */
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'json_invalido' }) }; }

  const { nombreColegio, region, comuna, rbd, slug,
          adminNombre, adminEmail, adminPassword, honeypot,
          terminos_aceptados, terminos_version } = body;

  /* ── Anti-bot: honeypot debe llegar vacío ── */
  if (honeypot) {
    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ success: true }) };
  }

  /* ── Modo verificación de slug (no crea nada) ──
     El cliente llama con { _checkSlug:true, slug } mientras el usuario escribe.
     Debe resolverse ANTES de validar términos/campos (que aún no existen). */
  if (body._checkSlug) {
    const s = String(slug || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(s) || SLUGS_RESERVADOS.includes(s)) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'slug_invalido' }) };
    }
    const pId = process.env.FIREBASE_PROJECT_ID;
    const aKey = process.env.FIREBASE_API_KEY;
    if (!pId || !aKey) {
      return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'config_servidor' }) };
    }
    const fb = `https://firestore.googleapis.com/v1/projects/${pId}/databases/(default)/documents`;
    try {
      const r = await fetch(`${fb}/tenants/${s}?key=${aKey}`, { signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        return { statusCode: 409, headers: CORS_HEADERS, body: JSON.stringify({ error: 'slug_taken' }) };
      }
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ disponible: true }) };
    } catch (e) {
      // Best-effort: ante error de red, no bloquear (el envío final revalida).
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ disponible: true }) };
    }
  }

  /* ── Consentimiento de términos (Ley 21.719) ──
     Validación también en servidor: no basta con el checkbox del cliente. */
  if (terminos_aceptados !== true) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'terminos_no_aceptados' }) };
  }

  /* ── Validar campos requeridos ── */
  if (!nombreColegio || !region || !comuna || !slug || !adminNombre || !adminEmail || !adminPassword) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'campos_faltantes' }) };
  }

  /* ── Validar contraseña mínima (Firebase Auth requiere 6+, pedimos 8) ── */
  if (adminPassword.length < 8) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'password_corto' }) };
  }

  /* ── Validar y limpiar slug ── */
  const slugLimpio = slug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(slugLimpio)) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'slug_invalido' }) };
  }
  if (SLUGS_RESERVADOS.includes(slugLimpio)) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'slug_reservado' }) };
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const apiKey    = process.env.FIREBASE_API_KEY;
  if (!projectId || !apiKey) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'config_servidor' }) };
  }

  const firestoreBase = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

  /* ── Verificar disponibilidad del slug en Firestore ── */
  try {
    const checkRes = await fetch(`${firestoreBase}/tenants/${slugLimpio}?key=${apiKey}`, {
      signal: AbortSignal.timeout(5000)
    });
    if (checkRes.ok) {
      // El documento existe → slug tomado
      return { statusCode: 409, headers: CORS_HEADERS, body: JSON.stringify({ error: 'slug_taken' }) };
    }
    if (checkRes.status !== 404) {
      // Error inesperado de Firestore (403, 500, etc.) → abortar
      return { statusCode: 500, headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'error_verificacion', detail: 'firestore_status_' + checkRes.status }) };
    }
    // status === 404 → slug disponible, continúa
  } catch (e) {
    return { statusCode: 500, headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'error_verificacion', detail: e.message }) };
  }

  /* ── Crear usuario en Firebase Auth vía REST API ── */
  let uid;
  let idToken; // hoisted here so Firestore catch blocks can use it for rollback
  try {
    const authRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: adminEmail.trim().toLowerCase(),
          password: adminPassword,
          displayName: adminNombre.trim(),
          returnSecureToken: true    // ← necesario para obtener idToken (usado en rollback)
        }),
        signal: AbortSignal.timeout(8000)
      }
    );
    const authData = await authRes.json();
    if (!authRes.ok) {
      const errCode = authData?.error?.message || '';
      if (errCode.includes('EMAIL_EXISTS')) {
        return { statusCode: 409, headers: CORS_HEADERS, body: JSON.stringify({ error: 'email_taken' }) };
      }
      return { statusCode: 500, headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'error_auth', detail: errCode }) };
    }
    uid = authData.localId;
    idToken = authData.idToken; // needed for rollback if Firestore fails
  } catch (e) {
    return { statusCode: 500, headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'error_auth', detail: e.message }) };
  }

  /* ── Crear documento del tenant en Firestore ── */
  const ahora        = Date.now();
  const demoExpiresAt = ahora + 3 * 24 * 60 * 60 * 1000; // +3 días en ms

  /* ── Evidencia de consentimiento (Ley 21.719) ──
     El timestamp lo fija el SERVIDOR (autoritativo, no manipulable por el
     cliente). Se guardan también IP y user-agent como prueba reforzada. */
  const h = event.headers || {};
  const ipCliente = (h['x-nf-client-connection-ip'] || h['client-ip'] ||
                     (h['x-forwarded-for'] || '').split(',')[0] || '').trim();
  const userAgent = (h['user-agent'] || '').slice(0, 400);
  const terminosVersion = (typeof terminos_version === 'string' && terminos_version.trim())
                            ? terminos_version.trim() : '1.1';

  const tenantDoc = {
    nombreColegio : nombreColegio.trim(),
    nombre        : nombreColegio.trim(),
    shortName     : nombreColegio.trim().substring(0, 15),
    region        : region.trim(),
    comuna        : comuna.trim(),
    rbd           : (rbd || '').trim(),
    status        : 'demo',
    demoExpiresAt,
    creadoAt      : ahora,
    updatedAt     : ahora,
    adminEmail    : adminEmail.trim().toLowerCase(),
    adminNombre   : adminNombre.trim(),
    colorPrimario : '#2e5e3e',
    colorSecundario: '#c8d9a8',
    logoUrl       : '',
    // ── Consentimiento de términos (Ley 21.719) ──
    terminos_aceptados_at : ahora,             // timestamp servidor (ms epoch)
    terminos_version      : terminosVersion,
    consentimiento_terminos: {
      aceptado    : true,
      version     : terminosVersion,
      aceptado_at : ahora,                     // timestamp servidor (autoritativo)
      ip          : ipCliente,
      userAgent   : userAgent,
      aceptado_por: adminEmail.trim().toLowerCase()
    },
    usuarios: [{
      uid,
      nombre  : adminNombre.trim(),
      email   : adminEmail.trim().toLowerCase(),
      rol     : 'admin',
      estado  : 'activo',
      modulosPermitidos: ADMIN_PERMISOS
    }],
    // Lista plana de emails de acceso (aislamiento por reglas de Firestore):
    // el colegio nace listo, con su admin ya en la lista.
    usuariosEmails: [ adminEmail.trim().toLowerCase() ],
    modulos: MODULOS_TODOS
  };

  try {
    const docRes = await fetch(`${firestoreBase}/tenants/${slugLimpio}?key=${apiKey}`, {
      method : 'PATCH',
      // Escritura autenticada como el admin recién creado (idToken). Con las
      // reglas seguras (tenants write: if request.auth != null), un PATCH sin
      // este header sería denegado.
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + idToken
      },
      body   : JSON.stringify(toFirestoreDoc(tenantDoc)),
      signal : AbortSignal.timeout(8000)
    });
    if (!docRes.ok) {
      const errText = await docRes.text();
      // Rollback: eliminar el usuario de Auth para no dejarlo huérfano
      try {
        await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
          signal: AbortSignal.timeout(5000)
        });
      } catch (_) { /* rollback best-effort, no bloqueante */ }
      return { statusCode: 500, headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'error_firestore', detail: errText.substring(0, 300) }) };
    }
  } catch (e) {
    // Rollback: eliminar el usuario de Auth
    try {
      await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
        signal: AbortSignal.timeout(5000)
      });
    } catch (_) { /* rollback best-effort */ }
    return { statusCode: 500, headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'error_firestore', detail: e.message }) };
  }

  /* ── Éxito ── */
  return {
    statusCode: 200,
    headers   : CORS_HEADERS,
    body      : JSON.stringify({
      success       : true,
      slug          : slugLimpio,
      demoUrl       : `https://bitacorapp.cl/?tenant=${slugLimpio}`,
      demoExpiresAt
    })
  };
};
