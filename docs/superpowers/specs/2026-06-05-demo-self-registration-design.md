# Demo Self-Registration — Diseño Técnico
**BitacoraApp (SGCE)** · 2026-06-05

## Contexto y problema

BitacoraApp es un SaaS multi-tenant para gestión escolar chilena. Cada colegio vive en
su propio subdominio `tenantid.bitacorapp.cl`, y ese subdominio debe añadirse manualmente
en Netlify (restricción de presupuesto: plan sin wildcard automático).

El problema: los colegios interesados no pueden probar el sistema de forma autónoma sin
que el admin los onboardee primero. Esto crea fricción y pérdida de leads.

## Objetivo

Permitir que un colegio se registre solo, reciba acceso inmediato a una demo de 3 días,
y que al confirmar el pago el administrador (Ignacio) solo tenga que: (1) añadir el
subdominio en Netlify y (2) hacer clic en "Activar" en el SuperAdmin.

---

## Enfoque elegido: Slug = Subdominio final (sin migración)

El tenant ID generado en el registro **es permanente y será el subdominio definitivo**.

- Demo: `bitacorapp.cl/?tenant=liceobicentenario`
- Post-pago: `liceobicentenario.bitacorapp.cl`

El mismo documento Firestore `tenants/liceobicentenario` sirve para ambas etapas.
La activación solo cambia el campo `status` de `'demo'` a `'activo'`.

---

## Componentes

### 1. Formulario de registro (Landing Page)

**Archivo:** `public/presentacion/index.html`

Nueva sección visible en la landing page (botón "Solicitar Demo Gratuita" en el hero,
abre un modal o sección in-page con scroll).

**Campos — Bloque 1: Datos del colegio**
| Campo | Tipo | Requerido |
|---|---|---|
| Nombre del colegio | texto | ✅ |
| Región | select | ✅ |
| Comuna | texto | ✅ |
| RBD | número | ❌ |

**Campos — Bloque 2: ID de acceso (slug)**
- Auto-generado al escribir el nombre (`"Liceo San Pedro"` → `liceosanpedro`)
- Editable manualmente: solo `[a-z0-9-]`, 3–30 caracteres
- Botón "Verificar disponibilidad" (consulta a la función antes de enviar)
- Preview en tiempo real:
  - Demo: `bitacorapp.cl/?tenant={slug}`
  - Definitiva: `{slug}.bitacorapp.cl`

**Campos — Bloque 3: Usuario administrador**
| Campo | Tipo | Requerido |
|---|---|---|
| Nombre completo | texto | ✅ |
| Email | email | ✅ |
| Contraseña | password | ✅ (mín. 8 chars) |
| Confirmar contraseña | password | ✅ |

**Campo oculto anti-bot:** `honeypot` (debe llegar vacío al servidor).

**Pantalla de éxito (post-registro):**
- URL de acceso (copiable con un clic): `https://bitacorapp.cl/?tenant={slug}`
- Email y contraseña del admin (recordatorio explícito: no se envían por email)
- Aviso: "Tienes 3 días para explorar BitacoraApp gratuitamente."
- Nota: "Tu URL definitiva tras la activación: `{slug}.bitacorapp.cl`"
- Botón directo: "Ir a mi demo →"

---

### 2. Netlify Function: `register-demo.js`

**Ruta:** `netlify/functions/register-demo.js`
**Redirect en `netlify.toml`:** `/api/register-demo` → `/.netlify/functions/register-demo`

**Método:** POST (JSON body)

**Flujo de la función:**

```
1. Validar honeypot (campo vacío)
2. Validar campos requeridos
3. Validar slug: /^[a-z0-9-]{3,30}$/, no está en lista reservada
4. Verificar disponibilidad: GET Firestore tenants/{slug}
   → si existe: return 409 { error: 'slug_taken' }
5. Crear usuario en Firebase Auth REST API:
   POST identitytoolkit.googleapis.com/v1/accounts:signUp?key={FIREBASE_API_KEY}
   { email, password, displayName, returnSecureToken: false }
   → obtener uid
6. Calcular demoExpiresAt = Date.now() + 3 * 24 * 60 * 60 * 1000
7. Crear documento en Firestore tenants/{slug}:
   {
     nombreColegio, region, comuna, rbd,
     status: 'demo',
     demoExpiresAt,
     creadoAt: Date.now(),
     adminEmail, adminNombre,
     usuarios: [{
       uid, nombre: adminNombre, email: adminEmail,
       rol: 'admin',
       modulosPermitidos: [...permisos de SGCE_RBAC.admin en index.html]
     }],
     modulos: { todos los módulos en true }
   }
8. Return 200 { success: true, slug, demoUrl, demoExpiresAt }
```

**Slugs reservados:** `demo`, `admin`, `superadmin`, `default`, `app`, `api`,
`www`, `mail`, `test`, `staging`, `bitacorapp`, `sgce`, `pago`, `login`,
`denuncias`, `presentacion`

**Variables de entorno usadas:**
- `FIREBASE_API_KEY` (ya existe)
- `FIREBASE_PROJECT_ID` (ya existe)

**Respuestas de error:**
| Código | Causa |
|---|---|
| 400 | Campos faltantes o slug inválido |
| 409 | Slug ya tomado |
| 422 | Email ya registrado en Firebase Auth |
| 500 | Error interno |

---

