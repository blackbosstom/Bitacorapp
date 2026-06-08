# Entrevista con Apoderado — Módulo Nueva Mediación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar el motivo "Entrevista con apoderado" (primero en el grid) con falta neutra automática, apoderado auto-agregado a la tabla de participantes, y nota de folio en el modal de firmas.

**Architecture:** Todo el cambio vive en `public/index.html`. Se modifican el HTML del formulario, las funciones JS `toggleMotivo()`, `autoFill()`, `_firmaRenderGestion()`, y el array `motivos` del PDF. Se introduce la variable de módulo `_motivoAnterior` para rastrear el motivo previo y poder revertir efectos secundarios al cambiar de motivo.

**Tech Stack:** HTML/JS vanilla, Firestore (datos ya cargados en `ESTUDIANTES[]`), sin dependencias nuevas.

---

## Contexto clave del codebase

- **`public/index.html`** — archivo único (~20.000 líneas). No hay git.
- **Línea 4649–4654** — `.motivos-grid` con los 4 botones de motivo actuales.
- **Línea 7972** — `let motivoActual='',faltaActual='';` (variables de módulo).
- **Línea 8187** — `function autoFill()` — rellena campos al seleccionar estudiante.
- **Línea 8203** — `function toggleMotivo(val,btn)` — gestiona selección de motivo.
- **Línea 8217** — `function selFalta(val,btn)` — gestiona selección de tipo de falta.
- **Línea 8465** — `const motivos=[...]` dentro de `renderPDFModal(d)`.
- **Línea 14641** — `function _firmaRenderGestion(tokenMaestro, firestoreId, m)`.
- **Línea 14669** — Inicio del bloque "Participantes y links individuales" (`html+=\`<div style="margin-bottom:1rem">\``).
- **`data.docId`** en el documento de firma = `String(medId)` (el timestamp de la mediación), usado para calcular el folio: `String(data.docId||'').slice(-6)`.

---

## Archivos modificados

| Archivo | Cambio |
|---|---|
| `public/index.html` | HTML: nuevo botón en `.motivos-grid`, CSS: grid adaptable a 5 columnas |
| `public/index.html` | JS: nueva variable `_motivoAnterior`, `toggleMotivo()` con efectos secundarios, `autoFill()` con fila de apoderado, `_firmaRenderGestion()` con nota de folio, array `motivos` en PDF |

---

## Task 1: CSS — Grid adaptable a 5 botones

**Archivos:**
- Modify: `public/index.html` línea ~339

El grid actual tiene `grid-template-columns:1fr 1fr 1fr 1fr` (4 columnas fijas). Con 5 botones quedaría 4+1 en dos filas. Cambiar a `repeat(auto-fit,minmax(155px,1fr))` para que se adapte a cualquier cantidad.

- [ ] **Paso 1: Localizar la línea CSS del motivos-grid**

Buscar en `public/index.html`:
```
.motivos-grid{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;
```
Está en la línea ~339.

- [ ] **Paso 2: Reemplazar la declaración**

Cambiar:
```
.motivos-grid{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:.6rem;grid-column:1/-1}
```
Por:
```
.motivos-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:.6rem;grid-column:1/-1}
```

La media query de móvil (`@media(max-width:700px)`) ya sobreescribe a `1fr 1fr` — no necesita cambios.

- [ ] **Paso 3: Verificar visualmente**

Abrir `public/index.html` en el navegador, ir a "Nueva Mediación". Los 4 botones de motivo actuales deben seguir en una sola fila y ocupar todo el ancho disponible.

---

## Task 2: HTML — Insertar botón "Entrevista con apoderado"

**Archivos:**
- Modify: `public/index.html` líneas 4649–4654

- [ ] **Paso 1: Localizar el bloque del grid**

Buscar en el archivo:
```html
          <div class="motivos-grid" style="margin-top:.5rem">
            <button class="motivo-btn" onclick="toggleMotivo('Problemas acad&#233;micos',this)">Problemas acad&#233;micos</button>
```

- [ ] **Paso 2: Insertar el nuevo botón como primer elemento**

Reemplazar el bloque completo del grid:
```html
          <div class="motivos-grid" style="margin-top:.5rem">
            <button class="motivo-btn" onclick="toggleMotivo('Problemas acad&#233;micos',this)">Problemas acad&#233;micos</button>
            <button class="motivo-btn" onclick="toggleMotivo('Problemas conductuales o de Convivencia Escolar',this)">Problemas conductuales o de Convivencia Escolar</button>
            <button class="motivo-btn" onclick="toggleMotivo('Ausentismo escolar',this)">Ausentismo escolar</button>
            <button class="motivo-btn" onclick="toggleMotivo('Otros',this)">Otros:</button>
          </div>
```
Por:
```html
          <div class="motivos-grid" style="margin-top:.5rem">
            <button class="motivo-btn" onclick="toggleMotivo('Entrevista con apoderado',this)">Entrevista con apoderado</button>
            <button class="motivo-btn" onclick="toggleMotivo('Problemas acad&#233;micos',this)">Problemas acad&#233;micos</button>
            <button class="motivo-btn" onclick="toggleMotivo('Problemas conductuales o de Convivencia Escolar',this)">Problemas conductuales o de Convivencia Escolar</button>
            <button class="motivo-btn" onclick="toggleMotivo('Ausentismo escolar',this)">Ausentismo escolar</button>
            <button class="motivo-btn" onclick="toggleMotivo('Otros',this)">Otros:</button>
          </div>
```

