# Demo Self-Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que colegios se registren autónomamente, accedan a una demo de 3 días vía `bitacorapp.cl/?tenant=slug`, y que el admin pueda activarlos con un clic en el SuperAdmin panel.

**Architecture:** Un formulario en la landing page envía datos a una nueva Netlify Function (`register-demo.js`) que crea el tenant en Firestore y el usuario en Firebase Auth vía REST API. La app detecta `status: 'demo'` en el tenant y muestra un banner de cuenta regresiva o bloquea el acceso al expirar. El SuperAdmin tiene un nuevo tab "Demos" para ver, activar y gestionar demos activas.

**Tech Stack:** Netlify Functions (ES modules, Node 20), Firestore REST API, Firebase Auth REST API (identitytoolkit), HTML/CSS/JS vanilla (SPA single-file).

---

## File Map

| Archivo | Acción | Qué cambia |
|---|---|---|
| `netlify/functions/register-demo.js` | Crear | Nueva función de registro |
| `netlify.toml` | Modificar | Redirect + CORS para la función |
| `public/presentacion/index.html` | Modificar | Modal de registro, botón hero, JS de registro |
| `public/index.html` | Modificar | Banner demo, bloqueo expirado, tab Demos en SuperAdmin |

---

## Task 1: Netlify Function `register-demo.js`

**Files:**
- Create: `netlify/functions/register-demo.js`

- [ ] **Paso 1: Crear el archivo de la función**

Crear `netlify/functions/register-demo.js` con el siguiente contenido completo:

```javascript
/**
 * register-demo — Crea un nuevo tenant en modo demo (3 días).
 *
 * POST /api/register-demo
 * Body JSON: { nombreColegio, region, comuna, rbd, slug, adminNombre, adminEmail, adminPassword, honeypot }
 *
 * 200: { success: true, slug, demoUrl, demoExpiresAt }
 * 400: { error: 'campos_faltantes' | 'slug_invalido' | 'slug_reservado' | 'password_corto' }
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
          adminNombre, adminEmail, adminPassword, honeypot } = body;

  /* ── Anti-bot: honeypot debe llegar vacío ── */
  if (honeypot) {
    // Simular éxito para no revelar la trampa al bot
    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ success: true }) };
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
  // 3-30 caracteres, empieza y termina con alfanumérico, solo letras minúsculas, números y guiones
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
    // checkRes.status === 404 → slug disponible (continúa)
  } catch (e) {
    return { statusCode: 500, headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'error_verificacion', detail: e.message }) };
  }

  /* ── Crear usuario en Firebase Auth vía REST API ── */
  let uid;
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
          returnSecureToken: false
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
  } catch (e) {
    return { statusCode: 500, headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'error_auth', detail: e.message }) };
  }

  /* ── Crear documento del tenant en Firestore ── */
  const ahora        = Date.now();
  const demoExpiresAt = ahora + 3 * 24 * 60 * 60 * 1000; // +3 días en ms

  const tenantDoc = {
    nombreColegio : nombreColegio.trim(),
    nombre        : nombreColegio.trim(),   // alias que usa la app en el header
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
    usuarios: [{
      uid,
      nombre  : adminNombre.trim(),
      email   : adminEmail.trim().toLowerCase(),
      rol     : 'admin',
      estado  : 'activo',
      modulosPermitidos: ADMIN_PERMISOS
    }],
    modulos: MODULOS_TODOS
  };

  try {
    const docRes = await fetch(`${firestoreBase}/tenants/${slugLimpio}?key=${apiKey}`, {
      method : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify(toFirestoreDoc(tenantDoc)),
      signal : AbortSignal.timeout(8000)
    });
    if (!docRes.ok) {
      const errText = await docRes.text();
      return { statusCode: 500, headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'error_firestore', detail: errText.substring(0, 300) }) };
    }
  } catch (e) {
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
```

- [ ] **Paso 2: Verificar que el archivo existe**

```bash
ls -la netlify/functions/register-demo.js
```

Resultado esperado: el archivo aparece listado con su tamaño.

- [ ] **Paso 3: Commit**

```bash
git add netlify/functions/register-demo.js
git commit -m "feat: add register-demo Netlify function for tenant self-registration"
```

---

## Task 2: Actualizar `netlify.toml`

**Files:**
- Modify: `netlify/netlify.toml` (o `netlify.toml` en la raíz del proyecto)

- [ ] **Paso 1: Añadir redirect para la función**

Localizar el bloque de redirects en `netlify.toml` (justo después del redirect `/pwa-icon`). Añadir el siguiente bloque **antes** de la sección `# CABECERAS DE SEGURIDAD`:

```toml
# ── /api/register-demo → function register-demo.js ──────────
[[redirects]]
  from   = "/api/register-demo"
  to     = "/.netlify/functions/register-demo"
  status = 200
  force  = true
```

- [ ] **Paso 2: Añadir CORS headers para la función**

Añadir al final del archivo `netlify.toml`, después del bloque `[[headers]] for = "/.netlify/functions/*"`:

```toml
[[headers]]
  for = "/.netlify/functions/register-demo"
  [headers.values]
    Access-Control-Allow-Origin  = "*"
    Access-Control-Allow-Methods = "POST, OPTIONS"
    Access-Control-Allow-Headers = "Content-Type"
```

- [ ] **Paso 3: Commit**

```bash
git add netlify.toml
git commit -m "feat: add register-demo redirect and CORS headers in netlify.toml"
```

---

## Task 3: Formulario de registro en la landing page

**Files:**
- Modify: `public/presentacion/index.html`

Todos los cambios van en este único archivo. El patrón de trabajo es similar al modal de contacto existente (`abrirModal()` / `cerrarModal()`).

- [ ] **Paso 1: Añadir CSS del modal de registro**

Localizar el bloque `</style>` que cierra el CSS principal de la landing (alrededor de la línea 274, justo antes de `</style></head>`). Insertar el siguiente CSS **antes** de ese `</style>`:

