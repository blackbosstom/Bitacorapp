/* ============================================================================
   BitácoraApp Free — Adaptador de datos localStorage que EMULA Firestore.
   Implementa la misma superficie window._fb* / window._db / window.colTenant
   que usa index.html, pero guardando todo en localStorage (por dispositivo).

   Los datos van bajo la clave  bfree:: + <path>  (JSON). Como los paths de la
   app son tenants/<uid>/<coleccion>/<id>, quedan naturalmente separados por
   usuario (currentTenantId = uid).

   Diseñado para correr en el navegador (se cuelga de window) y también en Node
   para tests (usa globalThis.localStorage y globalThis.window si existen).
   ========================================================================== */
(function () {
  var G = (typeof window !== 'undefined') ? window : globalThis;
  var LS = G.localStorage;
  var PREFIX = 'bfree::';

  /* ── util ── */
  function _id() { // id tipo Firestore (20 chars)
    var c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var s = ''; for (var i = 0; i < 20; i++) s += c[Math.floor(Math.random() * c.length)];
    return s;
  }
  function _key(path) { return PREFIX + path; }
  function _read(path) { try { var v = LS.getItem(_key(path)); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function _write(path, obj) { try { LS.setItem(_key(path), JSON.stringify(obj)); } catch (e) {} }
  function _remove(path) { try { LS.removeItem(_key(path)); } catch (e) {} }
  function _lastSeg(path) { var p = String(path).split('/'); return p[p.length - 1]; }
  function _colOf(path) { var p = String(path).split('/'); p.pop(); return p.join('/'); }

  /* Enumera los docs "hijos directos" de una colección (path con 1 segmento más). */
  function _docsEnColeccion(colPath) {
    var out = [], pre = PREFIX + colPath + '/';
    var nSeg = colPath.split('/').length + 1;
    for (var i = 0; i < LS.length; i++) {
      var k = LS.key(i);
      if (k && k.indexOf(pre) === 0) {
        var full = k.slice(PREFIX.length);
        if (full.split('/').length === nSeg) {
          var data = _read(full);
          if (data && typeof data === 'object') out.push({ id: _lastSeg(full), path: full, data: data });
        }
      }
    }
    return out;
  }

  /* ── sentinels (arrayUnion / deleteField) ── */
  function _isAU(v) { return v && typeof v === 'object' && v.__freeArrayUnion; }
  function _isDF(v) { return v && typeof v === 'object' && v.__freeDeleteField; }

  function _mergePatch(base, patch) {
    base = base || {};
    Object.keys(patch).forEach(function (k) {
      var v = patch[k];
      if (_isDF(v)) { delete base[k]; return; }
      if (_isAU(v)) {
        var arr = Array.isArray(base[k]) ? base[k].slice() : [];
        v.__freeArrayUnion.forEach(function (x) { if (arr.indexOf(x) < 0) arr.push(x); });
        base[k] = arr; return;
      }
      base[k] = v;
    });
    return base;
  }

  /* ── listeners (onSnapshot local) ── */
  var _listeners = []; // {colPath, run}
  function _emit(colPath) {
    _listeners.forEach(function (L) { if (L.colPath === colPath) { try { L.run(); } catch (e) {} } });
  }

  /* ── refs ── */
  function colTenant(nombre) { return 'tenants/' + (G.currentTenantId || 'default') + '/' + nombre; }
  function _collection(_db, path) { return { __col: true, path: String(path) }; }
  function _doc(_db) {
    var parts = Array.prototype.slice.call(arguments, 1).map(String);
    var path = parts.join('/');
    return { __doc: true, path: path, id: _lastSeg(path) };
  }

  /* ── query ── */
  function _query(colRef) {
    var cs = Array.prototype.slice.call(arguments, 1);
    return { __query: true, path: colRef.path, constraints: cs };
  }
  function _where(field, op, val) { return { type: 'where', field: field, op: op, val: val }; }
  function _orderBy(field, dir) { return { type: 'orderBy', field: field, dir: dir || 'asc' }; }
  function _queryTenant(colRef) { return _query(colRef, _where('tenant_id', '==', (G.currentTenantId || 'default'))); }

  function _cmp(a, b) { if (a === b) return 0; if (a === undefined || a === null) return -1; if (b === undefined || b === null) return 1; return a < b ? -1 : 1; }
  function _passWhere(data, w) {
    var v = data[w.field];
    switch (w.op) {
      case '==': return v === w.val;
      case '!=': return v !== w.val;
      case '<': return _cmp(v, w.val) < 0;
      case '<=': return _cmp(v, w.val) <= 0;
      case '>': return _cmp(v, w.val) > 0;
      case '>=': return _cmp(v, w.val) >= 0;
      case 'array-contains': return Array.isArray(v) && v.indexOf(w.val) >= 0;
      case 'in': return Array.isArray(w.val) && w.val.indexOf(v) >= 0;
      case 'not-in': return Array.isArray(w.val) && w.val.indexOf(v) < 0;
      default: return true;
    }
  }
  function _resolve(qOrCol) {
    var path = qOrCol.path, cs = qOrCol.constraints || [];
    var rows = _docsEnColeccion(path);
    cs.forEach(function (c) { if (c.type === 'where') rows = rows.filter(function (r) { return _passWhere(r.data, c); }); });
    cs.forEach(function (c) {
      if (c.type === 'orderBy') {
        rows.sort(function (a, b) { var r = _cmp(a.data[c.field], b.data[c.field]); return c.dir === 'desc' ? -r : r; });
      }
    });
    return rows;
  }
  function _colPathOf(qOrCol) { return qOrCol.path; }

  function _snapshot(rows) {
    var docs = rows.map(function (r) { return { id: r.id, exists: function () { return true; }, data: function () { return r.data; }, ref: { __doc: true, path: r.path, id: r.id } }; });
    return { docs: docs, size: docs.length, empty: docs.length === 0, forEach: function (fn) { docs.forEach(fn); } };
  }

  /* ── operaciones ── */
  function _addDoc(colRef, data) {
    var id = _id(); var path = colRef.path + '/' + id;
    _write(path, data); _emit(colRef.path);
    return Promise.resolve({ __doc: true, path: path, id: id });
  }
  function _setDoc(docRef, data) { _write(docRef.path, data); _emit(_colOf(docRef.path)); return Promise.resolve(); }
  function _updateDoc(docRef, patch) { var cur = _read(docRef.path) || {}; _write(docRef.path, _mergePatch(cur, patch)); _emit(_colOf(docRef.path)); return Promise.resolve(); }
  function _deleteDoc(docRef) { _remove(docRef.path); _emit(_colOf(docRef.path)); return Promise.resolve(); }
  function _getDocs(qOrCol) { return Promise.resolve(_snapshot(_resolve(qOrCol))); }
  function _getDoc(docRef) {
    var data = _read(docRef.path);
    return Promise.resolve({ id: docRef.id, exists: function () { return data !== null; }, data: function () { return data; }, ref: docRef });
  }
  function _onSnapshot(target, cb, errcb) {
    // Soporta ref de DOCUMENTO (DocumentSnapshot con exists()/data()) y
    // colección/consulta (QuerySnapshot con docs/forEach) — ambos patrones de la app.
    var isDoc = !!(target && target.__doc);
    var colPath = isDoc ? _colOf(target.path) : _colPathOf(target);
    var run;
    if (isDoc) {
      run = function () {
        try { var data = _read(target.path); cb({ id: target.id, exists: function () { return data !== null; }, data: function () { return data; }, ref: target }); }
        catch (e) { if (errcb) errcb(e); }
      };
    } else {
      run = function () { try { cb(_snapshot(_resolve(target))); } catch (e) { if (errcb) errcb(e); } };
    }
    _listeners.push({ colPath: colPath, run: run });
    run(); // dispara inmediatamente
    return function () { _listeners = _listeners.filter(function (L) { return L.run !== run; }); };
  }

  /* ── exponer la misma superficie que index.html ── */
  var api = {
    _db: { __free: true },
    colTenant: colTenant,
    conTenantId: function (d) { return Object.assign({}, d, { tenant_id: (G.currentTenantId || 'default') }); },
    _fbCollection: _collection,
    _fbDoc: _doc,
    _fbQuery: _query,
    _fbWhere: _where,
    _fbOrderBy: _orderBy,
    _fbQueryTenant: _queryTenant,
    _fbArrayUnion: function () { return { __freeArrayUnion: Array.prototype.slice.call(arguments) }; },
    _fbDeleteField: function () { return { __freeDeleteField: true }; },
    _fbAddDoc: _addDoc,
    _fbSetDoc: _setDoc,
    _fbUpdateDoc: _updateDoc,
    _fbDeleteDoc: _deleteDoc,
    _fbGetDocs: _getDocs,
    _fbGetDoc: _getDoc,
    _fbOnSnapshot: _onSnapshot,
    _fbReady: true,
    _freeAdapter: true
  };
  Object.keys(api).forEach(function (k) { G[k] = api[k]; });
  if (typeof window !== 'undefined') { Object.keys(api).forEach(function (k) { window[k] = api[k]; }); }
})();
