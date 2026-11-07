// The optional driving lesson. It watches a real session and decides when the player
// has really done each thing. It never writes to the game: the car, the scoring and the
// clock behave exactly as they do in a normal run. Contains no browser code.
import { TUNING as T } from './tuning.js';

export const TUTORIAL_STEPS = Object.freeze([
  { id: 'accelerate', title: 'FIRST, MAKE IT MOVE.', text: 'Hold ↑ to accelerate.' },
  { id: 'steer', title: 'NOW TRY THE WHEEL.', text: 'Use ← and → to steer. Try both directions.' },
  { id: 'slide', title: 'THE CAR PREFERS SIDEWAYS.', text: 'Steer into a corner. Tap SPACE to loosen the rear tyres.' },
  { id: 'countersteer', title: 'CATCH IT BEFORE IT CATCHES YOU.', text: 'Keep some throttle. Countersteer to control the slide.' },
  { id: 'bank', title: 'POINTS ARE ONLY YOURS WHEN BANKED.', text: 'Straighten up to bank your drift points.' },
]);

// What counts. Nothing here is a scoring threshold: a slide is whatever scoring calls one.
export const TUTORIAL_LIMITS = Object.freeze({
  movedMetres: 10,         // real progress along the road
  steerMinSpeed: 3,        // m/s forward, so turning the wheel at a standstill doesn't count
  steerMinInput: 0.2,      // of the smoothed wheel
  turnedRadians: 0.06,     // about 3.5 degrees of the car really turning that way
  counterMinInput: 0.3,    // of the smoothed wheel, against the slide
  counterSeconds: 0.2,     // of countersteering during one slide
  heldHandbrakeSeconds: 0.8,
  tapVerdictSeconds: 0.9,  // after a tap with no slide, it's counted as a miss
  idleSeconds: 3,          // without a slide before the player is reminded how to start one
  hintSeconds: 4,
  bankedSeconds: 1.6,      // the banked amount stays up this long before the lesson ends
  repeatedMisses: 2,       // the corrective hint waits until a mistake has happened this often
  stuckMisses: 4,          // ...and after this many, the prompt points out that steps can be skipped
});
const L = TUTORIAL_LIMITS;

// Scoring accepts a slide from 23 mph, but a tap only reliably starts one from about here,
// so this is the speed worth asking for. It's advice and not a threshold.
const SLIDE_SPEED = { metres: 16, mph: 40 };
// A tap shorter than this unsettles the car without starting a slide, at any speed.
const SHORT_TAP_SECONDS = 0.14;

export function createTutorial() {
  return {
    step: 0,
    phase: 'driving',   // driving, then banked for a moment, then complete
    skipped: [],
    bankedPoints: 0,
    hint: '',
    hintAge: 0,
    misses: 0,
    turnedLeft: 0,
    turnedRight: 0,
    counterTime: 0,
    idleTime: 0,
    phaseTime: 0,
    tap: null,           // the handbrake tap being judged
    bankCountdown: false,
    wasHandbrake: false,
    wasDrifting: false,
    seenRunId: null,
    seenTicks: 0,
    seenEventSerial: 0,
    seenSpinouts: 0,
  };
}

// True when the wheel is turned toward the slide. Slip is positive when the car is moving
// to the right of its nose, and steer is positive to the right, so the two share a sign:
// the same test physics.js uses to give countersteering its extra lock.
export function isCountersteering(car, minInput = L.counterMinInput) {
  return Math.abs(car.steer) >= minInput && car.steer * car.slipAngle > 0;
}

function setHint(t, text) {
  t.hint = text;
  t.hintAge = 0;
}

function nextStep(t) {
  t.step += 1;
  t.hint = '';
  t.hintAge = 0;
  t.misses = 0;
  t.counterTime = 0;
  t.idleTime = 0;
  t.tap = null;
  if (t.step >= TUTORIAL_STEPS.length) {
    t.phase = 'complete';
    t.step = TUTORIAL_STEPS.length - 1;
  }
}

// Moves on without the player having done the step. The ending says so.
export function skipStep(t) {
  if (t.phase !== 'driving') return;
  t.skipped.push(TUTORIAL_STEPS[t.step].id);
  nextStep(t);
}