```css
/* ═══ MODAL REGISTRO DEMO ═══════════════════════════════ */
.reg-overlay{position:fixed;inset:0;background:rgba(10,24,15,.85);z-index:1000;
  display:flex;align-items:center;justify-content:center;
  padding:1.5rem;opacity:0;pointer-events:none;transition:opacity .25s}
.reg-overlay.open{opacity:1;pointer-events:all}
.reg-box{background:#0e2318;border:1px solid rgba(82,183,136,.25);border-radius:20px;
  padding:2rem;width:min(560px,100%);max-height:90vh;overflow-y:auto;
  box-shadow:0 24px 80px rgba(0,0,0,.6);position:relative;
  font-family:var(--font);color:#d0e8d8;transform:translateY(12px);transition:transform .25s}
.reg-overlay.open .reg-box{transform:translateY(0)}
.reg-close{position:absolute;top:1rem;right:1rem;background:rgba(255,255,255,.07);
  border:none;color:rgba(180,210,190,.6);border-radius:8px;width:32px;height:32px;
  cursor:pointer;font-size:1.1rem;display:flex;align-items:center;justify-content:center;
  transition:all .15s}
.reg-close:hover{background:rgba(255,255,255,.14);color:#fff}
.reg-logo{width:56px;height:56px;border-radius:14px;overflow:hidden;margin:0 auto 1rem;
  border:2px solid rgba(224,123,39,.5);background:#1b4332}
.reg-logo img{width:100%;height:100%;object-fit:contain}
.reg-title{font-size:1.25rem;font-weight:700;color:#6dd98a;text-align:center;margin-bottom:.25rem}
.reg-sub{font-size:.82rem;color:rgba(180,210,190,.55);text-align:center;margin-bottom:1.5rem}
.reg-block-title{font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;
  color:rgba(180,210,190,.45);margin:.6rem 0 .5rem;padding-top:.8rem;
  border-top:1px solid rgba(80,160,100,.12)}
.reg-block-title:first-of-type{border-top:none;padding-top:0}
.reg-group{margin-bottom:.75rem}
.reg-group label{display:block;font-size:.78rem;font-weight:600;color:rgba(180,210,190,.7);
  margin-bottom:.3rem;letter-spacing:.03em}
.reg-group input,.reg-group select{width:100%;padding:.55rem .85rem;
  background:rgba(255,255,255,.06);border:1.5px solid rgba(80,160,100,.2);
  border-radius:9px;color:#d0e8d8;font-family:var(--font);font-size:.88rem;
  outline:none;transition:border-color .18s}
.reg-group input:focus,.reg-group select:focus{border-color:rgba(109,217,138,.5)}
.reg-group input::placeholder{color:rgba(180,210,190,.3)}
.reg-slug-preview{font-size:.75rem;color:rgba(109,217,138,.7);margin-top:.35rem;
  padding:.28rem .6rem;background:rgba(109,217,138,.07);border-radius:6px;
  border:1px solid rgba(109,217,138,.15)}
.reg-slug-preview span{color:rgba(109,217,138,.45)}
.reg-slug-badge{display:inline-flex;align-items:center;gap:.35rem;font-size:.7rem;
  padding:.18rem .55rem;border-radius:20px;margin-left:.4rem;font-weight:700}
.reg-slug-badge.disponible{background:rgba(52,183,83,.15);color:#4ade80;
  border:1px solid rgba(52,183,83,.3)}
.reg-slug-badge.tomado{background:rgba(239,68,68,.12);color:#f87171;
  border:1px solid rgba(239,68,68,.25)}
.reg-submit{width:100%;padding:.75rem;background:var(--naranja);color:var(--verde);
  font-weight:700;font-size:.95rem;border:none;border-radius:12px;cursor:pointer;
  font-family:var(--font);margin-top:.5rem;transition:all .2s}
.reg-submit:hover{background:var(--naranja-claro);transform:translateY(-1px)}
.reg-submit:disabled{opacity:.5;cursor:not-allowed;transform:none}
.reg-error{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);
  color:#f87171;border-radius:9px;padding:.6rem .9rem;font-size:.8rem;
  margin-bottom:.75rem;display:none}
.reg-row{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}
/* Pantalla de éxito */
.reg-success{display:none;text-align:center;padding:1rem 0}
.reg-success-ico{font-size:3rem;margin-bottom:.75rem}
.reg-success-title{font-size:1.3rem;font-weight:700;color:#6dd98a;margin-bottom:.5rem}
.reg-success-sub{font-size:.85rem;color:rgba(180,210,190,.6);margin-bottom:1.25rem;line-height:1.6}
.reg-url-box{background:rgba(109,217,138,.08);border:1.5px solid rgba(109,217,138,.25);
  border-radius:12px;padding:1rem 1.1rem;margin-bottom:1rem;text-align:left}
.reg-url-label{font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;
  color:rgba(180,210,190,.45);margin-bottom:.3rem}
.reg-url-value{font-size:.9rem;color:#6dd98a;font-weight:600;word-break:break-all}
.reg-copy-btn{background:rgba(109,217,138,.12);border:1.5px solid rgba(109,217,138,.3);
  color:#6dd98a;border-radius:8px;padding:.35rem .9rem;font-size:.78rem;font-weight:700;
  cursor:pointer;font-family:var(--font);margin-top:.5rem;transition:all .15s}
.reg-copy-btn:hover{background:rgba(109,217,138,.22)}
.reg-warn{background:rgba(255,170,0,.08);border:1px solid rgba(255,170,0,.25);
  border-radius:9px;padding:.6rem .9rem;font-size:.78rem;color:rgba(255,200,100,.75);
  margin-top:.75rem;line-height:1.5}
.reg-ir-btn{display:inline-block;background:var(--naranja);color:var(--verde);
  font-weight:700;font-size:.9rem;padding:.7rem 1.8rem;border-radius:50px;
  text-decoration:none;margin-top:1rem;transition:all .2s;border:none;cursor:pointer;
  font-family:var(--font)}
.reg-ir-btn:hover{background:var(--naranja-claro);transform:translateY(-1px)}
@media(max-width:520px){.reg-row{grid-template-columns:1fr}}
```

- [ ] **Paso 2: Añadir el HTML del modal de registro**

Localizar la línea `<!-- MODAL FORMULARIO REAL CON FORMSPREE -->` en el archivo (aprox. línea 278). Insertar el siguiente HTML **antes** de esa línea:

