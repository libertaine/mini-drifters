// Redline Mesa — Desert Proving Ground scenery layout (three wide opposing drift hairpins + canyon rim).
// Baked terracotta/sandstone elevation terrain with contour lines, dry arroyo wash, red-rock mesa
// outcrops, proving-ground observation bunker, desert cacti, and crisp chevron/tyrewall cues on
// every hairpin.
import { createPlacer, makeOutcropPoly, pointAtS } from './scenery-helpers.js';

const MESA_ROCK = ['#7c4128', '#b5613b', '#d48256', '#8d4c30'];

export function buildMesaScenery(track, h) {
  const b = track.bounds;
  const p = createPlacer(track, h);
  const rand = h.seeded(19840711);

  // 1. Dry sandy arroyo wash winding through the open central mesa basin (flat).
  p.addFlat({
    kind: 'wash',
    width: 11,
    points: [[-95, -52], [-64, -18], [-42, 16], [-18, 48], [10, 74]],
  });
  p.addFlat({ kind: 'wear', x: -50, y: 10, rx: 18, ry: 11 });
  p.addFlat({ kind: 'wear', x: -72, y: -36, rx: 12, ry: 7 });

  // 2. Central mesa landmarks (open pocket around -48, 10 with 84 m clearance!).
  p.add({ kind: 'bunker', x: -54, y: 12, w: 22, h: 13, roof: '#bfa180', label: 'TEST OPS' });
  p.add({ kind: 'tower', x: -54, y: -22, w: 14, h: 12, roof: '#8c694c', label: 'MESA 01' });
  p.add({ kind: 'tank', x: -24, y: 42, r: 5.5, color: '#d8cbb4', stripe: '#b84226' });
  p.add({ kind: 'outcrop', points: makeOutcropPoly(-82, 34, 13, 9, 41), palette: MESA_ROCK });
  p.add({ kind: 'outcrop', points: makeOutcropPoly(-20, -44, 10, 7.5, 53), palette: MESA_ROCK });
  p.add({ kind: 'outcrop', points: makeOutcropPoly(-164, -126, 16, 12, 67), palette: MESA_ROCK });
  p.add({ kind: 'truck', x: -82, y: -10, w: 4.2, h: 9.5, color: '#d9c598' });

  // 3. Corner readability: braking boards & outer chevrons + tyre walls framing all 3 wide hairpins.
  p.addBrakingBoards(152, -1, [74, 52, 30]); // Braking from Test Straight into Hairpin 1
  p.addBrakingBoards(730, -1, [74, 52, 30]); // Braking from South Mesa Straight into SW Sweeper
  for (const [s, sign] of [[188, 1], [346, -1], [488, 1], [768, 1], [982, 1]]) {
    p.addChevronAt(s, sign);
  }
  p.addOffsetLine('tyrewall', -31.5, 155, 240, 2.2, 5); // Outside Hairpin 1
  p.addOffsetLine('tyrewall', 31.5, 315, 385, 2.2, 5);  // Outside Hairpin 2 (left turn)
  p.addOffsetLine('tyrewall', -31.5, 455, 525, 2.2, 5); // Outside Hairpin 3
  p.addOffsetLine('tyrewall', -31.5, 735, 815, 2.2, 5); // Outside SW Sweeper
  p.addOffsetLine('tyrewall', -31.5, 955, 1020, 2.2, 5); // Outside Final Mesa Turn

  const [mx, my] = pointAtS(track, 24, 26.8);
  p.add({ kind: 'marshal', x: mx, y: my, w: 3.4, h: 2.8 });

  // Scattered desert boulders & saguaro cacti safely inside open infield pockets.
  p.scatterRounds(rand, 28, (r) => ({
    kind: r() < 0.55 ? 'rock' : 'cactus',
    x: Math.round((b.minX + 26 + r() * (b.maxX - b.minX - 52)) * 10) / 10,
    y: Math.round((b.minY + 26 + r() * (b.maxY - b.minY - 52)) * 10) / 10,
    r: 2.2 + r() * 2.4,
    palette: MESA_ROCK,
    seed: Math.floor(r() * 10000),
  }), { clearance: 26.5, minGap: 8.2 });

  // 4. Dramatic outside-the-wall canyon rim buttes, proving ground paddock & desert flora.
  const out = { outsideOnly: true };
  // North proving-ground service yard outside minY (-160)
  p.addFlat({ kind: 'gravel', points: [[-110, b.minY - 46], [115, b.minY - 46], [115, b.minY - 6], [-110, b.minY - 6]] });
  p.add({ kind: 'garage', x: -10, y: b.minY - 26, w: 54, h: 16, roof: '#8f6b4e', doors: 5 }, out);
  p.add({ kind: 'bunker', x: 64, y: b.minY - 24, w: 22, h: 13, roof: '#bfa180', label: 'TELEMETRY' }, out);
  p.add({ kind: 'trailer', x: -72, y: b.minY - 22, w: 4.5, h: 13, color: '#e6decb' }, out);
  p.add({ kind: 'van', x: -58, y: b.minY - 24, w: 3.2, h: 6.2, color: '#c84b2c' }, out);

  // Towering red-rock canyon buttes around east, south, and west rims.
  const buttes = [
    [b.maxX + 34, -95, 22, 16], [b.maxX + 40, -10, 24, 18], [b.maxX + 36, 86, 20, 16],
    [b.minX - 36, -80, 22, 18], [b.minX - 38, 12, 24, 16], [b.minX - 34, 102, 20, 15],
    [-110, b.maxY + 32, 24, 14], [10, b.maxY + 34, 28, 15], [122, b.maxY + 30, 22, 14],
  ];
  buttes.forEach(([bx, by, rx, ry], idx) => {
    p.add({ kind: 'outcrop', points: makeOutcropPoly(bx, by, rx, ry, 200 + idx * 17, 9), palette: MESA_ROCK }, out);
  });

  // Outer cacti and scrub clusters.
  p.scatterRounds(rand, 64, (r) => {
    const side = Math.floor(r() * 4);
    let x, y;
    if (side === 0) { x = b.minX - 14 - r() * 58; y = b.minY - 30 + r() * (b.maxY - b.minY + 60); }
    else if (side === 1) { x = b.maxX + 14 + r() * 58; y = b.minY - 30 + r() * (b.maxY - b.minY + 60); }
    else if (side === 2) { x = b.minX - 20 + r() * (b.maxX - b.minX + 40); y = b.minY - 52 - r() * 34; }
    else { x = b.minX - 20 + r() * (b.maxX - b.minX + 40); y = b.maxY + 14 + r() * 52; }
    return {
      kind: r() < 0.5 ? 'cactus' : 'rock',
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      r: 2.0 + r() * 2.8,
      palette: MESA_ROCK,
      seed: Math.floor(r() * 10000),
    };
  }, out);

  return {
    style: 'mesa',
    wall: 'jersey',
    shoulder: 14.5,
    shoulderTheme: { ditch: '#8c5534', base: '#cfa074', dark: '#b38156', light: '#e2ba91' },
    elevation: {
      origin: [-140, 120],
      dir: [0.68, -0.73],
      grade: 0.048,
      interval: 4.5,
      palette: [[0, [172, 110, 68]], [0.46, [194, 132, 84]], [1, [212, 158, 108]]],
      contour: 'rgba(112,56,28,0.16)',
      contourIndex: 'rgba(104,48,22,0.28)',
      bumps: [
        [-54, 12, 6, 48],
        [155, -80, 9, 55],
        [-160, -125, 11, 52],
        [120, 115, 7, 46],
      ],
      waves: [[1.6, 0.014, 0.011, 0.4]],
    },
    ground: {
      fallback: '#b07246',
      outer: 'rgba(84,38,16,0.28)',
    },
    roadColors: {
      asphalt: '#2e2d31',
      line: '#f7f0de',
      dash: '#f7bd38',
      curbRed: '#c84228',
      curbWhite: '#f4ead2',
    },
    gantry: {
      pillar: '#785038',
      bridge: '#362a24',
      stripes: [['#c84228', -0.85, 0.62], ['#f5bd38', -0.15, 0.45], ['#f4ead2', 0.38, 0.42]],
    },
    props: p.props,
  };
}
