// Runway 27 — Abandoned Airfield scenery layout (high-speed flowing circuit).
// Cracked olive-turf airfield, disused cross-runway with faded '27' / '09' numerals, ATC control
// tower, corrugated hangars, jet-fuel tanks, animated windsock and parked vintage aircraft beyond
// the chainlink perimeter fence. Off-course remains grass physics everywhere.
import { createPlacer, pointAtS } from './scenery-helpers.js';

export function buildRunwayScenery(track, h) {
  const b = track.bounds;
  const p = createPlacer(track, h);
  const rand = h.seeded(27092026);

  // 1. Disused cross-runway & taxiway strips across the wide open central infield (purely flat visual).
  p.addFlat({
    kind: 'runway',
    fill: '#5c605d',
    border: '#767a75',
    points: [[-105, -24], [100, -24], [100, 18], [-105, 18]],
  });
  p.addFlat({
    kind: 'runway',
    fill: '#575b58',
    points: [[-18, -94], [14, -94], [14, 92], [-18, 92]],
  });
  // Faded runway threshold piano keys & '27' / '09' designations.
  p.addFlat({
    kind: 'decal',
    x: 84,
    y: -3,
    color: 'rgba(236,232,218,0.46)',
    bars: [
      [4, -17, 10, 2.2], [4, -12, 10, 2.2], [4, -7, 10, 2.2],
      [4, 4, 10, 2.2], [4, 9, 10, 2.2], [4, 14, 10, 2.2],
    ],
  });
  p.addFlat({ kind: 'decal', x: 64, y: -3, text: '27', size: 15, color: 'rgba(238,234,220,0.44)', angle: -Math.PI / 2 });
  p.addFlat({
    kind: 'decal',
    x: -90,
    y: -3,
    color: 'rgba(236,232,218,0.42)',
    bars: [
      [-12, -17, 10, 2.2], [-12, -12, 10, 2.2], [-12, -7, 10, 2.2],
      [-12, 4, 10, 2.2], [-12, 9, 10, 2.2], [-12, 14, 10, 2.2],
    ],
  });
  p.addFlat({ kind: 'decal', x: -66, y: -3, text: '09', size: 15, color: 'rgba(238,234,220,0.40)', angle: Math.PI / 2 });
  // Taxiway centreline dashes on the central infield strip.
  for (let x = -48; x <= 44; x += 16) {
    p.addFlat({ kind: 'decal', x, y: -3, color: 'rgba(235,198,84,0.42)', bars: [[-4, -0.45, 8, 0.9]] });
  }
  // Subtle oil & weathered patches in infield apron.
  for (const [wx, wy, rx, ry] of [[-46, -68, 12, 6], [42, 68, 14, 7], [-54, 62, 11, 6], [56, -58, 10, 5]]) {
    p.addFlat({ kind: 'wear', x: wx, y: wy, rx, ry });
  }

  // 2. Signature central infield landmarks (huge 110..147 m clearance from all road sections).
  p.add({ kind: 'tower', x: -2, y: -58, w: 18, h: 14, roof: '#5a6466', label: 'ATC 27' });
  p.add({ kind: 'hangar', x: -58, y: 56, w: 34, h: 20, roof: '#697274', stripe: '#d95328', label: 'HGR 01' });
  p.add({ kind: 'hangar', x: 52, y: 56, w: 30, h: 18, roof: '#636c6e', stripe: '#e0b83a', label: 'HGR 02' });
  p.add({ kind: 'tank', x: 58, y: -56, r: 6.5, color: '#cfd1cb', stripe: '#d4482a' });
  p.add({ kind: 'tank', x: 78, y: -56, r: 6.5, color: '#cfd1cb', stripe: '#d4482a' });
  p.add({ kind: 'windsock', x: -58, y: -56, r: 1.3 });
  p.add({ kind: 'shed', x: -2, y: 66, w: 18, h: 9, roof: '#5f6869', label: 'OPS' });
  p.add({ kind: 'van', x: 24, y: -56, w: 5.2, h: 2.5, color: '#e6e1d1' });

  // 3. Corner readability: braking boards, outer apex chevrons & tyre walls along fast sweepers.
  p.addBrakingBoards(195, -1, [76, 54, 32]); // Approaching Turn 1 Fast Sweeper
  p.addBrakingBoards(795, -1, [76, 54, 32]); // Approaching Back Straight Sweeper
  for (const [s, sign] of [[245, 1], [415, -1], [525, 1], [860, 1], [1095, 1]]) {
    p.addChevronAt(s, sign, 36.5);
  }
  p.addOffsetLine('tyrewall', -36.5, 200, 325, 2.2, 6);
  p.addOffsetLine('tyrewall', -36.5, 480, 585, 2.2, 6);
  p.addOffsetLine('tyrewall', -36.5, 815, 935, 2.2, 6);
  p.addOffsetLine('tyrewall', -36.5, 1065, 1175, 2.2, 6);

  // Marshal posts near start/finish & back straight.
  const [mx, my] = pointAtS(track, 20, 26.8);
  p.add({ kind: 'marshal', x: mx, y: my, w: 3.4, h: 2.8 });
  const [mx2, my2] = pointAtS(track, 650, 26.8);
  p.add({ kind: 'marshal', x: mx2, y: my2, w: 3.4, h: 2.8 });

  // 4. Outside-the-fence airfield paddock & parked vintage aircraft (zero collision risk).
  const out = { outsideOnly: true };
  // North apron outside minY (-199)
  p.addFlat({ kind: 'paved', points: [[-180, b.minY - 58], [160, b.minY - 58], [160, b.minY - 6], [-180, b.minY - 6]] });
  p.add({ kind: 'hangar', x: -118, y: b.minY - 34, w: 42, h: 24, roof: '#616a6c', stripe: '#d95328', label: 'NORTH HGR' }, out);
  p.add({ kind: 'hangar', x: -58, y: b.minY - 34, w: 38, h: 22, roof: '#697274', stripe: '#e0b83a', label: 'MAINT' }, out);
  p.add({ kind: 'aircraft', x: 18, y: b.minY - 28, r: 9, angle: 0.35, color: '#d8d4c6', stripe: '#c94528' }, out);
  p.add({ kind: 'aircraft', x: 64, y: b.minY - 30, r: 9, angle: -0.25, color: '#bcc5c8', stripe: '#2e648a' }, out);
  p.add({ kind: 'grandstand', x: 122, y: b.minY - 26, w: 36, h: 14, roof: '#7c3426', rows: 5 }, out);
  p.add({ kind: 'truck', x: -158, y: b.minY - 22, w: 4.5, h: 11, color: '#d8c254' }, out);

  // South apron outside maxY (+199)
  p.addFlat({ kind: 'gravel', points: [[-140, b.maxY + 8], [140, b.maxY + 8], [140, b.maxY + 46], [-140, b.maxY + 46]] });
  p.add({ kind: 'hangar', x: -72, y: b.maxY + 28, w: 38, h: 20, roof: '#5e6668', stripe: '#d95328', label: 'CARGO 27' }, out);
  p.add({ kind: 'aircraft', x: 20, y: b.maxY + 28, r: 9, angle: Math.PI + 0.2, color: '#d4cfc0', stripe: '#c84528' }, out);
  p.add({ kind: 'tank', x: 84, y: b.maxY + 24, r: 7, color: '#c4c7c2', stripe: '#e0b83a' }, out);
  p.add({ kind: 'tank', x: 102, y: b.maxY + 24, r: 7, color: '#c4c7c2', stripe: '#e0b83a' }, out);

  // Perimeter scrub trees well outside the fence.
  p.scatterRounds(rand, 75, (r) => {
    const side = Math.floor(r() * 4);
    let x, y;
    if (side === 0) { x = b.minX - 18 - r() * 55; y = b.minY - 40 + r() * (b.maxY - b.minY + 80); }
    else if (side === 1) { x = b.maxX + 18 + r() * 55; y = b.minY - 40 + r() * (b.maxY - b.minY + 80); }
    else if (side === 2) { x = b.minX - 30 + r() * (b.maxX - b.minX + 60); y = b.minY - 64 - r() * 36; }
    else { x = b.minX - 30 + r() * (b.maxX - b.minX + 60); y = b.maxY + 52 + r() * 36; }
    return { kind: 'tree', x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, r: 4.2 + r() * 3.2, tone: Math.floor(r() * 3) };
  }, out);

  return {
    style: 'airfield',
    wall: 'chainlink',
    shoulder: 14.2,
    shoulderTheme: { ditch: '#3c4d34', base: '#7d8078', dark: '#676a63', light: '#95988f' },
    ground: {
      fill: '#4d6741',
      stripe: '#536f46',
      band: 26,
      outer: 'rgba(32,46,28,0.34)',
    },
    roadColors: {
      asphalt: '#33363b',
      line: '#f0ece0',
      dash: '#f2ba36',
      curbRed: '#df9d28',
      curbWhite: '#f0ece0',
    },
    gantry: {
      pillar: '#3b4244',
      bridge: '#262b2d',
      stripes: [['#e24e24', -0.85, 0.55], ['#f3efe2', -0.25, 0.55], ['#e24e24', 0.35, 0.5]],
    },
    props: p.props,
  };
}