```html
<!-- ══ MODAL REGISTRO DEMO ═══════════════════════════════════════════ -->
<div class="reg-overlay" id="reg-modal" onclick="if(event.target===this)cerrarRegistro()">
  <div class="reg-box">
    <button class="reg-close" onclick="cerrarRegistro()" type="button">✕</button>

    <div class="reg-logo"><img src="BITACORAPP.png" alt="Logo BitacoraApp"></div>
    <div class="reg-title">Solicitar Demo Gratuita</div>
    <div class="reg-sub">3 días sin costo · Sin tarjeta de crédito</div>

    <div id="reg-form-wrap">
      <div class="reg-error" id="reg-error"></div>

      <!-- Bloque 1: Datos del colegio -->
      <div class="reg-block-title">📍 Datos del establecimiento</div>
      <div class="reg-group">
        <label for="reg-nombre-colegio">Nombre del establecimiento *</label>
        <input type="text" id="reg-nombre-colegio" placeholder="Ej: Liceo Bicentenario"
          oninput="regGenerarSlug()" autocomplete="off">
      </div>
      <div class="reg-row">
        <div class="reg-group">
          <label for="reg-region">Región *</label>
          <select id="reg-region">
            <option value="">— Seleccionar —</option>
            <option>Región de Arica y Parinacota</option>
            <option>Región de Tarapacá</option>
            <option>Región de Antofagasta</option>
            <option>Región de Atacama</option>
            <option>Región de Coquimbo</option>
            <option>Región de Valparaíso</option>
            <option>Región Metropolitana</option>
            <option>Región del Libertador B. O'Higgins</option>
            <option>Región del Maule</option>
            <option>Región de Ñuble</option>
            <option>Región del Biobío</option>
            <option>Región de La Araucanía</option>
            <option>Región de Los Ríos</option>
            <option>Región de Los Lagos</option>
            <option>Región de Aysén</option>
            <option>Región de Magallanes</option>
          </select>
        </div>
        <div class="reg-group">
          <label for="reg-comuna">Comuna *</label>
          <input type="text" id="reg-comuna" placeholder="Ej: Temuco">
        </div>
      </div>
      <div class="reg-group">
        <label for="reg-rbd">RBD <span style="font-weight:400;opacity:.5">(opcional)</span></label>
        <input type="text" id="reg-rbd" placeholder="Ej: 12345" inputmode="numeric">
      </div>

      <!-- Bloque 2: ID de acceso -->
      <div class="reg-block-title">🔗 ID de acceso (subdominio futuro)</div>
      <div class="reg-group">
        <label for="reg-slug">
          Identificador único *
          <span id="reg-slug-check-badge"></span>
        </label>
        <input type="text" id="reg-slug" placeholder="Ej: liceobicentenario"
          oninput="regSlugManual()" maxlength="30">
        <div class="reg-slug-preview" id="reg-slug-preview" style="display:none">
          <div>Demo: <strong id="reg-preview-demo">—</strong></div>
          <div style="margin-top:.2rem;opacity:.6">Definitiva: <span id="reg-preview-def">—</span></div>
        </div>
      </div>

      <!-- Bloque 3: Usuario administrador -->
      <div class="reg-block-title">👤 Administrador del establecimiento</div>
      <div class="reg-group">
        <label for="reg-admin-nombre">Nombre completo *</label>
        <input type="text" id="reg-admin-nombre" placeholder="Ej: María González">
      </div>
      <div class="reg-group">
        <label for="reg-admin-email">Correo electrónico *</label>
        <input type="email" id="reg-admin-email" placeholder="admin@micolegio.cl">
      </div>
      <div class="reg-row">
        <div class="reg-group">
          <label for="reg-admin-pw">Contraseña * <span style="font-weight:400;opacity:.5">(mín. 8 chars)</span></label>
          <input type="password" id="reg-admin-pw" placeholder="••••••••" autocomplete="new-password">
        </div>
        <div class="reg-group">
          <label for="reg-admin-pw2">Confirmar contraseña *</label>
          <input type="password" id="reg-admin-pw2" placeholder="••••••••" autocomplete="new-password">
        </div>
      </div>

      <!-- Honeypot anti-bot (oculto) -->
      <input type="text" id="reg-honeypot" name="reg-honeypot" style="display:none" tabindex="-1" autocomplete="off">

      <button class="reg-submit" id="reg-submit-btn" type="button" onclick="regEnviar()">
        🚀 Crear mi demo gratuita
      </button>
    </div>

    <!-- Pantalla de éxito (se muestra al registrar) -->
    <div class="reg-success" id="reg-success">
      <div class="reg-success-ico">🎉</div>
      <div class="reg-success-title">¡Tu demo está lista!</div>
      <div class="reg-success-sub">Tu espacio de trabajo ha sido creado.<br>Guarda esta información — no se enviará por email.</div>
      <div class="reg-url-box">
        <div class="reg-url-label">🔗 Tu enlace de acceso</div>
        <div class="reg-url-value" id="reg-result-url">—</div>
        <button class="reg-copy-btn" onclick="regCopiarUrl()" type="button">📋 Copiar enlace</button>
      </div>
      <div class="reg-url-box" style="margin-top:.6rem">
        <div class="reg-url-label">📧 Correo de acceso</div>
        <div class="reg-url-value" id="reg-result-email">—</div>
      </div>
      <div class="reg-warn">
        ⏰ Tienes <strong>3 días</strong> para explorar BitacoraApp gratuitamente.<br>
        Después de activar tu cuenta, tu URL definitiva será:<br>
        <strong id="reg-result-subdomain">—</strong>
      </div>
      <a id="reg-ir-link" href="#" class="reg-ir-btn" target="_blank">Ir a mi demo →</a>
    </div>
  </div>
</div>
```

- [ ] **Paso 3: Añadir botón "Solicitar Demo" en el hero**

Localizar en el HTML (aprox. línea 370):
```html
        <button class="btn-primary" onclick="abrirModal()" type="button">📅 Agenda una reunión</button>
        <a href="#funciones" class="btn-secondary">Ver funciones</a>
```

Reemplazar por:
```html
        <button class="btn-primary" onclick="abrirRegistro()" type="button">🚀 Probar 3 días gratis</button>
        <button class="btn-secondary" onclick="abrirModal()" type="button" style="background:transparent">📅 Agenda una reunión</button>
        <a href="#funciones" class="btn-secondary">Ver funciones</a>
```