- [ ] **Paso 3: Verificar en navegador**

El nuevo botón debe aparecer como primer botón del grid, con el mismo estilo que los demás.

---

## Task 3: JS — Variable `_motivoAnterior` y `toggleMotivo()` actualizado

**Archivos:**
- Modify: `public/index.html` líneas ~7972 y ~8203

### 3a. Declarar `_motivoAnterior`

- [ ] **Paso 1: Localizar la línea de declaración de variables de módulo**

Buscar:
```javascript
let motivoActual='',faltaActual='';
```
(línea ~7972)

- [ ] **Paso 2: Agregar `_motivoAnterior` en la misma línea**

Reemplazar:
```javascript
let motivoActual='',faltaActual='';
```
Por:
```javascript
let motivoActual='',faltaActual='',_motivoAnterior='';
```

### 3b. Reemplazar `toggleMotivo()`

- [ ] **Paso 3: Localizar la función actual**

Buscar el bloque completo:
```javascript
function toggleMotivo(val,btn){
  document.querySelectorAll('.motivo-btn').forEach(b=>b.classList.remove('selected'));
  btn.classList.add('selected');motivoActual=val;document.getElementById('f_motivo').value=val;
  const co=document.getElementById('campo_otros');
  co.style.display=val==='Otros'?'flex':'none';
  if(val==='Otros'){
    setTimeout(()=>{
      const inp=document.getElementById('f_otros_texto');
      inp.focus();
      inp.style.borderColor='var(--amarillo)';
      inp.addEventListener('input',function(){this.style.borderColor=this.value.trim()?'var(--verde-claro)':'var(--amarillo)';},{once:true});
    },50);
  }
}
```

- [ ] **Paso 4: Reemplazar con la versión actualizada**

```javascript
function toggleMotivo(val,btn){
  // ── Si veníamos de "Entrevista con apoderado" y cambiamos a otro motivo,
  //    revertir efectos secundarios: falta y fila apoderado
  if(_motivoAnterior==='Entrevista con apoderado' && val!=='Entrevista con apoderado'){
    document.querySelectorAll('.falta-btn').forEach(b=>b.classList.remove('selected'));
    faltaActual='';
    document.getElementById('f_falta').value='';
    const rf=document.getElementById('riceField');
    if(rf){rf.style.opacity='1';rf.style.pointerEvents='';}
    document.querySelectorAll('#tbParticipantes tr[data-auto-apoderado="1"]').forEach(r=>r.remove());
  }

  // ── Selección visual del botón de motivo
  document.querySelectorAll('.motivo-btn').forEach(b=>b.classList.remove('selected'));
  btn.classList.add('selected');
  motivoActual=val;
  document.getElementById('f_motivo').value=val;

  // ── Si se selecciona "Entrevista con apoderado", auto-seleccionar falta Neutra
  if(val==='Entrevista con apoderado'){
    const btnNeutra=document.querySelector('.falta-btn.neutra');
    if(btnNeutra) selFalta('Neutra',btnNeutra);
  }

  // ── Mostrar/ocultar campo "Otros"
  const co=document.getElementById('campo_otros');
  co.style.display=val==='Otros'?'flex':'none';
  if(val==='Otros'){
    setTimeout(()=>{
      const inp=document.getElementById('f_otros_texto');
      inp.focus();
      inp.style.borderColor='var(--amarillo)';
      inp.addEventListener('input',function(){this.style.borderColor=this.value.trim()?'var(--verde-claro)':'var(--amarillo)';},{once:true});
    },50);
  }

  // ── Registrar el motivo actual para detectar cambios en el siguiente toggle
  _motivoAnterior=val;
}
```

- [ ] **Paso 5: Verificar comportamiento en navegador**

  1. Hacer clic en "Entrevista con apoderado" → el botón "Neutra" de falta debe quedar seleccionado automáticamente.
  2. Hacer clic en "Problemas académicos" → el botón Neutra debe deseleccionarse; el campo RICE debe volver a activo.
  3. El campo "Otros" sigue apareciendo solo al seleccionar ese motivo.

---

## Task 4: JS — `autoFill()` con fila de apoderado

