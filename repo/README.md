# SGCE — Cobertura de Seguridad Netlify

Solución para proteger la API key de Groq y cumplir estándares de seguridad al desplegar en Netlify.

---

## El problema que resuelve

Tu `index.html` actual llama directamente a `/api/groq` desde el navegador.
Sin esta cobertura, **la API key de Groq estaría expuesta** al cliente o debería ser hardcodeada en el HTML.

Esta configuración crea un **proxy seguro** con una Netlify Function: el navegador llama a `/api/groq` → Netlify agrega la API key en el servidor → reenvía a Groq. La clave nunca sale del servidor.

---

## Estructura de archivos

```
tu-proyecto/
├── public/
│   └── index.html          ← tu archivo actual (sin cambios)
├── netlify/
│   └── functions/
│       └── groq.js         ← proxy seguro (nuevo)
├── netlify.toml            ← cabeceras de seguridad + rutas (nuevo)
├── .env.example            ← plantilla de variables (nuevo)
└── .gitignore              ← protege el .env real (nuevo)
```

---

## Pasos de instalación

### 1. Copiar los archivos
Coloca los archivos entregados en la raíz de tu proyecto respetando la estructura de arriba.
Mueve tu `index.html` dentro de la carpeta `public/`.

### 2. Configurar la variable de entorno en Netlify

Ve a tu sitio en Netlify → **Site configuration → Environment variables → Add variable**:

| Key | Value |
|-----|-------|
| `GROQ_API_KEY` | `gsk_tu_clave_real_aqui` |
| `ALLOWED_ORIGINS` | `https://tu-sitio.netlify.app` |

> **Nunca** escribas la clave directamente en el código ni en el repositorio.

### 3. (Opcional) Firebase config

La Firebase config (`apiKey`, `projectId`, etc.) está actualmente hardcodeada en el HTML en dos lugares (líneas ~4738 y ~17469).

La API key de Firebase es pública por diseño (se protege con Firebase Security Rules, no ocultándola), pero si quieres moverla igual a variables de entorno, puedes hacerlo con un segundo archivo de función o un script de build.

**Acción recomendada:** Verifica que tus **Firebase Security Rules** estén correctamente configuradas en la consola de Firebase — eso es lo que realmente protege tu base de datos.

### 4. Desplegar

```bash
# Si usas Netlify CLI
netlify deploy --prod

# O simplemente haz push a tu rama principal en Git
git add .
git commit -m "feat: agregar cobertura de seguridad Netlify"
git push
```

---

## Qué hace cada archivo

### `netlify/functions/groq.js`
- Recibe el `POST /api/groq` del navegador
- Valida el body (formato, tamaño, roles permitidos)
- Inyecta `GROQ_API_KEY` desde el entorno (nunca llega al cliente)
- Reenvía a `api.groq.com` y retorna la respuesta
- Incluye CORS configurable vía `ALLOWED_ORIGINS`

### `netlify.toml`
Aplica las siguientes cabeceras de seguridad a todas las rutas:

| Cabecera | Propósito |
|----------|-----------|
| `X-Frame-Options: DENY` | Previene clickjacking |
| `X-Content-Type-Options: nosniff` | Previene MIME sniffing |
| `Strict-Transport-Security` | Fuerza HTTPS por 1 año |
| `Referrer-Policy` | Limita información de referencia |
| `Permissions-Policy` | Desactiva cámara, micrófono, geolocalización |
| `Content-Security-Policy` | Restringe orígenes de scripts, estilos e imágenes |

---

## Ajuste fino del CSP

Si tu app carga recursos de dominios adicionales, agrégalos en `netlify.toml`:

```toml
Content-Security-Policy = """
  ...
  connect-src 'self'
              https://*.firebaseio.com
              https://otro-dominio.com;   ← agrega aquí
  ...
"""
```

Prueba el CSP con [https://csp-evaluator.withgoogle.com](https://csp-evaluator.withgoogle.com) antes de ir a producción.

---

## Verificación post-despliegue

1. Abre DevTools → pestaña **Network** → filtra por `/api/groq`
2. Confirma que la request va a tu dominio Netlify (no a `api.groq.com` directamente)
3. Inspecciona los **Response Headers** de cualquier página y verifica que aparezcan `X-Frame-Options`, `Strict-Transport-Security`, etc.
4. En la consola de Groq, confirma que las llamadas aparecen con origen de servidor (IP de Netlify), no de IP de usuario final.