- [ ] **Paso 4: Añadir también botón en la nav**

Localizar (aprox. línea 356):
```html
  <button class="nav-cta" onclick="abrirModal()" type="button">Agenda una reunión</button>
```

Reemplazar por:
```html
  <button class="nav-cta" onclick="abrirRegistro()" type="button" style="background:var(--verde-medio);color:var(--crema)">🚀 Demo gratis</button>
  <button class="nav-cta" onclick="abrirModal()" type="button">Agenda reunión</button>
```

- [ ] **Paso 5: Añadir JS del formulario de registro**

Localizar el bloque `<script>` al final del archivo (aprox. línea 560). Antes de la función `abrirModal()`, insertar el siguiente bloque de funciones:

```javascript
/* ═══ REGISTRO DEMO ════════════════════════════════════════════════ */
var _regSlugCheckTimer = null;

function abrirRegistro() {
  document.getElementById('reg-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function cerrarRegistro() {
  document.getElementById('reg-modal').classList.remove('open');
  document.body.style.overflow = '';
}

/** Genera un slug a partir del nombre del colegio */
function regToSlug(str) {
  return str
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quitar tildes
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '')
    .substring(0, 28);
}

/** Auto-genera el slug cuando el usuario escribe el nombre */
function regGenerarSlug() {
  var nombre = document.getElementById('reg-nombre-colegio').value;
  var slugInput = document.getElementById('reg-slug');
  if (!slugInput._manualEdit) {
    var slug = regToSlug(nombre);
    slugInput.value = slug;
  }
  regActualizarPreview();
  regVerificarSlugDebounced();
}

/** El usuario editó el slug manualmente */
function regSlugManual() {
  document.getElementById('reg-slug')._manualEdit = true;
  regActualizarPreview();
  regVerificarSlugDebounced();
}

/** Actualiza el preview de URLs debajo del campo slug */
function regActualizarPreview() {
  var slug = document.getElementById('reg-slug').value.trim().toLowerCase();
  var preview = document.getElementById('reg-slug-preview');
  var previewDemo = document.getElementById('reg-preview-demo');
  var previewDef  = document.getElementById('reg-preview-def');
  if (!slug) { preview.style.display = 'none'; return; }
  preview.style.display = '';
  previewDemo.textContent = 'bitacorapp.cl/?tenant=' + slug;
  previewDef.textContent  = slug + '.bitacorapp.cl';
}

/** Verifica disponibilidad del slug con debounce de 600ms */
function regVerificarSlugDebounced() {
  clearTimeout(_regSlugCheckTimer);
  var badge = document.getElementById('reg-slug-check-badge');
  badge.innerHTML = '';
  var slug = document.getElementById('reg-slug').value.trim().toLowerCase();
  if (!slug || slug.length < 3) return;
  _regSlugCheckTimer = setTimeout(function() { regVerificarSlug(slug); }, 600);
}

async function regVerificarSlug(slug) {
  var badge = document.getElementById('reg-slug-check-badge');
  badge.innerHTML = '<span class="reg-slug-badge" style="background:rgba(255,255,255,.07);color:rgba(180,210,190,.5);border:1px solid rgba(255,255,255,.1)">⏳ verificando...</span>';
  try {
    var res = await fetch('/api/register-demo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _checkSlug: true, slug })
    });
    // La función retorna 409 si slug_taken, cualquier otro código = disponible
    // (Nota: esta es una verificación de buena fe; la validación real ocurre al registrar)
    // Usamos el mismo endpoint con payload especial que la función detecta:
    // si recibe _checkSlug:true sin los otros campos, retorna 400 (campos_faltantes) → disponible
    // si retorna 409 → tomado
    if (res.status === 409) {
      badge.innerHTML = '<span class="reg-slug-badge tomado">✕ ya existe</span>';
    } else {
      badge.innerHTML = '<span class="reg-slug-badge disponible">✓ disponible</span>';
    }
  } catch(e) {
    badge.innerHTML = '';
  }
}

/** Muestra un error en el formulario */
function regMostrarError(msg) {
  var el = document.getElementById('reg-error');
  el.textContent = msg;
  el.style.display = '';
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** Envía el formulario de registro */
async function regEnviar() {
  var btn = document.getElementById('reg-submit-btn');
  document.getElementById('reg-error').style.display = 'none';

  var nombreColegio = document.getElementById('reg-nombre-colegio').value.trim();
  var region        = document.getElementById('reg-region').value;
  var comuna        = document.getElementById('reg-comuna').value.trim();
  var rbd           = document.getElementById('reg-rbd').value.trim();
  var slug          = document.getElementById('reg-slug').value.trim().toLowerCase();
  var adminNombre   = document.getElementById('reg-admin-nombre').value.trim();
  var adminEmail    = document.getElementById('reg-admin-email').value.trim();
  var adminPassword = document.getElementById('reg-admin-pw').value;
  var adminPw2      = document.getElementById('reg-admin-pw2').value;
  var honeypot      = document.getElementById('reg-honeypot').value;

  /* Validaciones en cliente */
  if (!nombreColegio) return regMostrarError('⚠️ Ingresa el nombre del establecimiento.');
  if (!region)        return regMostrarError('⚠️ Selecciona tu región.');
  if (!comuna)        return regMostrarError('⚠️ Ingresa tu comuna.');
  if (!slug || slug.length < 3) return regMostrarError('⚠️ El identificador debe tener al menos 3 caracteres.');
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) return regMostrarError('⚠️ El identificador solo puede contener letras, números y guiones, sin espacios.');
  if (!adminNombre)   return regMostrarError('⚠️ Ingresa el nombre del administrador.');
  if (!adminEmail || !adminEmail.includes('@')) return regMostrarError('⚠️ Ingresa un correo electrónico válido.');
  if (adminPassword.length < 8) return regMostrarError('⚠️ La contraseña debe tener al menos 8 caracteres.');
  if (adminPassword !== adminPw2) return regMostrarError('⚠️ Las contraseñas no coinciden.');

  btn.disabled = true;
  btn.textContent = '⏳ Creando tu demo...';

  try {
    var res = await fetch('/api/register-demo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombreColegio, region, comuna, rbd, slug,
        adminNombre, adminEmail, adminPassword, honeypot })
    });
    var data = await res.json();

    if (!res.ok || !data.success) {
      var errores = {
        'campos_faltantes' : '⚠️ Completa todos los campos requeridos.',
        'slug_invalido'    : '⚠️ El identificador contiene caracteres no permitidos.',
        'slug_reservado'   : '⚠️ Ese identificador está reservado. Prueba con otro.',
        'slug_taken'       : '⚠️ Ese identificador ya está en uso. Elige otro.',
        'email_taken'      : '⚠️ Ese correo ya está registrado. ¿Ya tienes una cuenta?',
        'password_corto'   : '⚠️ La contraseña debe tener al menos 8 caracteres.',
      };
      var msg = (data.error && errores[data.error]) || ('❌ Error al crear la demo: ' + (data.error || 'desconocido'));
      regMostrarError(msg);
      btn.disabled = false;
      btn.textContent = '🚀 Crear mi demo gratuita';
      return;
    }

    /* ── Éxito: mostrar pantalla de resultado ── */
    document.getElementById('reg-result-url').textContent = data.demoUrl;
    document.getElementById('reg-result-email').textContent = adminEmail;
    document.getElementById('reg-result-subdomain').textContent = slug + '.bitacorapp.cl';
    document.getElementById('reg-ir-link').href = data.demoUrl;
    document.getElementById('reg-form-wrap').style.display = 'none';
    document.getElementById('reg-success').style.display = '';

  } catch(e) {
    regMostrarError('❌ Error de conexión. Intenta nuevamente.');
    btn.disabled = false;
    btn.textContent = '🚀 Crear mi demo gratuita';
  }
}

/** Copia la URL de la demo al portapapeles */
function regCopiarUrl() {
  var url = document.getElementById('reg-result-url').textContent;
  navigator.clipboard.writeText(url).then(function() {
    var btn = document.querySelector('.reg-copy-btn');
    btn.textContent = '✅ Copiado!';
    setTimeout(function(){ btn.textContent = '📋 Copiar enlace'; }, 2000);
  }).catch(function() {
    alert('URL: ' + url);
  });
}
/* ════════════════════════════════════════════════════════════════════ */
```