**Archivos:**
- Modify: `public/index.html` línea ~8187

- [ ] **Paso 1: Localizar el final del bloque existente de `autoFill()`**

La función actual termina así:
```javascript
function autoFill(){
  const opt=document.getElementById('f_estudiante').selectedOptions[0];
  if(opt&&opt.dataset.run){
    document.getElementById('f_run').value=opt.dataset.run;
    document.getElementById('f_apoderado').value=fmtNombre(opt.dataset.apoderado);
    document.getElementById('f_telefono').value=opt.dataset.telefono;
    document.getElementById('f_tutor').value=opt.dataset.tutor||'';
    document.getElementById('f_email_apoderado').value=opt.dataset.emailapoderado||'';
    const fp=document.getElementById('f_padre');if(fp)fp.value=fmtNombre(opt.dataset.padre)||'';
    const ftp=document.getElementById('f_telefono_padre');if(ftp)ftp.value=opt.dataset.telefonopadre||'';
    const fm=document.getElementById('f_madre');if(fm)fm.value=fmtNombre(opt.dataset.madre)||'';
    const ftm=document.getElementById('f_telefono_madre');if(ftm)ftm.value=opt.dataset.telefonmadre||'';
    const rows=document.querySelectorAll('#tbParticipantes tr');
    if(rows[0]){rows[0].querySelectorAll('input')[0].value=opt.value;rows[0].querySelectorAll('input')[1].value='Estudiante';}
  }
}
```

- [ ] **Paso 2: Reemplazar la función completa**

```javascript
function autoFill(){
  const opt=document.getElementById('f_estudiante').selectedOptions[0];
  if(opt&&opt.dataset.run){
    document.getElementById('f_run').value=opt.dataset.run;
    document.getElementById('f_apoderado').value=fmtNombre(opt.dataset.apoderado);
    document.getElementById('f_telefono').value=opt.dataset.telefono;
    document.getElementById('f_tutor').value=opt.dataset.tutor||'';
    document.getElementById('f_email_apoderado').value=opt.dataset.emailapoderado||'';
    const fp=document.getElementById('f_padre');if(fp)fp.value=fmtNombre(opt.dataset.padre)||'';
    const ftp=document.getElementById('f_telefono_padre');if(ftp)ftp.value=opt.dataset.telefonopadre||'';
    const fm=document.getElementById('f_madre');if(fm)fm.value=fmtNombre(opt.dataset.madre)||'';
    const ftm=document.getElementById('f_telefono_madre');if(ftm)ftm.value=opt.dataset.telefonmadre||'';
    const rows=document.querySelectorAll('#tbParticipantes tr');
    if(rows[0]){rows[0].querySelectorAll('input')[0].value=opt.value;rows[0].querySelectorAll('input')[1].value='Estudiante';}

    // ── Si el motivo es "Entrevista con apoderado", gestionar fila del apoderado
    if(motivoActual==='Entrevista con apoderado'){
      // Eliminar fila previa auto-apoderado si existe (cambio de estudiante)
      document.querySelectorAll('#tbParticipantes tr[data-auto-apoderado="1"]').forEach(r=>r.remove());
      // Agregar nueva fila con el apoderado del estudiante seleccionado
      const apNombre=opt.dataset.apoderado?fmtNombre(opt.dataset.apoderado):'';
      const tb=document.getElementById('tbParticipantes');
      const tr=document.createElement('tr');
      tr.setAttribute('data-auto-apoderado','1');
      tr.innerHTML='<td><input type="text" value="'+apNombre+'" placeholder="Nombre del apoderado/a"></td>'
        +'<td><input type="text" value="Apoderado/a"></td>'
        +'<td><button onclick="quitarFila(this)" style="background:none;border:none;color:var(--rojo);cursor:pointer;font-size:1rem">&#10005;</button></td>';
      tb.appendChild(tr);
    }
  }
}
```

- [ ] **Paso 3: Verificar en navegador**

  1. Seleccionar motivo "Entrevista con apoderado".
  2. Seleccionar un curso y un estudiante que tenga apoderado en BD.
  3. La tabla de participantes debe mostrar dos filas: [Estudiante | Estudiante] y [Nombre Apoderado | Apoderado/a].
  4. Cambiar de estudiante → la fila del apoderado se reemplaza por el apoderado del nuevo estudiante.
  5. Seleccionar un estudiante sin apoderado → la fila aparece con nombre vacío y rol "Apoderado/a".

---

## Task 5: JS — Nota de registro en `_firmaRenderGestion()`

**Archivos:**
- Modify: `public/index.html` línea ~14669

- [ ] **Paso 1: Localizar el inicio del bloque de participantes**

Dentro de `_firmaRenderGestion`, buscar exactamente:
```javascript
  // Tarjetas por participante
  html+=`<div style="margin-bottom:1rem">`;
  html+=`<div style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--verde);margin-bottom:.6rem">Participantes y links individuales</div>`;
