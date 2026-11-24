// Draws Original's and Switchback's scenery (scenery.js) in Dockyard's manner: flat shapes, a thin
// dark outline, a modest shadow to the bottom right and quiet detail lines. Browser-only (Path2D).
//
// Everything is static, so it is worked out once per circuit into a painter: shapes are grouped by
// layer, then by style, then by 64 m cell, and each frame fills or strokes one path per style for
// each cell the camera can see. Nothing here depends on play time or feeds the simulation.
//
// Layers, bottom to top:
//   contour, ground, shoulder: the ground and everything flat on it
//   wall: the perimeter, restyled (its collision is unchanged in game.js)
//   shadow, body, detail: raised props
//   ...the road, skid marks, the cars and smoke are drawn here by render.js...
//   canopy, canopyLight: tree tops, over the cars, as v0.5.0's trees were

const CELL = 64;
const SHADOW = 'rgba(14,40,20,0.30)';
const OUTLINE = '#2d3331';

const TREE_TONES = {
  grassroots: { dark: ['#1f6a35', '#246f39', '#2b6331'], light: ['#2d8644', '#36904a', '#3c7f3c'] },
  hillside: { dark: ['#22603a', '#2b693c', '#355f37'], light: ['#367a45', '#418249', '#4f7b40'] },
};
const PINE_TONES = { dark: ['#1b4a36', '#205339', '#18432f'], light: ['#2a6146', '#2f6a4a', '#285a40'] };

// --- The painter -----------------------------------------------------------------------------------

function createPainter() {
  const layers = new Map();
  const texts = new Map();
  const cellOf = (map, box) => {
    const k = `${Math.floor((box[0] + box[2]) / 2 / CELL)},${Math.floor((box[1] + box[3]) / 2 / CELL)}`;
    let c = map.get(k);
    if (!c) {
      c = { path: new Path2D(), minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, items: [] };
      map.set(k, c);
    }
    c.minX = Math.min(c.minX, box[0]);
    c.minY = Math.min(c.minY, box[1]);
    c.maxX = Math.max(c.maxX, box[2]);
    c.maxY = Math.max(c.maxY, box[3]);
    return c;
  };
  return {
    layers,
    texts,
    // One shape: `build` adds subpaths to the cell's path for this layer and style.
    add(layer, style, box, build) {
      if (!layers.has(layer)) layers.set(layer, new Map());
      const batches = layers.get(layer);
      const key = `${style.fill}|${style.stroke}|${style.width}|${style.dash}|${style.dashOffset}|${style.cap}|${style.join}|${style.alpha}|${style.rule}`;
      if (!batches.has(key)) batches.set(key, { style, cells: new Map() });
      build(cellOf(batches.get(key).cells, box).path);
    },
    text(layer, item, box) {
      if (!texts.has(layer)) texts.set(layer, new Map());
      cellOf(texts.get(layer), box).items.push(item);
    },
  };
}

function applyStyle(ctx, s) {
  ctx.globalAlpha = s.alpha ?? 1;
  if (s.fill) ctx.fillStyle = s.fill;
  if (s.stroke) {
    ctx.strokeStyle = s.stroke;
    ctx.lineWidth = s.width ?? 0.2;
    ctx.lineCap = s.cap ?? 'butt';
    ctx.lineJoin = s.join ?? 'miter';
    ctx.setLineDash(s.dash ?? []);
    ctx.lineDashOffset = s.dashOffset ?? 0;
  }
}

const sees = (c, v) => !(c.maxX < v.minX || c.minX > v.maxX || c.maxY < v.minY || c.minY > v.maxY);

