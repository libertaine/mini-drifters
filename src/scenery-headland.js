// Headland Run — Seaside Coastal Cliff scenery layout (3-sector asymmetric + 180° Opening-Radius
// Lighthouse Carousel). Emerald coastal turf dropping into shimmering animated turquoise ocean with
// surf foam along the south, east and west headlands, an iconic red-and-white Lighthouse sweeping
// its warm beam right across the signature Carousel, sheltered sandy coves, wooden marina piers,
// moored boats, granite sea cliffs and maritime blue-and-white curbs.
import { createPlacer, makeOutcropPoly, pointAtS } from './scenery-helpers.js';

const CLIFF_ROCK = ['#4c5358', '#7d8488', '#a0a7aa', '#5b6267'];

export function buildHeadlandScenery(track, h) {
  const b = track.bounds;
  const p = createPlacer(track, h);
  const rand = h.seeded(88022026);

  // 1. Sheltered sandy beach strips hugging the southern seawall & eastern cove (flat).
  p.addFlat({
    kind: 'sand',
    points: [[110, b.maxY - 26], [248, b.maxY - 26], [254, b.maxY - 2], [102, b.maxY - 2]],
  });
  p.addFlat({
    kind: 'sand',
    points: [[b.maxX - 24, -148], [b.maxX - 2, -148], [b.maxX - 2, -26], [b.maxX - 24, -26]],
  });
  p.addFlat({ kind: 'meadow', points: [[-100, -68], [32, -68], [32, 16], [-100, 16]] });
  p.addFlat({ kind: 'path', width: 2.6, points: [[-172, 85], [-125, 10], [-65, -24], [12, -24]] });

  // 2. Signature landmark: red-and-white Lighthouse dead-center of the 180° Carousel.
  // Verified distance from (-175, 86) to Carousel centerline is 35..41 m on every side.
  p.add({ kind: 'lighthouse', x: -175, y: 86, r: 5.8 }, { clearance: 26.0, minGap: 8.0 });

  // Central headland green landmarks (open pocket around -41, -29 with 91 m clearance).
  p.add({ kind: 'cabin', x: -46, y: -30, w: 16, h: 11, roof: '#345875', label: 'COAST GUARD' });
  p.add({ kind: 'gazebo', x: -14, y: -28, w: 8, h: 8, color: '#2b5e8f' });
  p.add({ kind: 'outcrop', points: makeOutcropPoly(-86, -24, 11, 8, 91), palette: CLIFF_ROCK });
  p.add({ kind: 'outcrop', points: makeOutcropPoly(24, -26, 12, 8.5, 97), palette: CLIFF_ROCK });

  // Open NE & SE headland bluff outcrops (94..130 m pockets).
  p.add({ kind: 'outcrop', points: makeOutcropPoly(216, -124, 18, 14, 103), palette: CLIFF_ROCK });
  p.add({ kind: 'outcrop', points: makeOutcropPoly(222, 134, 16, 12, 109), palette: CLIFF_ROCK });
  p.add({ kind: 'outcrop', points: makeOutcropPoly(-234, -138, 15, 11, 113), palette: CLIFF_ROCK });
  p.add({ kind: 'cabin', x: 214, y: -76, w: 15, h: 10, roof: '#8f3f2f', label: 'HARBOUR' });

  // 3. Corner readability: braking boards, coastal chevrons & tyre walls.
  p.addBrakingBoards(142, -1, [74, 52, 30]); // Waterfront Promenade into Fast Cliff Sweeper
  p.addBrakingBoards(705, 1, [74, 52, 30]);  // South Bay Straight into Headland Flick & Carousel
  for (const [s, sign, off] of [[180, 1, 34], [278, -1, 31.2], [372, 1, 31.2], [750, -1, 34], [835, 1, 34], [1088, 1, 36.5]]) {
    p.addChevronAt(s, sign, off);
  }
  p.addOffsetLine('tyrewall', -31.5, 145, 220, 2.2, 5); // Fast Cliff Sweeper outer
  p.addOffsetLine('tyrewall', 31.5, 260, 305, 2.2, 5);  // Cove Left outer
  p.addOffsetLine('tyrewall', -31.5, 345, 420, 2.2, 5); // Marina Cove U-turn outer
  p.addOffsetLine('tyrewall', -31.5, 795, 895, 2.2, 5); // Lighthouse Carousel outer

  const [mx, my] = pointAtS(track, 20, 26.8);
  p.add({ kind: 'marshal', x: mx, y: my, w: 3.4, h: 2.8 });

  // Coastal pines & granite rocks safely inside open headland bluffs.
  p.scatterRounds(rand, 32, (r) => ({
    kind: r() < 0.68 ? 'pine' : 'rock',
    x: Math.round((b.minX + 26 + r() * (b.maxX - b.minX - 52)) * 10) / 10,
    y: Math.round((b.minY + 26 + r() * (b.maxY - b.minY - 52)) * 10) / 10,
    r: 3.2 + r() * 2.6,
    tone: Math.floor(r() * 3),
    palette: CLIFF_ROCK,
    seed: Math.floor(r() * 10000),
  }), { clearance: 27.0, minGap: 8.5 });

  // 4. Outside-the-seawall waterfront village (north) & wooden piers + boats in the ocean (S/E/W).
  const out = { outsideOnly: true };
  // North coastal town & boardwalk outside minY (-174)
  p.addFlat({ kind: 'paved', points: [[-155, b.minY - 46], [155, b.minY - 46], [155, b.minY - 6], [-155, b.minY - 6]] });
  p.add({ kind: 'grandstand', x: -12, y: b.minY - 24, w: 46, h: 14, roof: '#24527a', rows: 5 }, out);
  p.add({ kind: 'building', x: -86, y: b.minY - 24, w: 26, h: 14, roof: '#b84b36', label: 'YACHT CLUB' }, out);
  p.add({ kind: 'building', x: 64, y: b.minY - 24, w: 24, h: 14, roof: '#34648c', label: 'MARINA' }, out);
  p.add({ kind: 'cabin', x: 108, y: b.minY - 24, w: 16, h: 11, roof: '#8f4b32' }, out);
  p.add({ kind: 'car', x: -124, y: b.minY - 22, w: 2.3, h: 4.8, color: '#e8e2d0' }, out);
  p.add({ kind: 'car', x: -132, y: b.minY - 22, w: 2.3, h: 4.8, color: '#2b5e8f' }, out);

  // Wooden marina piers & moored boats floating in the south & east ocean.
  p.addFlat({ kind: 'pier', x: 148, y: b.maxY + 26, w: 8, h: 44 });
  p.addFlat({ kind: 'pier', x: 148, y: b.maxY + 46, w: 42, h: 6 });
  p.addFlat({ kind: 'pier', x: -64, y: b.maxY + 22, w: 7, h: 36 });
  p.addFlat({ kind: 'pier', x: b.maxX + 22, y: 26, w: 38, h: 7 });
  for (const [bx, by, len, beam, angle, color, cabin] of [
    [132, b.maxY + 26, 11, 3.8, -Math.PI / 2, '#f5f2e8', '#255882'],
    [164, b.maxY + 28, 12, 4.0, -Math.PI / 2, '#f2eee4', '#b83c2c'],
    [186, b.maxY + 52, 13, 4.2, 0.3, '#f7f4ec', '#2c6878'],
    [-46, b.maxY + 24, 10, 3.5, -Math.PI / 2, '#f4f0e4', '#34648c'],
    [-190, b.maxY + 34, 14, 4.4, -0.4, '#f5f1e6', '#c24632'],
    [b.maxX + 26, 46, 12, 4.0, 0.1, '#f4f1e6', '#255882'],
    [b.minX - 28, 92, 13, 4.2, -0.5, '#f2efe6', '#2c6878'],
  ]) {
    p.addFlat({ kind: 'boat', x: bx, y: by, len, beam, angle, color, cabin });
  }

  // Coastal pine grove north of the village.
  p.scatterRounds(rand, 42, (r) => ({
    kind: 'pine',
    x: Math.round((b.minX - 10 + r() * (b.maxX - b.minX + 20)) * 10) / 10,
    y: Math.round((b.minY - 52 - r() * 44) * 10) / 10,
    r: 3.8 + r() * 3.2,
    tone: Math.floor(r() * 3),
  }), out);

  return {
    style: 'headland',
    wall: 'seawall',
    shoulder: 14.0,
    shoulderTheme: { ditch: '#265840', base: '#bfb598', dark: '#9e9478', light: '#d6ccb0' },
    ground: {
      fill: '#398350',
      stripe: '#3f8d57',
      band: 24,
      outer: 'rgba(18,52,36,0.28)',
      ocean: { south: true, west: true, east: true, deep: '#16556c', shallow: '#268098' },
    },
    roadColors: {
      asphalt: '#2c3138',
      line: '#f7f5ee',
      dash: '#ffd147',
      curbRed: '#2265a6',
      curbWhite: '#f7f5ee',
    },
    gantry: {
      pillar: '#234463',
      bridge: '#1e2c3a',
      stripes: [['#2265a6', -0.85, 0.55], ['#f7f5ee', -0.25, 0.55], ['#cc362b', 0.35, 0.5]],
    },
    props: p.props,
  };
}