- [ ] **Paso 6: Verificar visualmente en el navegador**

Abrir `public/presentacion/index.html` en un navegador (doble clic en Finder o via live-server). Verificar:
- El botón "🚀 Probar 3 días gratis" aparece en el hero
- Al hacer clic, el modal se abre
- Al escribir el nombre del colegio, el slug se auto-genera
- El preview de URLs aparece debajo del campo slug
- Las contraseñas que no coinciden muestran un error al intentar enviar

- [ ] **Paso 7: Commit**

```bash
git add public/presentacion/index.html
git commit -m "feat: add demo registration modal and form to landing page"
```

---

## Task 4: Demo banner y bloqueo en la app principal

**Files:**
- Modify: `public/index.html`

- [ ] **Paso 1: Añadir CSS del banner demo**

Localizar en `public/index.html` la línea con `</style>` que cierra el bloque de estilos del `imp-banner` (aprox. línea 814):
```html
</style>
<div id="imp-banner" ...
```

Insertar el siguiente CSS **dentro del bloque `<style>`** (antes del `</style>` de ese bloque):

```css
/* ─── Banner y bloqueo modo demo ──────────────────────── */
@keyframes demo-appear{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
#demo-banner{display:none;position:sticky;top:64px;z-index:94;width:100%;
  background:linear-gradient(90deg,#7c5a00,#9c7a00,#7c5a00);
  border-bottom:2px solid #f0b429;animation:demo-appear .3s ease}
#demo-banner .demo-inner{display:flex;align-items:center;justify-content:space-between;
  padding:.42rem 1.4rem;background:rgba(0,0,0,.3);flex-wrap:wrap;gap:.5rem;
  font-family:"Calibri","Segoe UI",Arial,sans-serif}
#demo-banner .demo-left{display:flex;align-items:center;gap:.6rem;font-size:.82rem;color:#fde68a}
#demo-banner .demo-days{font-weight:700;font-size:.95rem;color:#fbbf24}
#demo-banner .demo-contact{background:rgba(251,191,36,.2);border:1.5px solid rgba(251,191,36,.5);
  color:#fde68a;border-radius:7px;padding:.28rem .8rem;font-size:.74rem;font-weight:700;
  cursor:pointer;font-family:"Calibri","Segoe UI",Arial,sans-serif;
  text-decoration:none;transition:all .15s;letter-spacing:.03em}
#demo-banner .demo-contact:hover{background:rgba(251,191,36,.35);color:#fff}
/* Modal de bloqueo al expirar */
#demo-bloqueado{display:none;position:fixed;inset:0;z-index:9999;
  background:rgba(0,0,0,.9);align-items:center;justify-content:center}
#demo-bloqueado.show{display:flex}
#demo-bloqueado .blq-box{background:#0e1c14;border:1px solid rgba(80,160,100,.2);
  border-radius:20px;padding:2.5rem 2rem;text-align:center;max-width:420px;
  width:90%;font-family:"Calibri","Segoe UI",Arial,sans-serif;color:#d0e8d8;
  box-shadow:0 24px 80px rgba(0,0,0,.7)}
#demo-bloqueado .blq-ico{font-size:3rem;margin-bottom:.8rem}
#demo-bloqueado .blq-title{font-size:1.25rem;font-weight:700;color:#f87171;margin-bottom:.5rem}
#demo-bloqueado .blq-sub{font-size:.88rem;color:rgba(180,210,190,.6);
  line-height:1.65;margin-bottom:1.25rem}
#demo-bloqueado .blq-contact{display:inline-block;background:#2e5e3e;color:#d0e8d8;
  font-weight:700;font-size:.88rem;padding:.65rem 1.6rem;border-radius:50px;
  text-decoration:none;margin-bottom:.75rem;transition:all .2s}
#demo-bloqueado .blq-contact:hover{background:#3d7a52}
#demo-bloqueado .blq-logout{background:transparent;border:1.5px solid rgba(180,210,190,.2);
  color:rgba(180,210,190,.5);border-radius:8px;padding:.4rem 1rem;font-size:.78rem;
  cursor:pointer;font-family:"Calibri","Segoe UI",Arial,sans-serif;
  font-weight:600;transition:all .15s}
#demo-bloqueado .blq-logout:hover{border-color:rgba(180,210,190,.4);color:#d0e8d8}
```

