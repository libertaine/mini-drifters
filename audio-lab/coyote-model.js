// Tuning anchors, NOT measured recording RPM. See docs/COYOTE-AUDIO.md.
export const COYOTE_LAYERS = Object.freeze([
  { key: 'idle', rpm: 1100 }, { key: 'mid', rpm: 2700 },
  { key: 'load', rpm: 4400 }, { key: 'high', rpm: 6600 },
]);
export function mapCoyote({ rpm, throttle }) {
  const weights = COYOTE_LAYERS.map(() => 0);
  if (rpm <= COYOTE_LAYERS[0].rpm) weights[0] = 1;
  else if (rpm >= COYOTE_LAYERS.at(-1).rpm) weights[3] = 1;
  else {
    const hi = COYOTE_LAYERS.findIndex((l) => l.rpm >= rpm), lo = hi - 1;
    const x = Math.log(rpm / COYOTE_LAYERS[lo].rpm) / Math.log(COYOTE_LAYERS[hi].rpm / COYOTE_LAYERS[lo].rpm);
    const t = x * x * (3 - 2 * x); weights[lo] = 1 - t; weights[hi] = t;
  }
  return {
    coyoteWeights: weights,
    coyoteRates: COYOTE_LAYERS.map((l) => Math.max(0.65, Math.min(1.65, rpm / l.rpm))),
    coyoteGain: 0.38 + 0.30 * throttle,
    coyoteCutoff: 1300 + 2500 * (rpm - 750) / 6250 + 2600 * throttle,
    coyotePresence: -3 + 6 * throttle,
  };
}
