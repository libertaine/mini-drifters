// Dockyard's scenery layout and picture. World-space metres. The layout is also what the solid
// scenery is made from (obstacles.js turns its warehouses, containers and barriers into collision
// boxes), so a prop's position lives here and nowhere else. No simulation state.
// The fixed layout is built once per cached course, with no random work per frame.
export function buildDockyardScenery(track) {
  if (track.id !== 'dockyard') return null;
  const props = [
    { kind: 'warehouse', x: -108, y: -149, w: 72, h: 26, color: '#697574' },
    { kind: 'warehouse', x: 35, y: -151, w: 94, h: 30, color: '#626e70' },
    { kind: 'warehouse', x: -24, y: 151, w: 84, h: 26, color: '#6c7470' },
    ...[-67, -37, -7].map((x, i) => ({ kind: 'container', x, y: -43, w: 24, h: 8,
      color: ['#94684e', '#597477', '#7e805b'][i] })),
    ...[-67, -37].map((x) => ({ kind: 'container', x, y: -32, w: 24, h: 8, color: '#647477' })),
    { kind: 'container', x: 110, y: -33, w: 22, h: 8, color: '#916b50' },
    { kind: 'container', x: 110, y: -44, w: 22, h: 8, color: '#647b7c' },
    { kind: 'container', x: -93, y: 30, w: 24, h: 8, color: '#7c805c' },
    { kind: 'container', x: -93, y: 41, w: 24, h: 8, color: '#94684e' },
    ...[-60, -46, -32, -18].map((x) => ({ kind: 'barrier', x, y: -104, w: 10, h: 2, color: '#b3b6ab' })),
    ...[12, 26, 40].map((x) => ({ kind: 'barrier', x, y: 52, w: 10, h: 2, color: '#b3b6ab' })),
    // Loading-bay stripes stay beside the containers, away from the racing line.
    { kind: 'loading', x: -37, y: -56, w: 82, h: 5, color: '#a59660' },
    { kind: 'loading', x: -93, y: 53, w: 26, h: 5, color: '#a59660' },
  ];
  const boards = [
    { id: 'hook', label: 'HOOK', x: 100, y: -102, w: 15, h: 8,
      route: [[-2, -1], [1, -1], [1, 1.2]] },
    { id: 'hook-tightens', label: 'TIGHTENS', x: 190, y: -17, w: 15, h: 8,
      route: [[1, -1.2], [1, 1], [-2, 1]] },
    { id: 'chicane', label: 'CHICANE', x: 8, y: -10, w: 15, h: 8,
      route: [[2.2, -1], [0.6, -1], [-0.6, 1], [-2.2, 1]] },
    { id: 'basin', label: 'BASIN', x: -88, y: 102, w: 15, h: 8,
      route: [[2, 1], [-1, 1], [-2, 0], [-1, -1], [1, -1]] },
  ];
  return { props, boards };
}

function visible(item, view) {
  // Includes the modest bottom-right shadow. No scenery traversal grows with play time.
  return Math.abs(item.x - view.x) < view.hw + item.w / 2 + 2
    && Math.abs(item.y - view.y) < view.hh + item.h / 2 + 2;
}

export function drawDockyardGround(ctx, view) {
  const { x, y, hw, hh } = view;
  ctx.fillStyle = '#59615f';
  ctx.fillRect(x - hw - 1, y - hh - 1, hw * 2 + 2, hh * 2 + 2);
  // Quiet slab joints give movement a reference without competing with rubber on asphalt.
  ctx.strokeStyle = '#535b59';
  ctx.lineWidth = 0.12;
  ctx.beginPath();
  for (let sx = Math.floor((x - hw) / 24) * 24; sx < x + hw; sx += 24) {
    ctx.moveTo(sx, y - hh - 1); ctx.lineTo(sx, y + hh + 1);
  }
  for (let sy = Math.floor((y - hh) / 24) * 24; sy < y + hh; sy += 24) {
    ctx.moveTo(x - hw - 1, sy); ctx.lineTo(x + hw + 1, sy);
  }
  ctx.stroke();
}

export function drawDockyardScenery(ctx, scenery, view) {
  ctx.save();
  ctx.setLineDash([]);
  for (const p of scenery.props) {
    if (!visible(p, view)) continue;
    const x = p.x - p.w / 2;
    const y = p.y - p.h / 2;
    if (p.kind === 'loading') {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 0.28;
      ctx.beginPath();
      for (let sx = x; sx < x + p.w - p.h; sx += 3) {
        ctx.moveTo(sx, y + p.h); ctx.lineTo(sx + p.h, y);
      }
      ctx.stroke();
      continue;
    }
    ctx.fillStyle = '#424b49';
    ctx.fillRect(x + 1.2, y + 1.4, p.w, p.h);
    ctx.fillStyle = '#303c3c';
    ctx.fillRect(x - 0.3, y - 0.3, p.w + 0.6, p.h + 0.6);
    ctx.fillStyle = p.color;
    ctx.fillRect(x, y, p.w, p.h);
    ctx.strokeStyle = '#ffffff20';
    ctx.lineWidth = 0.22;
    ctx.beginPath();
    const spacing = p.kind === 'warehouse' ? 6 : 1.8;
    for (let sx = x + 1; sx < x + p.w; sx += spacing) {
      ctx.moveTo(sx, y + 0.6); ctx.lineTo(sx, y + p.h - 0.6);
    }
    ctx.stroke();
    if (p.kind === 'warehouse') {
      ctx.fillStyle = '#85908b';
      ctx.fillRect(x, y, p.w, 1.2);
      ctx.fillStyle = '#394745';
      for (let sx = x + 5; sx < x + p.w - 6; sx += 16) ctx.fillRect(sx, y + p.h - 3, 8, 3);
    } else if (p.kind === 'barrier') {
      ctx.fillStyle = '#d1c69b';
      ctx.fillRect(x + 0.5, y + 0.3, p.w - 1, 0.4);
    } else {
      ctx.fillStyle = '#c4bba4';
      ctx.fillRect(x + p.w - 3.2, y + 1.1, 1.8, 0.8);
    }
  }
  for (const b of scenery.boards) {
    if (!visible(b, view)) continue;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.fillStyle = '#424b49';
    ctx.fillRect(-b.w / 2 + 0.7, -b.h / 2 + 0.9, b.w, b.h);
    ctx.fillStyle = '#eee9d6';
    ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
    ctx.fillStyle = '#202b2e';
    ctx.fillRect(-b.w / 2 + 0.3, -b.h / 2 + 0.3, b.w - 0.6, b.h - 0.6);
    ctx.fillStyle = '#f4f0de';
    ctx.font = 'bold 1.55px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.label, 0, -2.1);
    ctx.translate(0, 1.1);
    ctx.strokeStyle = '#ffd15b';
    ctx.fillStyle = '#ffd15b';
    ctx.lineWidth = 0.55;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    b.route.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.stroke();
    const [a, z] = b.route.slice(-2);
    const angle = Math.atan2(z[1] - a[1], z[0] - a[0]);
    ctx.translate(z[0], z[1]);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0.65, 0); ctx.lineTo(-0.65, -0.8); ctx.lineTo(-0.65, 0.8);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}