// Why a slide isn't counting, in scoring's own words.
const whyNoSlide = {
  'too slow': `A bit more speed first. Try about ${SLIDE_SPEED.mph} mph.`,
  'off road': "Slides on the grass don't count. Get back on the road.",
  'no progress': 'Keep moving along the road. A slide has to get somewhere.',
  'repeat ground': "Only new road counts. Keep going past where you've already been.",
};

function explainIgnoredSlide(t, game) {
  const { car, scoring } = game;
  if (Math.abs(car.slipAngle) >= T.driftMinSlip || car.handbrake) {
    const why = whyNoSlide[scoring.qualification];
    if (why) setHint(t, why);
  }
}

function watchTap(t, game, dt) {
  const { car, scoring } = game;
  if (car.handbrake && !t.wasHandbrake) {
    t.tap = { speed: car.speed, steer: Math.abs(car.steer), held: 0, age: 0 };
  }
  if (!t.tap) return;
  t.tap.steer = Math.max(t.tap.steer, Math.abs(car.steer));
  if (car.handbrake) {
    t.tap.held += dt;
    if (scoring.handbrakeTime > L.heldHandbrakeSeconds) setHint(t, 'Just a tap. Hold SPACE too long and the car spins.');
    return;
  }
  t.tap.age += dt;
  if (t.tap.age < L.tapVerdictSeconds) return;
  t.misses += 1;
  // The very quick tap is the one mistake nobody could guess, so it's explained straight away.
  const tooShort = t.tap.held < SHORT_TAP_SECONDS && t.tap.speed >= SLIDE_SPEED.metres && t.tap.steer >= 0.5;
  if (tooShort) setHint(t, 'Hold SPACE a little longer: about a quarter of a second.');
  else if (t.misses >= L.repeatedMisses) {
    if (t.tap.speed < SLIDE_SPEED.metres) setHint(t, whyNoSlide['too slow']);
    else if (t.tap.steer < 0.5) setHint(t, 'Turn the wheel first, then tap SPACE while it is turned.');
    else setHint(t, 'Hold SPACE a little longer: about a quarter of a second.');
  }
  t.tap = null;
}

function updateSteer(t, car, dt) {
  if (car.forwardSpeed >= L.steerMinSpeed) {
    if (car.steer >= L.steerMinInput && car.yawRate > 0) t.turnedRight += car.yawRate * dt;
    if (car.steer <= -L.steerMinInput && car.yawRate < 0) t.turnedLeft -= car.yawRate * dt;
  }
  if (t.turnedLeft >= L.turnedRadians && t.turnedRight >= L.turnedRadians) nextStep(t);
  else if (t.turnedRight >= L.turnedRadians) setHint(t, 'Good. Now the other way: ←.');
  else if (t.turnedLeft >= L.turnedRadians) setHint(t, 'Good. Now the other way: →.');
}

function updateSlide(t, game, dt) {
  if (game.scoring.drifting) {
    nextStep(t);
    return;
  }
  watchTap(t, game, dt);
  explainIgnoredSlide(t, game);
}

function updateCountersteer(t, game, dt, spun) {
  const { car, scoring } = game;
  if (spun) {
    t.counterTime = 0;
    setHint(t, 'Spun it. Next time, steer toward the slide sooner.');
  }
  if (scoring.drifting && !scoring.spunOut) {
    t.idleTime = 0;
    if (isCountersteering(car)) t.counterTime += dt;
    if (t.counterTime >= L.counterSeconds) {
      nextStep(t);
      return;
    }
  } else {
    t.idleTime += dt;
    if (t.wasDrifting) {
      // The slide ended without being caught.
      t.counterTime = 0;
      t.misses += 1;
      if (t.misses >= L.repeatedMisses) setHint(t, 'As the tail swings out, steer the same way the tail is going.');
    }
    if (t.idleTime >= L.idleSeconds && !t.hint) setHint(t, 'Start another slide: steer, then tap SPACE.');
    explainIgnoredSlide(t, game);
  }
}