function paintLayer(ctx, painter, layer, view) {
  const batches = painter.layers.get(layer);
  if (batches) {
    for (const { style, cells } of batches.values()) {
      let styled = false;
      for (const c of cells.values()) {
        if (!sees(c, view)) continue;
        if (!styled) { applyStyle(ctx, style); styled = true; }
        if (style.fill) ctx.fill(c.path, style.rule ?? 'nonzero');
        else ctx.stroke(c.path);
      }
    }
  }
  const texts = painter.texts.get(layer);
  if (texts) {
    for (const c of texts.values()) {
      if (!sees(c, view)) continue;
      for (const t of c.items) {
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.translate(t.x, t.y);
        if (t.angle) ctx.rotate(t.angle);
        ctx.fillStyle = t.color;
        ctx.font = `bold ${t.size}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(t.text, 0, 0);
        ctx.restore();
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
}

// --- Shape helpers ----------------------------------------------------------------------------------

const boxOf = (p, pad = 0) => [p.x - p.w / 2 - pad, p.y - p.h / 2 - pad, p.x + p.w / 2 + pad, p.y + p.h / 2 + pad];
const roundBox = (p, pad = 0) => [p.x - p.r - pad, p.y - p.r - pad, p.x + p.r + pad, p.y + p.r + pad];
function pointsBox(points, pad = 0) {
  const xs = points.map((q) => q[0]);
  const ys = points.map((q) => q[1]);
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
}
const rectPath = (x, y, w, h) => (path) => path.rect(x, y, w, h);
const circlePath = (x, y, r) => (path) => { path.moveTo(x + r, y); path.arc(x, y, r, 0, Math.PI * 2); };
function polyPath(points, dx = 0, dy = 0) {
  return (path) => {
    points.forEach(([x, y], i) => (i ? path.lineTo(x + dx, y + dy) : path.moveTo(x + dx, y + dy)));
    path.closePath();
  };
}
function linePath(points, dx = 0, dy = 0) {
  return (path) => points.forEach(([x, y], i) => (i ? path.lineTo(x + dx, y + dy) : path.moveTo(x + dx, y + dy)));
}

// Same small generator as the layout, for per-prop shape detail (rock outlines).
function jitter(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// --- Props ------------------------------------------------------------------------------------------

// A raised box: shadow, outline, body. Returns the top-left corner for details.
function block(paint, p, body, shadow = [1.2, 1.4]) {
  const x = p.x - p.w / 2;
  const y = p.y - p.h / 2;
  paint.add('shadow', { fill: SHADOW }, boxOf(p, 2), rectPath(x + shadow[0], y + shadow[1], p.w, p.h));
  paint.add('body', { fill: OUTLINE }, boxOf(p, 0.3), rectPath(x - 0.3, y - 0.3, p.w + 0.6, p.h + 0.6));
  paint.add('body', { fill: body }, boxOf(p), rectPath(x, y, p.w, p.h));
  return [x, y];
}

function label(paint, p, text, size, color, angle = 0) {
  paint.text('detail', { x: p.x, y: p.y, text, size, color, angle }, boxOf(p));
}

function vehicle(paint, p) {
  const x = p.x - p.w / 2;
  const y = p.y - p.h / 2;
  const long = p.h > p.w;
  const r = Math.min(p.w, p.h) * 0.25;
  paint.add('shadow', { fill: SHADOW }, boxOf(p, 2), (path) => path.roundRect(x + 0.5, y + 0.6, p.w, p.h, r));
  paint.add('body', { fill: OUTLINE }, boxOf(p, 0.2), (path) => path.roundRect(x - 0.18, y - 0.18, p.w + 0.36, p.h + 0.36, r + 0.1));
  paint.add('body', { fill: p.color }, boxOf(p), (path) => path.roundRect(x, y, p.w, p.h, r));
  // Glass toward the front (north for a lengthwise vehicle, west for a crosswise one).
  const glass = { fill: '#22303c' };
  if (p.kind === 'trailer') {
    paint.add('detail', { stroke: '#ffffff26', width: 0.18 }, boxOf(p), (path) => {
      for (let k = y + 1.2; k < y + p.h - 0.6; k += 1.4) { path.moveTo(x + 0.35, k); path.lineTo(x + p.w - 0.35, k); }
    });
  } else if (long) {
    paint.add('detail', glass, boxOf(p), rectPath(x + 0.3, y + p.h * 0.16, p.w - 0.6, p.h * 0.14));
    if (p.kind === 'car') paint.add('detail', glass, boxOf(p), rectPath(x + 0.35, y + p.h * 0.66, p.w - 0.7, p.h * 0.1));
  } else {
    paint.add('detail', glass, boxOf(p), rectPath(x + p.w * 0.16, y + 0.3, p.w * 0.14, p.h - 0.6));
    if (p.kind === 'car') paint.add('detail', glass, boxOf(p), rectPath(x + p.w * 0.66, y + 0.35, p.w * 0.1, p.h - 0.7));
  }
  if (p.kind === 'truck') {
    paint.add('detail', { fill: '#f3efe2' }, boxOf(p), rectPath(x + 0.3, y + p.h * 0.5, p.w - 0.6, 0.45));
    paint.add('detail', { fill: '#d7d9d4' }, boxOf(p), rectPath(x + 0.5, y + p.h * 0.62, p.w - 1, p.h * 0.3));
  }
  if (p.kind === 'tractor') {
    paint.add('body', { fill: '#17181b' }, boxOf(p, 0.8), (path) => {
      path.rect(x - 0.7, y + p.h - 1.9, 0.8, 1.6); path.rect(x + p.w - 0.1, y + p.h - 1.9, 0.8, 1.6);
      path.rect(x - 0.4, y + 0.3, 0.5, 1); path.rect(x + p.w - 0.1, y + 0.3, 0.5, 1);
    });
    paint.add('detail', { fill: '#e8c33c' }, boxOf(p), rectPath(x + 0.5, y + p.h - 1.8, p.w - 1, 1.2));
  }
}

function structure(paint, p) {
  const roof = p.roof ?? { garage: '#7c8483', tower: '#5d6766', grandstand: '#b23a2a', shed: '#6f7a78', cabin: '#6e5138', building: '#8a6f55' }[p.kind];
  const body = p.kind === 'grandstand' ? '#bcb8ad' : roof;
  const [x, y] = block(paint, p, body);
  const fine = { stroke: '#ffffff22', width: 0.22 };
  if (p.kind === 'garage') {
    paint.add('detail', fine, boxOf(p), (path) => {
      for (let k = x + 3; k < x + p.w; k += 3) { path.moveTo(k, y + 0.6); path.lineTo(k, y + p.h - 3.4); }
    });
    // Sunlit fascia & roof skylights.
    paint.add('detail', { fill: '#9ca4a2' }, boxOf(p), rectPath(x, y, p.w, 1.1));
    paint.add('detail', { fill: '#8fb4c2', alpha: 0.7 }, boxOf(p), (path) => {
      for (let k = x + 4.5; k < x + p.w - 6; k += 9) path.rect(k, y + 3.2, 4.4, 2.2);
    });
    // Doors on the side facing the circuit (the bottom edge), with numbered pit apron stalls.
    const n = p.doors ?? 6;
    const span = p.w / n;
    paint.add('detail', { fill: '#33393a' }, boxOf(p), (path) => {
      for (let i = 0; i < n; i += 1) path.rect(x + i * span + 1, y + p.h - 2.9, span - 2, 2.9);
    });
    paint.add('detail', { fill: '#d9d3c1' }, boxOf(p), (path) => {
      for (let i = 0; i <= n; i += 1) path.rect(x + i * span - 0.5, y + p.h - 3.2, 1, 3.2);
    });
    paint.add('ground', { fill: 'rgba(92,96,98,0.45)' }, [x - 1, y + p.h, x + p.w + 1, y + p.h + 5.5], rectPath(x, y + p.h, p.w, 5));
    paint.add('ground', { stroke: 'rgba(244,241,230,0.5)', width: 0.22 }, [x - 1, y + p.h, x + p.w + 1, y + p.h + 5.5], (path) => {
      for (let i = 0; i <= n; i += 1) { path.moveTo(x + i * span, y + p.h + 0.4); path.lineTo(x + i * span, y + p.h + 4.6); }
      path.moveTo(x, y + p.h + 4.8); path.lineTo(x + p.w, y + p.h + 4.8);
    });
  } else if (p.kind === 'tower') {
    paint.add('detail', { fill: '#3f4a4b' }, boxOf(p), rectPath(x + 1.5, y + 1.5, p.w - 3, p.h - 6));
    // Rooftop timing dish & crisp glass reflection streaks on the viewing gallery.
    paint.add('detail', { fill: '#7f8c8d' }, boxOf(p), circlePath(x + p.w - 3.2, y + 3.4, 1.35));
    paint.add('detail', { fill: '#d8ddd8' }, boxOf(p), circlePath(x + p.w - 3.4, y + 3.2, 0.5));
    paint.add('detail', { fill: '#9cc3d3' }, boxOf(p), rectPath(x + 0.6, y + p.h - 3.6, p.w - 1.2, 2.2));
    paint.add('detail', { fill: 'rgba(255,255,255,0.34)' }, boxOf(p), (path) => {
      for (let k = x + 1.2; k < x + p.w - 2; k += 4) path.rect(k, y + p.h - 3.4, 1.1, 1.8);
    });
    paint.add('detail', { stroke: '#3f4a4b', width: 0.25 }, boxOf(p), (path) => {
      for (let k = x + 2; k < x + p.w - 1; k += 2) { path.moveTo(k, y + p.h - 3.6); path.lineTo(k, y + p.h - 1.4); }
    });
    label(paint, { ...p, y: y + p.h * 0.36 }, p.label, 1.5, '#f2efe4');
  } else if (p.kind === 'grandstand') {
    const east = p.facing === 'east';
    // A roof over the back half with sunlit eaves highlight, rows of seats stepping down toward the circuit.
    const roofBox = east ? [x, y, p.w * 0.42, p.h] : [x, y, p.w, p.h * 0.42];
    paint.add('detail', { fill: roof }, boxOf(p), rectPath(...roofBox));
    paint.add('detail', { fill: 'rgba(255,255,255,0.16)' }, boxOf(p), east ? rectPath(x, y, 0.9, p.h) : rectPath(x, y, p.w, 0.9));
    // Roof cast shadow onto the first row of terrace seats.
    paint.add('detail', { fill: 'rgba(0,0,0,0.22)' }, boxOf(p), east ? rectPath(x + p.w * 0.42, y, 1.1, p.h) : rectPath(x, y + p.h * 0.42, p.w, 1.1));
    paint.add('detail', { stroke: '#00000030', width: 0.25 }, boxOf(p), (path) => {
      if (east) for (let k = y + 2; k < y + p.h; k += 2) { path.moveTo(x, k); path.lineTo(x + p.w * 0.42, k); }
      else for (let k = x + 2; k < x + p.w; k += 2) { path.moveTo(k, y); path.lineTo(k, y + p.h * 0.42); }
    });
    const rows = p.rows ?? 6;
    paint.add('detail', { stroke: '#7d7a72', width: 0.32 }, boxOf(p), (path) => {
      for (let i = 0; i < rows; i += 1) {
        if (east) { const k = x + p.w * 0.46 + (i * p.w * 0.5) / rows; path.moveTo(k, y + 0.6); path.lineTo(k, y + p.h - 0.6); }
        else { const k = y + p.h * 0.46 + (i * p.h * 0.5) / rows; path.moveTo(x + 0.6, k); path.lineTo(x + p.w - 0.6, k); }
      }
    });
    // Front safety balustrade facing the circuit.
    paint.add('detail', { stroke: '#f0ece0', width: 0.35 }, boxOf(p), east
      ? linePath([[x + p.w - 0.25, y + 0.3], [x + p.w - 0.25, y + p.h - 0.3]])
      : linePath([[x + 0.3, y + p.h - 0.25], [x + p.w - 0.3, y + p.h - 0.25]]));
    // Spectators: a sprinkle of colour along the rows.
    const rand = jitter(Math.round(p.x * 31 + p.y * 17));
    const colors = ['#e9e2cf', '#c94b2e', '#2f5f97', '#f0c341', '#3b3b3f'];
    colors.forEach((c, ci) => paint.add('detail', { fill: c }, boxOf(p), (path) => {
      for (let i = 0; i < rows * 10; i += 1) {
        if (Math.floor(rand() * colors.length) !== ci) { rand(); rand(); continue; }
        const a = rand();
        const b = Math.floor(rand() * rows);
        const sx = east ? x + p.w * 0.48 + (b * p.w * 0.5) / rows : x + 1 + a * (p.w - 2);
        const sy = east ? y + 1 + a * (p.h - 2) : y + p.h * 0.48 + (b * p.h * 0.5) / rows;
        path.rect(sx - 0.32, sy - 0.32, 0.64, 0.64);
      }
    }));
  } else if (p.kind === 'building' || p.kind === 'cabin') {
    // A hipped roof: ridge and hips.
    const inset = Math.min(p.w, p.h) / 2;
    paint.add('detail', { stroke: '#00000038', width: 0.3 }, boxOf(p), (path) => {
      const long = p.w >= p.h;
      const a = long ? [x + inset, p.y] : [p.x, y + inset];
      const b = long ? [x + p.w - inset, p.y] : [p.x, y + p.h - inset];
      path.moveTo(...a); path.lineTo(...b);
      path.moveTo(x, y); path.lineTo(...a); path.moveTo(x, y + p.h); path.lineTo(...a);
      path.moveTo(x + p.w, y); path.lineTo(...b); path.moveTo(x + p.w, y + p.h); path.lineTo(...b);
    });
    if (p.kind === 'cabin') paint.add('detail', { fill: '#4a4542' }, boxOf(p), rectPath(x + p.w * 0.7, y + 1, 1.4, 1.4));
    if (p.label) label(paint, { ...p, y: p.y + p.h * 0.3 }, p.label, 1.3, '#f3eedf');
  } else if (p.kind === 'shed') {
    paint.add('detail', fine, boxOf(p), (path) => {
      for (let k = x + 1; k < x + p.w; k += 1.8) { path.moveTo(k, y + 0.6); path.lineTo(k, y + p.h - 0.6); }
    });
    if (p.label) label(paint, p, p.label, p.w < 18 ? 1.05 : 1.3, '#f0ecdf');
  }
}

function signs(paint, p) {
  const x = p.x - p.w / 2;
  const y = p.y - p.h / 2;
  if (p.kind === 'hoarding') {
    block(paint, p, p.color, [0.4, 0.5]);
    label(paint, p, p.label, Math.min(1.5, p.h * 0.62), p.ink);
  } else if (p.kind === 'marker') {
    paint.add('shadow', { fill: SHADOW }, boxOf(p, 1), rectPath(x + 0.5, y + 0.6, p.w, p.h));
    paint.add('body', { fill: '#c7372a' }, boxOf(p, 0.2), rectPath(x - 0.2, y - 0.2, p.w + 0.4, p.h + 0.4));
    paint.add('body', { fill: '#f4f1e6' }, boxOf(p), rectPath(x + 0.2, y + 0.2, p.w - 0.4, p.h - 0.4));
    label(paint, p, p.label, 2.2, '#1b1c1f');
  } else if (p.kind === 'marshal') {
    block(paint, p, '#e6e2d6', [0.6, 0.7]);
    paint.add('detail', { fill: '#e2622b' }, boxOf(p), rectPath(x, y, p.w, p.h * 0.45));
    paint.add('detail', { stroke: '#3a3d3c', width: 0.18 }, boxOf(p, 2), linePath([[x + p.w + 0.2, y - 1.3], [x + p.w + 0.2, y + 0.6]]));
  } else if (p.kind === 'sign') {
    const brown = p.glyph === 'view';
    paint.add('shadow', { fill: SHADOW }, boxOf(p, 1), (path) => path.rect(x + 0.5, y + 0.6, p.w, p.h));
    if (brown) {
      paint.add('body', { fill: '#f1ecdc' }, boxOf(p, 0.2), rectPath(x - 0.2, y - 0.2, p.w + 0.4, p.h + 0.4));
      paint.add('body', { fill: '#7a4b2a' }, boxOf(p), rectPath(x, y, p.w, p.h));
      label(paint, p, 'VIEW', 0.9, '#f1ecdc');
      return;
    }
    // A yellow diamond with a black edge and glyph.
    const d = p.w / 2;
    const diamond = (k) => [[p.x, p.y - d * k], [p.x + d * k, p.y], [p.x, p.y + d * k], [p.x - d * k, p.y]];
    paint.add('body', { fill: '#1d1d1f' }, boxOf(p, 0.2), polyPath(diamond(1.08)));
    paint.add('body', { fill: '#f2c230' }, boxOf(p), polyPath(diamond(0.92)));
    const glyph = p.glyph === 'winding'
      ? [[p.x - 0.35, p.y + 0.9], [p.x + 0.35, p.y + 0.35], [p.x - 0.35, p.y - 0.2], [p.x + 0.35, p.y - 0.75]]
      : [[p.x - 0.3, p.y + 0.9], [p.x - 0.3, p.y - 0.1], [p.x + 0.5, p.y - 0.6]];
    paint.add('detail', { stroke: '#1d1d1f', width: 0.28, join: 'round', cap: 'round' }, boxOf(p), linePath(glyph));
  } else if (p.kind === 'chevron') {
    // A long black board of yellow arrows, pointing the way the road turns.
    block(paint, p, '#1d1d1f', [0.4, 0.5]);
    const along = p.h > p.w;
    const len = along ? p.h : p.w;
    const across = along ? p.w : p.h;
    const dir = p.point === 'west' || p.point === 'north' ? -1 : 1;
    paint.add('detail', { stroke: '#f2c230', width: 0.42, join: 'miter' }, boxOf(p), (path) => {
      for (let k = 2.5; k < len - 1.5; k += 4) {
        const c = (along ? y : x) + k;
        const tip = across * 0.35 * dir;
        if (along) { path.moveTo(p.x - tip, c - 1.3); path.lineTo(p.x + tip, c); path.lineTo(p.x - tip, c + 1.3); }
        else { path.moveTo(c - 1.3, p.y - tip); path.lineTo(c, p.y + tip); path.lineTo(c + 1.3, p.y - tip); }
      }
    });
  } else if (p.kind === 'bench') {
    paint.add('shadow', { fill: SHADOW }, boxOf(p, 1), rectPath(x + 0.3, y + 0.35, p.w, p.h));
    paint.add('body', { fill: '#6b4c32' }, boxOf(p), rectPath(x, y, p.w, p.h));
    paint.add('detail', { stroke: '#8a6a49', width: 0.14 }, boxOf(p), (path) => {
      if (p.w > p.h) { path.moveTo(x + 0.2, p.y); path.lineTo(x + p.w - 0.2, p.y); }
      else { path.moveTo(p.x, y + 0.2); path.lineTo(p.x, y + p.h - 0.2); }
    });
  }
}

function gazebo(paint, p) {
  const [x, y] = block(paint, p, p.color, [0.6, 0.7]);
  paint.add('detail', { fill: '#f4f1e6' }, boxOf(p), (path) => {
    path.moveTo(x, y); path.lineTo(p.x, p.y); path.lineTo(x + p.w, y); path.closePath();
    path.moveTo(x, y + p.h); path.lineTo(p.x, p.y); path.lineTo(x + p.w, y + p.h); path.closePath();
  });
}

function rockOutline(p) {
  const rand = jitter(p.seed ?? Math.round(p.x * 13 + p.y * 7));
  const n = 7 + Math.floor(rand() * 3);
  const start = rand() * Math.PI;
  return Array.from({ length: n }, (_, i) => {
    const a = start + (i / n) * Math.PI * 2;
    const k = p.r * (0.8 + rand() * 0.28);
    return [p.x + Math.cos(a) * k, p.y + Math.sin(a) * k];
  });
}

function rock(paint, p) {
  const outline = rockOutline(p);
  paint.add('shadow', { fill: SHADOW }, roundBox(p, 2), polyPath(outline, 0.6, 0.7));
  paint.add('body', { fill: '#5d5f59' }, roundBox(p, 0.3), polyPath(outline.map(([x, y]) => [p.x + (x - p.x) * 1.08, p.y + (y - p.y) * 1.08])));
  paint.add('body', { fill: '#8d8f87' }, roundBox(p), polyPath(outline));
  paint.add('detail', { fill: '#a8aaa1' }, roundBox(p), polyPath(outline.slice(0, Math.ceil(outline.length / 2))
    .map(([x, y]) => [p.x - p.r * 0.12 + (x - p.x) * 0.62, p.y - p.r * 0.12 + (y - p.y) * 0.62]).concat([[p.x - p.r * 0.1, p.y - p.r * 0.1]])));
}

function outcrop(paint, p) {
  const box = pointsBox(p.points, 1);
  paint.add('shadow', { fill: SHADOW }, pointsBox(p.points, 3), polyPath(p.points, 1.4, 1.7));
  paint.add('body', { fill: '#5d5f59' }, box, polyPath(p.points));
  const cx = p.points.reduce((a, q) => a + q[0], 0) / p.points.length;
  const cy = p.points.reduce((a, q) => a + q[1], 0) / p.points.length;
  const inner = p.points.map(([x, y]) => [cx + (x - cx) * 0.9, cy + (y - cy) * 0.9]);
  paint.add('body', { fill: '#8a8b83' }, box, polyPath(inner));
  paint.add('detail', { fill: '#a6a79e' }, box, polyPath([...inner.slice(0, 3), [cx - 1, cy - 1]]));
  paint.add('detail', { stroke: '#6c6d66', width: 0.3 }, box, (path) => {
    inner.forEach(([x, y], i) => { if (i % 2 === 0) { path.moveTo(cx, cy); path.lineTo(x, y); } });
  });
}

function canopy(paint, t, tones, pine = false) {
  const box = roundBox(t, 2.5);
  paint.add('shadow', { fill: SHADOW }, box, circlePath(t.x + t.r * 0.34, t.y + t.r * 0.44, t.r));
  if (pine) {
    const star = (k, dx = 0, dy = 0) => (path) => {
      for (let i = 0; i < 16; i += 1) {
        const a = (i / 16) * Math.PI * 2;
        const rr = t.r * k * (i % 2 ? 0.68 : 1);
        const px = t.x + dx + Math.cos(a) * rr;
        const py = t.y + dy + Math.sin(a) * rr;
        if (i) path.lineTo(px, py); else path.moveTo(px, py);
      }
      path.closePath();
    };
    paint.add('canopy', { fill: tones.dark[t.tone % 3] }, box, star(1));
    paint.add('canopyLight', { fill: tones.light[t.tone % 3] }, box, star(0.62, -t.r * 0.1, -t.r * 0.1));
    paint.add('canopyLight', { fill: 'rgba(136,196,138,0.28)' }, box, circlePath(t.x - t.r * 0.16, t.y - t.r * 0.16, t.r * 0.22));
    return;
  }
  paint.add('canopy', { fill: tones.dark[t.tone % 3] }, box, circlePath(t.x, t.y, t.r));
  paint.add('canopyLight', { fill: tones.light[t.tone % 3] }, box, circlePath(t.x - t.r * 0.24, t.y - t.r * 0.24, t.r * 0.64));
  paint.add('canopyLight', { fill: 'rgba(164,218,128,0.20)' }, box, circlePath(t.x - t.r * 0.34, t.y - t.r * 0.34, t.r * 0.32));
}

function stand(paint, p, tones) {
  const box = pointsBox(p.points, 8);
  paint.add('shadow', { fill: SHADOW }, box, polyPath(p.points, 2, 2.6));
  paint.add('canopy', { fill: tones.dark[0] }, box, polyPath(p.points));
  for (const t of p.trees) canopy(paint, t, tones);
}

function lineProp(paint, p) {
  const box = pointsBox(p.points, p.width + 2);
  if (p.kind === 'tyrewall') {
    paint.add('body', { stroke: '#1c1d20', width: p.width, join: 'round', cap: 'round' }, box, linePath(p.points));
    paint.add('detail', { stroke: '#3b3c41', width: 0.5, dash: [0.55, 0.65], cap: 'round' }, box, linePath(p.points));
    paint.add('detail', { stroke: '#e7e2d3', width: 0.5, dash: [0.55, 4.25], cap: 'round' }, box, linePath(p.points));
    paint.add('detail', { stroke: '#c73a2c', width: 0.5, dash: [0.55, 4.25], dashOffset: 2.4, cap: 'round' }, box, linePath(p.points));
  } else if (p.kind === 'retaining') {
    paint.add('shadow', { stroke: SHADOW, width: p.width + 1.4, join: 'round' }, box, linePath(p.points, 0.9, 1.1));
    paint.add('body', { stroke: '#5f5c55', width: p.width + 0.5, join: 'round', cap: 'round' }, box, linePath(p.points));
    paint.add('body', { stroke: '#a39e90', width: p.width, join: 'round', cap: 'round' }, box, linePath(p.points));
    paint.add('detail', { stroke: '#bfb9aa', width: 0.4, join: 'round' }, box, linePath(p.points, -0.25, -0.25));
    paint.add('detail', { stroke: '#7c786d', width: p.width, dash: [0.18, 3.8] }, box, linePath(p.points));
  } else if (p.kind === 'fence' || p.kind === 'guardrail') {
    paint.add('body', { stroke: '#b9bdb6', width: 0.45 }, box, linePath(p.points));
    paint.add('detail', { stroke: '#5e4a32', width: 0.8, dash: [0.3, 2.2] }, box, linePath(p.points));
  }
}

function flat(paint, p) {
  if (p.kind === 'road') {
    const box = pointsBox(p.points, p.width);
    paint.add('ground', { stroke: '#4a4d50', width: p.width + 0.8, join: 'round' }, box, linePath(p.points));
    paint.add('ground', { stroke: '#56595c', width: p.width, join: 'round' }, box, linePath(p.points));
    paint.add('ground', { stroke: '#c9c3ad', width: 0.2, dash: [3, 5] }, box, linePath(p.points));
    // Patches and cracks: a road kept up on a budget.
    const rand = jitter(Math.round(p.points[0][0] * 7 + p.points[0][1]));
    paint.add('ground', { fill: '#4f5255' }, box, (path) => {
      for (let i = 1; i < p.points.length; i += 1) {
        const [ax, ay] = p.points[i - 1];
        const [bx, by] = p.points[i];
        const len = Math.hypot(bx - ax, by - ay);
        for (let d = 6; d < len; d += 14 + rand() * 20) {
          const f = d / len;
          const s = 1.2 + rand() * 2;
          path.rect(ax + (bx - ax) * f + (rand() - 0.5) * p.width * 0.6 - s / 2, ay + (by - ay) * f + (rand() - 0.5) * p.width * 0.6 - s / 2, s, s * 0.7);
        }
      }
    });
  } else if (p.kind === 'parking' || p.kind === 'gravel' || p.kind === 'paved') {
    const box = pointsBox(p.points, 1);
    const fill = { parking: '#5a5d60', gravel: '#a39b87', paved: '#9b9585' }[p.kind];
    paint.add('ground', { fill }, box, polyPath(p.points));
    if (p.kind === 'parking') {
      const [x0, y0, x1, y1] = pointsBox(p.points);
      paint.add('ground', { stroke: '#d6d1c2', width: 0.16 }, box, (path) => {
        if (p.bays === 'x') {
          for (let x = x0 + 3; x < x1; x += 3) { path.moveTo(x, y0 + 1); path.lineTo(x, y0 + 6); path.moveTo(x, y1 - 6); path.lineTo(x, y1 - 1); }
        } else {
          for (let y = y0 + 3; y < y1; y += 3) { path.moveTo(x0 + 1, y); path.lineTo(x0 + 6, y); path.moveTo(x1 - 6, y); path.lineTo(x1 - 1, y); }
        }
      });
    } else {
      const rand = jitter(Math.round(p.points[0][0] * 3 + p.points[0][1] * 5));
      const [x0, y0, x1, y1] = pointsBox(p.points);
      paint.add('ground', { fill: p.kind === 'gravel' ? '#8f8873' : '#857f70' }, box, (path) => {
        for (let i = 0; i < ((x1 - x0) * (y1 - y0)) / 18; i += 1) {
          const sx = x0 + rand() * (x1 - x0);
          const sy = y0 + rand() * (y1 - y0);
          path.rect(sx, sy, 0.35, 0.35);
        }
      });
    }
  } else if (p.kind === 'wear') {
    const box = [p.x - p.rx, p.y - p.ry, p.x + p.rx, p.y + p.ry];
    paint.add('ground', { fill: 'rgba(142,128,72,0.30)' }, box, (path) => path.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, Math.PI * 2));
    paint.add('ground', { fill: 'rgba(150,126,78,0.30)' }, box, (path) => path.ellipse(p.x, p.y, p.rx * 0.55, p.ry * 0.6, 0, 0, Math.PI * 2));
  } else if (p.kind === 'mound') {
    // A grass bank in soft tiers, lit from the top left like everything else.
    const box = pointsBox(p.points, 3);
    const cx = p.points.reduce((a, q) => a + q[0], 0) / p.points.length;
    const cy = p.points.reduce((a, q) => a + q[1], 0) / p.points.length;
    const tier = (k, dx = 0, dy = 0) => p.points.map(([x, y]) => [cx + (x - cx) * k + dx, cy + (y - cy) * k + dy]);
    paint.add('ground', { fill: 'rgba(30,90,40,0.16)' }, box, polyPath(tier(1.02, 1.4, 1.8)));
    [[1, 'rgba(120,200,110,0.10)'], [0.74, 'rgba(120,200,110,0.10)'], [0.48, 'rgba(120,200,110,0.10)']]
      .forEach(([k, fill]) => paint.add('ground', { fill }, box, polyPath(tier(k, -(1 - k) * 2, -(1 - k) * 2))));
  } else if (p.kind === 'path') {
    paint.add('ground', { stroke: 'rgba(160,146,98,0.55)', width: p.width, join: 'round', cap: 'round' }, pointsBox(p.points, p.width), linePath(p.points));
  } else if (p.kind === 'wash') {
    const box = pointsBox(p.points, p.width + 3);
    paint.add('ground', { stroke: 'rgba(70,78,52,0.35)', width: p.width + 2.4, join: 'round', cap: 'round' }, box, linePath(p.points));
    paint.add('ground', { stroke: '#a9a08a', width: p.width, join: 'round', cap: 'round' }, box, linePath(p.points));
    paint.add('ground', { stroke: '#8c846f', width: 0.5, dash: [0.4, 1.3], join: 'round' }, box, linePath(p.points, 0.6, 0.3));
    paint.add('ground', { stroke: '#c2b9a1', width: 0.45, dash: [0.4, 2.1], join: 'round' }, box, linePath(p.points, -0.9, -0.4));
  } else if (p.kind === 'meadow') {
    const box = pointsBox(p.points, 2);
    paint.add('ground', { fill: 'rgba(160,190,90,0.14)' }, box, polyPath(p.points));
    const rand = jitter(4242);
    const [x0, y0, x1, y1] = pointsBox(p.points);
    for (const c of ['#f1ead2', '#f0cf4a', '#c88fbf']) {
      paint.add('ground', { fill: c }, box, (path) => {
        for (let i = 0; i < 110; i += 1) {
          const sx = x0 + rand() * (x1 - x0);
          const sy = y0 + rand() * (y1 - y0);
          path.moveTo(sx + 0.3, sy); path.arc(sx, sy, 0.3, 0, Math.PI * 2);
        }
      });
    }
  } else if (p.kind === 'earth') {
    // The cut slope above a retaining wall: bare earth and scree fading up into the grass.
    const box = pointsBox(p.points, p.width);
    for (const [k, alpha] of [[1, 0.16], [0.7, 0.2], [0.42, 0.26]]) {
      paint.add('ground', { stroke: `rgba(128,108,74,${alpha})`, width: p.width * k, join: 'round', cap: 'round' }, box, linePath(p.points));
    }
    const rand = jitter(Math.round(p.points[0][0] * 11 + p.points[0][1] * 3));
    for (const c of ['#8d8c84', '#a5a39a', '#76695a']) {
      paint.add('ground', { fill: c }, box, (path) => {
        p.points.forEach(([x, y], i) => {
          if (i === 0) return;
          const [ux, uy] = p.points[i - 1];
          for (let k = 0; k < 3; k += 1) {
            const f = rand();
            const sx = ux + (x - ux) * f + (rand() - 0.5) * p.width * 0.6;
            const sy = uy + (y - uy) * f + (rand() - 0.5) * p.width * 0.6;
            const r = 0.25 + rand() * 0.45;
            path.moveTo(sx + r, sy); path.arc(sx, sy, r, 0, Math.PI * 2);
          }
        });
      });
    }
  }
}

// --- Ground ----------------------------------------------------------------------------------------

// Gravel shoulders to `shoulder` metres from the centreline, a ditch beyond them and speckles of
// stone in them: laid out in 32 m pieces of the lap, so only the pieces in view are drawn.
function addShoulders(paint, track, shoulder) {
  const pts = track.points;
  const n = pts.length;
  const at = (i, shift) => {
    const p = pts[(i + n) % n];
    return [p.x - p.ty * shift, p.y + p.tx * shift];
  };
  const piece = 16;
  const styles = [
    [{ stroke: '#2f5a31', width: 1.1, join: 'round', cap: 'round' }, [-shoulder - 0.6, shoulder + 0.6]],
    [{ stroke: '#9e9682', width: shoulder * 2, join: 'round', cap: 'round' }, [0]],
    [{ stroke: '#857d69', width: 0.32, dash: [0.3, 1.7] }, [-13.6]],
    [{ stroke: '#b8af98', width: 0.32, dash: [0.25, 2.3] }, [-11.4]],
    [{ stroke: '#857d69', width: 0.32, dash: [0.25, 2.9] }, [11.4]],
    [{ stroke: '#b8af98', width: 0.32, dash: [0.3, 1.9] }, [13.6]],
  ];
  for (const [style, shifts] of styles) {
    for (let i = 0; i < n; i += piece) {
      for (const shift of shifts) {
        const line = [];
        for (let k = i; k <= i + piece; k += 1) line.push(at(k, shift));
        paint.add('shoulder', style, pointsBox(line, shoulder + 1), linePath(line));
      }
    }
  }
}

// The hill's height (in metres, notionally) at a point: it shades the ground and draws the contour
// lines. The ground itself stays flat; nothing in the simulation reads this.
function heightAt(e, x, y) {
  let z = e.grade * ((x - e.origin[0]) * e.dir[0] + (y - e.origin[1]) * e.dir[1]);
  for (const [bx, by, amp, sigma] of e.bumps) z += amp * Math.exp(-((x - bx) ** 2 + (y - by) ** 2) / (2 * sigma * sigma));
  for (const [amp, kx, ky, phase] of e.waves ?? []) z += amp * Math.sin(kx * x + ky * y + phase);
  return z;
}

// One grid of heights, every 2 m from 140 m outside the guardrail, shared by the shading and the
// contours, so each point of the hill is worked out once.
function heightGrid(track, e) {
  const b = track.bounds;
  const step = 2;
  const x0 = b.minX - 140;
  const y0 = b.minY - 140;
  const w = Math.ceil((b.maxX - b.minX + 280) / step) + 1;
  const h = Math.ceil((b.maxY - b.minY + 280) / step) + 1;
  const z = new Float32Array(w * h);
  for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) z[j * w + i] = heightAt(e, x0 + i * step, y0 + j * step);
  return { z, w, h, x0, y0, step };
}

// The hill's colour, baked once at 2 m a pixel: valley grass shading up the slope, lit from the top
// left. Neighbouring pixels differ by under one colour level, so it is drawn scaled up without
// smoothing (much cheaper than smoothing, or a gradient, over a whole frame).
function bakeHill(e, grid) {
  const { z, w, h, x0, y0, step } = grid;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const stops = [[0, [63, 138, 69]], [0.45, [77, 149, 72]], [1, [121, 160, 82]]];
  for (let j = 0; j < h; j += 1) {
    for (let i = 0; i < w; i += 1) {
      const x = x0 + i * step;
      const y = y0 + j * step;
      const u = Math.max(0, Math.min(1, ((x - e.origin[0]) * e.dir[0] + (y - e.origin[1]) * e.dir[1] + 260) / 580));
      const k = u < stops[1][0] ? 0 : 1;
      const f = (u - stops[k][0]) / (stops[k + 1][0] - stops[k][0]);
      const ca = stops[k][1];
      const cb = stops[k + 1][1];
      // Slopes facing the top left catch the light; those facing away fall into shade.
      const gx = z[j * w + Math.min(w - 1, i + 1)] - z[j * w + Math.max(0, i - 1)];
      const gy = z[Math.min(h - 1, j + 1) * w + i] - z[Math.max(0, j - 1) * w + i];
      const light = Math.max(-1, Math.min(1, (gx + gy) * 0.9));
      const o = (j * w + i) * 4;
      img.data[o] = ca[0] + (cb[0] - ca[0]) * f - light * 9;
      img.data[o + 1] = ca[1] + (cb[1] - ca[1]) * f - light * 9;
      img.data[o + 2] = ca[2] + (cb[2] - ca[2]) * f - light * 7;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, x0: x0 - step / 2, y0: y0 - step / 2, scale: step };
}

// Marching squares over the height grid, 4 m cells, into the painter's contour layer; every fourth
// line is darker. Each cell only visits the levels its corners span.
const CONTOUR = { stroke: 'rgba(28,62,30,0.13)', width: 0.3 };
const CONTOUR_INDEX = { stroke: 'rgba(28,62,30,0.24)', width: 0.42 };
function addContours(paint, e, grid) {
  const { z, w, h, x0, y0, step } = grid;
  const k = 2;
  const cell = step * k;
  const crossing = (level, a, d, ax, ay, dx, dy) => {
    const t = (level - a) / (d - a);
    return [ax + (dx - ax) * t, ay + (dy - ay) * t];
  };
  for (let j = 0; j + k < h; j += k) {
    for (let i = 0; i + k < w; i += k) {
      const c0 = z[j * w + i];
      const c1 = z[j * w + i + k];
      const c2 = z[(j + k) * w + i + k];
      const c3 = z[(j + k) * w + i];
      const lo = Math.min(c0, c1, c2, c3);
      const hi = Math.max(c0, c1, c2, c3);
      const sx = x0 + i * step;
      const sy = y0 + j * step;
      const corners = [[sx, sy, c0], [sx + cell, sy, c1], [sx + cell, sy + cell, c2], [sx, sy + cell, c3]];
      for (let n = Math.ceil(lo / e.interval); n * e.interval < hi; n += 1) {
        const level = n * e.interval;
        const hits = [];
        for (let q = 0; q < 4; q += 1) {
          const [ax, ay, a] = corners[q];
          const [dx, dy, d] = corners[(q + 1) % 4];
          if ((a < level) !== (d < level)) hits.push(crossing(level, a, d, ax, ay, dx, dy));
        }
        if (hits.length < 2) continue;
        paint.add('contour', n % 4 === 0 ? CONTOUR_INDEX : CONTOUR, [sx, sy, sx + cell, sy + cell], (path) => {
          path.moveTo(...hits[0]); path.lineTo(...hits[1]);
          if (hits.length === 4) { path.moveTo(...hits[2]); path.lineTo(...hits[3]); }
        });
      }
    }
  }
}

// --- Building and drawing a circuit's landscape -----------------------------------------------------

// Every kind buildLandscape draws (the tests check that every solid kind is among them).
export const DRAWN_KINDS = Object.freeze(['tree', 'pine', 'stand', 'rock', 'tyres', 'outcrop', 'van', 'trailer', 'truck',
  'car', 'tractor', 'gazebo', 'garage', 'tower', 'grandstand', 'shed', 'cabin', 'building', 'hoarding', 'marker', 'marshal',
  'sign', 'chevron', 'bench', 'tyrewall', 'retaining', 'fence', 'guardrail',
  'road', 'parking', 'gravel', 'paved', 'wear', 'mound', 'path', 'wash', 'meadow', 'earth']);

export function buildLandscape(track, scenery) {
  const paint = createPainter();
  const tones = TREE_TONES[scenery.style] ?? TREE_TONES.grassroots;
  const grid = scenery.elevation ? heightGrid(track, scenery.elevation) : null;
  if (grid) addContours(paint, scenery.elevation, grid);
  if (scenery.shoulder) addShoulders(paint, track, scenery.shoulder);
  for (const p of scenery.props) {
    switch (p.kind) {
      case 'tree': canopy(paint, p, tones); break;
      case 'pine': canopy(paint, p, PINE_TONES, true); break;
      case 'stand': stand(paint, p, tones); break;
      case 'rock': case 'tyres':
        if (p.kind === 'rock') rock(paint, p);
        else {
          paint.add('shadow', { fill: SHADOW }, roundBox(p, 2), circlePath(p.x + 0.5, p.y + 0.6, p.r));
          paint.add('body', { fill: '#1c1d20' }, roundBox(p), circlePath(p.x, p.y, p.r));
          paint.add('detail', { stroke: '#3d3e43', width: 0.35 }, roundBox(p), circlePath(p.x, p.y, p.r * 0.62));
          paint.add('detail', { fill: '#0f1012' }, roundBox(p), circlePath(p.x, p.y, p.r * 0.32));
        }
        break;
      case 'outcrop': outcrop(paint, p); break;
      case 'van': case 'trailer': case 'truck': case 'car': case 'tractor': vehicle(paint, p); break;
      case 'gazebo': gazebo(paint, p); break;
      case 'garage': case 'tower': case 'grandstand': case 'shed': case 'cabin': case 'building': structure(paint, p); break;
      case 'hoarding': case 'marker': case 'marshal': case 'sign': case 'chevron': case 'bench': signs(paint, p); break;
      case 'tyrewall': case 'retaining': case 'fence': case 'guardrail': lineProp(paint, p); break;
      default: flat(paint, p);
    }
  }
  const marshals = scenery.props
    .filter((p) => p.kind === 'marshal')
    .map((p) => ({ x: p.x + p.w / 2 + 0.2, y: p.y - p.h / 2 - 1.25 }));
  return {
    style: scenery.style,
    wall: scenery.wall,
    shoulder: scenery.shoulder ?? 0,
    painter: paint,
    marshals,
    hill: grid ? bakeHill(scenery.elevation, grid) : null,
  };
}

function viewBox(view) {
  return { minX: view.x - view.hw - 2, minY: view.y - view.hh - 2, maxX: view.x + view.hw + 2, maxY: view.y + view.hh + 2 };
}

// The ground for a hillside circuit: the baked hill, then the forest floor beyond the guardrail.
function drawHillside(ctx, track, land, view) {
  const { x, y, hw, hh } = view;
  const { canvas, x0, y0, scale } = land.hill;
  const left = x - hw - 1;
  const top = y - hh - 1;
  // The bake reaches 140 m past the guardrail; a view wider than that (an ultrawide window, or the
  // debug overview) gets the valley colour under it first.
  if (left < x0 || top < y0 || x + hw + 1 > x0 + canvas.width * scale || y + hh + 1 > y0 + canvas.height * scale) {
    ctx.fillStyle = '#3f8a45';
    ctx.fillRect(left, top, hw * 2 + 2, hh * 2 + 2);
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, (left - x0) / scale, (top - y0) / scale, (hw * 2 + 2) / scale, (hh * 2 + 2) / scale, left, top, hw * 2 + 2, hh * 2 + 2);
  // Darker beyond the guardrail: only the strips of it in view, as Original's grass does.
  const b = track.bounds;
  const right = x + hw + 1;
  const bottom = y + hh + 1;
  ctx.fillStyle = 'rgba(16,46,24,0.34)';
  if (top < b.minY) ctx.fillRect(left, top, right - left, b.minY - top);
  if (bottom > b.maxY) ctx.fillRect(left, b.maxY, right - left, bottom - b.maxY);
  const t = Math.max(top, b.minY);
  const u = Math.min(bottom, b.maxY);
  if (u > t && left < b.minX) ctx.fillRect(left, t, b.minX - left, u - t);
  if (u > t && right > b.maxX) ctx.fillRect(b.maxX, t, right - b.maxX, u - t);
  ctx.imageSmoothingEnabled = true;
}

function drawWallStyle(ctx, track, style) {
  const { minX, maxX, minY, maxY } = track.bounds;
  const rect = (o) => ctx.strokeRect(minX - o, minY - o, maxX - minX + o * 2, maxY - minY + o * 2);
  ctx.setLineDash([]);
  if (style === 'armco') {
    // Catch fence behind, steel barrier in front, posts between.
    ctx.strokeStyle = '#59605c'; ctx.lineWidth = 0.16; rect(2.4);
    ctx.setLineDash([0.22, 2.8]); ctx.lineWidth = 0.5; rect(2.4);
    ctx.setLineDash([]);
    ctx.strokeStyle = '#555c58'; ctx.lineWidth = 1.2; rect(0.6);
    ctx.strokeStyle = '#c7ccc8'; ctx.lineWidth = 0.7; rect(0.45);
    ctx.strokeStyle = '#eef0ec'; ctx.lineWidth = 0.18; rect(0.3);
  } else {
    // A guardrail on timber posts.
    ctx.strokeStyle = '#5b4730'; ctx.lineWidth = 1.3; ctx.setLineDash([0.35, 2.15]); rect(0.9);
    ctx.setLineDash([]);
    ctx.strokeStyle = '#6f746e'; ctx.lineWidth = 0.95; rect(0.5);
    ctx.strokeStyle = '#c3c7c0'; ctx.lineWidth = 0.55; rect(0.4);
  }
  ctx.setLineDash([]);
}

// Everything under the road: the ground (Switchback's own; Original's grass is drawn by render.js
// first), flat props, the perimeter, shadows and raised props.
export function drawLandscapeBelow(ctx, track, land, view) {
  const v = viewBox(view);
  if (land.style === 'hillside') {
    drawHillside(ctx, track, land, view);
    paintLayer(ctx, land.painter, 'contour', v);
  }
  paintLayer(ctx, land.painter, 'ground', v);
  paintLayer(ctx, land.painter, 'shoulder', v);
  drawWallStyle(ctx, track, land.wall);
  paintLayer(ctx, land.painter, 'shadow', v);
  paintLayer(ctx, land.painter, 'body', v);
  paintLayer(ctx, land.painter, 'detail', v);
}

// Tree tops, over the cars and smoke.
export function drawLandscapeAbove(ctx, land, view) {
  const v = viewBox(view);
  paintLayer(ctx, land.painter, 'canopy', v);
  paintLayer(ctx, land.painter, 'canopyLight', v);
}

// --- Dockyard waterfront & port visual renderer (browser-only; keeps dockyard-scenery.js untouched) ---

function dockVisible(item, view) {
  return Math.abs(item.x - view.x) < view.hw + item.w / 2 + 2
    && Math.abs(item.y - view.y) < view.hh + item.h / 2 + 2;
}

export function drawDockyardGroundPolished(ctx, view, bounds = null, time = 0, still = false) {
  const { x, y, hw, hh } = view;
  const left = x - hw - 1;
  const top = y - hh - 1;
  const right = x + hw + 1;
  const bottom = y + hh + 1;

  // Concrete apron base.
  ctx.fillStyle = '#57605e';
  ctx.fillRect(left, top, right - left, bottom - top);

  // Subtle alternating weathered concrete bays (24 m slabs) for tactile scale & speed sense.
  const slab = 24;
  const sx0 = Math.floor(left / slab);
  const sx1 = Math.ceil(right / slab);
  const sy0 = Math.floor(top / slab);
  const sy1 = Math.ceil(bottom / slab);
  ctx.fillStyle = 'rgba(255,255,255,0.028)';
  for (let gx = sx0; gx <= sx1; gx += 1) {
    for (let gy = sy0; gy <= sy1; gy += 1) {
      if (((gx * 7 + gy * 13) & 3) === 0) ctx.fillRect(gx * slab, gy * slab, slab, slab);
    }
  }
  ctx.fillStyle = 'rgba(22,28,28,0.05)';
  for (let gx = sx0; gx <= sx1; gx += 1) {
    for (let gy = sy0; gy <= sy1; gy += 1) {
      if (((gx * 11 + gy * 5) & 7) === 3) ctx.fillRect(gx * slab, gy * slab, slab, slab);
    }
  }

  // Primary 24 m expansion joints and fine 12 m saw-cut lines.
  ctx.strokeStyle = '#4c5452';
  ctx.lineWidth = 0.16;
  ctx.beginPath();
  for (let sx = sx0 * slab; sx <= sx1 * slab; sx += slab) { ctx.moveTo(sx, top); ctx.lineTo(sx, bottom); }
  for (let sy = sy0 * slab; sy <= sy1 * slab; sy += slab) { ctx.moveTo(left, sy); ctx.lineTo(right, sy); }
  ctx.stroke();

  ctx.strokeStyle = 'rgba(68,76,74,0.38)';
  ctx.lineWidth = 0.08;
  ctx.beginPath();
  for (let sx = sx0 * slab + 12; sx <= sx1 * slab; sx += slab) { ctx.moveTo(sx, top); ctx.lineTo(sx, bottom); }
  for (let sy = sy0 * slab + 12; sy <= sy1 * slab; sy += slab) { ctx.moveTo(left, sy); ctx.lineTo(right, sy); }
  ctx.stroke();

  // Flush embedded steel gantry crane rails along the north quay and south apron.
  const drawRails = (ry) => {
    if (ry < top - 4 || ry > bottom + 4) return;
    const rx0 = Math.max(left, -196);
    const rx1 = Math.min(right, 196);
    if (rx1 <= rx0) return;
    ctx.fillStyle = 'rgba(34,40,40,0.45)';
    ctx.fillRect(rx0, ry - 0.55, rx1 - rx0, 1.1);
    ctx.strokeStyle = '#8b9491';
    ctx.lineWidth = 0.22;
    ctx.beginPath();
    ctx.moveTo(rx0, ry - 0.28); ctx.lineTo(rx1, ry - 0.28);
    ctx.moveTo(rx0, ry + 0.28); ctx.lineTo(rx1, ry + 0.28);
    ctx.stroke();
  };
  drawRails(-118);
  drawRails(-127);
  drawRails(118);
  drawRails(127);

  // Subtle painted yard stencils & oil wear spots (flat, quiet, clear of racing line).
  ctx.save();
  ctx.fillStyle = 'rgba(22,26,27,0.12)';
  for (const [ox, oy, rx, ry] of [[-52, -55, 7, 3.2], [-22, -55, 5.5, 2.6], [108, -22, 6, 3], [-86, 54, 6.5, 3]]) {
    if (Math.abs(ox - x) > hw + 10 || Math.abs(oy - y) > hh + 10) continue;
    ctx.beginPath();
    ctx.ellipse(ox, oy, rx, ry, 0.15, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(232,226,204,0.22)';
  ctx.font = 'bold 4.4px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [lbl, tx, ty, rot] of [
    ['QUAY 01', -18, -112, 0],
    ['YARD B', -42, -16, 0],
    ['BERTH S', 24, 110, 0],
    ['BASIN W', -126, 2, -Math.PI / 2],
  ]) {
    if (Math.abs(tx - x) > hw + 24 || Math.abs(ty - y) > hh + 16) continue;
    ctx.save();
    ctx.translate(tx, ty);
    if (rot) ctx.rotate(rot);
    ctx.fillText(lbl, 0, 0);
    ctx.restore();
  }
  ctx.restore();

  // Working harbor water & quay seawall right beyond the south and west perimeter bounds.
  if (bounds) {
    const seaS = bounds.maxY + 2.2;
    const seaW = bounds.minX - 2.2;
    const seaE = bounds.maxX + 6;
    const drawWater = (wx, wy, ww, wh) => {
      if (ww <= 0 || wh <= 0) return;
      ctx.fillStyle = '#213746';
      ctx.fillRect(wx, wy, ww, wh);
      ctx.fillStyle = 'rgba(10,18,24,0.42)';
      ctx.fillRect(wx, wy, ww, Math.min(wh, 5));
      const phase = still ? 0 : time * 1.1;
      ctx.strokeStyle = 'rgba(138,184,204,0.18)';
      ctx.lineWidth = 0.28;
      ctx.beginPath();
      const stepY = 7;
      const startY = Math.max(wy + 3, Math.floor(wy / stepY) * stepY);
      for (let ry = startY; ry < wy + wh; ry += stepY) {
        const shift = Math.sin(phase + ry * 0.25) * 2.2;
        const startX = Math.floor(wx / 18) * 18;
        for (let rx = startX; rx < wx + ww; rx += 18) {
          const x0 = rx + shift + ((Math.round(ry) * 5) % 9);
          ctx.moveTo(x0, ry);
          ctx.lineTo(x0 + 7.5, ry);
        }
      }
      ctx.stroke();
    };

    if (bottom > seaS) {
      drawWater(left, seaS, right - left, bottom - seaS);
      ctx.fillStyle = '#7e8682';
      ctx.fillRect(left, seaS - 3.0, right - left, 3.0);
      ctx.fillStyle = '#d8c577';
      ctx.fillRect(left, seaS - 0.75, right - left, 0.5);
      for (let px = Math.floor(left / 14) * 14; px < right; px += 14) {
        ctx.fillStyle = '#4e3c2c';
        ctx.fillRect(px, seaS - 0.25, 3.6, 1.35);
        ctx.fillStyle = '#2c3133';
        ctx.beginPath();
        ctx.arc(px + 1.8, seaS - 1.85, 0.54, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (left < seaW) {
      const wy0 = top;
      const wy1 = Math.min(bottom, seaS);
      if (wy1 > wy0) {
        drawWater(left, wy0, seaW - left, wy1 - wy0);
        ctx.fillStyle = '#7e8682';
        ctx.fillRect(seaW, wy0, 3.0, wy1 - wy0);
        ctx.fillStyle = '#d8c577';
        ctx.fillRect(seaW + 0.25, wy0, 0.5, wy1 - wy0);
        for (let py = Math.floor(wy0 / 16) * 16; py < wy1; py += 16) {
          ctx.fillStyle = '#4e3c2c';
          ctx.fillRect(seaW - 1.1, py, 1.35, 3.6);
          ctx.fillStyle = '#2c3133';
          ctx.beginPath();
          ctx.arc(seaW + 1.85, py + 1.8, 0.54, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    if (right > seaE) {
      const ey0 = top;
      const ey1 = Math.min(bottom, seaS);
      if (ey1 > ey0) {
        ctx.fillStyle = '#474f4d';
        ctx.fillRect(seaE, ey0, right - seaE, ey1 - ey0);
      }
    }
  }
}

export function drawDockyardSceneryPolished(ctx, scenery, view) {
  ctx.save();
  ctx.setLineDash([]);
  for (const p of scenery.props) {
    if (!dockVisible(p, view)) continue;
    const x = p.x - p.w / 2;
    const y = p.y - p.h / 2;
    if (p.kind === 'loading') {
      ctx.fillStyle = 'rgba(30,36,36,0.22)';
      ctx.fillRect(x, y, p.w, p.h);
      ctx.strokeStyle = '#c4b46c';
      ctx.lineWidth = 0.24;
      ctx.strokeRect(x, y, p.w, p.h);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 0.32;
      ctx.beginPath();
      for (let sx = x; sx < x + p.w - p.h; sx += 3) {
        ctx.moveTo(sx, y + p.h); ctx.lineTo(sx + p.h, y);
      }
      ctx.stroke();
      continue;
    }
    ctx.fillStyle = 'rgba(26,33,33,0.44)';
    ctx.fillRect(x + 1.35, y + 1.55, p.w, p.h);
    ctx.fillStyle = '#273131';
    ctx.fillRect(x - 0.32, y - 0.32, p.w + 0.64, p.h + 0.64);
    ctx.fillStyle = p.color;
    ctx.fillRect(x, y, p.w, p.h);

    const spacing = p.kind === 'warehouse' ? 5.5 : 1.8;
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 0.22;
    ctx.beginPath();
    for (let sx = x + 1; sx < x + p.w - 0.6; sx += spacing) { ctx.moveTo(sx, y + 0.6); ctx.lineTo(sx, y + p.h - 0.6); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.14)';
    ctx.lineWidth = 0.18;
    ctx.beginPath();
    for (let sx = x + 1.35; sx < x + p.w - 0.5; sx += spacing) { ctx.moveTo(sx, y + 0.6); ctx.lineTo(sx, y + p.h - 0.6); }
    ctx.stroke();

    if (p.kind === 'warehouse') {
      ctx.fillStyle = 'rgba(0,0,0,0.10)';
      ctx.fillRect(x, y + p.h / 2, p.w, p.h / 2);
      ctx.fillStyle = '#8b9792';
      ctx.fillRect(x, y, p.w, 1.3);
      ctx.fillStyle = '#9aa6a1';
      ctx.fillRect(x, y + p.h / 2 - 0.35, p.w, 0.7);
      for (let sx = x + 8; sx < x + p.w - 10; sx += 16) {
        ctx.fillStyle = '#85a3ad';
        ctx.fillRect(sx, y + p.h * 0.22, 7.5, 2.8);
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.fillRect(sx + 0.4, y + p.h * 0.22 + 0.3, 3.2, 2.2);
        if (Math.round(sx) % 32 === 0) {
          ctx.fillStyle = '#485454';
          ctx.fillRect(sx + 1, y + p.h * 0.62, 3.6, 3.2);
          ctx.fillStyle = '#2d3636';
          ctx.beginPath();
          ctx.arc(sx + 2.8, y + p.h * 0.62 + 1.6, 1.05, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.fillStyle = '#33403e';
      for (let sx = x + 5; sx < x + p.w - 6; sx += 16) {
        ctx.fillRect(sx, y + p.h - 3.1, 8.2, 3.1);
        ctx.fillStyle = '#53615e';
        ctx.fillRect(sx + 0.5, y + p.h - 2.6, 7.2, 0.5);
        ctx.fillStyle = '#33403e';
      }
    } else if (p.kind === 'barrier') {
      ctx.fillStyle = '#cfd2c8';
      ctx.fillRect(x + 0.3, y + 0.25, p.w - 0.6, 0.55);
      ctx.fillStyle = '#d8c56b';
      ctx.fillRect(x + 1.2, y + 0.3, 2.2, 0.45);
      ctx.fillRect(x + p.w - 3.4, y + 0.3, 2.2, 0.45);
      ctx.fillStyle = 'rgba(30,36,36,0.35)';
      ctx.fillRect(x + p.w / 2 - 0.12, y, 0.24, p.h);
    } else {
      ctx.fillStyle = '#353e3e';
      const lug = 0.85;
      ctx.fillRect(x, y, lug, lug);
      ctx.fillRect(x + p.w - lug, y, lug, lug);
      ctx.fillRect(x, y + p.h - lug, lug, lug);
      ctx.fillRect(x + p.w - lug, y + p.h - lug, lug, lug);
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(x + lug, y, p.w - lug * 2, 0.45);
      ctx.fillStyle = '#ded6bf';
      ctx.fillRect(x + p.w - 3.6, y + 1.15, 2.1, 0.9);
      ctx.fillStyle = 'rgba(240,234,216,0.45)';
      ctx.fillRect(x + 1.8, y + p.h - 1.7, 4.4, 0.55);
    }
  }
  for (const b of scenery.boards) {
    if (!dockVisible(b, view)) continue;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.fillStyle = 'rgba(22,30,30,0.46)';
    ctx.fillRect(-b.w / 2 + 0.85, -b.h / 2 + 1.05, b.w, b.h);
    ctx.fillStyle = '#f2ede0';
    ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
    ctx.fillStyle = '#1b2427';
    ctx.fillRect(-b.w / 2 + 0.32, -b.h / 2 + 0.32, b.w - 0.64, b.h - 0.64);
    ctx.fillStyle = '#e8c43e';
    ctx.fillRect(-b.w / 2 + 0.32, -b.h / 2 + 0.32, b.w - 0.64, 0.42);
    ctx.fillStyle = '#f6f2e2';
    ctx.font = 'bold 1.55px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.label, 0, -1.95);
    ctx.translate(0, 1.2);
    ctx.strokeStyle = '#ffd15b';
    ctx.fillStyle = '#ffd15b';
    ctx.lineWidth = 0.58;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    b.route.forEach(([rx, ry], i) => (i ? ctx.lineTo(rx, ry) : ctx.moveTo(rx, ry)));
    ctx.stroke();
    const [a, z] = b.route.slice(-2);
    const angle = Math.atan2(z[1] - a[1], z[0] - a[0]);
    ctx.translate(z[0], z[1]);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0.7, 0); ctx.lineTo(-0.65, -0.82); ctx.lineTo(-0.65, 0.82);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}
