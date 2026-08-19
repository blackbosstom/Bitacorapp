/**
 * tc-tienda — Backend de la Tienda de Convivencia (fase B).
 *
 * Única vía por la que el público (sin login) consulta saldo/movimientos y
 * canjea premios. Valida número+PIN y descuenta el saldo del lado servidor,
 * con una credencial de servicio (Firestore admin), para que nadie pueda
 * alterar su propio saldo ni ver datos ajenos.
 *
 * POST /api/tc-tienda
 * Body: { tenant, action:'consultar'|'comprar', numero, pin, premioId? }
 *
 * 200 consultar: { ok:true, nombre, curso, saldo, movimientos:[...] }
 * 200 comprar:   { ok:true, saldo, codigo }
 * 400: { error:'json_invalido' | 'datos_invalidos' | 'premio_invalido' }
 * 401: { error:'tarjeta_o_pin' }
 * 402: { error:'saldo_insuficiente' }
 * 429: { error:'demasiadas_solicitudes' }
 * 500: { error:'config_servidor' | 'error_servidor', detail }
 */
const crypto = require('crypto');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

/* Rate limiting anti fuerza bruta del PIN: máx 12 intentos por IP / 10 min. */
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 12;
const _rateMap = new Map();
function checkRate(ip) {
  const now = Date.now();
  const e = _rateMap.get(ip) || { count: 0, start: now };
  if (now - e.start > RATE_WINDOW_MS) { e.count = 0; e.start = now; }
  e.count++;
  _rateMap.set(ip, e);
  if (_rateMap.size > 2000) { for (const [k, v] of _rateMap) { if (now - v.start > RATE_WINDOW_MS) _rateMap.delete(k); } }
  return e.count <= RATE_MAX;
}

/* ── Firestore value helpers ── */
function toVal(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { integerValue: String(Math.round(v)) };
  return { stringValue: String(v) };
}
function toDoc(fields) { return { fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, toVal(v)])) }; }
function fromVal(v) {
  if (!v) return null;
  if ('integerValue' in v) return parseInt(v.integerValue, 10);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('stringValue' in v) return v.stringValue;
  if ('nullValue' in v) return null;
  return null;
}
function fromDoc(d) { const o = {}; const f = (d && d.fields) || {}; for (const k in f) o[k] = fromVal(f[k]); return o; }

/* ── OAuth2 token desde la service account (JWT RS256), cacheado ── */
let _tokenCache = { token: null, exp: 0 };
function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }
async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  if (_tokenCache.token && _tokenCache.exp - 60 > now) return _tokenCache.token;
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  }));
  const signingInput = header + '.' + claims;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = b64url(signer.sign(sa.private_key));
  const jwt = signingInput + '.' + signature;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + encodeURIComponent(jwt),
    signal: AbortSignal.timeout(8000),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error('token:' + (j.error || r.status));
  _tokenCache = { token: j.access_token, exp: now + (j.expires_in || 3600) };
  return j.access_token;
}