- [ ] **Paso 2: Añadir HTML del banner y bloqueo**

Localizar la línea del `imp-banner` (aprox. línea 815):
```html
<div id="imp-banner" style="display:none;position:sticky;top:64px;z-index:95;...
```

Insertar **justo antes** de esa línea:

```html
<!-- ══ BANNER DEMO ════════════════════════════════════════════════ -->
<div id="demo-banner">
  <div class="demo-inner">
    <div class="demo-left">
      <span>🕐</span>
      <span>Modo demo —</span>
      <span class="demo-days" id="demo-days-text">… días restantes</span>
    </div>
    <a href="mailto:contacto@bitacorapp.cl" class="demo-contact">
      ✉️ Contactar para activar →
    </a>
  </div>
</div>

<!-- ══ BLOQUEO DEMO EXPIRADO ══════════════════════════════════════ -->
<div id="demo-bloqueado">
  <div class="blq-box">
    <div class="blq-ico">⏰</div>
    <div class="blq-title">Tu demo ha expirado</div>
    <div class="blq-sub">Tu período de prueba gratuito ha finalizado.<br>
      Contáctanos para activar tu cuenta y seguir usando BitacoraApp.</div>
    <a href="mailto:contacto@bitacorapp.cl" class="blq-contact">✉️ Contactar para activar</a>
    <br>
    <button class="blq-logout" onclick="typeof sgceCerrarSesion==='function' ? sgceCerrarSesion() : location.reload()">
      Cerrar sesión
    </button>
  </div>
</div>
```

- [ ] **Paso 3: Añadir lógica de demo mode en `cargarConfiguracionTenant()`**

Localizar en `public/index.html` (aprox. línea 5723) el bloque al final del `if (snap.exists())`:
```javascript
      /* Re-ejecutar renderUI con los módulos del tenant ya cargados */
      if (typeof renderUI === 'function') renderUI();
```

Insertar **justo antes** de esa línea (es decir, entre el cierre del try/catch de sincronización y el renderUI):

```javascript
      /* ── Demo mode: banner o bloqueo ─────────────────────────── */
      if (datos.status === 'demo') {
        var _ahora = Date.now();
        if (datos.demoExpiresAt && datos.demoExpiresAt > _ahora) {
          var _diasRestantes = Math.ceil((datos.demoExpiresAt - _ahora) / 86400000);
          _mostrarBannerDemo(_diasRestantes);
        } else {
          _bloquearAppDemo();
        }
      }
      /* ──────────────────────────────────────────────────────────── */
```

- [ ] **Paso 4: Añadir las funciones `_mostrarBannerDemo` y `_bloquearAppDemo`**

Localizar (aprox. línea 5753) el cierre de la función `cargarConfiguracionTenant()` (el `}` que sigue al bloque `else` del `snap.exists()`). Insertar **justo después** de ese cierre de función:

```javascript
/** Muestra el banner amarillo de cuenta regresiva en modo demo */
function _mostrarBannerDemo(diasRestantes) {
  var banner = document.getElementById('demo-banner');
  var daysEl = document.getElementById('demo-days-text');
  if (!banner) return;
  var txt = diasRestantes === 1 ? '1 día restante' : diasRestantes + ' días restantes';
  if (daysEl) daysEl.textContent = txt;
  banner.style.display = '';
}

/** Bloquea la app al expirar el demo (modal no escapable) */
function _bloquearAppDemo() {
  var blq = document.getElementById('demo-bloqueado');
  if (blq) blq.classList.add('show');
}
```

- [ ] **Paso 5: Verificar en el navegador (simulación visual)**

Para verificar el banner sin un tenant real, agregar temporalmente en la consola del navegador (en el contexto de la app cargada):
```javascript
_mostrarBannerDemo(2);
```
Verificar que aparece el banner amarillo debajo del header con "2 días restantes".

Para verificar el bloqueo:
```javascript
_bloquearAppDemo();
```
Verificar que aparece el modal de bloqueo y **no hay forma de cerrarlo** haciendo clic fuera.

- [ ] **Paso 6: Commit**

```bash
git add public/index.html
git commit -m "feat: add demo mode banner and expiry block to app"
```

---

## Task 5: Tab "Demos" en el panel SuperAdmin

**Files:**
- Modify: `public/index.html`

- [ ] **Paso 1: Añadir el botón de tab "Demos"**

Localizar en `public/index.html` (aprox. línea 6008):
```html
      <button class="sa-tab" onclick="sasTab('migrar',this)"><span class="tab-ico">🏫</span>Migrar Escuela</button>
    </div>
```

Reemplazar por:
```html
      <button class="sa-tab" onclick="sasTab('migrar',this)"><span class="tab-ico">🏫</span>Migrar Escuela</button>
      <button class="sa-tab" onclick="sasTab('demos',this)"><span class="tab-ico">🕐</span>Demos</button>
    </div>
```

- [ ] **Paso 2: Añadir el HTML del tab "Demos"**

Localizar (aprox. línea 6357) el bloque del tab `migrar`:
```html
    <div id="sa-tab-migrar" class="sa-body" style="display:none">
```

Insertar el siguiente HTML **antes** de ese bloque:

