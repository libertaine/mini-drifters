// Original: a grassroots club circuit, kept up on a small budget. World metres; see scenery.js for
// the shapes and rules. The perimeter wall (track.bounds) is about x -252..241, y -159..205; anything
// built against it is placed from the real bounds, so it crosses the wall line. Every reachable solid stays 24 m or more from the centreline. Things built against the wall touch it,
// so nothing leaves a slot the car could wedge into.
//
//   North, along the main straight: race control, the pit garages and the main grandstand, built
//     into the perimeter, with sponsor boards between them. The paddock road runs behind.
//   Infield, east: the grass paddock (clubhouse, scrutineering, vans, trailers, gazebos, the
//     fire tender). Infield, west: copses, and the sweeper's marker boards.
//   Hairpin: a small grandstand on its outside, with a copse running into the outer woods.
//   South-east: the maintenance yard (shed, tyre piles, the mower).
//   Perimeter: tyre walls on the outside of the corners, woods and car parks beyond.

export function buildOriginalScenery(track, h) {
  const rand = h.seeded(1987);
  const W = track.bounds;
  const props = [];
  const add = (p) => { props.push(p); return p; };

  // --- Ground: flat, never solid ------------------------------------------------------------------
  // Beyond the wall: the paddock road and car parks (paved, out of reach).
  add({ kind: 'road', points: [[-330, -172], [-60, -172], [150, -172], [262, -172], [262, -60], [262, 260]], width: 8 });
  add({ kind: 'road', points: [[-60, -172], [-60, -240]], width: 7 });
  add({ kind: 'parking', points: [[-210, -232], [-90, -232], [-90, -180], [-210, -180]], bays: 'x' });
  add({ kind: 'parking', points: [[270, -140], [312, -140], [312, -10], [270, -10]], bays: 'y' });
  add({ kind: 'gravel', points: [[-40, -232], [140, -232], [140, -180], [-40, -180]] });
  // Inside: worn grass where cars run wide, a spectator bank, footpaths.
  for (const [x, y, rx, ry] of [[208, -40, 9, 26], [-115, 116, 7, 16], [-225, -60, 8, 22], [-20, 186, 22, 7],
    [128, 40, 14, 6]]) add({ kind: 'wear', x, y, rx, ry });
  add({ kind: 'mound', points: h.roundOutline(h.convexHull([[-190, 96], [-160, 92], [-150, 110], [-152, 150], [-176, 162], [-196, 140]]), 3) });
  // The marshals' service track, mown into the infield along the main straight.
  add({ kind: 'path', points: [[-150, -78], [-120, -90], [-60, -92], [0, -93], [40, -89], [62, -70]], width: 3 });
  add({ kind: 'path', points: [[40, -40], [70, -48], [110, -52], [150, -40]], width: 2 });
  add({ kind: 'path', points: [[-150, 128], [-176, 120], [-222, 130], [-262, 130]], width: 2 });

  // --- North frontage, built into the wall ---------------------------------------------------------
  add({ kind: 'tower', x: -60, y: W.minY + 5.5, w: 16, h: 17, label: 'RACE CONTROL' });
  add({ kind: 'hoarding', x: -39, y: W.minY + 0.8, w: 26, h: 2.4, label: 'CLUB MOTORSPORT', color: '#e9e4d2', ink: '#1f4c8f' });
  add({ kind: 'garage', x: 10, y: W.minY + 5, w: 72, h: 14, doors: 8 });
  add({ kind: 'hoarding', x: 58, y: W.minY + 0.8, w: 24, h: 2.4, label: 'TYRES · FITTING', color: '#f2c230', ink: '#1d1d1f' });
  add({ kind: 'grandstand', x: 93, y: W.minY + 6, w: 46, h: 18, rows: 7, roof: '#b23a2a' });
  // The wall itself: tyre walls on the outside of the corners, lying against it.
  // Their centre line is 0.6 m inside the wall and they are 1.6 m thick, so they cross its line.
  const [n, e, s, w] = [W.minY + 0.6, W.maxX - 0.6, W.maxY - 0.6, W.minX + 0.6];
  add({ kind: 'tyrewall', points: [[116.8, n], [e, n], [e, 40]], width: 1.6 });
  add({ kind: 'tyrewall', points: [[w, -96], [w, n], [-96, n]], width: 1.6 });
  add({ kind: 'tyrewall', points: [[w, -96], [w, 10]], width: 1.6 });
  add({ kind: 'tyrewall', points: [[-130, s], [70, s]], width: 1.6 });
  add({ kind: 'tyrewall', points: [[e, 90], [e, s], [150, s]], width: 1.6 });

  // --- Infield paddock, on the grass ----------------------------------------------------------------
  add({ kind: 'building', x: 70, y: -62, w: 30, h: 14, roof: '#8a6f55', label: 'CLUBHOUSE' });
  add({ kind: 'shed', x: 108, y: -64, w: 16, h: 12, roof: '#6f7a78', label: 'SCRUTINEERING' });
  // Vans with their gazebos pitched against them; 8 m or more between neighbours.
  [[44, -38, '#e8e3d4'], [60, -38, '#3c5c88'], [74, -38, '#b8462e'], [90, -38, '#e8e3d4']]
    .forEach(([x, y, color]) => add({ kind: 'van', x, y, w: 3, h: 6.2, color }));
  add({ kind: 'gazebo', x: 48, y: -38, w: 5, h: 5, color: '#2f7fc1' });
  add({ kind: 'gazebo', x: 78, y: -38, w: 5, h: 5, color: '#e0a526' });
  [[46, -10], [62, -10], [78, -10]].forEach(([x, y], i) => add({ kind: 'trailer', x, y, w: 3.2, h: 9, color: ['#b9b6ab', '#6b7c86', '#a85d3e'][i] }));
  add({ kind: 'truck', x: 116, y: -28, w: 3.4, h: 9.5, color: '#c8352a', label: 'FIRE' });
  add({ kind: 'marker', x: 10, y: -84, w: 3, h: 3, label: '3' });
  add({ kind: 'marker', x: 45, y: -84, w: 3, h: 3, label: '2' });
  add({ kind: 'marker', x: 80, y: -84, w: 3, h: 3, label: '1' });

  // --- Marshal posts --------------------------------------------------------------------------------
  add({ kind: 'marshal', x: -150, y: -78, w: 4, h: 3.4 });
  add({ kind: 'marshal', x: 247, y: -62, w: 4, h: 3.4 });
  add({ kind: 'marshal', x: -259, y: -50, w: 4, h: 3.4 });

  // --- Hairpin --------------------------------------------------------------------------------------
  add({ kind: 'grandstand', x: -143, y: 128, w: 14, h: 40, rows: 6, roof: '#2c5d8f', facing: 'east' });
  add({ kind: 'marshal', x: -126, y: 168, w: 4, h: 3.4 });
  add({ kind: 'truck', x: -160, y: 170, w: 3.4, h: 8, color: '#eeeae0', label: 'MEDIC' });
  add({ kind: 'marker', x: 20, y: 183, w: 3, h: 3, label: '2' });
  add({ kind: 'marker', x: -10, y: 183, w: 3, h: 3, label: '1' });

  // --- Maintenance yard, south-east ------------------------------------------------------------------
  add({ kind: 'shed', x: 140, y: 156, w: 22, h: 12, roof: '#7b5a44', label: 'WORKSHOP' });
  add({ kind: 'tyres', x: 162, y: 150, r: 2.2 });
  add({ kind: 'tyres', x: 163, y: 162, r: 2.6 });
  add({ kind: 'tractor', x: 128, y: 178, w: 2.6, h: 4.2, color: '#3d7a3a' });

  // --- Woodland -------------------------------------------------------------------------------------
  // Copses inside the wall: solid stands, their canopy drawn over the outline.
  const stands = [
    [[-122, -70], [-96, -74], [-84, -56], [-98, -44], [-120, -48]],
    [[-56, -62], [-30, -66], [-20, -52], [-34, -42], [-54, -46]],
    [[-160, -56], [-140, -60], [-134, -46], [-148, -38], [-162, -44]],
    [[-52, 38], [-36, 34], [-26, 46], [-36, 58], [-52, 54]],
    // These three run on through the wall: their outline reaches 8 m past it, so rounding their
    // corners can't open a slot along the wall.
    [[W.minX - 8, 36], [-206, 34], [-190, 66], [-200, 98], [W.minX - 8, 106]],
    [[W.minX - 8, 148], [-212, 146], [-196, 176], [-200, W.maxY + 8], [W.minX - 8, W.maxY + 8]],
    [[176, 120], [W.maxX + 8, 110], [W.maxX + 8, 162], [196, 168], [178, 146]],
    [[-12, -60], [8, -64], [16, -50], [2, -40], [-12, -46]],
  ];
  stands.forEach((pts, i) => {
    const points = h.convexHull(h.roundOutline(h.convexHull(pts)));
    add({ kind: 'stand', points, trees: h.fillStand(points, h.seeded(300 + i), { spacing: 7.5, rMin: 3.6, rMax: 5.6 }) });
  });

  // An avenue of trees inside the back straight, 15 m apart.
  for (let x = -125; x <= -35; x += 15) add({ kind: 'tree', x, y: -30 + (rand() - 0.5) * 2, r: 4.2 + rand() * 0.8, tone: Math.floor(rand() * 3) });

  // Woods all round beyond the wall, out of reach: a seeded scatter, kept off the paved ground.
  const paved = props.filter((p) => p.kind === 'road' || p.kind === 'parking' || p.kind === 'gravel' || p.w !== undefined);
  const extent = (p) => (p.w !== undefined
    ? [p.x - p.w / 2, p.x + p.w / 2, p.y - p.h / 2, p.y + p.h / 2]
    : [Math.min(...p.points.map((q) => q[0])), Math.max(...p.points.map((q) => q[0])),
      Math.min(...p.points.map((q) => q[1])), Math.max(...p.points.map((q) => q[1]))]);
  const onPaving = (x, y, r) => paved.some((p) => {
    if (p.width) return p.points.some(([ax, ay], i) => i > 0 && segDist(x, y, ...p.points[i - 1], ax, ay) < p.width / 2 + r + 1);
    const [x0, x1, y0, y1] = extent(p);
    return x > x0 - r && x < x1 + r && y > y0 - r && y < y1 + r;
  });
  const ring = { minX: W.minX - 110, maxX: W.maxX + 110, minY: W.minY - 110, maxY: W.maxY + 110 };
  for (let x = ring.minX; x < ring.maxX; x += 11) {
    for (let y = ring.minY; y < ring.maxY; y += 10) {
      const tx = x + (rand() - 0.5) * 9;
      const ty = y + (rand() - 0.5) * 9;
      const r = 3.6 + rand() * 3.2;
      const beyond = tx < W.minX - r - 3 || tx > W.maxX + r + 3 || ty < W.minY - r - 3 || ty > W.maxY + r + 3;
      // Thinner close to the wall, so the woods read as a treeline rather than a carpet.
      const edge = Math.min(W.minX - tx, tx - W.maxX, W.minY - ty, ty - W.maxY);
      const keep = rand() < (Math.max(-edge, edge) < 25 ? 0.42 : 0.82);
      if (beyond && keep && !onPaving(tx, ty, r)) add({ kind: 'tree', x: tx, y: ty, r, tone: Math.floor(rand() * 3) });
    }
  }

  // Parked cars in the car parks (beyond the wall).
  const carColors = ['#c74a2c', '#e9e5da', '#3b5e8c', '#2b2d31', '#8a9aa0', '#d6a531', '#5b7f4a'];
  for (let x = -204; x <= -96; x += 6) {
    for (const y of [-224, -188]) if (rand() < 0.7) add({ kind: 'car', x, y, w: 2.3, h: 4.6, color: carColors[Math.floor(rand() * carColors.length)] });
  }
  for (let y = -134; y <= -16; y += 6) {
    for (const x of [276, 306]) if (rand() < 0.7) add({ kind: 'car', x, y, w: 4.6, h: 2.3, color: carColors[Math.floor(rand() * carColors.length)] });
  }
  // Team transporters on the paddock gravel, beyond the wall.
  for (const [x, i] of [[-24, 0], [6, 1], [36, 2], [66, 3], [96, 4], [124, 5]]) {
    add({ kind: 'trailer', x, y: -206, w: 3.4, h: 14, color: ['#e2ddcf', '#2f4f7a', '#9c3b2a', '#4c6b57', '#d8b043', '#6d6f73'][i] });
  }

  return {
    props,
    style: 'grassroots',
    wall: 'armco',
  };
}

function segDist(x, y, ax, ay, bx, by) {
  const ex = bx - ax;
  const ey = by - ay;
  const len2 = ex * ex + ey * ey;
  let t = len2 ? ((x - ax) * ex + (y - ay) * ey) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (ax + ex * t), y - (ay + ey * t));
}
