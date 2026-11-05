// Domoplano — edición de DXF sin pérdidas.
// Regla: lo que no se toca se guarda IDÉNTICO (se copian las líneas originales del archivo); solo se reescriben los
// registros modificados y se agregan los nuevos. Así no se pierde nada que el lector todavía no entienda.
const Edit = (() => {
  const fmt = (v) => {
    if (!Number.isFinite(v)) return '0.0';
    const r = Math.round(v * 1e10) / 1e10;
    const s = String(r);
    return /[.e]/.test(s) ? s : s + '.0';
  };
  const codeStr = (c) => String(c).padStart(3, ' ');
  // Códigos de grupo que el formato DXF define como enteros
  const isIntCode = (c) => (c >= 60 && c <= 99) || (c >= 170 && c <= 179) || (c >= 270 && c <= 289) ||
    (c >= 370 && c <= 389) || (c >= 400 && c <= 409) || (c >= 1060 && c <= 1071);
  const val = (c, v) => (typeof v === 'number' ? (isIntCode(c) ? String(Math.round(v)) : fmt(v)) : String(v));

  function recLines(rec) {
    const out = [codeStr(0), rec.type];
    for (const [c, v] of rec.p) out.push(codeStr(c), String(v));
    return out;
  }

  // ---------------------------------------------------------------- transformar entidades (mover, girar, escalar)
  const MOVABLE = new Set(['LINE', 'POINT', 'CIRCLE', 'ARC', 'ELLIPSE', 'INSERT', 'TEXT', 'MTEXT', 'ATTRIB', 'ATTDEF',
    'LWPOLYLINE', 'POLYLINE', 'VERTEX', 'SEQEND', 'SOLID', 'TRACE', '3DFACE', 'SPLINE', 'LEADER', 'HATCH', 'IMAGE', 'WIPEOUT', 'VIEWPORT']);
  // Entidades cuyas coordenadas van en el sistema del objeto (OCS): si están reflejadas (extrusión -Z), X va invertida.
  const OCS = new Set(['CIRCLE', 'ARC', 'LWPOLYLINE', 'POLYLINE', 'VERTEX', 'TEXT', 'ATTRIB', 'ATTDEF', 'INSERT', 'SOLID', 'TRACE', 'HATCH']);
  // Qué códigos son puntos (pt), vectores (vec), longitudes (len) y ángulos en grados (ang) en cada tipo
  const RULES = {
    LINE: { pt: [10, 11] }, POINT: { pt: [10] }, CIRCLE: { pt: [10], len: [40] }, ARC: { pt: [10], len: [40], ang: [50, 51] },
    ELLIPSE: { pt: [10], vec: [11] }, TEXT: { pt: [10, 11], len: [40], ang: [50] }, ATTRIB: { pt: [10, 11], len: [40], ang: [50] },
    ATTDEF: { pt: [10, 11], len: [40], ang: [50] }, MTEXT: { pt: [10], vec: [11], len: [40, 41, 42, 43, 46] },
    INSERT: { pt: [10], scale: [41, 42, 43], len: [44, 45], ang: [50] }, LWPOLYLINE: { pt: [10], len: [40, 41, 43] },
    POLYLINE: { len: [40, 41] }, VERTEX: { pt: [10], len: [40, 41] }, SEQEND: {},
    SOLID: { pt: [10, 11, 12, 13] }, TRACE: { pt: [10, 11, 12, 13] }, '3DFACE': { pt: [10, 11, 12, 13] },
    SPLINE: { pt: [10, 11], vec: [12, 13] }, LEADER: { pt: [10], vec: [211, 212, 213] },
    IMAGE: { pt: [10], vec: [11, 12] }, WIPEOUT: { pt: [10], vec: [11, 12] },
    VIEWPORT: { pt: [10], len: [40, 41] }, // ventana de plancha: se mueve y se escala (muestra la misma zona del modelo); no se gira
  };
  const norm360 = (a) => { a %= 360; if (a < 0) a += 360; return Math.abs(a) < 1e-10 || Math.abs(a - 360) < 1e-10 ? 0 : a; };

  /** Transformación de semejanza: p' = base + s·R(deg)·(p − base) + (dx, dy). */
  function similarity({ dx = 0, dy = 0, deg = 0, s = 1, base = [0, 0] }) {
    const r = deg * Math.PI / 180, c = Math.cos(r) * s, n = Math.sin(r) * s;
    const [bx, by] = base;
    return {
      dx, dy, deg, s, base,
      pt: (x, y) => [bx + c * (x - bx) - n * (y - by) + dx, by + n * (x - bx) + c * (y - by) + dy],
      vec: (x, y) => [c * x - n * y, n * x + c * y],
      m: [c, n, -n, c, bx - c * bx + n * by + dx, by - n * bx - c * by + dy],
    };
  }
  const isTranslation = (T) => T.deg === 0 && T.s === 1;

  /** Copia de los pares con la transformación T aplicada. mir = la entidad (o su POLYLINE) está reflejada en OCS.
   *  null si el tipo no se puede transformar todavía. */
  function transformPairs(type, pairs, T, mir) {
    if (!MOVABLE.has(type)) return null;
    if (type === 'VIEWPORT' && (T.deg || mir)) return null;
    const out = pairs.map((q) => q.slice());
    if (type === 'HATCH') {
      if (isTranslation(T)) return hatchTranslate(out, mir ? -T.dx : T.dx, T.dy);
      return mir ? null : hatchOps(out, simOps(T));
    }
    const R = RULES[type] || {};
    const flip = mir && OCS.has(type);
    const pt = flip ? (x, y) => { const [a, b] = T.pt(-x, y); return [-a, b]; } : T.pt;
    const dDeg = flip ? -T.deg : T.deg;
    let embedded = false;
    const pairY = (i, c) => { for (let j = i + 1; j < out.length && j < i + 4; j++) if (out[j][0] === c + 10) return j; return -1; };
    for (let i = 0; i < out.length; i++) {
      const c = out[i][0];
      if (c === 101) { embedded = true; continue; } // MTEXT incrustado en ATTRIB/ATTDEF (AutoCAD 2018+)
      const ptCodes = embedded ? [10] : (R.pt || []), vecCodes = embedded ? [11] : (R.vec || []);
      if (ptCodes.includes(c) || vecCodes.includes(c)) {
        const j = pairY(i, c); if (j < 0) continue;
        const x = parseFloat(out[i][1]), y = parseFloat(out[j][1]);
        const [a, b] = ptCodes.includes(c) ? pt(x, y) : T.vec(x, y);
        out[i][1] = fmt(a); out[j][1] = fmt(b);
      } else if (T.s !== 1 && ((embedded ? [40, 41, 46] : (R.len || [])).includes(c) || (R.scale || []).includes(c))) {
        out[i][1] = fmt(parseFloat(out[i][1]) * T.s);
      } else if (dDeg && !embedded && (R.ang || []).includes(c)) {
        out[i][1] = fmt(norm360(parseFloat(out[i][1]) + dDeg));
      } else if (dDeg && type === 'MTEXT' && c === 50) {
        out[i][1] = fmt(parseFloat(out[i][1]) + dDeg * Math.PI / 180); // en MTEXT el código 50 va en radianes
      }
    }
    // valores que faltan porque eran los de omisión
    const has = (c) => out.some((q) => q[0] === c);
    const insertAfter = (anchors, items) => {
      let k = -1;
      for (const a of anchors) { k = out.findIndex((q) => q[0] === a); if (k >= 0) break; }
      if (k < 0) k = out.length - 1;
      out.splice(k + 1, 0, ...items);
    };
    if (type === 'INSERT') {
      if (T.s !== 1 && !has(41)) insertAfter([30, 20], [[41, fmt(T.s)], [42, fmt(T.s)], [43, fmt(T.s)]]);
      if (dDeg && !has(50)) insertAfter([43, 42, 41, 30, 20], [[50, fmt(norm360(dDeg))]]);
    } else if ((type === 'TEXT' || type === 'ATTRIB' || type === 'ATTDEF') && dDeg && !has(50)) {
      insertAfter([1, 40], [[50, fmt(norm360(dDeg))]]);
    } else if (type === 'MTEXT' && dDeg && !has(11) && !has(50)) {
      insertAfter([41, 40], [[50, fmt(dDeg * Math.PI / 180)]]);
    }
    return out;
  }

  function hatchTranslate(out, dx, dy) {
    const add = (i, d) => { out[i][1] = fmt(parseFloat(out[i][1]) + d); };
    let seen91 = false, polyPath = false, edgeType = 0;
    for (let i = 0; i < out.length; i++) {
      const c = out[i][0], v = out[i][1];
      if (c === 91) seen91 = true;
      if (!seen91) continue; // antes de los contornos, 10/20/30 es la elevación
      if (c === 92) { polyPath = (parseInt(v, 10) & 2) !== 0; edgeType = 0; }
      else if (c === 72 && !polyPath) edgeType = parseInt(v, 10);
      else if (c === 10) add(i, dx); else if (c === 20) add(i, dy);
      else if (c === 11 && edgeType !== 3) add(i, dx); else if (c === 21 && edgeType !== 3) add(i, dy);
    }
    return out;
  }

  /** Operaciones de un sombreado bajo una transformación de semejanza (para hatchOps). */
  function simOps(T) {
    return { pt: T.pt, vec: T.vec, s: T.s, ang: (a) => norm360(a + T.deg),
      arc: (a0, a1, ccw) => (ccw ? [a0 + T.deg, a1 + T.deg, 1] : [a0 - T.deg, a1 - T.deg, 0]), ell: (a0, a1, ccw) => [a0, a1, ccw], bulge: (b) => b };
  }
  /** Recorre los pares de un HATCH (contornos, patrón y semillas) aplicando ops = {pt, vec, s, ang, arc, ell, bulge}. */
  function hatchOps(out, o) {
    const P = out; let i = 0;
    const setPt = (k, f) => { const j = k + 1; if (!P[j] || P[j][0] !== P[k][0] + 10) return; const [a, b] = f(parseFloat(P[k][1]), parseFloat(P[j][1])); P[k][1] = fmt(a); P[j][1] = fmt(b); };
    const find = (code, lim) => { while (i < P.length && P[i][0] !== code) { if (lim && lim.includes(P[i][0])) return -1; i++; } return i < P.length ? i : -1; };
    while (i < P.length && P[i][0] !== 91) { if (P[i][0] === 52) P[i][1] = fmt(o.ang(parseFloat(P[i][1]))); else if (P[i][0] === 41 && o.s !== 1) P[i][1] = fmt(parseFloat(P[i][1]) * o.s); i++; }
    if (i >= P.length) return out;
    const nPaths = parseInt(P[i][1], 10); i++;
    for (let k = 0; k < nPaths; k++) {
      if (find(92) < 0) return out;
      const flags = parseInt(P[i][1], 10); i++;
      if (flags & 2) {
        if (find(93) < 0) return out; const n = parseInt(P[i][1], 10); i++;
        for (let v = 0; v < n && i < P.length;) {
          if (P[i][0] === 10) { setPt(i, o.pt); i += 2; v++; if (P[i] && P[i][0] === 42) { P[i][1] = fmt(o.bulge(parseFloat(P[i][1]))); i++; } } else i++;
        }
      } else {
        if (find(93) < 0) return out; const ne = parseInt(P[i][1], 10); i++;
        for (let e = 0; e < ne && i < P.length; e++) {
          if (find(72) < 0) return out; const et = parseInt(P[i][1], 10); i++;
          if (et === 1) { const a = find(10); setPt(a, o.pt); const b = find(11); setPt(b, o.pt); i++; }
          else if (et === 2 || et === 3) {
            const c = find(10); setPt(c, o.pt);
            if (et === 3) { const m = find(11); setPt(m, o.vec); } else { const r = find(40); P[r][1] = fmt(parseFloat(P[r][1]) * o.s); }
            const a0 = find(50), a1 = find(51); i++;
            const kc = P[i] && P[i][0] === 73 ? i : -1; const ccw = kc >= 0 ? parseInt(P[kc][1], 10) : 1;
            const [n0, n1, nc] = (et === 2 ? o.arc : o.ell)(parseFloat(P[a0][1]), parseFloat(P[a1][1]), ccw);
            P[a0][1] = fmt(n0); P[a1][1] = fmt(n1); if (kc >= 0) P[kc][1] = String(nc);
          } else if (et === 4) {
            i++;
            while (i < P.length && ![72, 92, 97, 75].includes(P[i][0])) {
              const c = P[i][0];
              if (c === 10 || c === 11) { setPt(i, o.pt); i += 2; } else if (c === 12 || c === 13) { setPt(i, o.vec); i += 2; } else i++;
            }
          }
        }
      }
    }
    // patrón y semillas
    for (; i < P.length; i++) {
      const c = P[i][0];
      if (c === 52 || c === 53) P[i][1] = fmt(o.ang(parseFloat(P[i][1])));
      else if (c === 41 || c === 49) { if (o.s !== 1) P[i][1] = fmt(parseFloat(P[i][1]) * o.s); }
      else if (c === 43 && P[i + 1] && P[i + 1][0] === 44) { const [a, b] = o.pt(parseFloat(P[i][1]), parseFloat(P[i + 1][1])); P[i][1] = fmt(a); P[i + 1][1] = fmt(b); i++; }
      else if (c === 45 && P[i + 1] && P[i + 1][0] === 46) { const [a, b] = o.vec(parseFloat(P[i][1]), parseFloat(P[i + 1][1])); P[i][1] = fmt(a); P[i + 1][1] = fmt(b); i++; }
      else if (c === 98) { const n = parseInt(P[i][1], 10); let k = 0; i++; for (; i < P.length && k < n; i++) if (P[i][0] === 10) { setPt(i, o.pt); i++; k++; } i--; }
    }
    return out;
  }

  /** Compatibilidad: desplazar (dx, dy). */
  function translatePairs(type, pairs, dx, dy, mir) { return transformPairs(type, pairs, similarity({ dx, dy }), mir); }
  const mirrored = (rec) => rec.num(230, 1) < 0;

  // ---------------------------------------------------------------- sesión de edición
  class Session {
    constructor(doc) {
      this.doc = doc; this.D = doc.dxf;
      this.undoStack = []; this.redoStack = []; this.changed = false;
      const hs = this.D.header.$HANDSEED;
      this.seed = hs && hs[5] ? parseInt(hs[5], 16) : 0;
      this.useHandles = this.D.acadver && this.D.acadver !== 'AC1009';
      if (this.useHandles) { // por seguridad: la semilla debe ser mayor que todo handle existente (entidades, tablas y objetos)
        let max = 0; const tk = this.D.tk;
        const i0 = this.D.sections && this.D.sections.HEADER ? this.D.sections.HEADER[1] : 0; // en HEADER, «5» es la propia semilla
        for (let i = i0; i < tk.n; i++) { const c = tk.codes[i]; if (c === 5 || c === 105) { const n = parseInt(tk.vals[i], 16); if (n > max) max = n; } }
        if (this.seed <= max) this.seed = max + 1;
      }
      this.hdr = new Map(); // variables de cabecera cambiadas: '$NOMBRE|código' → valor
    }

    /** Valor actual de una variable de cabecera (con los cambios de la sesión). */
    hdrGet(name, code, def) { const k = name + '|' + code; if (this.hdr.has(k)) return this.hdr.get(k); const h = this.D.header[name]; return h && h[code] !== undefined ? String(h[code]).trim() : def; }
    _hdrPut(name, code, v) {
      const k = name + '|' + code;
      if (v === undefined) this.hdr.delete(k); else this.hdr.set(k, String(v));
      const H = this.D.header; if (!H[name]) H[name] = {};
      if (v === undefined) { if (this.D.headerOrig && this.D.headerOrig[k] !== undefined) H[name][code] = this.D.headerOrig[k]; }
      else { if (!this.D.headerOrig) this.D.headerOrig = {}; if (!(k in this.D.headerOrig)) this.D.headerOrig[k] = H[name][code]; H[name][code] = String(v); }
    }

    newHandle() { const h = this.seed.toString(16).toUpperCase(); this.seed++; return h; }

    /** Contenedor (lista) y posición de un registro. */
    locate(rec) {
      let i = this.D.entities.indexOf(rec);
      if (i >= 0) return { list: this.D.entities, i };
      for (const b of this.D.blocks.values()) { i = b.ents.indexOf(rec); if (i >= 0) return { list: b.ents, i }; }
      return null;
    }

    /** El registro y los que le pertenecen (VERTEX/ATTRIB … SEQEND). */
    withSeq(rec) {
      const loc = this.locate(rec); if (!loc) return [rec];
      const out = [rec];
      if (rec.type === 'POLYLINE' || (rec.type === 'INSERT' && rec.int(66, 0) === 1)) {
        for (let k = loc.i + 1; k < loc.list.length; k++) {
          const r = loc.list[k];
          if (r.type !== 'VERTEX' && r.type !== 'ATTRIB' && r.type !== 'SEQEND') break;
          out.push(r);
          if (r.type === 'SEQEND') break;
        }
      }
      return out;
    }

    run(op) { op.apply(); this.undoStack.push(op); this.redoStack.length = 0; this.changed = true; this.doc.invalidate(op.full, op); }
    undo() { const op = this.undoStack.pop(); if (!op) return false; op.revert(); this.redoStack.push(op); this.changed = true; this.doc.invalidate(op.full, op); return op.label; }
    redo() { const op = this.redoStack.pop(); if (!op) return false; op.apply(); this.undoStack.push(op); this.changed = true; this.doc.invalidate(op.full, op); return op.label; }

    // ---- operaciones
    erase(recs) {
      const all = [...new Set(recs.flatMap((r) => this.withSeq(r)))];
      this.run({ label: `Borrar ${recs.length}`, apply: () => all.forEach((r) => { r.deleted = true; }), revert: () => all.forEach((r) => { r.deleted = false; }) });
      return recs.length;
    }

    /** Aplica la transformación T (semejanza) a los registros. */
    transform(recs, T, label, xf) {
      const items = []; const refused = new Set();
      const extra = { adds: [], dels: [] };
      for (const r of recs) {
        if (r.type === 'DIMENSION' && Edit.dimHook) {
          const d = Edit.dimHook.transform(this, r, T, xf);
          if (!d) { refused.add(r.type); continue; }
          d.mods.forEach(({ rec, pairs }) => items.push({ q: rec, before: rec.p, after: pairs, wasDirty: !!rec.dirty }));
          extra.adds.push(...(d.adds || [])); extra.dels.push(...(d.dels || [])); continue;
        }
        const group = this.withSeq(r); const mir = mirrored(group[0]);
        const afters = group.map((q) => (xf ? xf(q.type, q.p, q.type === 'ATTRIB' ? mirrored(q) : mir) : transformPairs(q.type, q.p, T, mir)));
        if (afters.some((a) => !a)) { refused.add(r.type); continue; }
        group.forEach((q, k) => items.push({ q, before: q.p, after: afters[k], wasDirty: !!q.dirty }));
      }
      const n = recs.length - [...recs].filter((r) => refused.has(r.type)).length;
      if (!items.length) return { done: 0, refused: [...refused] };
      const { adds, dels } = extra;
      this.run({ label: `${label} ${n}`, full: adds.length > 0,
        apply: () => { items.forEach((it) => { it.q.p = it.after; it.q.dirty = true; }); adds.forEach((a) => { a.deleted = false; if (!a.home.includes(a)) a.home.push(a); }); dels.forEach((d) => { d.deleted = true; }); },
        revert: () => { items.forEach((it) => { it.q.p = it.before; it.q.dirty = it.wasDirty; }); adds.forEach((a) => { a.deleted = true; }); dels.forEach((d) => { d.deleted = false; }); } });
      return { done: n, refused: [...refused] };
    }

    move(recs, dx, dy) { const r = this.transform(recs, similarity({ dx, dy }), 'Mover'); return { moved: r.done, refused: r.refused }; }
    rotate(recs, base, deg) { return this.transform(recs, similarity({ base, deg }), 'Girar'); }
    scale(recs, base, s) { return this.transform(recs, similarity({ base, s }), 'Escalar'); }

    /** Registro nuevo a partir de pares (handle nuevo, sin reactores), en el mismo contenedor que `like`. */
    clone(like, type, pairs, page) {
      let p = stripReactors(pairs);
      if (this.useHandles) { const nh = this.newHandle(); p = p.some((q) => q[0] === 5) ? p.map(([c, v]) => (c === 5 ? [5, nh] : [c, v])) : [[5, nh], ...p]; }
      const loc = like ? this.locate(like) : null;
      const n = new DXF.Rec(type, p);
      n.isNew = true; n.home = loc ? loc.list : page.edit.container;
      n.insertLine = insertLineFor(this.D, n.home, page);
      return n;
    }

    copy(recs, dx, dy, page, T) {
      const res = this.copyRecs(recs, T || similarity({ dx, dy }), page);
      if (!res.recs.length) return { copied: 0, refused: res.refused };
      this.commit(`Copiar ${recs.length}`, { adds: res.recs, newBlocks: res.newBlocks });
      return { copied: res.copied, refused: res.refused, recs: res.recs };
    }

    /** Copias (sin guardar en el deshacer) de los registros con la transformación T. xf = función propia de pares
     *  (type, pairs, mir) → pares, para transformaciones que no son de semejanza (SIMETRIA). */
    copyRecs(recs, T, page, xf) {
      const tf = (type, p, mir, own) => (xf ? xf(type, p, own) : transformPairs(type, p, T, mir));
      const news = []; const refused = new Set(); const newBlocks = [];
      for (const r of recs) {
        if (r.type === 'DIMENSION' && Edit.dimHook) {
          const d = Edit.dimHook.copy(this, r, T, xf, page);
          if (!d) { refused.add(r.type); continue; }
          news.push(d.rec); if (d.extra) news.push(d.extra); newBlocks.push(d.block); continue;
        }
        const group = this.withSeq(r); const mir = mirrored(group[0]);
        const afters = group.map((q) => tf(q.type, q.p, mir, q.type === 'ATTRIB' ? mirrored(q) : mir));
        if (afters.some((a) => !a)) { refused.add(r.type); continue; }
        const handleMap = new Map(); const made = [];
        group.forEach((q, k) => {
          const n = this.clone(q, q.type, afters[k], page);
          const old = q.get(5); if (old && this.useHandles) handleMap.set(old.trim(), n.get(5));
          made.push(n);
        });
        // ATTRIB/VERTEX/SEQEND apuntan (330) a su INSERT/POLYLINE: se reenlazan a la copia
        for (const n of made) n.p = n.p.map(([c, v]) => (c === 330 && handleMap.has(String(v).trim()) ? [330, handleMap.get(String(v).trim())] : [c, v]));
        news.push(...made);
      }
      return { recs: news, newBlocks, refused: [...refused], copied: recs.length - [...recs].filter((r) => refused.has(r.type)).length };
    }

    /** Cambio compuesto en una sola operación de deshacer: mods = [{rec, pairs}], adds = [Rec nuevos], dels = [Rec],
     *  hdr = [{name, code, value}] variables de cabecera, blocks = [bloques a quitar]. Si toca tablas (capas, tipos de
     *  línea, estilos) se vuelven a leer y se redibuja todo (tables = true). */
    commit(label, { mods = [], adds = [], dels = [], hdr = [], blocks = [], newBlocks = [], tables = false, full = false, keepModel = false, layouts = false } = {}) {
      const m = mods.map(({ rec, pairs }) => ({ rec, before: rec.p, after: pairs, wasDirty: !!rec.dirty }));
      const d = [...new Set(dels.flatMap((r) => this.withSeq(r)))];
      const h = hdr.map(({ name, code, value }) => ({ name, code, value: value === undefined ? undefined : String(value), before: this.hdr.get(name + '|' + code) }));
      const post = () => { if (tables) DXF.deriveTables(this.D); if (layouts && DXF.deriveLayouts) DXF.deriveLayouts(this.D); };
      const D = this.D;
      const addB = (b) => { b.deleted = false; D.blocks.set(b.name.toUpperCase(), b); if (!D.blockList.includes(b)) D.blockList.push(b); };
      const delB = (b) => { b.deleted = true; if (D.blocks.get(b.name.toUpperCase()) === b) D.blocks.delete(b.name.toUpperCase()); };
      this.run({ label, keepModel, layouts, full: full || tables || blocks.length > 0 || newBlocks.length > 0 || adds.some((a) => a.inBlock) || dels.some((a) => a.inBlock),
        apply: () => { newBlocks.forEach(addB); m.forEach((x) => { x.rec.p = x.after; x.rec.dirty = true; }); adds.forEach((n) => { n.deleted = false; if (!n.home.includes(n)) n.home.push(n); }); d.forEach((r) => { r.deleted = true; });
          h.forEach((x) => this._hdrPut(x.name, x.code, x.value)); blocks.forEach((b) => { b.deleted = true; }); post(); },
        revert: () => { newBlocks.forEach(delB); m.forEach((x) => { x.rec.p = x.before; x.rec.dirty = x.wasDirty; }); adds.forEach((n) => { n.deleted = true; }); d.forEach((r) => { r.deleted = false; });
          h.forEach((x) => this._hdrPut(x.name, x.code, x.before)); blocks.forEach((b) => { b.deleted = false; }); post(); } });
    }

    /** Registro nuevo de una tabla (LAYER, LTYPE, STYLE…): va al final de la tabla, antes de ENDTAB. */
    tableRec(table, type, pairs) {
      const T = this.D.tables[table]; if (!T) return null;
      const n = new DXF.Rec(type, pairs);
      n.isNew = true; n.home = T.recs; n.insertLine = T.endLine;
      return n;
    }

    /** Agrega una entidad nueva en la hoja actual. body = pares desde el subtipo (después de capa). */
    add(page, type, subclass, body, layer) {
      const rec = this.make(page, type, subclass, body, layer);
      this.run({ label: `Crear ${type}`, apply: () => { rec.deleted = false; if (!rec.home.includes(rec)) rec.home.push(rec); }, revert: () => { rec.deleted = true; } });
      return rec;
    }

    /** Arma (sin agregar) una entidad nueva de la hoja actual. */
    make(page, type, subclass, body, layer, owner) {
      const ed = page.edit;
      const p = [];
      if (this.useHandles) p.push([5, this.newHandle()]);
      if (owner || ed.owner) p.push([330, owner || ed.owner]);
      p.push([100, 'AcDbEntity']);
      if (ed.paper) p.push([67, '1']);
      p.push([8, layer || '0']);
      if (subclass) p.push([100, subclass]);
      for (const q of body) p.push([q[0], val(q[0], q[1])]);
      if (type === 'TEXT') { // TEXT lleva el marcador dos veces; la alineación vertical (73) va después del segundo
        const k = p.findIndex((q) => q[0] === 73);
        const v73 = k >= 0 ? p.splice(k, 1)[0] : null;
        p.push([100, 'AcDbText']); if (v73) p.push(v73);
      }
      const rec = new DXF.Rec(type, p);
      rec.isNew = true; rec.insertLine = ed.insertLine; rec.home = ed.container;
      return rec;
    }

    // ---- guardar
    serialize() {
      const tk = this.D.tk; const lines = tk.lines;
      const skip = new Uint8Array(lines.length + 1);
      const replaceAt = new Map(); const insertAt = new Map();
      const visit = (list) => {
        for (const r of list) {
          if (r.isNew) {
            if (r.deleted) continue;
            const arr = insertAt.get(r.insertLine) || []; arr.push(...recLines(r)); insertAt.set(r.insertLine, arr);
            continue;
          }
          if (r.L0 == null) continue;
          if (r.deleted) { skip.fill(1, r.L0, r.L1); continue; }
          if (r.dirty) { skip.fill(1, r.L0, r.L1); replaceAt.set(r.L0, recLines(r)); }
        }
      };
      visit(this.D.entities);
      for (const b of (this.D.blockList || [...this.D.blocks.values()])) {
        if (b.isNew) { // bloque creado en la sesión (BLOQUE, cotas): BLOCK + entidades + ENDBLK al final de la sección BLOCKS
          if (b.deleted) continue;
          const at = this.D.blocksEndLine; const arr = insertAt.get(at) || [];
          arr.push(...recLines(b.head)); for (const r of b.ents) if (!r.deleted) arr.push(...recLines(r)); arr.push(...recLines(b.end));
          insertAt.set(at, arr); continue;
        }
        if (b.deleted) { if (b.head && b.end && b.head.L0 != null) skip.fill(1, b.head.L0, b.end.L1); continue; }
        visit(b.ents);
      }
      for (const T of Object.values(this.D.tables || {})) visit(T.recs);
      for (const L of [this.D.classes, this.D.objects]) if (L) visit(L); // CLASSES y OBJECTS leídos para editar (IMAGEN)
      // variables de cabecera cambiadas (las que no existían se agregan al final de HEADER)
      for (const [k, v] of this.hdr) {
        const [name, code] = k.split('|');
        const ti = this.D.headerTok[name] && this.D.headerTok[name][code];
        if (ti != null) { const vl = tk.li[ti] + 1; replaceAt.set(vl, [v]); skip[vl] = 1; }
        else if (this.D.headerEndLine != null) { const arr = insertAt.get(this.D.headerEndLine) || []; arr.push(codeStr(9), name, codeStr(+code), v); insertAt.set(this.D.headerEndLine, arr); }
      }
      // semilla de handles
      const ht = this.D.headerTok.$HANDSEED;
      if (this.useHandles && ht && ht[5] != null) {
        const vl = tk.li[ht[5]] + 1;
        replaceAt.set(vl, [this.seed.toString(16).toUpperCase()]); skip[vl] = 1;
      }
      const out = [];
      for (let i = 0; i < lines.length; i++) {
        const ins = insertAt.get(i); if (ins) out.push(...ins);
        const rep = replaceAt.get(i); if (rep) out.push(...rep);
        if (!skip[i]) out.push(lines[i]);
      }
      const ins = insertAt.get(lines.length); if (ins) out.push(...ins);
      return out.join(tk.eol);
    }
  }

  function stripReactors(p) {
    const out = []; let depth = 0;
    for (const q of p) {
      if (q[0] === 102) { const v = String(q[1]).trim(); if (v.startsWith('{')) { depth++; continue; } if (v === '}') { depth = Math.max(0, depth - 1); continue; } }
      if (depth === 0) out.push(q);
    }
    return out;
  }

  function insertLineFor(D, list, page) {
    if (list === D.entities) return D.entitiesEndLine;
    for (const b of D.blocks.values()) if (b.ents === list) return b.endLine;
    for (const T of Object.values(D.tables || {})) if (T.recs === list) return T.endLine;
    return page.edit.insertLine;
  }

  // ---------------------------------------------------------------- puntos de enganche (referencias a objetos)
  /** Puntos notables de un registro: {x,y,kind}. kind: end | mid | cen | ins | quad */
  function snapPoints(rec) {
    const pts = []; const P = (x, y, kind) => pts.push({ x, y, kind });
    const t = rec.type;
    if (rec.num(230, 1) < 0) return pts; // entidades reflejadas (OCS): se omiten por ahora
    if (t === 'LINE') {
      const x0 = rec.num(10), y0 = rec.num(20), x1 = rec.num(11), y1 = rec.num(21);
      P(x0, y0, 'end'); P(x1, y1, 'end'); P((x0 + x1) / 2, (y0 + y1) / 2, 'mid');
    } else if (t === 'LWPOLYLINE') {
      const vs = []; let cur = null;
      for (const [c, v] of rec.p) { if (c === 10) { cur = [parseFloat(v), 0]; vs.push(cur); } else if (c === 20 && cur) cur[1] = parseFloat(v); }
      vs.forEach(([x, y], k) => { P(x, y, 'end'); if (k) P((x + vs[k - 1][0]) / 2, (y + vs[k - 1][1]) / 2, 'mid'); });
      if ((rec.int(70) & 1) && vs.length > 2) { const a = vs[0], b = vs[vs.length - 1]; P((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 'mid'); }
    } else if (t === 'CIRCLE') {
      const x = rec.num(10), y = rec.num(20), r = rec.num(40);
      P(x, y, 'cen'); P(x + r, y, 'quad'); P(x - r, y, 'quad'); P(x, y + r, 'quad'); P(x, y - r, 'quad');
    } else if (t === 'ARC') {
      const x = rec.num(10), y = rec.num(20), r = rec.num(40), a0 = rec.num(50) * Math.PI / 180, a1 = rec.num(51) * Math.PI / 180;
      let am = (a0 + a1) / 2; if (a1 < a0) am += Math.PI;
      P(x, y, 'cen'); P(x + r * Math.cos(a0), y + r * Math.sin(a0), 'end'); P(x + r * Math.cos(a1), y + r * Math.sin(a1), 'end'); P(x + r * Math.cos(am), y + r * Math.sin(am), 'mid');
    } else if (t === 'TEXT' || t === 'MTEXT' || t === 'INSERT' || t === 'POINT') {
      P(rec.num(10), rec.num(20), 'ins');
    }
    return pts;
  }

  /** Bytes del DXF a guardar (igual que la app de Mac): UTF-8, o Windows-1252 con \U+XXXX para lo que no cabe (DXF < 2007). */
  const CP1252 = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E,
    0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
  function encodeDXF(text, enc) {
    if (enc !== 'windows-1252') return new TextEncoder().encode(text);
    const out = [];
    for (const ch of text) {
      const c = ch.codePointAt(0);
      if (c < 0x80 || (c >= 0xA0 && c <= 0xFF)) out.push(c);
      else if (CP1252[c]) out.push(CP1252[c]);
      else for (const k of `\\U+${c.toString(16).toUpperCase().padStart(4, '0')}`) out.push(k.charCodeAt(0));
    }
    return Uint8Array.from(out);
  }

  return { Session, encodeDXF, translatePairs, transformPairs, similarity, snapPoints, fmt, val, mirrored, stripReactors, recLines, codeStr, hatchOps, simOps, norm360, RULES, OCS, MOVABLE, dimHook: null };
})();
if (typeof module !== 'undefined') module.exports = Edit; else self.Edit = Edit;
