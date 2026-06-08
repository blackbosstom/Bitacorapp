# Entrevista con Apoderado — Módulo Nueva Mediación
**BitacoraApp (SGCE)** · 2026-06-06

## Contexto

El módulo "Nueva Mediación" en `public/index.html` registra entrevistas y mediaciones escolares. Actualmente los botones de motivo son: "Problemas académicos", "Problemas conductuales o de Convivencia Escolar", "Ausentismo escolar", "Otros". Se necesita agregar un nuevo motivo "Entrevista con apoderado" con comportamiento especial: falta automática, apoderado auto-agregado a participantes, y nota de registro en el modal de firmas.

---

## Cambios requeridos

### 1. Botón "Entrevista con apoderado" (primer lugar en el grid)

**Archivo:** `public/index.html`

**HTML:** Insertar como primer `<button>` en `.motivos-grid` (antes de "Problemas académicos"):

```html
<button class="motivo-btn" onclick="toggleMotivo('Entrevista con apoderado',this)">
  Entrevista con apoderado
</button>
```

**Lógica en `toggleMotivo(val, btn)`:**

Al seleccionar `'Entrevista con apoderado'`:
1. Ejecutar la lógica normal (selección visual, `motivoActual`, `f_motivo`)
2. Auto-seleccionar el botón "Neutra": llamar a `selFalta('Neutra', btnNeutra)` donde `btnNeutra` se obtiene con `document.querySelector('.falta-btn.neutra')`

Al seleccionar **cualquier otro motivo** (y el motivo anterior era `'Entrevista con apoderado'`):
1. Ejecutar lógica normal
2. Deseleccionar la falta: limpiar todos los `.falta-btn.selected`, setear `faltaActual=''`, `document.getElementById('f_falta').value=''`; re-activar el campo RICE (`riceField.style.opacity='1'`, `riceField.style.pointerEvents=''`)
3. Eliminar la fila de apoderado auto-agregada: `document.querySelectorAll('#tbParticipantes tr[data-auto-apoderado="1"]').forEach(r=>r.remove())`

Variable de control en módulo: `var _motivoAnterior = ''` — se actualiza al final de cada `toggleMotivo` call con el valor nuevo.

---

### 2. Auto-fill de apoderado en tabla de participantes

**Función modificada:** `autoFill()`

Después del bloque existente que rellena la primera fila de `#tbParticipantes` con el estudiante, agregar:

```javascript
// Si motivo es "Entrevista con apoderado", gestionar fila del apoderado
if (motivoActual === 'Entrevista con apoderado') {
  // Eliminar fila previa auto-apoderado si existe
  document.querySelectorAll('#tbParticipantes tr[data-auto-apoderado="1"]').forEach(r => r.remove());

  // Agregar nueva fila del apoderado (con o sin datos)
  const apNombre = opt.dataset.apoderado ? fmtNombre(opt.dataset.apoderado) : '';
  const tb = document.getElementById('tbParticipantes');
  const tr = document.createElement('tr');
  tr.setAttribute('data-auto-apoderado', '1');
  tr.innerHTML = `
    <td><input type="text" value="${apNombre}" placeholder="Nombre del apoderado/a"></td>
    <td><input type="text" value="Apoderado/a"></td>
    <td><button onclick="quitarFila(this)" style="background:none;border:none;color:var(--rojo);cursor:pointer;font-size:1rem">✕</button></td>
  `;
  tb.appendChild(tr);
}
```

**Comportamiento:**
- Si el estudiante tiene apoderado en BD (`opt.dataset.apoderado`): la fila se rellena con su nombre
- Si no tiene: la fila queda con campo de nombre vacío y rol "Apoderado/a"
- Si el usuario cambia de estudiante (y el motivo sigue siendo "Entrevista con apoderado"): se elimina la fila anterior y se crea una nueva con el apoderado del nuevo estudiante
- El usuario puede eliminar manualmente la fila con el botón ✕ (comportamiento normal de `quitarFila`)

---

### 3. Nota de registro en modal de firmas

**Función modificada:** `_firmaRenderGestion(tokenMaestro, firestoreId, m)`

