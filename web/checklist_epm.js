// Domoplano — H6-E: CHECKEPM, lista de chequeo NC-RA8-001 automática sobre una plancha (código propio).
// Revisa lo que EPM marca en su «Lista de verificación de proyectos particulares» y lo que devolvió en la Tienda del Café:
//   rótulo completo (6.2.3.1 a–l, máx. 160 × 100 mm, firma escaneada), sello 160 × 70 encima del rótulo (Fig. 1, 6.2.3.9),
//   símbolo de proyección del tercer cuadrante (6.2.3.1 j), escala en cada dibujo y ventanas normalizadas (6.2.2 Tabla 4),
//   norte en localización y ubicación (6.2.3.2, 6.2.3.3 a), convenciones (6.2.3.6), notas (6.2.3.8), cuadro de cargas con
//   las columnas de 6.2.3.7 (Fig. 27/29) + la distancia de cada alimentador (patrón Praga), textos ≥ 2,5 mm en notas y
//   convenciones (6.3.1 c), 0 textos montados (web/verificador.js), una capa o el mínimo, DWF < 1 MB y sin imágenes raster
//   salvo la firma. Cada punto sale ✅ / ❌ / ⚠️ con «dónde» (coordenadas de la plancha).
// Funciona con la plantilla EPM de Domoplano (rótulo como bloque con atributos) y con planos «planos» de textos sueltos.
// Sin código ni archivos de Autodesk.
//
// Uso:  const r = await ChecklistEPM.revisar(textoDXF, { presentacion, pesoDWF | medirDWF: async (plancha) => bytes })
//       r.items[] {id, titulo, norma, estado: 'ok'|'falla'|'aviso', detalle, donde: [{x, y, que}]} · r.informe · ChecklistEPM.md(r) · ChecklistEPM.dxfInforme(r)
const ChecklistEPM = (() => {
  const V = (typeof Verificador !== 'undefined') ? Verificador : require('./verificador.js');
  const C = (typeof Comparador !== 'undefined') ? Comparador : require('./comparador.js');
  const D2R = Math.PI / 180;
  const r1 = (v) => Math.round(v * 10) / 10;
  const N = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  const dentro = (p, b, m = 0) => p[0] >= b[0] - m && p[0] <= b[2] + m && p[1] >= b[1] - m && p[1] <= b[3] + m;
  const bbDentro = (a, b, m = 0) => a[0] >= b[0] - m && a[2] <= b[2] + m && a[1] >= b[1] - m && a[3] <= b[3] + m;
  const area = (b) => (b[2] - b[0]) * (b[3] - b[1]);
  const sinLlenar = (s) => /\(\?\)|_{4,}/.test(String(s));
  const ESCALAS = [1, 2, 5, 10, 20, 25, 50, 75, 100, 200, 250, 500, 1000, 2000, 2500, 5000];

  // ================================================================ aplanar la plancha (bloques abiertos, hasta 3 niveles)
  function aplanar(ents, D, T = C.ident, nivel = 0, padre = null, out = []) {
    for (const e of ents) {
      if (e.type === 'ATTDEF' && nivel > 0) continue;
      if (e.type === 'INSERT') {
        const b = D.blocks.get(e.s(2).toUpperCase());
        const geo = C.geometria(e, D, T, nivel);
        out.push({ e, tipo: 'INSERT', nombre: e.s(2), padre, nivel, bb: C.bbDe(geo), geo, capa: e.s(8, '0') });
        if (b && nivel < 3) aplanar(b.ents, D, C.xform(e, b.base, T), nivel + 1, padre || e, out);
        for (const a of e.sub) if (a.type === 'ATTRIB') aplanar([a], D, T, nivel + 1, padre || e, out);
        continue;
      }
      const geo = C.geometria(e, D, T, nivel); const bb = C.bbDe(geo);
      const o = { e, tipo: e.type, padre, nivel, bb, geo, capa: e.s(8, '0') };
      if (/^(TEXT|MTEXT|ATTRIB|ATTDEF)$/.test(e.type)) {
        o.texto = C.textoDe(e); o.h = e.n(40, 0) * T.k; o.tag = e.type === 'ATTRIB' || e.type === 'ATTDEF' ? e.s(2).toUpperCase() : null;
        const h72 = e.n(72, 0), v73 = e.n(73, 0); o.pt = T.f((h72 || v73) && e.has(11) && e.type !== 'MTEXT' ? [e.n(11), e.n(21)] : [e.n(10), e.n(20)]);
        if (bb) { o.pt = [bb[0], (bb[1] + bb[3]) / 2]; o.cx = (bb[0] + bb[2]) / 2; } // ubicación = borde izquierdo a media altura (como se lee)
      }
      if (e.type === 'CIRCLE') { o.c = T.f([e.n(10), e.n(20)]); o.r = e.n(40) * T.k; }
      if (e.type === 'LWPOLYLINE' && (e.n(70, 0) & 1) && bb) {
        const vs = geo[0] || []; const ok = vs.length >= 4 && vs.length <= 6 && vs.every(([x, y]) => (Math.abs(x - bb[0]) < 0.05 || Math.abs(x - bb[2]) < 0.05) && (Math.abs(y - bb[1]) < 0.05 || Math.abs(y - bb[3]) < 0.05));
        if (ok) o.rect = bb;
      }
      if (e.type === 'VIEWPORT') o.vp = true;
      out.push(o);
    }
    return out;
  }

  // ================================================================ revisión
  async function revisar(entrada, o = {}) {
    const texto = typeof entrada === 'string' ? entrada : decode(entrada);
    const D = V.leer(texto); const E = C.espaciosDe(D);
    const papeles = [...E.entries()].filter(([k]) => k !== 'Modelo');
    let nombre = o.presentacion && E.has(o.presentacion) ? o.presentacion : null;
    if (!nombre && o.presentacion) { const k = [...E.keys()].find((x) => x.toUpperCase() === String(o.presentacion).toUpperCase()); if (k) nombre = k; }
    if (!nombre) {
      const mEnts = E.get('Modelo') || [];
      const mejorPapel = papeles.length ? papeles.reduce((a, b) => (b[1].length > a[1].length ? b : a)) : null;
      const esPlanchaReal = mejorPapel && (mejorPapel[1].length >= 15 || mejorPapel[1].some((e) => e.type === 'INSERT' && /ROTULO|CAJETIN|TITLE|TITULO/i.test(e.s(2))));
      nombre = esPlanchaReal || !mEnts.length ? mejorPapel[0] : 'Modelo';
    }
    const lay = D.layouts.find((l) => l.name === nombre);
    let hoja = [0, 0];
    if (lay && lay.paper[0] > 0) hoja = lay.rot % 2 === 1 ? [lay.paper[1], lay.paper[0]] : [lay.paper[0], lay.paper[1]];
    const ents = E.get(nombre) || [];
    const objs = aplanar(ents, D);
    const top = objs.filter((x) => x.nivel === 0);
    const textos = objs.filter((x) => x.texto && x.texto.trim() && x.tipo !== 'ATTDEF' && x.bb);
    const rects = objs.filter((x) => x.rect).map((x) => x.rect);
    const items = [];
    const add = (id, titulo, norma, estado, detalle, donde = []) => items.push({ id, titulo, norma, estado, detalle, donde: donde.slice(0, 40).map((d) => ({ x: r1(d.x), y: r1(d.y), que: d.que || '' })) });
    const espacio = (p, minW = 40, minH = 25, excepto = null) => { let best = null; for (const r of rects) { if (r === excepto || r[2] - r[0] < minW || r[3] - r[1] < minH || !dentro(p, r)) continue; if (!best || area(r) < area(best)) best = r; } return best; };
    const buscar = (re) => textos.filter((t) => re.test(N(t.texto)));
    const en = (t) => ({ x: t.pt[0], y: t.pt[1], que: t.texto.slice(0, 70) });
    if (nombre === 'Modelo') add('plancha', 'Plancha revisada', 'NC-RA8-001 6.2', 'aviso', 'El plano no tiene planchas: se revisó el Modelo (la norma se revisa sobre la hoja que se entrega).');

    // -------------------------------------------------------------- 1. rótulo (6.2.3.1 a–l)
    const LETRAS = [
      ['a', 'Proyecto (nombre, dirección, municipio)', ['PROYECTO', 'DIRECCION'], /^PROYECTO\s*:/],
      ['b', 'Firma que presenta (nombre, contacto, NIT/CC)', ['FIRMA', 'FIRMA_CONTACTO'], /^FIRMA QUE (PRESENTA|DISENA)/],
      ['c', 'Propietario (nombre, contacto, NIT/CC)', ['PROPIETARIO', 'PROPIETARIO_CONTACTO'], /^PROPIETARIO/],
      ['d', 'Consecutivo', ['CONSECUTIVO'], /^CONSECUTIVO/],
      ['e', 'Contiene (DR1 a DR11)', ['CONTIENE'], /^CONTIENE/],
      ['f', 'Diseñó (nombre y matrícula)', ['DISENO', 'MATRICULA'], /^DISEN(O|ADOR)\b/],
      ['g', 'Dibujó', ['DIBUJO'], /^DIBUJ/],
      ['h', 'Escala', ['ESCALA'], /^ESCALA\s*:/],
      ['i', 'Fecha', ['FECHA'], /^FECHA\b/],
      ['j', 'Sistema de proyección (tercer cuadrante)', [], null],
      ['k', 'Numeración n/p (plancha X de Y)', ['PLANCHA', 'TOTAL'], null],
      ['l', 'Solicitud (SN) o pedido', ['SN'], /^(SN\b|SOLICITUD)/],
    ];
    const insRot = top.find((x) => x.tipo === 'INSERT' && /ROTULO|CAJETIN|TITLE|TITULO/i.test(x.nombre) && x.e.sub.some((a) => a.type === 'ATTRIB'));
    let zona = null; const porLetra = {};
    if (insRot) {
      zona = insRot.bb;
      const at = new Map(insRot.e.sub.filter((a) => a.type === 'ATTRIB').map((a) => [a.s(2).toUpperCase(), V.textoPlano(a.s(1)).trim()]));
      const ubic = (tag) => { const t = textos.find((x) => x.tag === tag && x.padre === insRot.e); return t ? t.pt : [zona[0], zona[1]]; };
      for (const [l, nom, tags] of LETRAS) {
        if (!tags.length) continue;
        const malos = tags.filter((t) => !at.has(t) || !at.get(t) || sinLlenar(at.get(t)) || (t === 'SN' && /CAMPO DE EPM/i.test(at.get(t))));
        porLetra[l] = { ok: !malos.length, valor: tags.map((t) => at.get(t) || '').join(' · '), donde: malos.map((t) => ({ x: ubic(t)[0], y: ubic(t)[1], que: `${t}: ${at.has(t) ? (at.get(t) || 'vacío') : 'no existe'}` })) };
      }
    } else {
      const labels = [];
      for (const [l, , , re] of LETRAS) if (re) for (const t of buscar(re)) labels.push([l, t]);
      if (labels.length >= 3) {
        let best = null, nb = 0;
        for (const r of rects) { const n = labels.filter(([, t]) => dentro(t.pt, r)).length; if (n > nb || (n === nb && best && area(r) < area(best))) { best = r; nb = n; } }
        if (best && nb >= 3) zona = best;
        else { const xs = labels.map(([, t]) => t.bb); zona = [Math.min(...xs.map((b) => b[0])) - 5, Math.min(...xs.map((b) => b[1])) - 5, Math.max(...xs.map((b) => b[2])) + 5, Math.max(...xs.map((b) => b[3])) + 5]; }
        const esLabel = new Set(labels.map(([, t]) => t));
        for (const [l, , , re] of LETRAS) {
          if (!re) continue;
          const t = labels.filter(([x, tt]) => x === l && dentro(tt.pt, zona)).map(([, tt]) => tt)[0];
          if (!t) { porLetra[l] = { ok: false, valor: '', donde: [{ x: zona[0], y: zona[1], que: 'no se encontró el campo' }] }; continue; }
          const cel = espacio(t.pt, 15, 5); const valores = [];
          if (cel && cel !== zona && bbDentro(cel, zona, 1) && area(cel) < 0.6 * area(zona)) for (const x of textos) { if (x !== t && !esLabel.has(x) && dentro(x.pt, cel)) valores.push(x); }
          if (!valores.length) {
            let mejor = null, dm = Infinity;
            for (const x of textos) {
              if (x === t || esLabel.has(x) || x.h >= 8 || !dentro(x.pt, zona)) continue;
              const dx = x.pt[0] - t.pt[0], dy = x.pt[1] - t.pt[1]; if (dx < -5 || dx > 120 || dy < -18 || dy > 2) continue;
              const d = Math.hypot(dx, dy * 2); if (d < dm) { dm = d; mejor = x; }
            }
            if (mejor) valores.push(mejor);
          }
          const enLinea = N(t.texto).replace(re, '').replace(/^[:\s.]*(NO\.?)?\s*/, '');
          const malos = valores.filter((x) => sinLlenar(x.texto));
          const hay = valores.length || enLinea.length > 4;
          porLetra[l] = { ok: hay && !malos.length && !sinLlenar(t.texto), valor: [enLinea.length > 4 ? t.texto : '', ...valores.map((x) => x.texto)].filter(Boolean).join(' · ').slice(0, 160),
            donde: !hay ? [{ x: t.pt[0], y: t.pt[1], que: t.texto + ' (vacío)' }] : [...(sinLlenar(t.texto) ? [en(t)] : []), ...malos.map(en)] };
        }
      }
    }
    // j) proyección del tercer cuadrante: dos círculos concéntricos (y un cono truncado o el texto PROYECCIÓN)
    const circ = objs.filter((x) => x.c && x.r > 0.5 && x.r < 20);
    let proy = null;
    for (const a of circ) for (const b of circ) {
      if (a === b || b.r >= a.r || Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1]) > 0.15 || b.r / a.r < 0.25 || b.r / a.r > 0.85) continue;
      if (zona && !dentro(a.c, zona, 2)) continue;
      const cono = objs.some((x) => x.tipo === 'LWPOLYLINE' && x.bb && (x.e.n(70, 0) & 1) && (x.geo[0] || []).length >= 4 && (x.geo[0] || []).length <= 5 && Math.hypot((x.bb[0] + x.bb[2]) / 2 - a.c[0], (x.bb[1] + x.bb[3]) / 2 - a.c[1]) < 4 * a.r + 6);
      const txt = textos.some((t) => /PROYECC/.test(N(t.texto)) && Math.hypot(t.pt[0] - a.c[0], t.pt[1] - a.c[1]) < 40);
      if (cono || txt) { proy = a.c; break; }
    }
    porLetra.j = { ok: !!proy, valor: proy ? 'símbolo encontrado' : '', donde: proy ? [] : (zona ? [{ x: zona[2] - 30, y: zona[1] + 5, que: 'falta el símbolo de proyección' }] : []) };
    // k) n/p
    if (!porLetra.k) {
      const nums = zona ? textos.filter((t) => dentro(t.pt, zona) && /^\d{1,3}$/.test(t.texto.trim())) : [];
      const np = zona ? textos.find((t) => dentro(t.pt, zona) && /\b\d{1,3}\s*(\/|DE)\s*\d{1,3}\b/.test(N(t.texto)) && !/\d{4}/.test(t.texto)) : null;
      porLetra.k = { ok: nums.length >= 2 || !!np, valor: np ? np.texto : nums.map((t) => t.texto).join(' / '), donde: nums.length >= 2 || np ? [] : (zona ? [{ x: zona[2] - 15, y: zona[1] + 10, que: 'falta n/p' }] : []) };
    }
    // R2-fix M-13: el «de Y» del rótulo debe coincidir con las planchas que de verdad tiene el plano (las que llevan rótulo)
    if (insRot && porLetra.k && porLetra.k.ok) {
      const esRot = (e) => e.type === 'INSERT' && /ROTULO|CAJETIN|TITLE|TITULO/i.test(e.s(2)) && e.sub.some((a) => a.type === 'ATTRIB');
      const tabDe = (k) => { const L = D.layouts.find((l) => l.name === k); return L && L.tab ? L.tab : 0; };
      const conRot = papeles.filter(([, es]) => es.some(esRot)).map(([k]) => k).sort((a, b) => tabDe(a) - tabDe(b));
      const at = new Map(insRot.e.sub.filter((a) => a.type === 'ATTRIB').map((a) => [a.s(2).toUpperCase(), V.textoPlano(a.s(1)).trim()]));
      const nP = parseInt(at.get('PLANCHA'), 10), nT = parseInt(at.get('TOTAL'), 10), real = conRot.length, mia = conRot.indexOf(nombre) + 1;
      const mal = [];
      if (real > 0 && Number.isFinite(nT) && nT !== real) mal.push(`dice «de ${at.get('TOTAL')}» pero el plano tiene ${real} plancha(s) con rótulo`);
      if (mia > 0 && Number.isFinite(nP) && nP !== mia) mal.push(`dice «plancha ${at.get('PLANCHA')}» pero es la ${String(mia).padStart(2, '0')}`);
      if (mal.length) { const t = textos.find((x) => x.tag === 'TOTAL' && x.padre === insRot.e) || textos.find((x) => x.tag === 'PLANCHA' && x.padre === insRot.e); porLetra.k = { ok: false, valor: porLetra.k.valor + ' — ' + mal.join('; '), donde: [{ x: t ? t.pt[0] : zona[0], y: t ? t.pt[1] : zona[1], que: mal.join('; ') }] }; }
    }
    if (!zona) add('rotulo', 'Rótulo completo (campos a–l)', 'NC-RA8-001 6.2.3.1, Fig. 4', 'falla', 'No se encontró el rótulo (ni el bloque EPM_ROTULO ni los títulos PROYECTO:, CONSECUTIVO, CONTIENE, DISEÑÓ, FECHA, SN…).');
    else {
      const malas = LETRAS.filter(([l]) => !porLetra[l] || !porLetra[l].ok);
      add('rotulo', 'Rótulo completo (campos a–l)', 'NC-RA8-001 6.2.3.1, Fig. 4', malas.length ? 'falla' : 'ok',
        LETRAS.map(([l, nom]) => `${porLetra[l] && porLetra[l].ok ? '✅' : '❌'} ${l}) ${nom}${porLetra[l] && porLetra[l].valor ? ': ' + porLetra[l].valor.slice(0, 90) : ''}`).join('\n'),
        malas.flatMap(([l]) => (porLetra[l] ? porLetra[l].donde : []).map((d) => ({ ...d, que: `${l}) ${d.que}` }))));
      const w = zona[2] - zona[0], h = zona[3] - zona[1];
      add('rotulo_tam', 'Tamaño del rótulo (máx. 160 × 100 mm)', 'NC-RA8-001 6.2.3.1', w <= 160.6 && h <= 100.6 ? 'ok' : 'falla', `El rótulo mide ${r1(w)} × ${r1(h)} mm.`, w <= 160.6 && h <= 100.6 ? [] : [{ x: zona[0], y: zona[3], que: `${r1(w)} × ${r1(h)} mm` }]);
    }
    // firma escaneada (IMAGE) en el rótulo
    const imgs = objs.filter((x) => x.tipo === 'IMAGE' || x.tipo === 'OLE2FRAME');
    const firmas = zona ? imgs.filter((x) => x.tipo === 'IMAGE' && x.bb && dentro([(x.bb[0] + x.bb[2]) / 2, (x.bb[1] + x.bb[3]) / 2], zona, 1)) : [];
    add('firma', 'Firma escaneada del diseñador en el rótulo', 'NC-RA8-001 §7 c, 6.2.3.1 f', firmas.length ? 'ok' : 'falla',
      firmas.length ? `${firmas.length} imagen(es) en el rótulo.` : 'No hay imagen de firma (IMAGE) dentro del rótulo: insértela con IMAGEN.', firmas.length || !zona ? [] : [{ x: zona[0] + (zona[2] - zona[0]) * 0.7, y: zona[1] + (zona[3] - zona[1]) * 0.4, que: 'falta la firma' }]);

    // -------------------------------------------------------------- 2. sello 160 × 70 encima del rótulo
    {
      let sello = null; const tSel = buscar(/SELLO/);
      for (const t of tSel) { const r = espacio(t.pt, 60, 30); if (r && (!sello || area(r) < area(sello))) sello = r; }
      if (!sello && zona) sello = rects.find((r) => Math.abs(r[1] - zona[3]) < 8 && r[2] - r[0] >= 159 && r[3] - r[1] >= 69) || null;
      if (!sello) add('sello', 'Espacio para el sello (160 × 70 mm) encima del rótulo', 'NC-RA8-001 Fig. 1, 6.2.3.9', 'falla', 'No se encontró el espacio 9 de sellos (recuadro libre de 160 × 70 mm o más encima del rótulo).', zona ? [{ x: zona[0], y: zona[3] + 10, que: 'aquí va el sello' }] : []);
      else {
        const w = sello[2] - sello[0], h = sello[3] - sello[1]; const prob = [];
        if (w < 159.5 || h < 69.5) prob.push(`mide ${r1(w)} × ${r1(h)} mm (mínimo 160 × 70)`);
        if (zona) { const sobre = Math.abs(sello[1] - zona[3]) <= 8 && Math.min(sello[2], zona[2]) - Math.max(sello[0], zona[0]) >= 0.8 * Math.min(w, zona[2] - zona[0]); if (!sobre) prob.push('no está justo encima del rótulo'); }
        const adentro = top.filter((x) => x.bb && x.rect !== sello && !(x.texto && /SELLO/i.test(N(x.texto))) && bbDentro(x.bb, [sello[0] + 0.5, sello[1] + 0.5, sello[2] - 0.5, sello[3] - 0.5]));
        if (adentro.length) prob.push(`tiene ${adentro.length} objeto(s) adentro (debe quedar libre)`);
        add('sello', 'Espacio para el sello (160 × 70 mm) encima del rótulo', 'NC-RA8-001 Fig. 1, 6.2.3.9', prob.length ? 'falla' : 'ok', prob.length ? 'El sello ' + prob.join('; ') + '.' : `Recuadro de ${r1(w)} × ${r1(h)} mm libre, encima del rótulo.`,
          adentro.length ? adentro.map((x) => ({ x: x.bb[0], y: x.bb[1], que: x.tipo + (x.texto ? ' ' + x.texto.slice(0, 40) : '') })) : prob.length ? [{ x: sello[0], y: sello[1], que: prob[0] }] : []);
      }
    }
    // -------------------------------------------------------------- 3. símbolo de proyección
    add('proyeccion', 'Símbolo del sistema de proyección (tercer cuadrante)', 'NC-RA8-001 6.2.3.1 j', proy ? 'ok' : 'falla', proy ? 'Círculos concéntricos y cono truncado (o el texto PROYECCIÓN) en el rótulo.' : 'No se encontró el símbolo de proyección del tercer cuadrante en el rótulo.', proy ? [{ x: proy[0], y: proy[1], que: 'símbolo' }] : porLetra.j.donde);

    // -------------------------------------------------------------- 4. escalas
    const titulosDibujo = textos.filter((t) => { const s = N(t.texto).replace(/^ESPACIO\s*\d+\s*-\s*/, ''); return /^(LOCALIZACION|UBICACION|DIAGRAMA DE UBICACION|VISTA|VISTAS|DETALLE|CORTE|PLANTA|PERFIL)/.test(s) && t.texto.length < 130; });
    const escalaDe = (t) => {
      const r = espacio(t.pt, 30, 20);
      const cand = [t, ...textos.filter((x) => x !== t && Math.abs(x.pt[1] - t.pt[1]) <= 6 && (r ? dentro(x.pt, r) : Math.abs(x.pt[0] - t.pt[0]) < 250))];
      for (const x of cand) { const s = N(x.texto); if (/ESCALA|\bESC\b|S\/E|1\s*:\s*\d/.test(s)) { const m = /1\s*:\s*([\d.]+)/.exec(s); return { txt: x.texto, n: m ? parseFloat(m[1].replace(/\./g, '')) : null, sin: /SIN ESCALA|S\/E|ESQUEMA/.test(s), r }; } }
      return { txt: null, r };
    };
    {
      const prob = [], lineas = [], donde = [];
      for (const t of titulosDibujo) {
        const e = escalaDe(t); const s = N(t.texto);
        if (!e.txt && /^ESPACIO\s*\d/.test(s) && e.r && titulosDibujo.some((x) => x !== t && dentro(x.pt, e.r) && escalaDe(x).txt)) continue; // el título del espacio: la escala va en el título de cada dibujo
        if (!e.txt) { prob.push(t.texto); donde.push({ ...en(t), que: 'sin escala: ' + t.texto.slice(0, 50) }); lineas.push(`❌ ${t.texto.slice(0, 60)}: sin escala`); continue; }
        if (/LOCALIZACION/.test(s) && !(e.n === 500 || e.n === 1000)) { prob.push(t.texto); donde.push({ ...en(t), que: 'Tabla 4: localización 1:500 o 1:1000' }); lineas.push(`❌ ${t.texto.slice(0, 60)}: ${e.txt} (Tabla 4 pide 1:500 o 1:1000)`); continue; }
        const k = e.txt.search(/SIN ESCALA|ESCALA|ESC\.|S\/E|1\s*:\s*\d/i);
        lineas.push(`✅ ${t.texto.slice(0, 60)}: ${e.txt === t.texto && k > 0 ? e.txt.slice(k) : e.txt}`);
      }
      const unitMM = C.INSUNITS_MM[(D.header.$INSUNITS && parseInt(D.header.$INSUNITS[70], 10)) || 4] || 1;
      for (const v of top.filter((x) => x.vp && x.e.n(69, 2) !== 1 && x.e.n(68, 1) !== 0)) {
        const h = v.e.n(41), vh = v.e.n(45); if (!(h > 0 && vh > 0)) continue;
        const n = unitMM / (h / vh); const nr = ESCALAS.find((k) => Math.abs(n - k) / k < 0.005);
        const c = [v.e.n(10), v.e.n(20)];
        if (!nr) { prob.push('ventana'); donde.push({ x: c[0], y: c[1], que: `ventana a 1:${r1(n)} (no normalizada)` }); lineas.push(`❌ ventana en (${r1(c[0])}, ${r1(c[1])}): 1:${r1(n)} no es una escala normalizada`); continue; }
        const tit = titulosDibujo.find((t) => { const r = espacio(t.pt, 30, 20); return r && dentro(c, r); });
        const e = tit ? escalaDe(tit) : null;
        if (e && e.n && e.n !== nr && !e.sin) { prob.push('ventana'); donde.push({ x: c[0], y: c[1], que: `la ventana está a 1:${nr} y el título dice 1:${e.n}` }); lineas.push(`❌ ventana de «${tit.texto.slice(0, 40)}»: 1:${nr} pero el título dice 1:${e.n}`); continue; }
        lineas.push(`✅ ventana${tit ? ' de «' + tit.texto.slice(0, 40) + '»' : ''}: 1:${nr}`);
      }
      if (!titulosDibujo.length) add('escalas', 'Escala en cada dibujo', 'NC-RA8-001 6.2.2 Tabla 4, Fig. 1', 'aviso', 'No se encontraron títulos de dibujo (LOCALIZACIÓN, UBICACIÓN, VISTA, DETALLE…) para revisar sus escalas.' + (lineas.length ? '\n' + lineas.join('\n') : ''), donde);
      else add('escalas', 'Escala en cada dibujo', 'NC-RA8-001 6.2.2 Tabla 4, Fig. 1', prob.length ? 'falla' : 'ok', lineas.join('\n'), donde);
    }
    // -------------------------------------------------------------- 5. norte
    {
      const nortes = [];
      for (const x of top) if (x.tipo === 'INSERT' && /NORTE|NORTH/i.test(x.nombre) && x.bb) nortes.push([(x.bb[0] + x.bb[2]) / 2, (x.bb[1] + x.bb[3]) / 2]);
      for (const t of textos) {
        const s = N(t.texto); if (s !== 'N' && s !== 'NORTE' && s !== 'NORTE GEOGRAFICO' && s !== 'NG') continue;
        const cerca = objs.some((x) => !x.texto && x.bb && x.tipo !== 'VIEWPORT' && (x.bb[2] - x.bb[0]) < 60 && Math.hypot((x.bb[0] + x.bb[2]) / 2 - t.pt[0], (x.bb[1] + x.bb[3]) / 2 - t.pt[1]) < 25);
        if (cerca && !nortes.some((p) => Math.hypot(p[0] - t.pt[0], p[1] - t.pt[1]) < 40)) nortes.push(t.pt);
      }
      const unicos = []; for (const p of nortes) if (!unicos.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 40)) unicos.push(p);
      const faltan = [];
      for (const t of titulosDibujo) { const s = N(t.texto); if (!/LOCALIZACION|UBICACION/.test(s)) continue; const r = espacio(t.pt, 30, 20); if (r && !unicos.some((p) => dentro(p, r))) faltan.push(t); }
      add('norte', 'Norte geográfico (localización y ubicación)', 'NC-RA8-001 6.2.3.2, 6.2.3.3 a', unicos.length && !faltan.length ? 'ok' : 'falla',
        (unicos.length ? `${unicos.length} norte(s).` : 'No se encontró el norte.') + (faltan.length ? ' Falta en: ' + faltan.map((t) => t.texto.slice(0, 50)).join('; ') + '.' : ''),
        [...unicos.map((p) => ({ x: p[0], y: p[1], que: 'norte' })), ...faltan.map((t) => ({ ...en(t), que: 'falta el norte aquí' }))].filter((d, i) => !faltan.length || d.que !== 'norte'));
    }
    // -------------------------------------------------------------- 6. convenciones · 7. notas
    const tituloDe = (re) => buscar(re).sort((a, b) => b.h - a.h)[0];
    const tConv = tituloDe(/^(ESPACIO\s*\d+\s*-\s*)?CONVENCIONES/);
    const rConv = tConv ? espacio(tConv.pt, 40, 25) : null;
    if (!tConv) add('convenciones', 'Convenciones (Anexo A)', 'NC-RA8-001 6.2.3.6', 'falla', 'No se encontró el cuadro de CONVENCIONES.');
    else {
      const sim = rConv ? top.filter((x) => x.tipo === 'INSERT' && x.bb && dentro([(x.bb[0] + x.bb[2]) / 2, (x.bb[1] + x.bb[3]) / 2], rConv)).length : 0;
      const tx = rConv ? textos.filter((t) => t !== tConv && dentro(t.pt, rConv) && t.nivel === 0).length : 0;
      add('convenciones', 'Convenciones (Anexo A)', 'NC-RA8-001 6.2.3.6', tx >= 3 ? 'ok' : 'falla', `${tx} renglón(es) de texto y ${sim} símbolo(s) en el cuadro de convenciones. Confirme que cada símbolo usado en el plano sea el del Anexo A.`, [en(tConv)]);
    }
    const tNot = tituloDe(/^(ESPACIO\s*\d+\s*-\s*)?NOTAS\b/);
    const rNot = tNot ? espacio(tNot.pt, 40, 25) : null;
    if (!tNot) add('notas', 'Notas (Anexo B y carta del punto de conexión)', 'NC-RA8-001 6.2.3.8', 'falla', 'No se encontró el cuadro de NOTAS.');
    else {
      const dentroN = rNot ? textos.filter((t) => dentro(t.pt, rNot)) : [];
      const num = dentroN.filter((t) => /^\s*\d{1,2}\s*[.)-]\s*\S/.test(t.texto));
      const q = dentroN.filter((t) => sinLlenar(t.texto));
      add('notas', 'Notas (Anexo B y carta del punto de conexión)', 'NC-RA8-001 6.2.3.8, Anexo B', num.length && !q.length ? 'ok' : 'falla',
        `${num.length} nota(s) numerada(s)${q.length ? `; ${q.length} renglón(es) con «(?)» sin llenar` : ''}. Revise contra el Anexo B y la carta del PDC (texto literal, sin agregar ni reescribir).`, q.length ? q.map(en) : [en(tNot)]);
    }
    // -------------------------------------------------------------- 8. cuadro de cargas (6.2.3.7 + Praga)
    {
      const tCua = tituloDe(/CUADRO DE CARGA/);
      if (!tCua) add('cuadro', 'Cuadro de cargas (6.2.3.7 + distancia, patrón Praga)', 'NC-RA8-001 6.2.3.7, Fig. 27 y 29', 'falla', 'No se encontró el CUADRO DE CARGAS.');
      else {
        let r = espacio(tCua.pt, 80, 30);
        const enR = r ? textos.filter((t) => dentro(t.pt, r)) : textos.filter((t) => t.pt[0] >= tCua.pt[0] - 10 && t.pt[0] <= tCua.pt[0] + 400 && t.pt[1] <= tCua.pt[1] + 5 && t.pt[1] >= tCua.pt[1] - 150);
        const frases = enR.map((t) => N(t.texto));
        for (const t of enR) { // encabezados partidos en dos renglones («TRANSFORMADOR» / «No», «% DE» / «REGULACION»)
          const abajo = enR.filter((x) => x !== t && (Math.abs(x.pt[0] - t.pt[0]) < 4 || Math.abs(x.cx - t.cx) < 4) && t.pt[1] - x.pt[1] > 0.5 && t.pt[1] - x.pt[1] < 7).sort((a, b) => b.pt[1] - a.pt[1])[0];
          if (abajo) frases.push(N(t.texto + ' ' + abajo.texto));
        }
        const COL = [
          ['Nº del transformador', /(TRANS\w*|TRAFO)\.?\s*(N[°ºO]\.?|NO\b|#|NUM)|(N[°ºO]|#|NUM\w*)\.?\s*(DE\s*)?(TRANS|TRAFO)|TRANS\.?\s*N/],
          ['kVA del transformador', /^KVA$|KVA\s*(DEL\s*)?(TRANS|TRAFO|NOMINAL)|(TRANS\w*|TRAFO)\s*KVA/],
          ['Nº de instalaciones', /(N[°ºO]\.?|NO\.?|#|NUM\w*|CANT\w*)\s*(DE\s*)?INST/],
          ['kVA por instalación', /KVA\s*(\/|POR)?\s*INST|DEMANDA\s*(POR|\/)\s*INST/],
          ['kVA total', /KVA\s*TOTAL|TOTAL\s*KVA|KVA\s*DIVERSIFICAD/],
          ['% de carga', /%\s*(DE\s*)?CARGA|CARGABILIDAD/],
          ['% de regulación', /%\s*(DE\s*)?REG|REGULACI/],
          ['tipo de carga / estrato', /ESTRATO|RESIDENCIAL|COMERCIAL|INDUSTRIAL|TIPO DE CARGA/],
          ['fila de totales', /^TOTAL(ES)?\b/],
          ['distancia del alimentador (m) — Praga', /DISTANCIA|\bDIST\b|LONGITUD|LONG\.|\bL\s*\(M\)/],
        ];
        const lineas = [], falt = [];
        for (const [nom, re] of COL) { const ok = frases.some((s) => re.test(s)); lineas.push(`${ok ? '✅' : '❌'} ${nom}`); if (!ok) falt.push(nom); }
        const q = enR.filter((t) => sinLlenar(t.texto));
        if (q.length) lineas.push(`❌ ${q.length} celda(s) con «(?)» sin llenar`);
        add('cuadro', 'Cuadro de cargas (6.2.3.7 + distancia, patrón Praga)', 'NC-RA8-001 6.2.3.7, Fig. 27 y 29; nota 25 (Praga)', falt.length || q.length ? 'falla' : 'ok', lineas.join('\n'), [...(falt.length ? [{ ...en(tCua), que: 'faltan: ' + falt.join(', ') }] : []), ...q.map(en)]);
      }
    }
    // -------------------------------------------------------------- 9. textos ≥ 2,5 mm en notas y convenciones
    {
      const zonas = [rNot, rConv].filter(Boolean);
      if (!zonas.length) add('alturas', 'Textos de notas y convenciones ≥ 2,5 mm', 'NC-RA8-001 6.3.1 c', 'aviso', 'Sin cuadro de notas ni de convenciones para medir.');
      else {
        const medibles = textos.filter((t) => (t.nivel === 0 || t.tipo === 'ATTRIB') && zonas.some((z) => dentro(t.pt, z))); // las letras dibujadas dentro de un símbolo son parte del símbolo
        const bajos = medibles.filter((t) => t.h > 0 && t.h < 2.495);
        const hmin = Math.min(...medibles.map((t) => t.h));
        add('alturas', 'Textos de notas y convenciones ≥ 2,5 mm', 'NC-RA8-001 6.3.1 c', bajos.length ? 'falla' : 'ok', bajos.length ? `${bajos.length} texto(s) de menos de 2,5 mm (el más bajo: ${r1(hmin * 100) / 100} mm).` : `Todos ≥ 2,5 mm (mínimo ${Number.isFinite(hmin) ? Math.round(hmin * 100) / 100 : '—'} mm).`, bajos.map((t) => ({ ...en(t), que: `${Math.round(t.h * 100) / 100} mm: ${t.texto.slice(0, 50)}` })));
      }
    }
    // -------------------------------------------------------------- 10. textos montados (verificador)
    try {
      const v = await V.verificar(texto, { presentacion: nombre === 'Modelo' ? 'Model' : nombre, nombre: o.nombre || 'plano', sinBordeEnModelo: true, fuente: o.fuente });
      add('montajes', '0 textos montados (VERIFICAR)', 'NC-RA8-001 6.3.1 c (legibilidad); observaciones EPM', v.colisiones.length ? 'falla' : 'ok', v.colisiones.length ? `${v.colisiones.length} choque(s): ` + [...new Set(v.colisiones.map((c) => c[0]))].join(', ') + '.' : `Sin choques (${v.textos} textos revisados).`,
        v.colisiones.map((c) => ({ x: c[3], y: c[4], que: `${c[0]}: ${String(c[1]).slice(0, 40)}${c[2] ? ' ↔ ' + String(c[2]).slice(0, 30) : ''}` })));
    } catch (e) { add('montajes', '0 textos montados (VERIFICAR)', 'NC-RA8-001 6.3.1 c', 'aviso', 'No se pudo correr el verificador: ' + (e.message || e)); }
    // -------------------------------------------------------------- 11. capas · 12. peso del DWF
    {
      const usadas = new Set(); for (const [, L] of E) for (const e of L) if (e.type !== 'VIEWPORT') usadas.add(e.s(8, '0').toUpperCase());
      const n = usadas.size;
      add('capas', 'Una capa (o el mínimo)', 'Observaciones EPM (planos devueltos con 40 capas); skill diseño eléctrico', n <= 1 ? 'ok' : n <= 20 ? 'aviso' : 'falla',
        `${n} capa(s) con dibujo: ${[...usadas].slice(0, 25).join(', ')}${n > 25 ? '…' : ''}.${n > 1 ? ' EPM pidió el plano liviano: deje el mínimo de capas (LIMPIA purga las vacías).' : ''}`);
      let bytes = o.pesoDWF; let nota = '';
      if (bytes == null && o.medirDWF) { try { bytes = await o.medirDWF(nombre === 'Modelo' ? undefined : nombre); } catch (e) { nota = ' (' + (e.message || e) + ')'; } }
      if (bytes == null) add('peso', 'Peso del DWF < 1 MB', 'NC-RA8-001 6.3.1 g; devoluciones de Praga 3R (2,5–3,2 MB)', 'aviso', 'No se midió el DWF' + nota + '.');
      else { const mb = bytes / 1048576; add('peso', 'Peso del DWF < 1 MB', 'NC-RA8-001 6.3.1 g; devoluciones de Praga 3R (2,5–3,2 MB)', mb < 0.6 ? 'ok' : mb < 1 ? 'aviso' : 'falla', `El DWF de esta plancha pesa ${(bytes / 1024).toFixed(1)} KB${mb >= 0.6 && mb < 1 ? ' (meta del equipo: ≤ 0,6 MB)' : ''}.`); }
    }
    // -------------------------------------------------------------- 13. imágenes raster (solo la firma)
    {
      const modelo = aplanar(E.get('Modelo') || [], D).filter((x) => x.tipo === 'IMAGE' || x.tipo === 'OLE2FRAME');
      const otras = [...imgs.filter((x) => !firmas.includes(x)), ...(nombre === 'Modelo' ? [] : modelo)];
      add('raster', 'Sin imágenes raster (salvo la firma)', 'NC-RA8-001 6.2.3.2 a (no capturas de mapas web); observaciones EPM', otras.length ? 'falla' : 'ok', otras.length ? `${otras.length} imagen(es) que no son la firma del rótulo: quítelas (dibuje las vías y paramentos).` : (firmas.length ? 'Solo la firma.' : 'Ninguna imagen.'),
        otras.filter((x) => x.bb).map((x) => ({ x: x.bb[0], y: x.bb[1], que: x.tipo })));
    }

    const resumen = { ok: items.filter((i) => i.estado === 'ok').length, falla: items.filter((i) => i.estado === 'falla').length, aviso: items.filter((i) => i.estado === 'aviso').length };
    const r = { archivo: o.nombre || '', plancha: nombre, hoja, fecha: o.fecha || hoy(), resumen, items, cumple: resumen.falla === 0 };
    r.informe = informe(r);
    return r;
  }
  function decode(u8) { try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { return new TextDecoder('windows-1252').decode(u8); } }
  function hoy() { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`; }

  // ================================================================ informes (texto, Markdown y PDF por DXF)
  const IC = { ok: '✅', falla: '❌', aviso: '⚠️' };
  function informe(r) {
    const L = [`CHECKEPM  ${r.archivo ? r.archivo + ' · ' : ''}plancha «${r.plancha}» · ${r.resumen.ok} ✅ · ${r.resumen.falla} ❌ · ${r.resumen.aviso} ⚠️  → ${r.cumple ? 'cumple lo que se puede revisar en el plano' : 'NO cumple la NC-RA8-001'}`];
    r.items.forEach((it, i) => {
      L.push(`${i + 1}. ${IC[it.estado]} ${it.titulo} (${it.norma})`);
      for (const l of String(it.detalle).split('\n')) L.push('     ' + l);
      if (it.estado !== 'ok') for (const d of it.donde.slice(0, 12)) L.push(`     dónde: (${d.x}, ${d.y}) ${d.que}`);
    });
    L.push('No revisa (lo hace el revisor con la lista de EPM): datos contra licencia, punto A y carta del PDC, unifilar (6.2.3.4), vistas (6.2.3.5) ni memorias.');
    return L.join('\n');
  }
  function md(r) {
    const L = [`# Lista de chequeo NC-RA8-001 — ${r.archivo || 'plano'}`, '', `- **Plancha:** ${r.plancha}${r.hoja[0] ? ` (${r.hoja[0]} × ${r.hoja[1]} mm)` : ''}`, `- **Fecha de la revisión:** ${r.fecha}`, `- **Resultado:** ${r.resumen.ok} ✅ · ${r.resumen.falla} ❌ · ${r.resumen.aviso} ⚠️ → ${r.cumple ? '**cumple** lo que se puede revisar en el plano' : '**NO cumple** la NC-RA8-001'}`, '', '| # | Punto | Norma | Estado | Detalle | Dónde (x, y en mm de la plancha) |', '|---|---|---|---|---|---|'];
    r.items.forEach((it, i) => L.push(`| ${i + 1} | ${it.titulo} | ${it.norma} | ${IC[it.estado]} | ${String(it.detalle).replace(/\|/g, '/').replace(/\n/g, '<br>')} | ${it.estado === 'ok' ? '' : it.donde.slice(0, 8).map((d) => `(${d.x}, ${d.y}) ${String(d.que).replace(/\|/g, '/')}`).join('<br>')} |`));
    L.push('', '> Hecho por CHECKEPM (Domoplano). No revisa datos contra la licencia, el punto A y la carta del PDC, el unifilar (6.2.3.4), las vistas (6.2.3.5) ni las memorias: eso sigue en la lista de EPM y en la revisión del equipo.');
    return L.join('\n') + '\n';
  }
  /** DXF de una hoja (210 mm de ancho) con el informe, para pasarlo a PDF con el escritor de Domoplano. */
  function dxfInforme(r) {
    const G = (typeof DXFGen !== 'undefined') ? DXFGen : require('./dxf_generador.js');
    const TXT = { ok: 'CUMPLE', falla: 'NO CUMPLE', aviso: 'REVISAR' }; const COLOR = { ok: 3, falla: 1, aviso: 30 };
    const lineas = [];
    const partir = (s, n) => { const out = []; for (const par of String(s).split('\n')) { let x = par; while (x.length > n) { let k = x.lastIndexOf(' ', n); if (k < n * 0.5) k = n; out.push(x.slice(0, k)); x = x.slice(k).trimStart(); } out.push(x); } return out; };
    const limpio = (s) => String(s).replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/✅/g, '[OK]').replace(/❌/g, '[X]').replace(/⚠️/g, '[!]').replace(/[^\u0000-ɏ°±Ø·«»–—→↔…]/g, '');
    lineas.push({ t: 'LISTA DE CHEQUEO NC-RA8-001 (CHECKEPM - Domoplano)', h: 4, c: 7 });
    lineas.push({ t: limpio(`${r.archivo || 'plano'} - plancha ${r.plancha} - ${r.fecha}`), h: 2.5, c: 7 });
    lineas.push({ t: limpio(`${r.resumen.ok} cumplen - ${r.resumen.falla} no cumplen - ${r.resumen.aviso} por revisar -> ${r.cumple ? 'cumple lo que se puede revisar en el plano' : 'NO CUMPLE la NC-RA8-001'}`), h: 2.8, c: r.cumple ? 3 : 1 });
    lineas.push({ t: '', h: 2.5 });
    r.items.forEach((it, i) => {
      lineas.push({ t: limpio(`${i + 1}. [${TXT[it.estado]}] ${it.titulo}`), h: 2.8, c: COLOR[it.estado] });
      lineas.push({ t: limpio(`   ${it.norma}`), h: 2.2, c: 8 });
      for (const l of partir(limpio(it.detalle), 98)) lineas.push({ t: '   ' + l, h: 2.5, c: 7 });
      if (it.estado !== 'ok') for (const d of it.donde.slice(0, 10)) for (const l of partir(limpio(`   donde: (${d.x}, ${d.y}) ${d.que}`), 98)) lineas.push({ t: l, h: 2.2, c: 8 });
      lineas.push({ t: '', h: 1.5 });
    });
    for (const l of partir('No revisa: datos contra la licencia, punto A y carta del PDC, unifilar (6.2.3.4), vistas (6.2.3.5) ni memorias.', 110)) lineas.push({ t: l, h: 2.2, c: 8 });
    const alto = Math.max(297, Math.ceil(20 + lineas.reduce((s, l) => s + l.h * 1.6, 0)));
    const Dib = new G.Dibujo({ papel: [210, alto], plancha: 'INFORME CHECKEPM', nombrePapel: `210 x ${alto} mm`, unidades: 4 });
    Dib.capa('INFORME', { color: 7, grosor: 18 }); for (const c of [1, 3, 8, 30]) Dib.capa('INFORME-' + c, { color: c, grosor: 18 });
    let y = alto - 14;
    for (const l of lineas) { if (l.t) Dib.plancha.texto([12, y], l.h, l.t, { capa: l.c && l.c !== 7 ? 'INFORME-' + l.c : 'INFORME' }); y -= l.h * 1.6; }
    return Dib.toString();
  }

  return { revisar, informe, md, dxfInforme, aplanar };
})();
if (typeof module !== 'undefined') module.exports = ChecklistEPM; else self.ChecklistEPM = ChecklistEPM;
