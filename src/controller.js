// Native standard mapping only. No DOM, timers, hardware IDs or simulation state.
export const STICK_DEAD_ZONE = 0.15;
export const TRIGGER_DEAD_ZONE = 0.05;
export const BUTTONS = Object.freeze({ confirm: 0, back: 1, ghost: 2, radio: 3, pause: 9, up: 12, down: 13, left: 14, right: 15 });
export const NEUTRAL_DRIVE = Object.freeze({ steer: 0, accelerator: 0, brake: 0, handbrake: false });

const clamp = (v, lo, hi) => Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0;
const buttonDown = (b) => b?.pressed === true || clamp(b?.value, 0, 1) > 0.5;
const trigger = (b) => {
  const value = clamp(b?.value, 0, 1);
  return value <= TRIGGER_DEAD_ZONE ? 0 : value;
};

export function readStandardPad(pad) {
  if (!pad?.connected || pad.mapping !== 'standard' || pad.axes?.length < 4 || pad.buttons?.length < 17
    || !pad.axes || !pad.buttons) return null;
  const x = clamp(pad.axes[0], -1, 1);
  const steer = Math.abs(x) <= STICK_DEAD_ZONE ? 0
    : Math.sign(x) * (Math.abs(x) - STICK_DEAD_ZONE) / (1 - STICK_DEAD_ZONE);
  const buttons = Object.fromEntries(Object.entries(BUTTONS).map(([name, i]) => [name, buttonDown(pad.buttons[i])]));
  return { drive: { steer, accelerator: trigger(pad.buttons[7]), brake: trigger(pad.buttons[6]), handbrake: buttons.confirm }, buttons };
}

const neutral = (snapshot) => !Object.values(snapshot.buttons).some(Boolean)
  && !snapshot.drive.steer && !snapshot.drive.accelerator && !snapshot.drive.brake;

export class Controller {
  constructor(getGamepads) {
    this.getGamepads = getGamepads;
    this.current = null;
    this.previous = {};
    this.gated = true;
  }

  reset() {
    this.gated = true;
    this.previous = {};
  }

  disconnect(index) {
    if (this.current?.index !== index) return false;
    this.current = null;
    this.reset();
    return true;
  }

  poll() {
    let pads = [];
    let unavailable = false;
    try {
      if (typeof this.getGamepads !== 'function') unavailable = true;
      else pads = Array.from(this.getGamepads() ?? []);
    } catch { unavailable = true; } // permissions policy, browser or device failure
    const result = { drive: NEUTRAL_DRIVE, pressed: {}, connected: false, lost: false,
      unavailable, unsupported: pads.some((p) => p?.connected && !readStandardPad(p)) };
    if (this.current) {
      const pad = pads.find((p) => p?.index === this.current.index && p.id === this.current.id && readStandardPad(p));
      if (!pad) {
        this.disconnect(this.current.index);
        result.lost = true;
        return result;
      }
    } else {
      const pad = pads.find((p) => readStandardPad(p));
      if (pad) {
        this.current = { index: pad.index, id: pad.id };
        this.reset(); // even a pad connected with controls held must first be released
      }
    }
    if (!this.current) return result;
    result.connected = true;
    const snapshot = readStandardPad(pads.find((p) => p?.index === this.current.index));
    if (this.gated) {
      if (neutral(snapshot)) this.gated = false;
      this.previous = snapshot.buttons;
      return result;
    }
    result.drive = snapshot.drive;
    result.pressed = Object.fromEntries(Object.entries(snapshot.buttons).map(([key, down]) => [key, down && !this.previous[key]]));
    this.previous = snapshot.buttons;
    return result;
  }
}