```

- [ ] **Paso 2: Insertar la nota de registro ANTES de ese bloque**

Reemplazar:
```javascript
  // Tarjetas por participante
  html+=`<div style="margin-bottom:1rem">`;
  html+=`<div style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--verde);margin-bottom:.6rem">Participantes y links individuales</div>`;
```
Por:
```javascript
  // ── Nota de registro para "Entrevista con apoderado"
  const _motivoDoc=(data.resumenDoc&&data.resumenDoc.motivo)||(m&&m.motivo)||'';
  if(_motivoDoc==='Entrevista con apoderado'){
    const _folioDoc=String(data.docId||'').slice(-6)||'—';
    const _fechaDoc=(data.resumenDoc&&data.resumenDoc.fecha)||'';
    const _horaDoc=(data.resumenDoc&&data.resumenDoc.hora)||'';
    html+=`<div style="background:#eaf4fb;border:1.5px solid #2980b9;border-radius:8px;padding:.7rem 1rem;margin-bottom:1rem;display:flex;align-items:center;gap:.7rem">`;
    html+=`<div style="font-size:1.1rem">📋</div>`;
    html+=`<div><div style="font-weight:700;font-size:.88rem;color:#1a5276">Registro de entrevista al apoderado</div>`;
    html+=`<div style="font-size:.8rem;color:#2471a3;margin-top:2px">N° de Folio: ${_folioDoc}${_fechaDoc?' · '+_fechaDoc:''}${_horaDoc?' · '+_horaDoc:''}</div></div>`;
    html+=`</div>`;
  }

  // Tarjetas por participante
  html+=`<div style="margin-bottom:1rem">`;
  html+=`<div style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--verde);margin-bottom:.6rem">Participantes y links individuales</div>`;
```

- [ ] **Paso 3: Verificar en navegador**

  1. Completar el formulario con motivo "Entrevista con apoderado" y guardar.
  2. El modal de firmas debe mostrar el recuadro azul con "Registro de entrevista al apoderado · N° de Folio: XXXXXX · DD/MM/AAAA · HH:MM" **sobre** la sección de participantes.
  3. Guardar un registro con motivo distinto (ej: "Ausentismo escolar") → el recuadro azul **no** debe aparecer.
  4. Abrir el modal de firmas desde el historial (`✍️ Firmas`) de un registro "Entrevista con apoderado" → el recuadro azul debe aparecer igualmente.

---

## Task 6: JS — Array `motivos` en PDF con "Entrevista con apoderado"

**Archivos:**
- Modify: `public/index.html` línea ~8465

- [ ] **Paso 1: Localizar la línea del array de motivos del PDF**

Buscar en el archivo (dentro de `renderPDFModal`). **Importante:** el archivo usa escapes unicode literales (`é`), no el carácter `é`:
```
  const motivos=['Problemas académicos','Problemas conductuales o de Convivencia Escolar','Ausentismo escolar','Otros'];
```

- [ ] **Paso 2: Agregar "Entrevista con apoderado" como primer elemento**

Reemplazar (string exacto con escape unicode):
```
  const motivos=['Problemas académicos','Problemas conductuales o de Convivencia Escolar','Ausentismo escolar','Otros'];
```
Por:
```
  const motivos=['Entrevista con apoderado','Problemas académicos','Problemas conductuales o de Convivencia Escolar','Ausentismo escolar','Otros'];
```

- [ ] **Paso 3: Verificar en navegador**

  1. Crear un registro con motivo "Entrevista con apoderado".
  2. Abrir la vista previa del PDF (botón "🖨️ PDF" en el historial).
  3. En la sección "Motivo de la reunión", la casilla "Entrevista con apoderado" debe aparecer marcada con ✕.
  4. Abrir el PDF de un registro antiguo con motivo "Ausentismo escolar" → la casilla "Ausentismo escolar" debe seguir marcada correctamente.

---

## Verificación final (manual)

Flujo completo en el navegador:

1. Ir a "Nueva Mediación"
2. Hacer clic en **"Entrevista con apoderado"** (primer botón) → falta "Neutra" se selecciona sola ✓
3. Seleccionar un curso y un estudiante con apoderado → aparece fila `[Nombre Apoderado | Apoderado/a]` en la tabla ✓
4. Cambiar a otro motivo → falta Neutra se deselecciona, fila del apoderado desaparece ✓
5. Volver a "Entrevista con apoderado" → falta Neutra vuelve a seleccionarse ✓
6. Completar descripción/acuerdos y guardar → modal de firmas se abre ✓
7. En el modal de firmas, **arriba** de los tokens de participantes aparece el recuadro azul con folio, fecha y hora ✓
8. Generar PDF del registro → "Entrevista con apoderado" aparece marcado con ✕ ✓
