// Escena común: nodos que dibuja el visor (coordenadas de página, y hacia abajo).
//   grupo  {k:'g', m:[a,b,c,d,e,f]|null, clip:{p:Path2D, rule}|null, op, ch:[], bb}
//   trazo  {k:'p', p:Path2D, fill, rule, stroke, lw, cap, join, miter, dash, bb}
//   texto  {k:'t', str, x, y, size, family, weight, style, fill, adv:[]|null, sx, bb}
//   imagen {k:'i', img, x, y, w, h, bb}
// bb siempre en coordenadas absolutas de la página: [x0, y0, x1, y1].
const Scene = (() => {
  const EMPTY = () => [Infinity, Infinity, -Infinity, -Infinity];

  function mul(m1, m2) { // m1 aplicado después de m2 (m = m1 · m2)
    if (!m1) return m2; if (!m2) return m1;
    return [
      m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
    ];
  }

  function bbXform(bb, m) {
    if (!m || !isFinite(bb[0])) return bb;
    const xs = [], ys = [];
    for (const [x, y] of [[bb[0], bb[1]], [bb[2], bb[1]], [bb[0], bb[3]], [bb[2], bb[3]]]) {
      xs.push(m[0] * x + m[2] * y + m[4]); ys.push(m[1] * x + m[3] * y + m[5]);
    }
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }

  function bbUnion(a, b) {
    if (b[0] < a[0]) a[0] = b[0]; if (b[1] < a[1]) a[1] = b[1];
    if (b[2] > a[2]) a[2] = b[2]; if (b[3] > a[3]) a[3] = b[3];
    return a;
  }

  // Convierte un arco estilo SVG (endpoint) en ctx.ellipse (centro).
  function arcTo(path, x1, y1, rx, ry, phiDeg, large, sweep, x2, y2) {
    if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) { path.lineTo(x2, y2); return; }
    rx = Math.abs(rx); ry = Math.abs(ry);
    const phi = phiDeg * Math.PI / 180, cos = Math.cos(phi), sin = Math.sin(phi);
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
    let lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
    const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    let co = Math.sqrt(Math.max(0, num / den));
    if (large === sweep) co = -co;
    const cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
    const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
    const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
    path.ellipse(cx, cy, rx, ry, phi, t1, t1 + dt, !sweep);
    return [cx, cy, Math.max(rx, ry)];
  }

  // Interpreta datos de trazado XPS/SVG → {path, bb (local), evenodd}
  const TOK = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[A-Za-z]/g;
  function parsePathData(d) {
    const path = new Path2D();
    const bb = EMPTY();
    let evenodd = true; // F0 (por defecto en XPS) = EvenOdd
    const t = d.match(TOK) || [];
    let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, cx = 0, cy = 0, pc = '';
    const ext = (px, py) => {
      if (px < bb[0]) bb[0] = px; if (px > bb[2]) bb[2] = px;
      if (py < bb[1]) bb[1] = py; if (py > bb[3]) bb[3] = py;
    };
    const isNum = () => i < t.length && !/^[A-Za-z]$/.test(t[i]);
    const n = () => parseFloat(t[i++]);
    while (i < t.length) {
      if (!isNum()) { cmd = t[i++]; }
      else if (!cmd) { i++; continue; }
      const rel = cmd >= 'a' && cmd <= 'z';
      const C = cmd.toUpperCase();
      switch (C) {
        case 'F': evenodd = n() === 0; cmd = ''; break;
        case 'M': {
          x = (rel ? x : 0) + n(); y = (rel ? y : 0) + n();
          path.moveTo(x, y); ext(x, y); sx = x; sy = y;
          cmd = rel ? 'l' : 'L'; break;
        }
        case 'L': x = (rel ? x : 0) + n(); y = (rel ? y : 0) + n(); path.lineTo(x, y); ext(x, y); break;
        case 'H': x = (rel ? x : 0) + n(); path.lineTo(x, y); ext(x, y); break;
        case 'V': y = (rel ? y : 0) + n(); path.lineTo(x, y); ext(x, y); break;
        case 'C': {
          const ox = rel ? x : 0, oy = rel ? y : 0;
          const a = ox + n(), b = oy + n(); cx = ox + n(); cy = oy + n(); x = ox + n(); y = oy + n();
          path.bezierCurveTo(a, b, cx, cy, x, y); ext(a, b); ext(cx, cy); ext(x, y); break;
        }
        case 'S': {
          const ox = rel ? x : 0, oy = rel ? y : 0;
          const a = /[CS]/.test(pc) ? 2 * x - cx : x, b = /[CS]/.test(pc) ? 2 * y - cy : y;
          cx = ox + n(); cy = oy + n(); x = ox + n(); y = oy + n();
          path.bezierCurveTo(a, b, cx, cy, x, y); ext(a, b); ext(cx, cy); ext(x, y); break;
        }
        case 'Q': {
          const ox = rel ? x : 0, oy = rel ? y : 0;
          cx = ox + n(); cy = oy + n(); x = ox + n(); y = oy + n();
          path.quadraticCurveTo(cx, cy, x, y); ext(cx, cy); ext(x, y); break;
        }
        case 'T': {
          const ox = rel ? x : 0, oy = rel ? y : 0;
          if (/[QT]/.test(pc)) { cx = 2 * x - cx; cy = 2 * y - cy; } else { cx = x; cy = y; }
          x = ox + n(); y = oy + n();
          path.quadraticCurveTo(cx, cy, x, y); ext(cx, cy); ext(x, y); break;
        }
        case 'A': {
          const ox = rel ? x : 0, oy = rel ? y : 0;
          const rx = n(), ry = n(), rot = n(), la = n(), sw = n();
          const nx = ox + n(), ny = oy + n();
          const r = arcTo(path, x, y, rx, ry, rot, la ? 1 : 0, sw ? 1 : 0, nx, ny);
          if (r) { ext(r[0] - r[2], r[1] - r[2]); ext(r[0] + r[2], r[1] + r[2]); }
          x = nx; y = ny; ext(x, y); break;
        }
        case 'Z': path.closePath(); x = sx; y = sy; cmd = ''; break;
        default: cmd = ''; i++; // comando desconocido: saltar
      }
      pc = C;
    }
    return { path, bb, evenodd };
  }

  // ---------- Dibujo ----------
  // Estado al recorrer el árbol: view = rectángulo visible en coordenadas del nivel actual, px = px de pantalla por
  // unidad del nivel actual (en grupos "locales") , ls = escala acumulada (grupos no locales), mm = mm de papel por
  // unidad local (null en el espacio modelo → grosores de línea finos).
  // Grupos con `local: true` tienen sus hijos con bb en SUS coordenadas (bloques reutilizados, ventanas de plancha);
  // los demás (escenas de DWF/DWFx) tienen bb absolutas de página, como antes.
  function render(ctx, root, view, pxScale, o = {}) {
    drawNode(ctx, root, { view, px: pxScale, ls: 1, bp: pxScale, mm: o.mmPerUnit ?? null });
  }

  function visible(bb, v) {
    return !(bb[2] < v[0] || bb[0] > v[2] || bb[3] < v[1] || bb[1] > v[3]);
  }

  function inv(m) {
    const d = m[0] * m[3] - m[1] * m[2] || 1e-30;
    return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
  }

  const hidden = new Set(); // capas ocultas
  const SEL = '#1e88ff';    // color de lo seleccionado
  // hideMarkups: marcas de revisión (Design Review) ocultas.
  // lwDisplay (como LWDISPLAY de AutoCAD): true = grosores de línea reales (en planchas, a escala del papel; en el modelo,
  // en píxeles de pantalla: 1 mm ≈ 3,78 px); false = todo con línea fina. Sin definir = true (pruebas y exportadores).
  // paper: color del papel con que se pintan las tapas de fondo (WIPEOUT, nodos con bg: true).
  const opts = { hideMarkups: false, lwDisplay: undefined, paper: '#ffffff' };
  const PX_POR_MM = 96 / 25.4;
  function drawNode(ctx, n, st) {
    if (n.markup && opts.hideMarkups) return;
    if (n.layer != null && (hidden.has(n.layer) || (st.hl && st.hl.has(n.layer)))) return; // capa oculta, o inutilizada en esta ventana (VPLAYER)
    if (n.bb && !visible(n.bb, st.view)) return;
    const unitPx = st.px * st.ls;
    // bp = px de pantalla por unidad de las cajas bb (en grupos no locales las bb son absolutas de página)
    const bbPx = st.bp ?? unitPx;
    if (n.bb && (n.bb[2] - n.bb[0]) * bbPx < 0.25 && (n.bb[3] - n.bb[1]) * bbPx < 0.25) return;
    if (n.sel && !st.sel) st = { ...st, sel: true }; // seleccionado en el editor: se pinta resaltado
    switch (n.k) {
      case 'g': {
        ctx.save();
        let st2 = st;
        if (n.m) {
          ctx.transform(n.m[0], n.m[1], n.m[2], n.m[3], n.m[4], n.m[5]);
          const sc = Math.sqrt(Math.abs(n.m[0] * n.m[3] - n.m[1] * n.m[2]));
          st2 = n.local
            ? { view: bbXform(st.view, inv(n.m)), px: unitPx * sc, ls: 1, bp: unitPx * sc, mm: st.mm != null ? st.mm * sc : null, sel: st.sel, hl: st.hl }
            : { view: st.view, px: st.px, ls: st.ls * sc, bp: st.bp, mm: st.mm != null ? st.mm * sc : null, sel: st.sel, hl: st.hl };
        }
        if (n.mm !== undefined) st2 = { ...st2, mm: n.mm };
        if (st2 === st && n.hideLayers) st2 = { ...st };
        if (n.hideLayers) st2.hl = st.hl ? new Set([...st.hl, ...n.hideLayers]) : n.hideLayers;
        else if (st.hl && !st2.hl) st2.hl = st.hl;
        if (n.op != null && n.op < 1) ctx.globalAlpha *= n.op;
        if (n.clip) ctx.clip(n.clip.p, n.clip.rule || 'nonzero');
        for (const c of n.ch) drawNode(ctx, c, st2);
        ctx.restore();
        break;
      }
      case 'p': {
        // bg: tapa de fondo (WIPEOUT) — siempre del color del papel, salvo resaltada al seleccionar
        if (n.fill) { ctx.fillStyle = st.sel ? SEL : n.bg ? (opts.paper || '#ffffff') : paint(ctx, n.fill); ctx.fill(n.p, n.rule || 'nonzero'); }
        if (n.stroke) {
          let lw = n.lw || 0;
          if (n.lwmm != null) { // grosor en mm de papel
            if (opts.lwDisplay === false) lw = 0;
            else lw = st.mm != null ? n.lwmm / st.mm : (opts.lwDisplay ? n.lwmm * PX_POR_MM / unitPx : 0);
          }
          ctx.lineWidth = Math.max(lw, (st.sel ? 2 : 0.7) / unitPx);
          ctx.strokeStyle = st.sel ? SEL : paint(ctx, n.stroke);
          ctx.lineCap = n.cap || 'round';
          ctx.lineJoin = n.join || 'round';
          ctx.miterLimit = n.miter || 10;
          if (n.dash) ctx.setLineDash(n.dash);
          ctx.stroke(n.p);
          if (n.dash) ctx.setLineDash([]);
        }
        break;
      }
      case 'h': { // sombreado con patrón: líneas recortadas por el contorno
        ctx.save();
        ctx.clip(n.p, n.rule || 'evenodd');
        ctx.strokeStyle = st.sel ? SEL : paint(ctx, n.color || '#000');
        ctx.lineWidth = 0.7 / unitPx;
        ctx.lineCap = 'butt';
        ctx.stroke(n.lines);
        ctx.restore();
        break;
      }
      case 't': {
        ctx.save();
        if (n.m) ctx.transform(n.m[0], n.m[1], n.m[2], n.m[3], n.m[4], n.m[5]);
        ctx.fillStyle = st.sel ? SEL : paint(ctx, n.fill || '#000');
        ctx.font = `${n.style || 'normal'} ${n.weight || 'normal'} ${n.size}px ${n.family}`;
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = n.align || 'left';
        if (n.sx && n.sx !== 1) { ctx.translate(n.x, n.y); ctx.scale(n.sx, 1); ctx.translate(-n.x, -n.y); }
        if (n.adv) {
          let x = n.x; let k = 0;
          for (const ch of n.str) { ctx.fillText(ch, x, n.y); x += n.adv[k++] ?? ctx.measureText(ch).width; }
        } else ctx.fillText(n.str, n.x, n.y);
        ctx.restore();
        break;
      }
      case 'i': {
        if (n.img) {
          ctx.save();
          if (n.m) ctx.transform(n.m[0], n.m[1], n.m[2], n.m[3], n.m[4], n.m[5]);
          ctx.drawImage(n.img, n.x, n.y, n.w, n.h);
          ctx.restore();
        }
        break;
      }
    }
  }

  function paint(ctx, f) {
    if (typeof f === 'string') return f;
    if (f.pattern) {
      if (!f._pat) {
        f._pat = ctx.createPattern(f.pattern, 'repeat');
        if (f._pat && f.m) f._pat.setTransform(new DOMMatrix(f.m));
      }
      return f._pat || 'rgba(0,0,0,0.3)';
    }
    return '#000';
  }

  return { EMPTY, mul, inv, bbXform, bbUnion, parsePathData, render, hidden, opts };
})();
if (typeof module !== 'undefined') module.exports = Scene; else self.Scene = Scene;
