/**
 * cambio-de-ano — Cierra el año escolar de un colegio (SuperAdmin).
 *
 * Mueve (archivo físico) todas las subcolecciones vivas del colegio a
 * tenants/<id>/archivos/<año>/<col>/…, guarda un snapshot de antecedentes,
 * y limpia la nómina del doc del colegio (mantiene funcionarios + config).
 * Usa la credencial de servicio (REST Firestore + JWT), como tc-tienda.js.
 * Auth: passphrase en el body === process.env.CAMBIO_ANO_SECRET.
 *
 * POST /api/cambio-de-ano
 * Body: { tenantId, expectedAnio, secret }
 * 200: { ok:true, anioCerrado, anioNuevo, resumen:{ <col>:{copiados,borrados} } }
 * 401 secreto_invalido | 400 datos_invalidos | 409 conflicto | 500 config/servidor
 */
const crypto = require('crypto');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};
function resp(statusCode, obj){ return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(obj) }; }

/* ── OAuth2 token desde la service account (igual que tc-tienda.js) ── */
let _tokenCache = { token: null, exp: 0 };
function b64url(buf){ return Buffer.from(buf).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_'); }
async function getAccessToken(sa){
  const now = Math.floor(Date.now()/1000);
  if (_tokenCache.token && _tokenCache.exp - 60 > now) return _tokenCache.token;
  const header = b64url(JSON.stringify({ alg:'RS256', typ:'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope:'https://www.googleapis.com/auth/datastore', aud:'https://oauth2.googleapis.com/token', iat: now, exp: now+3600 }));
  const signingInput = header + '.' + claims;
  const signer = crypto.createSign('RSA-SHA256'); signer.update(signingInput);
  const jwt = signingInput + '.' + b64url(signer.sign(sa.private_key));
  const r = await fetch('https://oauth2.googleapis.com/token', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion='+encodeURIComponent(jwt), signal: AbortSignal.timeout(8000) });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error('token:'+(j.error||r.status));
  _tokenCache = { token: j.access_token, exp: now + (j.expires_in||3600) };
  return j.access_token;
}

/* Comparación de secreto en tiempo constante. */
function secretoOK(a, b){
  a = String(a||''); b = String(b||'');
  if (!a || !b || a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch { return false; }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers:CORS_HEADERS, body:'' };
  if (event.httpMethod !== 'POST') return resp(405, { error:'metodo_no_permitido' });

  let body;
  try { body = JSON.parse(event.body||'{}'); } catch { return resp(400, { error:'json_invalido' }); }

  if (!secretoOK(body.secret, process.env.CAMBIO_ANO_SECRET)) return resp(401, { error:'secreto_invalido' });

  const tenantId = String(body.tenantId||'').toLowerCase().replace(/[^a-z0-9\-]/g,'');
  const expectedAnio = parseInt(body.expectedAnio, 10);
  if (!tenantId || tenantId === 'superadmin' || !Number.isInteger(expectedAnio)) return resp(400, { error:'datos_invalidos' });

  const rawSa = process.env.FIREBASE_SERVICE_ACCOUNT || '';
  if (!rawSa) return resp(500, { error:'config_servidor', detail:'falta FIREBASE_SERVICE_ACCOUNT' });
  let sa;
  try { sa = JSON.parse(rawSa); } catch { return resp(500, { error:'config_servidor', detail:'json_invalido en FIREBASE_SERVICE_ACCOUNT' }); }
  if (sa.private_key) sa.private_key = String(sa.private_key).replace(/\\n/g,'\n');
  const projectId = sa.project_id || process.env.FIREBASE_PROJECT_ID;
  if (!sa.client_email || !sa.private_key || !projectId) return resp(500, { error:'config_servidor', detail:'faltan campos de la service account' });

  const docPrefix = `projects/${projectId}/databases/(default)/documents`;
  const base = `https://firestore.googleapis.com/v1/${docPrefix}`;

  try {
    const token = await getAccessToken(sa);
    const authH = { 'Authorization':'Bearer '+token, 'Content-Type':'application/json' };

    // 1) Leer doc del colegio
    const tDocUrl = `${base}/tenants/${tenantId}`;
    const rT = await fetch(tDocUrl, { headers: authH, signal: AbortSignal.timeout(10000) });
    if (rT.status === 404) return resp(409, { error:'colegio_no_existe' });
    const tDoc = await rT.json();
    if (!rT.ok) throw new Error('get_tenant:'+JSON.stringify(tDoc).slice(0,200));
    const tf = tDoc.fields || {};
    const anioActivo = tf.anioActivo && 'integerValue' in tf.anioActivo ? parseInt(tf.anioActivo.integerValue,10) : new Date().getFullYear();
    if (anioActivo !== expectedAnio) return resp(409, { error:'anio_desactualizado', anioActivo });
    const cerrando = anioActivo;

    // 2) ¿Ya archivado? Marcador = cerrando ∈ aniosArchivados (solo se fija al final, paso 8).
    //    Así un fallo a mitad NO bloquea el reintento (la copia es idempotente por docId),
    //    pero un año ya cerrado con éxito queda protegido (además del check de anioActivo).
    const archDocUrl = `${base}/tenants/${tenantId}/archivos/${cerrando}`;
    const prevArch = (tf.aniosArchivados && tf.aniosArchivados.arrayValue && tf.aniosArchivados.arrayValue.values) || [];
    if (prevArch.some(v => 'integerValue' in v && parseInt(v.integerValue,10) === cerrando)) return resp(409, { error:'ya_archivado', anio:cerrando });

    // 3) Snapshot de antecedentes (reutiliza los valores crudos del doc del colegio)
    const snapFields = { anio:{ integerValue:String(cerrando) }, cerradoEl:{ stringValue:new Date().toISOString() } };
    ['estudiantes','funcionarios','cursoTutores','cursos','asistenciaConfig'].forEach(k=>{ if (tf[k]) snapFields[k] = tf[k]; });
    const rSnap = await fetch(archDocUrl, { method:'PATCH', headers: authH, body: JSON.stringify({ fields: snapFields }), signal: AbortSignal.timeout(10000) });
    if (!rSnap.ok) throw new Error('snapshot:'+(await rSnap.text()).slice(0,200));

    // 4) Listar subcolecciones del colegio (excepto 'archivos')
    const rL = await fetch(`${tDocUrl}:listCollectionIds`, { method:'POST', headers: authH, body: JSON.stringify({ pageSize:300 }), signal: AbortSignal.timeout(10000) });
    const lj = await rL.json();
    if (!rL.ok) throw new Error('listCollectionIds:'+JSON.stringify(lj).slice(0,200));
    const cols = (lj.collectionIds||[]).filter(c => c !== 'archivos');

    // Helpers de listado y commit por lotes
    async function listAll(col){
      let docs = [], pageToken = '';
      do {
        const url = `${base}/tenants/${tenantId}/${col}?pageSize=300` + (pageToken?`&pageToken=${encodeURIComponent(pageToken)}`:'');
        const r = await fetch(url, { headers: authH, signal: AbortSignal.timeout(15000) });
        const j = await r.json();
        if (!r.ok) throw new Error('list '+col+':'+JSON.stringify(j).slice(0,200));
        (j.documents||[]).forEach(d => docs.push({ id: d.name.split('/').pop(), fields: d.fields||{} }));
        pageToken = j.nextPageToken || '';
      } while (pageToken);
      return docs;
    }
    async function commitWrites(writes){
      for (let i=0; i<writes.length; i+=450){
        const chunk = writes.slice(i, i+450);
        const r = await fetch(`${base}:commit`, { method:'POST', headers: authH, body: JSON.stringify({ writes: chunk }), signal: AbortSignal.timeout(20000) });
        const j = await r.json();
        if (!r.ok) throw new Error('commit:'+JSON.stringify(j).slice(0,200));
      }
    }
    async function countCol(col, archived){
      const path = archived ? `tenants/${tenantId}/archivos/${cerrando}/${col}` : `tenants/${tenantId}/${col}`;
      let n = 0, pageToken = '';
      do {
        const url = `${base}/${path}?pageSize=300` + (pageToken?`&pageToken=${encodeURIComponent(pageToken)}`:'');
        const r = await fetch(url, { headers: authH, signal: AbortSignal.timeout(15000) });
        const j = await r.json();
        if (!r.ok) throw new Error('count '+col+':'+JSON.stringify(j).slice(0,200));
        n += (j.documents||[]).length; pageToken = j.nextPageToken || '';
      } while (pageToken);
      return n;
    }

    const resumen = {};

    // 5) Copiar cada subcolección → archivo (guardando los ids copiados para borrar EXACTAMENTE esos)
    const idsPorCol = {};
    for (const col of cols){
      const docs = await listAll(col);
      idsPorCol[col] = docs.map(d => d.id);
      const writes = docs.map(d => ({ update: { name: `${docPrefix}/tenants/${tenantId}/archivos/${cerrando}/${col}/${d.id}`, fields: d.fields } }));
      await commitWrites(writes);
      resumen[col] = { origen: docs.length };
    }

    // 6) Verificar conteos ANTES de borrar
    for (const col of cols){
      const copiados = await countCol(col, true);
      resumen[col].copiados = copiados;
      if (copiados !== resumen[col].origen) {
        return resp(500, { error:'verificacion_fallida', col, origen: resumen[col].origen, copiados });
      }
    }

    // 7) Borrar SOLO los docs que se copiaron y verificaron (no re-listar: un doc agregado
    //    durante la operación no se borra —queda vivo en el año nuevo— en vez de perderse).
    for (const col of cols){
      const ids = idsPorCol[col] || [];
      const writes = ids.map(id => ({ delete: `${docPrefix}/tenants/${tenantId}/${col}/${id}` }));
      await commitWrites(writes);
      resumen[col].borrados = ids.length;
    }

    // 8) Actualizar el doc del colegio (prevArch viene del paso 2; cerrando aún no está en él)
    const nuevosArch = prevArch.concat([{ integerValue:String(cerrando) }]);
    const updFields = {
      anioActivo: { integerValue: String(cerrando+1) },
      aniosArchivados: { arrayValue: { values: nuevosArch } },
      estudiantes: { arrayValue: {} },
      cursoTutores: { mapValue: { fields: {} } },
      cursos: { arrayValue: {} },
    };
    const mask = ['anioActivo','aniosArchivados','estudiantes','cursoTutores','cursos'].map(f=>'updateMask.fieldPaths='+f).join('&');
    const rUpd = await fetch(`${tDocUrl}?${mask}`, { method:'PATCH', headers: authH, body: JSON.stringify({ fields: updFields }), signal: AbortSignal.timeout(10000) });
    if (!rUpd.ok) throw new Error('update_tenant:'+(await rUpd.text()).slice(0,200));

    return resp(200, { ok:true, anioCerrado: cerrando, anioNuevo: cerrando+1, resumen });
  } catch (e) {
    return resp(500, { error:'error_servidor', detail: String(e && e.message || e).slice(0,300) });
  }
};