Antes de la sección "Participantes y links individuales", verificar el motivo:

```javascript
const motivoDoc = (data.resumenDoc && data.resumenDoc.motivo) || (m && m.motivo) || '';
const esEntrevista = motivoDoc === 'Entrevista con apoderado';

if (esEntrevista) {
  const folioDoc = String(data.docId || '').slice(-6) || '—';   // docId = medId (timestamp)
  const fechaDoc = (data.resumenDoc && data.resumenDoc.fecha) || '';
  const horaDoc  = (data.resumenDoc && data.resumenDoc.hora)  || '';
  html += `<div style="background:#eaf4fb;border:1.5px solid #2980b9;border-radius:8px;
    padding:.7rem 1rem;margin-bottom:1rem;display:flex;align-items:center;gap:.7rem">
    <div style="font-size:1.1rem">📋</div>
    <div>
      <div style="font-weight:700;font-size:.88rem;color:#1a5276">
        Registro de entrevista al apoderado
      </div>
      <div style="font-size:.8rem;color:#2471a3;margin-top:2px">
        N° de Folio: ${folioDoc}
        ${fechaDoc ? ' · ' + fechaDoc : ''}
        ${horaDoc  ? ' · ' + horaDoc  : ''}
      </div>
    </div>
  </div>`;
}
```

**Posición:** Inmediatamente antes de `html += '<div style="margin-bottom:1rem">'` (inicio del bloque de participantes).

**Disponibilidad:** Funciona tanto al guardar por primera vez (modal automático post-save) como al abrir desde el historial (botón "✍️ Firmas"), ya que el motivo se lee desde `data.resumenDoc` almacenado en Firestore.

---

### 4. Actualización del array de motivos en PDF

**Función modificada:** `previewPDF()` (línea donde se define `const motivos=[...]`)

Cambiar de:
```javascript
const motivos = ['Problemas académicos','Problemas conductuales o de Convivencia Escolar','Ausentismo escolar','Otros'];
```
A:
```javascript
const motivos = ['Entrevista con apoderado','Problemas académicos','Problemas conductuales o de Convivencia Escolar','Ausentismo escolar','Otros'];
```

Esto garantiza que al generar el PDF de un registro con motivo "Entrevista con apoderado", la casilla correspondiente aparezca marcada con ✕.

---

## Resumen de variables nuevas

| Variable | Tipo | Uso |
|---|---|---|
| `_motivoAnterior` | `string` | Rastrea el motivo previo para saber si revertir falta al cambiar |

## Flujo completo

```
Usuario abre formulario Nueva Mediación
  └─ Hace clic en "Entrevista con apoderado" (primer botón)
       ├─ motivoActual = 'Entrevista con apoderado'
       ├─ faltaActual = 'Neutra' (auto-seleccionado)
       └─ _motivoAnterior = 'Entrevista con apoderado'

  └─ Selecciona un estudiante del select
       ├─ autoFill() rellena campos habituales
       └─ Agrega fila [Nombre Apoderado | Apoderado/a] en tbParticipantes (data-auto-apoderado="1")

  └─ Cambia estudiante
       └─ autoFill() reemplaza la fila anterior del apoderado por la del nuevo

  └─ Cambia motivo a otro
       ├─ Elimina fila data-auto-apoderado="1"
       ├─ Limpia faltaActual (deselecciona Neutra)
       └─ _motivoAnterior = nuevo motivo

  └─ Hace clic en "Guardar"
       ├─ Se guarda el registro en Firestore
       └─ Se abre firmaAbrirGestion(m.id) automáticamente
            └─ _firmaRenderGestion muestra recuadro azul:
                 "📋 Registro de entrevista al apoderado
                  N° de Folio: XXXXXX · DD/MM/AAAA · HH:MM"
                 (sobre los tokens de participantes)
```

## Archivos modificados

| Archivo | Cambio |
|---|---|
| `public/index.html` | HTML: nuevo botón en `.motivos-grid`; JS: `toggleMotivo()`, `autoFill()`, `_firmaRenderGestion()`, array `motivos` en PDF |