function updateBank(t, game, dt, newEvent) {
  const { scoring } = game;
  if (newEvent?.type === 'banked' && newEvent.reason === 'banked' && newEvent.points > 0) {
    t.bankedPoints = newEvent.points;
    t.phase = 'banked';
    t.phaseTime = 0;
    t.hint = '';
    return;
  }
  if (newEvent?.type === 'lost') {
    t.misses += 1;
    setHint(t, `Lost ${newEvent.points}: ${newEvent.reason}. Slide again, then keep it clean.`);
    return;
  }
  if (scoring.combo || scoring.drifting) t.idleTime = 0;
  else t.idleTime += dt;
  if (t.hint && !t.bankCountdown) return;
  t.bankCountdown = !!scoring.combo && !scoring.drifting;
  if (t.bankCountdown) setHint(t, `Keep it clean for ${T.comboGrace} seconds and the points are yours.`);
  else t.hint = '';
  if (!scoring.combo && !scoring.drifting) {
    if (t.idleTime >= L.idleSeconds) setHint(t, 'Nothing to bank yet. Slide again, then straighten up.');
    explainIgnoredSlide(t, game);
  }
}

// Call after the session has advanced. Time only counts when the simulation really ran,
// so pausing or losing focus stops the lesson as well.
export function updateTutorial(t, game) {
  if (t.phase === 'complete' || game.state === 'menu') return t;
  const { car, scoring } = game;

  // A restart or a fresh run keeps the step the player reached, but no half-finished slide.
  if (t.seenRunId !== game.runId) {
    t.seenRunId = game.runId;
    t.seenTicks = game.ticks;
    t.seenEventSerial = scoring.eventSerial;
    t.seenSpinouts = scoring.spinouts;
    t.counterTime = 0;
    t.tap = null;
    t.wasDrifting = false;
    t.wasHandbrake = false;
    if (t.phase === 'banked') t.phase = 'complete';
  }
  const dt = (game.ticks - t.seenTicks) * T.simStep;
  t.seenTicks = game.ticks;
  if (dt <= 0) return t;

  const newEvent = scoring.eventSerial !== t.seenEventSerial ? scoring.event : null;
  t.seenEventSerial = scoring.eventSerial;
  const spun = scoring.spinouts > t.seenSpinouts;
  t.seenSpinouts = scoring.spinouts;

  if (t.phase === 'banked') {
    t.phaseTime += dt;
    // Never ends the lesson while the player is in the middle of another slide.
    if (t.phaseTime >= L.bankedSeconds && !scoring.drifting) t.phase = 'complete';
    return t;
  }

  t.hintAge += dt;
  if (t.hint && t.hintAge >= L.hintSeconds) t.hint = '';

  const { id } = TUTORIAL_STEPS[t.step];
  if (id === 'accelerate') {
    if (game.progress >= L.movedMetres && car.forwardSpeed > 0) nextStep(t);
  } else if (id === 'steer') {
    updateSteer(t, car, dt);
  } else if (id === 'slide') {
    updateSlide(t, game, dt);
  } else if (id === 'countersteer') {
    updateCountersteer(t, game, dt, spun);
  } else {
    updateBank(t, game, dt, newEvent);
  }

  // finishRun has ended this run. The caller puts the car back on the grid for another.
  if (game.state === 'finished') setHint(t, 'Three laps done. Back to the grid, and the lesson carries on.');
  // Steps stay on the screen after a restart, so say what the grid is waiting for.
  if (game.state === 'ready' && t.step > 0 && !t.hint) t.hint = 'Hold ↑ to get rolling.';
  if (game.wrongWayTime > 1.2) setHint(t, 'Wrong way. Turn around: only new road counts.');

  t.wasHandbrake = car.handbrake;
  t.wasDrifting = scoring.drifting;
  return t;
}

// What the prompt shows.
export function tutorialView(t) {
  const step = TUTORIAL_STEPS[t.step];
  if (t.phase === 'banked') {
    return { number: t.step + 1, total: TUTORIAL_STEPS.length, title: `+${t.bankedPoints.toLocaleString('en-US')} BANKED.`, text: "That's yours now.", hint: '', stuck: false };
  }
  return { number: t.step + 1, total: TUTORIAL_STEPS.length, title: step.title, text: step.text, hint: t.hint, stuck: t.misses >= L.stuckMisses };
}

// The ending stays honest about anything that was skipped.
export function tutorialEnding(t) {
  if (t.skipped.length === 0) {
    return {
      qualified: true,
      title: 'YOU ARE NOW QUALIFIED TO BE DANGEROUS.',
      text: 'The tyres have requested a transfer.',
      banked: t.bankedPoints,
    };
  }
  const count = t.skipped.length;
  return {
    qualified: false,
    title: 'THAT WILL DO FOR NOW.',
    text: `You skipped ${count === 1 ? 'a step' : `${count} steps`}. Practice Again whenever you like.`,
    banked: t.bankedPoints,
  };
}
