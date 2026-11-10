// One command shape for the existing vehicle model. Numeric fields take precedence;
// absent fields retain the original keyboard targets and smoothing exactly.
const bounded = (value, min, max) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : 0;

export function drivingCommands(input) {
  return {
    steer: input.steer === undefined ? (input.right ? 1 : 0) - (input.left ? 1 : 0) : bounded(input.steer, -1, 1),
    accelerator: input.accelerator === undefined ? (input.up ? 1 : 0) : bounded(input.accelerator, 0, 1),
    brake: input.brake === undefined ? (input.down ? 1 : 0) : bounded(input.brake, 0, 1),
    handbrake: !!input.handbrake,
  };
}

export function drivingActive(input) {
  const c = drivingCommands(input);
  return c.steer !== 0 || c.accelerator > 0 || c.brake > 0 || c.handbrake;
}

// Driving keys always win while held. After keyboard use, the pad must be neutral
// before it can take over; releasing a key cannot expose a previously held pedal.
export class InputArbiter {
  source = 'keyboard';
  blocked = true;

  reset() {
    this.source = 'keyboard';
    this.blocked = true;
  }

  resolve(keyboard, controller) {
    if (!drivingActive(controller)) this.blocked = false;
    if (drivingActive(keyboard)) {
      this.source = 'keyboard';
      this.blocked = true;
      return keyboard;
    }
    if (!this.blocked && drivingActive(controller)) this.source = 'controller';
    return this.source === 'controller' && !this.blocked ? controller : keyboard;
  }
}