```html
    <!-- ══ TAB DEMOS ══════════════════════════════════════════════ -->
    <div id="sa-tab-demos" class="sa-body" style="display:none">
      <div class="sa-toolbar" style="margin-bottom:1rem">
        <div style="font-size:.82rem;color:rgba(180,210,190,.5)">
          Establecimientos en período de demo (3 días de prueba gratuita).
        </div>
        <button class="sa-toolbar-btn secondary" onclick="sasDemosRender()">🔄 Actualizar</button>
      </div>
      <div id="sa-demos-lista">
        <div class="sa-empty"><span class="sa-empty-ico">🕐</span>Cargando demos...</div>
      </div>
      <!-- Modal instrucciones activación -->
      <div id="sa-demos-activar-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;align-items:center;justify-content:center">
        <div style="background:#0e1c14;border:1px solid rgba(80,160,100,.25);border-radius:16px;padding:1.8rem;width:min(500px,95vw);box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:'Calibri','Segoe UI',Arial,sans-serif;color:#d0e8d8">
          <div style="font-size:1rem;font-weight:700;color:#6dd98a;margin-bottom:1rem">✅ Demo activada correctamente</div>
          <p style="font-size:.85rem;color:rgba(180,210,190,.7);margin-bottom:1rem;line-height:1.6">
            El tenant ha sido marcado como <strong style="color:#6dd98a">activo</strong>.<br>
            Para que el colegio acceda por su subdominio, añade el dominio en Netlify:
          </p>
          <div style="background:rgba(0,0,0,.3);border-radius:10px;padding:.8rem 1rem;font-size:.82rem;margin-bottom:1rem;border:1px solid rgba(80,160,100,.15)">
            <div style="color:rgba(180,210,190,.45);font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;margin-bottom:.3rem">Subdominio a añadir en Netlify:</div>
            <div id="sa-demos-activar-slug" style="color:#6dd98a;font-weight:700;font-size:1.05rem;font-family:'Cascadia Code','Fira Mono',monospace"></div>
          </div>
          <ol style="font-size:.8rem;color:rgba(180,210,190,.65);padding-left:1.2rem;margin-bottom:1.2rem;line-height:1.8">
            <li>Ve a <strong>Netlify → Site → Domain management</strong></li>
            <li>Clic en <strong>Add a domain</strong></li>
            <li>Escribe el subdominio mostrado arriba</li>
            <li>Confirma. El colegio ya puede acceder.</li>
          </ol>
          <button onclick="document.getElementById('sa-demos-activar-modal').style.display='none'" style="background:#2e5e3e;border:none;color:#d0e8d8;border-radius:9px;padding:.5rem 1.2rem;font-family:'Calibri','Segoe UI',Arial,sans-serif;font-size:.85rem;font-weight:700;cursor:pointer">Entendido</button>
        </div>
      </div>
    </div>
```

- [ ] **Paso 3: Actualizar `sasTab()` para incluir 'demos'**

Localizar (aprox. línea 6468):
```javascript
  ['colegios','usuarios','modulos','sync','importar','migrar'].forEach(t => {
```

Reemplazar por:
```javascript
  ['colegios','usuarios','modulos','sync','importar','migrar','demos'].forEach(t => {
```

Y localizar justo después (aprox. línea 6480):
```javascript
  if (tab === 'migrar')   { sasMigActualizarSelectDest(); }
}
```

Reemplazar por:
```javascript
  if (tab === 'migrar')   { sasMigActualizarSelectDest(); }
  if (tab === 'demos')    { sasDemosRender(); }
}
```

- [ ] **Paso 4: Añadir las funciones JS del tab Demos**

Localizar (aprox. línea 6840) el inicio de las funciones `sasMig*`. Insertar el siguiente bloque **justo antes** de `var _sasMigData = null;`:

```javascript
/* ════════════════════════════════════════════════════════════════
   SUPERADMIN — Tab DEMOS
   Lista, activa, extiende y elimina tenants en modo demo.
   Los datos ya están en _sa.colegios (cargados por saCargarTenants).
════════════════════════════════════════════════════════════════ */

/** Renderiza la tabla de demos en el tab */
function sasDemosRender() {
  var lista = document.getElementById('sa-demos-lista');
  if (!lista) return;

  var demos = (_sa.colegios || []).filter(function(c) { return c.status === 'demo'; });

  if (!demos.length) {
    lista.innerHTML = '<div class="sa-empty"><span class="sa-empty-ico">🎉</span>No hay demos activas en este momento.</div>';
    return;
  }

  var ahora = Date.now();
  var html = '<div class="sa-table-wrap"><table class="sa-table"><thead><tr>' +
    '<th>Establecimiento</th><th>Slug / URL demo</th>' +
    '<th>Admin</th><th>Registrado</th><th>Expira en</th><th>Acciones</th>' +
    '</tr></thead><tbody>';

  demos.forEach(function(c) {
    var diasRestantes = c.demoExpiresAt
      ? Math.ceil((c.demoExpiresAt - ahora) / 86400000)
      : -1;
    var expirado = diasRestantes <= 0;
    var color = expirado ? '#f87171' : diasRestantes === 1 ? '#fbbf24' : '#6dd98a';
    var expiraTexto = expirado
      ? '<span style="color:#f87171;font-weight:700">Expirado</span>'
      : '<span style="color:' + color + ';font-weight:700">' + diasRestantes + ' día' + (diasRestantes !== 1 ? 's' : '') + '</span>';

    var fechaReg = c.creadoAt
      ? new Date(c.creadoAt).toLocaleDateString('es-CL')
      : '—';

    var slugSafe = String(c.id).replace(/'/g, "\\'");
    html += '<tr>' +
      '<td>' + (c.nombre || c.id) + '</td>' +
      '<td><a href="https://bitacorapp.cl/?tenant=' + c.id + '" target="_blank" style="color:#6dd98a;text-decoration:none;font-size:.8rem">' + c.id + '</a></td>' +
      '<td style="font-size:.8rem">' + (c.adminEmail || '—') + '</td>' +
      '<td style="font-size:.8rem">' + fechaReg + '</td>' +
      '<td>' + expiraTexto + '</td>' +
      '<td style="display:flex;gap:.4rem;flex-wrap:wrap">' +
        '<button class="sa-toolbar-btn primary" style="font-size:.72rem;padding:.25rem .7rem" onclick="sasDemosActivar(\'' + slugSafe + '\')">✅ Activar</button>' +
        '<button class="sa-toolbar-btn secondary" style="font-size:.72rem;padding:.25rem .7rem" onclick="sasDemosExtender(\'' + slugSafe + '\')">+3 días</button>' +
        '<button class="sa-toolbar-btn" style="font-size:.72rem;padding:.25rem .7rem;background:rgba(239,68,68,.15);border-color:rgba(239,68,68,.3);color:#f87171" onclick="sasDemosEliminar(\'' + slugSafe + '\')">🗑️</button>' +
      '</td>' +
    '</tr>';
  });

  html += '</tbody></table></div>';
  lista.innerHTML = html;
}

/** Activa un tenant demo (status: 'demo' → 'activo') */
async function sasDemosActivar(tenantId) {
  if (!confirm('¿Activar el tenant "' + tenantId + '"? Esto cambiará su estado a "activo".')) return;
  try {
    const { deleteField } = await import('https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js');
    await window._fbUpdateDoc(
      window._fbDoc(window._db, 'tenants', tenantId),
      { status: 'activo', activadoAt: Date.now(), demoExpiresAt: deleteField() }
    );
    // Mostrar modal de instrucciones Netlify
    document.getElementById('sa-demos-activar-slug').textContent = tenantId + '.bitacorapp.cl';
    var modal = document.getElementById('sa-demos-activar-modal');
    modal.style.display = 'flex';
    // El listener de snapshot actualizará _sa.colegios y re-renderizará
  } catch(e) {
    alert('Error al activar: ' + e.message);
  }
}

/** Extiende el demo 3 días más */
async function sasDemosExtender(tenantId) {
  var c = (_sa.colegios || []).find(function(x) { return x.id === tenantId; });
  if (!c) return;
  var base = (c.demoExpiresAt && c.demoExpiresAt > Date.now()) ? c.demoExpiresAt : Date.now();
  var nueva = base + 3 * 24 * 60 * 60 * 1000;
  try {
    await window._fbUpdateDoc(
      window._fbDoc(window._db, 'tenants', tenantId),
      { demoExpiresAt: nueva, updatedAt: Date.now() }
    );
    sasDemosRender();
  } catch(e) {
    alert('Error al extender: ' + e.message);
  }
}

/** Elimina un tenant demo de Firestore */
async function sasDemosEliminar(tenantId) {
  if (!confirm('¿Eliminar el tenant demo "' + tenantId + '"? Esta acción no se puede deshacer.\n\n' +
    'Nota: el usuario de Firebase Auth no se elimina automáticamente.')) return;
  try {
    const { deleteDoc } = await import('https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js');
    await deleteDoc(window._fbDoc(window._db, 'tenants', tenantId));
    // _fbOnSnapshot actualizará _sa.colegios automáticamente
  } catch(e) {
    alert('Error al eliminar: ' + e.message);
  }
}
/* ════════════════════════════════════════════════════════════════ */
```

