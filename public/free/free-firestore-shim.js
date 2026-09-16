/* BitácoraApp Free — shim ES module que reexporta el adaptador localStorage
   (window._fb*, definido por free-adapter.js, que corre antes que los módulos).
   El generador reemplaza los import() de firebase-firestore.js por este archivo,
   así los ~11 sitios que importaban Firestore directo pasan al adaptador. */
const w = (typeof window !== 'undefined') ? window : globalThis;

export const collection      = w._fbCollection;
export const doc             = w._fbDoc;
export const addDoc          = w._fbAddDoc;
export const setDoc          = w._fbSetDoc;
export const updateDoc       = w._fbUpdateDoc;
export const deleteDoc       = w._fbDeleteDoc;
export const getDoc          = w._fbGetDoc;
export const getDocs         = w._fbGetDocs;
export const query           = w._fbQuery;
export const where           = w._fbWhere;
export const orderBy         = w._fbOrderBy;
export const onSnapshot      = w._fbOnSnapshot;
export const arrayUnion      = w._fbArrayUnion;
export const deleteField     = w._fbDeleteField;
export const getFirestore    = function(){ return w._db; };
export const serverTimestamp = function(){ return Date.now(); };
export const writeBatch      = function(){
  const ops = [];
  return {
    set:   function(ref,data){ ops.push(function(){ return w._fbSetDoc(ref,data); }); return this; },
    update:function(ref,data){ ops.push(function(){ return w._fbUpdateDoc(ref,data); }); return this; },
    delete:function(ref){ ops.push(function(){ return w._fbDeleteDoc(ref); }); return this; },
    commit:function(){ return Promise.all(ops.map(function(f){ return f(); })); }
  };
};
export default {};
