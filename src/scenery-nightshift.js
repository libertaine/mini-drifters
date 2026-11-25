// Nightshift Viaduct — Midnight Industrial Expressway scenery layout (205° Cloverleaf On-Ramp).
// Deep midnight slate-navy yard, player twin headlight cones, glowing warm sodium streetlamps at
// every braking zone & apex, concrete viaduct piers + pulsing red hazard beacons inside the
// cloverleaf interchange, rail freight tracks, illuminated warehouse bays and high-contrast road
// markings for razor-sharp night readability.
import { createPlacer, pointAtS } from './scenery-helpers.js';

export function buildNightshiftScenery(track, h) {
  const b = track.bounds;
  const p = createPlacer(track, h);
  const rand = h.seeded(23590042);

  // 1. Massive SE industrial rail freight yard (open pocket at 88..188, 71..121 with 83..130 m clearance).
  p.addFlat({
    kind: 'runway',
    fill: '#1b2029',
    border: '#2d3542',
    points: [[44, 48], [218, 48], [218, 138], [44, 138]],
  });
  p.addFlat({ kind: 'rail', points: [[46, 62], [216, 62]] });
  p.addFlat({ kind: 'rail', points: [[46, 74], [216, 74]] });
  p.addFlat({ kind: 'decal', x: 132, y: 92, text: 'VIADUCT 04', size: 8, color: 'rgba(255,194,76,0.22)' });

  // 2. Signature Cloverleaf Interchange Heart at (134, -50) — center of the 205° loop.
  p.add({ kind: 'pylon', x: 134, y: -50, w: 12, h: 12, color: '#3b434d' }, { clearance: 26.0, minGap: 8.0 });
  p.add({ kind: 'lamppost', x: 134, y: -50, r: 1.5, glow: 34 }, { clearance: 26.0, minGap: 8.0, allowTouch: true });

  // Central west infield expressway supports & industrial depot.
  p.add({ kind: 'pylon', x: -96, y: -24, w: 14, h: 10, color: '#3b434d' });
  p.add({ kind: 'pylon', x: -96, y: 24, w: 14, h: 10, color: '#3b434d' });
  p.add({ kind: 'hangar', x: 126, y: 112, w: 46, h: 20, roof: '#2d3540', stripe: '#f2b238', label: 'FREIGHT 04' });
  p.add({ kind: 'tank', x: 186, y: 108, r: 7, color: '#4c5663', stripe: '#f2b238' });
  p.add({ kind: 'tank', x: 76, y: 112, r: 6.5, color: '#4c5663', stripe: '#e05832' });
  p.add({ kind: 'shed', x: 174, y: 78, w: 18, h: 8, roof: '#343d48', label: 'DISPATCH' });

  // 3. Glowing Sodium Streetlamps illuminating every braking zone, apex and exit.
  const lampSpots = [
    [35, -26.5], [125, -26.5], [215, -26.5], [275, -26.5], [335, -26.5], [395, -26.5],
    [475, 26.5], [545, 26.5], [625, -26.5], [705, -26.5], [790, -26.5], [885, -26.5],
    [965, -26.5], [1030, -26.5],
  ];
  for (const [s, off] of lampSpots) {
    const [lx, ly] = pointAtS(track, s, off);
    p.add({ kind: 'lamppost', x: lx, y: ly, r: 1.15, glow: 26 }, { clearance: 25.0, minGap: 7.6 });
  }

  // Braking boards, chevrons & outer tyre barriers for unmistakable midnight corner cues.
  p.addBrakingBoards(222, -1, [76, 54, 32]); // Expressway Straight into 205° Cloverleaf
  p.addBrakingBoards(780, -1, [70, 48, 28]); // South Freight Straight into West Viaduct
  for (const [s, sign] of [[295, 1], [355, 1], [492, -1], [635, 1], [818, 1], [982, 1]]) {
    p.addChevronAt(s, sign);
  }
  p.addOffsetLine('tyrewall', -31.5, 235, 370, 2.2, 6); // Outer 205° Cloverleaf barrier
  p.addOffsetLine('tyrewall', 31.5, 465, 530, 2.2, 5);  // Outer Underpass Left barrier
  p.addOffsetLine('tyrewall', -31.5, 795, 860, 2.2, 5); // Outer SW Viaduct barrier
  p.addOffsetLine('tyrewall', -31.5, 955, 1020, 2.2, 5); // Outer NW Overpass barrier

  const [mx, my] = pointAtS(track, 24, 26.8);
  p.add({ kind: 'marshal', x: mx, y: my, w: 3.4, h: 2.8 });

  // 4. Outside-the-parapet midnight industrial skyline: warehouses, rail lines, floodlit yard.
  const out = { outsideOnly: true };
  // North industrial corridor outside minY (-149)
  p.addFlat({ kind: 'runway', fill: '#171c24', points: [[-220, b.minY - 56], [220, b.minY - 56], [220, b.minY - 6], [-220, b.minY - 6]] });
  p.addFlat({ kind: 'rail', points: [[-220, b.minY - 48], [220, b.minY - 48]] });
  p.add({ kind: 'hangar', x: -130, y: b.minY - 26, w: 48, h: 20, roof: '#28303b', stripe: '#f2b238', label: 'SECTOR N1' }, out);
  p.add({ kind: 'garage', x: -34, y: b.minY - 24, w: 58, h: 16, roof: '#2d3540', doors: 6 }, out);
  p.add({ kind: 'tower', x: 34, y: b.minY - 24, w: 18, h: 14, roof: '#252d38', label: 'CTRL' }, out);
  p.add({ kind: 'hangar', x: 112, y: b.minY - 26, w: 46, h: 20, roof: '#2a323e', stripe: '#48a468', label: 'EXIT 205' }, out);

  // South & West freight depots outside maxY / minX
  p.addFlat({ kind: 'runway', fill: '#171c24', points: [[-220, b.maxY + 6], [220, b.maxY + 6], [220, b.maxY + 52], [-220, b.maxY + 52]] });
  p.add({ kind: 'hangar', x: -112, y: b.maxY + 26, w: 44, h: 18, roof: '#29313d', stripe: '#f2b238', label: 'DOCK S2' }, out);
  p.add({ kind: 'hangar', x: 10, y: b.maxY + 26, w: 44, h: 18, roof: '#252d38', stripe: '#e05832', label: 'DEPOT S3' }, out);
  p.add({ kind: 'tank', x: 88, y: b.maxY + 26, r: 8, color: '#454e5a', stripe: '#f2b238' }, out);
  p.add({ kind: 'tank', x: 110, y: b.maxY + 26, r: 8, color: '#454e5a', stripe: '#f2b238' }, out);
  p.add({ kind: 'pylon', x: b.minX - 24, y: -42, w: 14, h: 14, color: '#343c47' }, out);
  p.add({ kind: 'pylon', x: b.minX - 24, y: 42, w: 14, h: 14, color: '#343c47' }, out);
  p.add({ kind: 'pylon', x: b.maxX + 24, y: -48, w: 14, h: 14, color: '#343c47' }, out);
  p.add({ kind: 'pylon', x: b.maxX + 24, y: 48, w: 14, h: 14, color: '#343c47' }, out);

  // Soft perimeter sodium lamps outside the parapet for depth.
  for (const [lx, ly] of [[-160, b.minY - 12], [0, b.minY - 12], [160, b.minY - 12], [-150, b.maxY + 12], [150, b.maxY + 12]]) {
    p.add({ kind: 'lamppost', x: lx, y: ly, r: 1.1, glow: 28 }, out);
  }
  // Sparse dark night conifers far outside the industrial yard.
  p.scatterRounds(rand, 28, (r) => ({
    kind: 'tree',
    x: Math.round((b.minX - 42 - r() * 40) * 10) / 10,
    y: Math.round((b.minY - 30 + r() * (b.maxY - b.minY + 60)) * 10) / 10,
    r: 4 + r() * 3,
    tone: Math.floor(r() * 3),
  }), out);

  return {
    style: 'nightshift',
    wall: 'viaduct',
    night: true,
    shoulder: 14.0,
    shoulderTheme: { ditch: '#0e1218', base: '#2c323c', dark: '#20252d', light: '#3c4452' },
    ground: {
      fill: '#141922',
      grid: 28,
      gridColor: 'rgba(130,152,184,0.06)',
      outer: 'rgba(6,8,12,0.52)',
    },
    roadColors: {
      asphalt: '#22262f',
      line: '#f2f5fa',
      dash: '#ffbe3b',
      curbRed: '#f0ab26',
      curbWhite: '#eef2f8',
    },
    gantry: {
      pillar: '#2d3540',
      bridge: '#1a242c',
      stripes: [['#2c8a56', -0.85, 0.72], ['#f6f2e4', -0.05, 0.28], ['#ffbe3b', 0.32, 0.52]],
    },
    beacons: [
      { x: 134, y: -50 },
      { x: 34, y: b.minY - 24 },
      { x: -96, y: -24 },
    ],
    props: p.props,
  };
}