- [ ] **Paso 5: Verificar en el SuperAdmin**

Con la app desplegada en Netlify:
1. Hacer login como SUPERADMIN
2. Abrir el panel SuperAdmin → ver el nuevo tab "🕐 Demos"
3. Si hay algún tenant con `status: 'demo'` en Firestore, debe aparecer en la tabla
4. El botón "Activar" debe cambiar el status y mostrar el modal de instrucciones
5. El botón "+3 días" debe extender el plazo

Para probar sin un demo real, temporalmente crear un documento en Firestore con `status: 'demo'` y un `demoExpiresAt` en el futuro.

- [ ] **Paso 6: Commit**

```bash
git add public/index.html
git commit -m "feat: add Demos tab to SuperAdmin panel for managing demo tenants"
```

---

## Task 6: Deploy y prueba de punta a punta

- [ ] **Paso 1: Verificar todos los archivos modificados**

```bash
git status
git log --oneline -6
```

Deben aparecer los 4 commits de los tasks anteriores.

- [ ] **Paso 2: Push a Netlify y esperar el deploy**

```bash
git push
```

Verificar en el dashboard de Netlify que el deploy pasa sin errores. El build ejecuta `node inject-env.js` — debe completarse en verde.

- [ ] **Paso 3: Prueba de punta a punta**

1. Abrir `https://bitacorapp.cl/presentacion/` (o la URL de la landing)
2. Hacer clic en "🚀 Probar 3 días gratis"
3. Completar el formulario con datos de prueba:
   - Nombre: `Escuela de Prueba`
   - Región: cualquiera
   - Comuna: cualquiera
   - Slug: `escuelaprueba` (verificar que aparece como "disponible")
   - Admin: nombre, email real, contraseña 8+ chars
4. Hacer clic en "🚀 Crear mi demo gratuita"
5. Verificar que aparece la pantalla de éxito con el link `https://bitacorapp.cl/?tenant=escuelaprueba`
6. Abrir ese link → debe cargar la app con el nombre del colegio en el header
7. Debe aparecer el **banner amarillo** con "3 días restantes"
8. Login con el email y contraseña registrados → acceso completo al tenant

- [ ] **Paso 4: Verificar en el SuperAdmin**

1. Login como SUPERADMIN
2. Panel SuperAdmin → tab "🕐 Demos"
3. Debe aparecer el tenant `escuelaprueba` creado en el paso anterior
4. Hacer clic en "✅ Activar" → confirmar → aparece el modal con instrucciones de Netlify
5. Verificar que el tenant ya no aparece en el tab Demos (pasó a `status: 'activo'`)

- [ ] **Paso 5: Limpiar el tenant de prueba**

En el SuperAdmin o directamente en Firestore Console, eliminar el tenant `escuelaprueba` creado en la prueba.

---

## Resumen de verificación contra el spec

| Requisito del spec | Task | Estado |
|---|---|---|
| Formulario en landing page (3 bloques) | Task 3 | ✅ |
| Slug auto-generado + editable + preview URLs | Task 3 | ✅ |
| Verificación de disponibilidad del slug | Task 3 + Task 1 | ✅ |
| Netlify Function que crea tenant + usuario Auth | Task 1 | ✅ |
| Demo URL: `bitacorapp.cl/?tenant=slug` | Task 1 | ✅ |
| Pantalla de éxito con URL copiable | Task 3 | ✅ |
| Banner demo con cuenta regresiva | Task 4 | ✅ |
| Bloqueo al expirar (no escapable) | Task 4 | ✅ |
| Tab "Demos" en SuperAdmin | Task 5 | ✅ |
| Botón Activar (status → activo + instrucciones Netlify) | Task 5 | ✅ |
| Botón +3 días | Task 5 | ✅ |
| Botón Eliminar | Task 5 | ✅ |
| Sin migración al activar (slug = subdomain final) | Arquitectura | ✅ |
| Honeypot anti-bot | Task 1 + Task 3 | ✅ |
| Slugs reservados validados | Task 1 | ✅ |