### 3. Demo Mode en la App (`public/index.html`)

**En `cargarTenant()`**, después de cargar los datos del tenant:

```javascript
// Demo mode check
if (datos.status === 'demo') {
  const ahora = Date.now();
  if (datos.demoExpiresAt && datos.demoExpiresAt > ahora) {
    // Mostrar banner amarillo sticky
    const diasRestantes = Math.ceil((datos.demoExpiresAt - ahora) / 86400000);
    _mostrarBannerDemo(diasRestantes);
  } else {
    // Bloquear la app completamente
    _bloquearAppDemo();
  }
}
```

**Banner demo (sticky, parte superior de la app):**
```
🕐 Modo demo — {N} día(s) restante(s) · [Contactar para activar →]
```
- Color: amarillo/ámbar, sobre el header
- El enlace "Contactar" abre el email o enlace de WhatsApp/contacto configurado

**Bloqueo al expirar:**
- Modal fullscreen que no se puede cerrar
- Mensaje: "Tu período de demo ha finalizado. Contáctanos para activar tu cuenta."
- Botón "Cerrar sesión" (único escape)
- No responde a Escape ni clic fuera

---

### 4. SuperAdmin — Tab "Demos"

**Nuevo tab en el panel SuperAdmin** (al lado de los tabs existentes)

**Vista:** tabla con todos los tenants donde `status === 'demo'`

| Columna | Descripción |
|---|---|
| Colegio | `nombreColegio` |
| Slug / URL | `slug` (link copiable a `?tenant=slug`) |
| Admin | `adminEmail` |
| Registrado | `creadoAt` formateado |
| Expira | días restantes (color: verde >1, amarillo =1, rojo expirado) |
| Acciones | botones abajo |

**Acciones por fila:**
- **[Activar]**: `status → 'activo'`, elimina `demoExpiresAt`. Muestra modal con instrucciones: "Añade `{slug}.bitacorapp.cl` en Netlify → Site configuration → Domain aliases."
- **[+3 días]**: `demoExpiresAt += 3 * 86400 * 1000`
- **[Eliminar]**: elimina el documento de Firestore (con confirmación). *Nota: el usuario Firebase Auth permanece; se elimina manualmente si es necesario.*

---

## Estructura de datos Firestore

### `tenants/{slug}` (documento de demo)
```json
{
  "nombreColegio": "Liceo Bicentenario",
  "region": "Región Metropolitana",
  "comuna": "Santiago",
  "rbd": "12345",
  "status": "demo",
  "demoExpiresAt": 1749456000000,
  "creadoAt": 1749196800000,
  "adminEmail": "admin@liceobicentenario.cl",
  "adminNombre": "Juan Pérez",
  "usuarios": [
    {
      "uid": "firebase-auth-uid-aqui",
      "nombre": "Juan Pérez",
      "email": "admin@liceobicentenario.cl",
      "rol": "admin",
      "modulosPermitidos": ["ver_protocolos", "ver_fichas", "ver_agenda", "..."]
    }
  ],
  "modulos": {
    "protocolos": true,
    "fichas": true,
    "derivaciones": true,
    "mediaciones": true,
    "citaciones": true,
    "reuniones": true,
    "agenda": true,
    "denuncias": true
  }
}
```

### Cambios al activar
```json
{
  "status": "activo",
  "activadoAt": 1749283200000
}
```
(`demoExpiresAt` se elimina con `deleteField()`)

---

## Cambios en archivos existentes

| Archivo | Cambio |
|---|---|
| `public/presentacion/index.html` | Sección/modal de registro, pantalla de éxito |
| `public/index.html` | Demo banner + bloqueo en `cargarTenant()`; tab "Demos" en SuperAdmin |
| `netlify/functions/register-demo.js` | Nuevo archivo |
| `netlify.toml` | Redirect `/api/register-demo`, CORS para la función |

---

## Consideraciones de seguridad

- **Honeypot anti-bot**: campo oculto en el formulario
- **Rate limiting**: Netlify incluye protección básica; la función puede limitar por IP usando los headers `x-forwarded-for`
- **Slugs reservados**: lista de palabras no permitidas
- **Contraseña mínima**: 8 caracteres, validado en cliente y en Firebase Auth
- **Firebase Auth REST API**: se usa la misma API key del proyecto (ya en las funciones existentes)
- **No exposición de credenciales**: la función corre en servidor, la API key solo está en variables de entorno de Netlify

---

## Flujo de activación paso a paso (para el admin)

1. Abrir panel SuperAdmin → tab "Demos"
2. Ver la solicitud pendiente, hacer clic en **[Activar]**
3. Copiar el slug mostrado en el modal de instrucciones
4. Ir a Netlify → Site configuration → Domain management → Add domain alias: `{slug}.bitacorapp.cl`
5. Netlify propaga el DNS (instantáneo si ya tienen el wildcard CNAME configurado, o requiere añadir un CNAME en el proveedor DNS del tenant)
6. El colegio ya puede acceder por `{slug}.bitacorapp.cl`

---

## Fuera de alcance (posibles mejoras futuras)

- Envío de email de bienvenida al colegio
- Panel de "Mi cuenta" dentro de la app para ver estado de suscripción
- Pago automático integrado (Khipu, Transbank, Stripe)
- Webhook que notifique al admin por WhatsApp o Telegram al nuevo registro
