#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build-free.py — Genera public/gratis-app.html a partir de public/index.html
para BitácoraApp Free (datos en localStorage). NO modifica index.html (solo lo lee).

Transformaciones (cada una falla ruidoso si no encuentra su ancla):
  1. Neutraliza DOMAIN_ROUTER (no redirige el dominio raíz a /presentacion/).
  2. Reemplaza ROUTE_GUARD por un guard Free (sin free_uid -> /gratis).
  3. Override detectarTenant: currentTenantId = localStorage.free_uid.
  4. Neutraliza los 2 <script type="module"> de init de Firebase/Firestore.
  5. Reemplaza la URL del CDN de firestore por el shim local (cubre los import()).
  6. Inyecta el adaptador localStorage + boot + CSS que esconde módulos (en <head>).
  7. Inyecta overrides de UI al final del <body> (cerrar sesión -> /gratis).
"""
import re, sys, os

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC  = os.path.join(ROOT, 'public', 'index.html')
OUT  = os.path.join(ROOT, 'public', 'gratis-app.html')

FIRESTORE_URL = 'https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js'

def sub_once(pattern, repl, html, label, flags=re.S, expected=1, count=0):
    new, n = re.subn(pattern, lambda m: repl, html, count=count, flags=flags)
    if n != expected:
        sys.exit('❌ [build-free] "%s": esperaba %d coincidencia(s), encontró %d. '
                 'El ancla en index.html cambió; ajusta el generador.' % (label, expected, n))
    print('  ✓ %s (%d)' % (label, n))
    return new

def main():
    with open(SRC, encoding='utf-8') as f:
        html = f.read()

    # 1. DOMAIN_ROUTER
    html = sub_once(r'<script>\s*\(function DOMAIN_ROUTER\(\)\s*\{.*?\}\)\(\);\s*</script>',
                    '<script>/* [Free] DOMAIN_ROUTER neutralizado */</script>',
                    html, 'neutralizar DOMAIN_ROUTER')

    # 2. ROUTE_GUARD -> guard Free
    free_guard = ('<script>\n'
                  '(function FREE_GUARD(){\n'
                  "  'use strict';\n"
                  '  try{\n'
                  "    var uid = localStorage.getItem('free_uid');\n"
                  "    var ud  = localStorage.getItem('sgce_user_data');\n"
                  "    if(!uid || !ud){ window.location.replace('/gratis'); throw new Error('[Free] sin sesion'); }\n"
                  "    window.SGCE_SESSION = { token: localStorage.getItem('sgce_session_token'), user: JSON.parse(ud) };\n"
                  '  }catch(e){ if(String((e&&e.message)||"").indexOf("[Free]")<0) console.error(e); }\n'
                  '})();\n'
                  '</script>')
    html = sub_once(r'<script>\s*\(function ROUTE_GUARD\(\)\s*\{.*?\}\)\(\);\s*</script>',
                    free_guard, html, 'reemplazar ROUTE_GUARD')

    # 3. detectarTenant -> usa free_uid
    det = ('(function detectarTenant(){\n'
           "  try{ var u=localStorage.getItem('free_uid'); if(u){ window.currentTenantId=u; return; } }catch(e){}\n"
           "  window.currentTenantId='default';\n"
           '})();')
    html = sub_once(r'\(function detectarTenant\(\)\s*\{.*?\}\)\(\);',
                    det, html, 'override detectarTenant')

    # 4. Neutralizar los 2 init de Firebase (type=module)
    html = sub_once(r'<script type="module">\s*//[^\n]*\n//\s*PROYECTO FIREBASE.*?</script>',
                    '<script>/* [Free] init Firebase neutralizado (usa free-adapter.js) */</script>',
                    html, 'neutralizar init Firebase (x2)', expected=2)

    # 5. Reemplazar URL del CDN de firestore por el shim local (cubre los import())
    n_url = html.count(FIRESTORE_URL)
    if n_url < 1:
        sys.exit('❌ [build-free] No se encontró la URL de firebase-firestore.js para redirigir al shim.')
    html = html.replace(FIRESTORE_URL, '/free/free-firestore-shim.js')
    print('  ✓ URL firestore -> shim local (%d)' % n_url)

    # 6. Inyección en <head> (adaptador + boot + CSS de recorte)
    head_inject = (
        '<meta charset="UTF-8">\n'
        '<!-- [Free] adaptador localStorage + boot -->\n'
        '<script src="/free/free-adapter.js"></script>\n'
        '<script>window._authReady=Promise.resolve();window._auth=null;'
        'window._firebaseConfig=window.FIREBASE_CONFIG||{};'
        'window._initializeApp=window._initializeApp||function(){return {};};</script>\n'
        '<style id="free-hide">\n'
        '[data-permiso="ver_denuncias"],[data-permiso="ver_test"],[data-permiso="ver_informes"],'
        '[data-permiso="ver_informes_red"],[data-permiso="ver_asistencia"]{display:none !important;}\n'
        '/* [Free] ocultar acciones remotas por enlace (no funcionan en localStorage): descargos de suspension */\n'
        'button[onclick*="spGenerarEnlaceDescargos"],button[onclick*="spCopiarEnlaceDescargos"]{display:none !important;}\n'
        '</style>')
    # Solo la PRIMERA <meta charset> (la del <head> del documento; hay más en plantillas internas)
    html = sub_once(r'<meta charset="UTF-8">', head_inject, html,
                    'inyectar adaptador/boot/CSS en <head>', count=1)

    # 7. Inyección antes del ÚLTIMO </body> (badge Plan Gratis + export + overrides de UI)
    body_inject = (
        '<div id="free-badge" style="position:fixed;left:12px;bottom:12px;z-index:9000;display:flex;gap:8px;'
        'align-items:center;background:#fff;border:1px solid #cfe0d0;border-radius:999px;padding:5px 8px 5px 13px;'
        'box-shadow:0 4px 16px rgba(30,50,35,.16);font-size:.8rem;font-family:\'Calibri\',\'Segoe UI\',Arial,sans-serif">'
        '<span style="font-weight:800;color:#2e5e3e">&#x1F381; Plan Gratis</span>'
        '<button onclick="freeExportar()" title="Descarga un respaldo de tus datos para migrarlos a la versi&#243;n completa" '
        'style="border:none;background:#2e5e3e;color:#fff;border-radius:999px;padding:5px 12px;font-weight:700;'
        'cursor:pointer;font-size:.78rem;font-family:inherit">&#x2B07;&#xFE0F; Exportar mis datos</button>'
        '</div>\n'
        '<script>\n'
        '/* [Free] overrides de UI */\n'
        'window.sgceCerrarSesion = function(){ if(!confirm("\\u00bfCerrar sesi\\u00f3n?")) return; '
        'try{ localStorage.removeItem("free_uid"); localStorage.removeItem("sgce_session_token"); '
        'localStorage.removeItem("sgce_user_data"); sessionStorage.clear(); }catch(e){} '
        'window.location.replace("/gratis"); };\n'
        'window.freeExportar = function(){ try{ if(typeof cfgDescargarRespaldo==="function"){ cfgDescargarRespaldo(); } '
        'else { alert("Exportaci\\u00f3n no disponible en este momento."); } }'
        'catch(e){ alert("Error al exportar: "+((e&&e.message)||e)); } };\n'
        '/* [Free] aviso al subir el logo (se guarda en este dispositivo/localStorage) */\n'
        'document.addEventListener("DOMContentLoaded", function(){ try{\n'
        '  var inp=document.getElementById("cfg-pers-logo-file"); if(!inp) return;\n'
        '  if(!document.getElementById("free-logo-note")){\n'
        '    var note=document.createElement("div"); note.id="free-logo-note";\n'
        '    note.style.cssText="margin-top:6px;font-size:.72rem;color:#8a6d1a;background:#fff8e1;border:1px solid #f0d890;border-radius:8px;padding:6px 9px;line-height:1.45";\n'
        '    note.innerHTML="\\u26a0\\ufe0f En la versi\\u00f3n gratis el logo se guarda <b>en este dispositivo</b>. Usa una imagen liviana (idealmente &lt; 200&nbsp;KB, PNG o SVG) para no llenar el almacenamiento.";\n'
        '    if(inp.parentNode) inp.parentNode.insertBefore(note, inp.nextSibling);\n'
        '  }\n'
        '  inp.addEventListener("change", function(e){ var f=(e.target.files||[])[0]; if(!f) return; var kb=Math.round(f.size/1024);\n'
        '    if(f.size > 250*1024){ var msg="\\u26a0\\ufe0f El logo pesa "+kb+" KB. En la versi\\u00f3n gratis se guarda en este navegador (l\\u00edmite ~5 MB en total). Te recomendamos una imagen m\\u00e1s liviana (< 200 KB) o en formato SVG."; if(typeof toast==="function") toast(msg); else alert(msg); }\n'
        '  });\n'
        '}catch(e){} });\n'
        '/* [Free] Firmas: en vez de enlace a distancia, firmar EN ESTE DISPOSITIVO */\n'
        'window.firmacopiarLink = function(link){ try{ if(!window.__freeFirmaAviso){ window.__freeFirmaAviso=1; if(typeof toast==="function") toast("\\u270d\\ufe0f Firma en este dispositivo (versi\\u00f3n gratis)"); } }catch(e){} window.location.href = link; };\n'
        'function _freeRelabelFirmas(){ try{ document.querySelectorAll(\'button[onclick*="firmacopiarLink"]\').forEach(function(b){ if(b.getAttribute("data-free")) return; b.setAttribute("data-free","1"); b.textContent="\\u270d\\ufe0f Firmar aqu\\u00ed"; b.title="En la versi\\u00f3n gratis la firma se hace en este mismo dispositivo (no hay enlace a distancia)."; }); }catch(e){} }\n'
        'document.addEventListener("DOMContentLoaded", function(){ _freeRelabelFirmas();\n'
        '  try{ var mo=new MutationObserver(function(){ _freeRelabelFirmas(); }); mo.observe(document.body,{childList:true,subtree:true}); }catch(e){}\n'
        '  try{ var p=new URLSearchParams(location.search); if(p.get("firmaToken") && localStorage.getItem("free_uid")){\n'
        '    var back=document.createElement("button"); back.textContent="\\u2190 Volver a la app";\n'
        '    back.style.cssText="position:fixed;top:12px;left:12px;z-index:100000;background:#2e5e3e;color:#fff;border:none;border-radius:999px;padding:8px 14px;font-weight:700;cursor:pointer;font-family:inherit;box-shadow:0 4px 14px rgba(0,0,0,.2)";\n'
        '    back.onclick=function(){ location.href=location.pathname; }; document.body.appendChild(back);\n'
        '  } }catch(e){}\n'
        '});\n'
        '</script>\n</body>')
    idx = html.rfind('</body>')
    if idx < 0:
        sys.exit('❌ [build-free] No se encontró </body> de cierre.')
    html = html[:idx] + body_inject + html[idx+len('</body>'):]
    print('  ✓ inyectar overrides antes del último </body>')

    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(html)
    print('✅ Generado: %s (%d bytes)' % (OUT, len(html)))

if __name__ == '__main__':
    main()