function codigoCanje() {
  const alf = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = ''; for (let i = 0; i < 5; i++) s += alf[Math.floor(Math.random() * alf.length)];
  return s;
}
function docId() {
  const alf = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = ''; for (let i = 0; i < 20; i++) s += alf[Math.floor(Math.random() * alf.length)];
  return s;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'metodo_no_permitido' }) };

  const h = event.headers || {};
  const ip = (h['x-nf-client-connection-ip'] || h['client-ip'] || (h['x-forwarded-for'] || '').split(',')[0] || '').trim();
  if (!checkRate(ip)) return { statusCode: 429, headers: CORS_HEADERS, body: JSON.stringify({ error: 'demasiadas_solicitudes' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'json_invalido' }) }; }

  const tenant = String(body.tenant || '').toLowerCase().replace(/[^a-z0-9\-]/g, '');
  const action = body.action;
  const numero = String(body.numero || '').replace(/\D/g, '');
  const pin = String(body.pin || '').replace(/\D/g, '');
  if (!tenant || !/^\d{8}$/.test(numero) || !/^\d{4}$/.test(pin) || (action !== 'consultar' && action !== 'comprar')) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'datos_invalidos' }) };
  }

  const rawSa = process.env.FIREBASE_SERVICE_ACCOUNT || '';
  if (!rawSa) return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'config_servidor', detail: 'falta FIREBASE_SERVICE_ACCOUNT' }) };
  let sa;
  try { sa = JSON.parse(rawSa); }
  catch { return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'config_servidor', detail: 'json_invalido en FIREBASE_SERVICE_ACCOUNT' }) }; }
  /* La private_key suele quedar con \n literales según cómo se pegue en el panel. */
  if (sa.private_key) sa.private_key = String(sa.private_key).replace(/\\n/g, '\n');
  const projectId = sa.project_id || process.env.FIREBASE_PROJECT_ID;
  if (!sa.client_email || !sa.private_key || !projectId) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'config_servidor', detail: 'faltan campos client_email/private_key/project_id' }) };
  }
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  const parent = `${base}/tenants/${tenant}`;

  try {
    const token = await getAccessToken(sa);
    const authH = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

    /* Busca la tarjeta por número; devuelve {name, updateTime, data} o null. */
    async function buscarTarjeta() {
      const q = {
        structuredQuery: {
          from: [{ collectionId: 'tc_tarjetas' }],
          where: { fieldFilter: { field: { fieldPath: 'numero' }, op: 'EQUAL', value: { stringValue: numero } } },
          limit: 1,
        },
      };
      const r = await fetch(`${parent}:runQuery`, { method: 'POST', headers: authH, body: JSON.stringify(q), signal: AbortSignal.timeout(8000) });
      const arr = await r.json();
      if (!r.ok) throw new Error('query:' + JSON.stringify(arr).slice(0, 200));
      const row = Array.isArray(arr) ? arr.find(x => x.document) : null;
      if (!row) return null;
      return { name: row.document.name, updateTime: row.document.updateTime, data: fromDoc(row.document) };
    }

    const card = await buscarTarjeta();
    if (!card || String(card.data.pin) !== pin) {
      return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'tarjeta_o_pin' }) };
    }

    async function movimientos() {
      const q = {
        structuredQuery: {
          from: [{ collectionId: 'tc_movimientos' }],
          where: { fieldFilter: { field: { fieldPath: 'numero' }, op: 'EQUAL', value: { stringValue: numero } } },
          limit: 100,
        },
      };
      const r = await fetch(`${parent}:runQuery`, { method: 'POST', headers: authH, body: JSON.stringify(q), signal: AbortSignal.timeout(8000) });
      const arr = await r.json();
      if (!r.ok) return [];
      return (Array.isArray(arr) ? arr : []).filter(x => x.document).map(x => fromDoc(x.document))
        .sort((a, b) => (a.fecha < b.fecha ? 1 : -1)).slice(0, 20)
        .map(m => ({ fecha: m.fecha, tipo: m.tipo, glosa: m.glosa, emoji: m.emoji, monto: m.monto, saldoDespues: m.saldoDespues, codigo: m.codigo || '' }));
    }

    const bloqueadaHasta = card.data.bloqueadaHasta || '';
    const bloqueada = !!(bloqueadaHasta && new Date(bloqueadaHasta) > new Date());

    if (action === 'consultar') {
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true, nombre: card.data.nombre || '', curso: card.data.curso || '', saldo: Number(card.data.saldo || 0), bloqueada, bloqueadaHasta, movimientos: await movimientos() }) };
    }

    /* Compra bloqueada por sanción de convivencia. */
    if (bloqueada) return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'tarjeta_bloqueada', bloqueadaHasta }) };

    /* ── comprar (carrito: items[] o premioId legado) ── */
    let carrito = Array.isArray(body.items) ? body.items : (body.premioId ? [{ premioId: body.premioId, cantidad: 1 }] : []);
    const cant = {};
    carrito.forEach(it => {
      const pid = String((it && it.premioId) || '').replace(/[^A-Za-z0-9_\-]/g, '');
      if (!pid) return;
      const q = Math.max(1, Math.min(50, parseInt(it && it.cantidad, 10) || 1));
      cant[pid] = (cant[pid] || 0) + q;
    });
    const ids = Object.keys(cant);
    if (!ids.length || ids.length > 30) return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'premio_invalido' }) };

    const lineas = [];
    for (const pid of ids) {
      const pr = await fetch(`${parent}/tc_premios/${encodeURIComponent(pid)}`, { headers: authH, signal: AbortSignal.timeout(8000) });
      if (!pr.ok) return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'premio_invalido' }) };
      const premio = fromDoc(await pr.json());
      if (premio.activo === false) return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'premio_invalido' }) };
      const precio = Number(premio.precio || 0);
      if (!(precio >= 0)) return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'premio_invalido' }) };
      lineas.push({ premio, precio, cantidad: cant[pid] });
    }
    const total = lineas.reduce((s, l) => s + l.precio * l.cantidad, 0);

    /* Descuento atómico SIN precondición: incremento del saldo (−total) + creación de
       los movimientos, todo en un commit. El incremento es atómico en el servidor, así
       que no hay 'conflicto' aunque haya operaciones concurrentes. */
    const saldo = Number(card.data.saldo || 0);
    if (saldo < total) return { statusCode: 402, headers: CORS_HEADERS, body: JSON.stringify({ error: 'saldo_insuficiente', saldo, total }) };
    const nuevo = saldo - total;
    const codigo = codigoCanje();
    let run = saldo;
    const writes = [{ transform: { document: card.name, fieldTransforms: [{ fieldPath: 'saldo', increment: { integerValue: String(-total) } }] } }];
    lineas.forEach(l => {
      const monto = -(l.precio * l.cantidad); run += monto;
      writes.push({ update: Object.assign({ name: `${parent}/tc_movimientos/${docId()}` }, toDoc({ claveEst: card.data.claveEst || '', numero: numero, tipo: 'compra', glosa: l.premio.nombre || '', emoji: l.premio.emoji || '', cantidad: l.cantidad, monto: monto, saldoDespues: run, fecha: new Date().toISOString(), autor: 'tienda', codigo: codigo })), currentDocument: { exists: false } });
    });
    const rc = await fetch(`${base}:commit`, { method: 'POST', headers: authH, body: JSON.stringify({ writes }), signal: AbortSignal.timeout(8000) });
    if (!rc.ok) { const errTxt = await rc.text(); return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'error_servidor', detail: ('commit:' + errTxt.slice(0, 220)) }) }; }
    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true, saldo: nuevo, total, codigo, items: lineas.map(l => ({ nombre: l.premio.nombre, emoji: l.premio.emoji, cantidad: l.cantidad, precio: l.precio })) }) };
  } catch (e) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'error_servidor', detail: String(e.message || e).slice(0, 200) }) };
  }
};
