// The page side of Gymkhana: the sheet where a challenge is chosen, the HUD panel while one is
// driven, and the sheet that shows how the run went. It fills elements that index.html already
// holds; main.js decides when each is showing and owns every key and button.
import { GYMKHANA_CHALLENGES } from './gymkhana.js';
import {
  MEDALS, MEDAL_NAMES, formatMedalTime, formatMedalValue, medalFor, medalRank,
  medalTargets, missedTargetBy, needsMillisecondDisplay, nextMedal,
} from './medals.js';
import { cueForGame, cueText, turnBearing } from './getaway-nav.js';
import { getawayMedal } from './getaway-records.js';
import { isDriver, updateDriverMeter, updateDriverHud, driverNavText, driverNavGoal, driverBanner, showDriverResults, showDriverMenu, driverNote } from './getaway-driver-ui.js';

const MPH_PER_MS = 2.23694;
const DEG = 180 / Math.PI;
const $ = (id) => document.getElementById(id);

const formatClock = (seconds) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
const formatNumber = (n) => Math.round(n).toLocaleString('en-US');
const mph = (ms) => `${Math.round(ms * MPH_PER_MS)} mph`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

// Getaway bests are kept by getaway-records.js and each environment supplies its own medal targets.
const isGetaway = (def) => def?.layout === 'urban';
const chaseTargets = (def, handlingId) => def.medalTargets?.[handlingId] ?? null;
const chaseMedal = getawayMedal;
const medalOf = (def, handlingId, value) => (isGetaway(def) ? chaseMedal(def, handlingId, value) : medalFor(def, handlingId, value));
const targetsOf = (def, handlingId) => (isGetaway(def) ? chaseTargets(def, handlingId) : medalTargets(def, handlingId));
function nextOf(def, handlingId, value) {
  if (!isGetaway(def)) return nextMedal(def, handlingId, value);
  const targets = chaseTargets(def, handlingId);
  if (!targets) return null;
  const rank = medalRank(chaseMedal(def, handlingId, value));
  const medal = [...MEDALS].reverse().find((m) => medalRank(m) > rank);
  return medal ? { medal, target: targets[medal] } : null;
}
const formatValue = (def, handlingId, value) => (isGetaway(def) ? (value === null || value === undefined ? '--' : formatNumber(value)) : formatMedalValue(def, handlingId, value));

// --- Medals (medals.js decides them; this only shows them) ------------------------------------
// A medal is shown as a disc carrying its initial beside its name, so it never rests on colour.
const INITIAL = { gold: 'G', silver: 'S', bronze: 'B' };
function medalBadge(medal) {
  const disc = document.createElement('i'); // not a span: the challenge buttons style every span inside them
  disc.className = 'medal';
  disc.dataset.medal = medal;
  disc.setAttribute('aria-hidden', 'true');
  disc.textContent = INITIAL[medal];
  return disc;
}
// "7.600 s total or faster" / "850 points or more": what a target asks for.
const targetText = (def, target) => (isGetaway(def) && target === 0 ? 'escape with every camera\'s footage'
  : isGetaway(def) && def.showmanship ? `escape with ${formatNumber(target)} Showmanship (drift + smash)`
    : def.kind === 'time' ? `${formatMedalTime(target)} total or faster` : `${formatNumber(target)} ${target === 1 ? 'point' : 'points'} or more`);
// When a timed result misses a target by less than a hundredth of a second, spell out the
// millisecond gap to match the three-decimal display of both result and target.
function shortBy(def, value, target) {
  const gap = missedTargetBy(def, value, target);
  return gap === null ? '' : ` Missed by ${formatMedalTime(gap)}.`;
}
// Fills `el` with a badge and words, or empties it. Rebuilt only when what it says changes.
function showMedal(el, medal, words) {
  const key = `${medal ?? ''}|${words}`;
  if (el.dataset.shown === key) return;
  el.dataset.shown = key;
  el.replaceChildren(...(medal ? [medalBadge(medal)] : []), ...(words ? [document.createTextNode(words)] : []));
}
// What the next medal takes, from a saved best (or none). '' when there are no targets.
function nextLine(def, handlingId, best) {
  const next = nextOf(def, handlingId, best);
  if (!targetsOf(def, handlingId)) return '';
  if (!next) return `Gold held with this handling.`;
  return `Next: ${MEDAL_NAMES[next.medal]}, ${targetText(def, next.target)}.${shortBy(def, best, next.target)}`;
}

// Why a run failed, in a sentence that says what to do about it.
function failure(reason) {
  if (reason === 'left the box') return 'You left the box. Stay inside its painted edges, and come back out through the open end.';
  if (reason === 'turned before the turn zone') return 'You came back out before reaching the turn zone at the far end of the box.';
  if (reason === 'came out backwards') return 'The car has to come back out through the gate nose first.';
  if (reason === 'out of time') return 'Out of time.';
  if (reason === 'busted') return 'Busted. The police car stayed close, inside its red ring and in sight of you, long enough to fill BUST RISK. Pull away, or put a building between you, to drain it.';
  const cam = /^missed camera (\d)$/.exec(reason);
  if (cam) return `Upload cancelled: you reached a later camera before camera ${cam[1]}. Film them in order.`;
  if (reason === 'missed the finish') return 'You missed the finish gate.';
  // Slalom Sprint.
  const side = /^wrong side of cone (\d)$/.exec(reason);
  if (side) return `You passed cone ${side[1]} on the wrong side. Go left of the first cone, then right of the next, and so on.`;
  const lane = /^left the lane at cone (\d)$/.exec(reason);
  if (lane) return `You were outside the painted lane at cone ${lane[1]}. Each cone has to be passed inside the lane.`;
  const gate = /^missed gate (\d)$/.exec(reason);
  if (gate) return `You missed gate ${gate[1]}. Every gate has to be taken, in order.`;
  const lost = /^drift lost: (.+)$/.exec(reason);
  if (lost) return `The drift was lost: ${lost[1]}. One Drift fails when its combo is lost.`;
  return reason;
}

// What a completed run was, in a sentence.
function remark(def, r) {
  if (def.layout === 'slalom') {
    return r.cones ? `Every cone on the correct side. ${plural(r.cones, 'cone')} touched, costing ${r.penalty} seconds.`
      : 'Every cone on the correct side, and none touched.';
  }
  if (def.kind === 'time') {
    const cones = r.cones ? ` ${plural(r.cones, 'cone')} cost ${r.penalty} seconds.` : '';
    if (r.technique === 'reversed') return `Round in more than one move. It counts, but a slide is much quicker.${cones}`;
    if (r.technique === 'grip') return `Round on grip. The handbrake is quicker.${cones}`;
    return r.cones ? `Round in one slide.${cones}` : 'Round in one slide, and clean.';
  }
  if (r.ended === 'escaped') {
    if (r.score === 0 && r.smashBonus > 0) return 'Plenty of wreckage, no drifting. The medals want it sideways.';
    if (r.score === 0) return 'Clean getaway. Every camera got the shot. Now try it sideways.';
    return r.shotsDrifted === r.cameras ? 'Sideways past every camera. That\'s going online.' : 'That\'s going online.';
  }
  if (r.ended === 'banked') return `The drift banked after ${Math.round(r.distance)} m of the course.`;
  if (r.score === 0) return 'Every gate, and no drift. Slide the bends to score.';
  return r.gatesDrifted === r.gates ? 'Every gate taken sideways.' : 'Every gate taken.';
}

function precisionRows(r, exactTime) {
  const rows = [
    ['Driving time', exactTime ? formatMedalTime(r.time) : `${r.time.toFixed(2)} s`],
    ['Cones', r.cones ? `${r.cones} (+${r.penalty} s)` : 'None'],
    ['Entry speed', mph(r.entrySpeed)],
    ['Turn', r.technique === 'slide' ? `Slide, ${Math.round(Math.min(r.peakSlip * DEG, 180))}°` : r.technique === 'grip' ? 'Grip' : 'Reversed'],
  ];
  if (r.exitOffset !== undefined) {
    const off = Math.abs(r.exitOffset);
    rows.push(['Exit line', off < 0.3 ? 'Centre' : `${off.toFixed(1)} m ${r.exitOffset > 0 ? 'right' : 'left'}`]);
    rows.push(['Exit speed', mph(r.exitSpeed)]);
  }
  return rows;
}

// Slalom Sprint's result, as driving time + penalties = total.
function slalomRows(r, failed, exactTime) {
  return [
    ['Driving time', exactTime ? formatMedalTime(r.time) : `${r.time.toFixed(2)} s`],
    ['Penalties', r.cones ? `${plural(r.cones, 'cone')}, +${r.penalty} s` : 'None'],
    ['Total time', failed ? 'Not counted' : exactTime ? formatMedalTime(r.total) : `${r.total.toFixed(2)} s`],
    ['Cones passed', `${r.passed} of ${r.count}`],
    ...(r.weaveSpeed ? [['Speed through the cones', mph(r.weaveSpeed)]] : []),
    ['Top speed', mph(r.topSpeed)],
  ];
}

function courseRows(r, failed) {
  return [
    ...(failed ? [['Banked, not counted', formatNumber(r.score)]] : []),
    ['Best combo', r.bestCombo ? `${formatNumber(r.bestCombo)} (×${r.bestMultiplier})` : 'None'],
    ['Gates drifted', `${r.gatesDrifted} of ${r.gatesPassed}`],
    ['Distance', `${Math.round(r.distance)} m`],
    ['Cones', r.cones ? String(r.cones) : 'None'],
    ['Spinouts', String(r.spinouts)],
    ...(failed ? [] : [['Time', `${r.time.toFixed(1)} s`]]),
  ];
}

// R4C: the Showmanship breakdown leads. On a failed run the same figures are shown, plainly
// labelled as not counted: nothing qualifies without an escape.
function urbanRows(r, failed) {
  const smashed = r.smashes ? `${r.smashes} by you${r.policeSmashes ? `, ${r.policeSmashes} by the police` : ''}` : r.policeSmashes ? `${r.policeSmashes} by the police` : 'None';
  const bonus = r.smashBonus ?? 0;
  return [
    ...(failed ? [
      ['Banked drift, not counted', formatNumber(r.score)],
      ['Destruction bonus, not counted', `+${formatNumber(bonus)}`],
    ] : [
      ['Banked drift', formatNumber(r.score)],
      ['Destruction bonus', `+${formatNumber(bonus)}`],
      ['Total Showmanship', formatNumber(r.showmanship ?? r.score)],
    ]),
    ['Footage', `${r.footage} of ${r.cameras} cameras${r.shotsDrifted ? `, ${r.shotsDrifted} sideways` : ''}`],
    ['Best combo', r.bestCombo ? `${formatNumber(r.bestCombo)} (×${r.bestMultiplier})` : 'None'],
    ['Closest call', r.minGap === null ? '--' : `${r.minGap.toFixed(1)} m`],
    ['Bust risk peak', `${Math.round(r.peakMeter * 100)}%${r.closeCalls ? ` · ${plural(r.closeCalls, 'narrow escape')}` : ''}`],
    ['Smashed', smashed],
    ['Spinouts', String(r.spinouts)],
    ['Time', `${r.time.toFixed(1)} s`],
  ];
}

const BUST_WORDS = { clear: 'Clear', close: 'Police close', critical: 'Critical', busted: 'Busted', waiting: 'Clear' };
let lastMeter = 0;
function updateBust(def, run, game) {
  const el = $('bust');
  if (!el) return;
  const on = isGetaway(def) && game.state !== 'menu';
  el.hidden = !on;
  const level = !on ? '' : run.phase === 'failed' && run.reason === 'busted' ? 'busted'
    : run.time < def.pursuerTuning.delay ? 'waiting' : run.phase === 'running' ? run.level : 'clear';
  document.body.dataset.bust = level;
  document.body.dataset.alert = on && run.phase === 'running' && level === 'close' && run.sees ? 'pursuit' : '';
  document.querySelector('.gauges')?.removeAttribute('data-speed-zone');
  $('gym-medal')?.removeAttribute('data-driver-track');
  if (!on) return;
  // Getaway Driver relabels this meter: put Get the Footage's back.
  if (el.dataset.mode) {
    el.dataset.mode = '';
    el.classList.remove('no-glide');
    el.querySelector('.bust-label').textContent = 'Bust risk';
    el.style.removeProperty('--mark');
    if ($('bust-lose')) $('bust-lose').hidden = true;
  }
  el.dataset.level = level;
  const pct = Math.round(run.meter * 100);
  el.style.setProperty('--bust', `${pct}%`);
  const trend = run.meter > lastMeter + 1e-6 ? 'rising' : run.meter < lastMeter - 1e-6 ? 'falling' : 'steady';
  lastMeter = run.meter;
  el.dataset.trend = trend;
  setText($('bust-state'), BUST_WORDS[level]);
  setText($('bust-pct'), `${pct}%`);
  setText($('bust-detail'), level === 'waiting' ? 'Police car waiting at the start'
    : level === 'busted' ? 'The police car stayed close too long'
      : `Police ${Math.round(run.gap)} m${run.gap < 25 && !run.sees ? ' · out of sight' : ''}${trend === 'falling' ? ' · getting away' : trend === 'rising' ? ' · closing in' : ''}`);
}
export function hideBust() {
  const el = $('bust');
  if (el) { el.hidden = true; el.classList.remove('no-glide'); }
  document.body.dataset.bust = '';
  document.body.dataset.alert = '';
  document.querySelector('.gauges')?.removeAttribute('data-speed-zone');
  $('gym-medal')?.removeAttribute('data-driver-track');
  const nav = $('nav');
  if (nav) nav.hidden = true;
}

// The navigation chip (R4C), docked on top of the minimap: the next turn and the objective. Its
// glyph is turned into screen space (the view does not turn with the car); the words say left or
// right as the driver sees it. Sized to the minimap render.js draws for a city.
let navShownFor = null;
let navNewUntil = 0;
function updateNav(def, run, game) {
  const el = $('nav');
  if (!el) return;
  const on = isGetaway(def) && game.state !== 'menu' && run.phase === 'running';
  el.hidden = !on;
  if (!on) return;
  const { bounds, cameras } = def.geometry;
  const W = bounds.maxX - bounds.minX;
  const H = bounds.maxY - bounds.minY;
  const scale = Math.min(210 / W, 150 / H);
  const width = `${Math.max(248, Math.round(W * scale + 12))}px`;
  const bottom = `${Math.round(16 + H * scale + 6)}px`;
  if (el.style.width !== width) el.style.width = width;
  if (el.style.bottom !== bottom) el.style.bottom = bottom;
  const cue = cueForGame(game);
  const words = isDriver(def) ? driverNavText(run, cue) : cueText(run, cue, cameras);
  el.dataset.glyph = words.glyph;
  el.dataset.goal = isDriver(def) ? driverNavGoal(run) : run.exitOpen ? 'escape' : run.missed[run.nextCamera] ? 'missed' : 'camera';
  // Screen bearing of the glyph (drawn pointing up): the coming turn's approach, or the aim.
  const car = game.car;
  const bearing = !cue ? -Math.PI / 2
    : ['left', 'right', 'around'].includes(words.glyph) ? turnBearing(cue, car) : cue.dir;
  el.style.setProperty('--nav-rot', `${Math.round((bearing * DEG + 90) / 3) * 3}deg`);
  setText($('nav-call'), words.call);
  setText($('nav-goal'), `${words.goal}${words.distance ? ` · ${words.distance}` : ''}`);
  // A new objective (a camera filmed or missed): the chip glows for a moment.
  const key = `${game.runId}|${run.nextCamera}|${run.exitOpen}|${run.missedShots}`;
  if (navShownFor !== key) {
    if (navShownFor !== null && run.time > 0.5) navNewUntil = run.time + 1.4;
    navShownFor = key;
  }
  el.dataset.new = run.time < navNewUntil ? 'true' : 'false';
}

// `records` is the gymkhana records keeper (gymkhana-records.js), `getawayRecords` the Getaway
// one (getaway-records.js) and `driverRecords` Getaway Driver's completion counts
// (getaway-driver-records.js). `onChoose` is called after the player picks a challenge on the sheet.
export function createGymkhanaUi({ records, getawayRecords, driverRecords, onChoose }) {
  let choices;
  let inputs = [];
  const remembered = new Map();
  const selected = () => choices[remembered.get(choices) ?? 0];
  const keeper = (def) => (isDriver(def) ? driverRecords : isGetaway(def) ? getawayRecords : records);
  const bestOf = (def, handlingId) => keeper(def).bestFor(def.id, handlingId);

  function choose(index) {
    remembered.set(choices, index);
    for (const input of inputs) input.checked = input.value === selected().id;
  }

  function setChoices(list) {
    if (list === choices) return;
    choices = list;
    const labels = choices.map((def, index) => {
      const label = document.createElement('label');
      label.className = 'station';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'challenge';
      input.value = def.id;
      input.setAttribute('aria-describedby', 'challenge-brief');
      const name = document.createElement('span');
      name.textContent = def.shortName ?? def.name;
      const held = document.createElement('i');
      held.className = 'medal-slot';
      name.append(held);
      label.append(input, name);
      input.addEventListener('change', () => { choose(index); onChoose(); });
      return label;
    });
    inputs = labels.map((label) => label.firstElementChild);
    $('challenges').replaceChildren(...labels);
    choose(remembered.get(choices) ?? 0);
  }
  setChoices(GYMKHANA_CHALLENGES);

  const recordsNote = (def) => (isDriver(def) ? driverNote(driverRecords)
    : !keeper(def).available ? 'Record storage unavailable. New improvements cannot be saved.'
      : keeper(def).readOnly ? `${isGetaway(def) ? 'Getaway' : 'Gymkhana'} records were saved by a newer version of Mini Drifters. They are kept, but cannot be updated here.` : '');

  let shownPrompt = '';
  let shownRows = '';

  return {
    get inputs() { return inputs; },
    selected,
    setChoices,
    // Left and Right on the sheet, wrapping.
    step(direction) {
      choose((choices.indexOf(selected()) + direction + choices.length) % choices.length);
    },

    // The sheet: the selected challenge, its rules and its record in the selected handling mode.
    showMenu(handling, device) {
      const def = selected();
      $('challenges').setAttribute('aria-label', isGetaway(def) ? 'Environment' : 'Challenge');
      setText($('challenge-brief'), def.brief);
      const points = def.points.join('|');
      const list = $('challenge-points');
      if (list.dataset.shown !== points) {
        list.dataset.shown = points;
        list.replaceChildren(...def.points.map((text) => {
          const li = document.createElement('li');
          li.textContent = text;
          return li;
        }));
      }
      setText($('challenge-best-label'), `Personal best · ${isGetaway(def) ? 'Showmanship' : def.kind === 'time' ? 'Time' : 'Score'}`);
      const best = bestOf(def, handling.id);
      setText($('challenge-best'), formatValue(def, handling.id, best));

      // Medals: the one each challenge's best holds in this handling mode, on its button; this
      // challenge's three targets, the ones held marked; and what the next one takes.
      choices.forEach((c, i) => {
        const medal = medalOf(c, handling.id, bestOf(c, handling.id));
        showMedal(inputs[i].parentElement.querySelector('.medal-slot'), medal, '');
        const label = `${medal ? `${c.name}, ${MEDAL_NAMES[medal]} medal` : c.name}`;
        if (inputs[i].getAttribute('aria-label') !== label) inputs[i].setAttribute('aria-label', label);
      });
      const medal = medalOf(def, handling.id, best);
      showMedal($('challenge-medal'), medal, medal ? MEDAL_NAMES[medal] : best === null ? '' : 'No medal');
      const targets = targetsOf(def, handling.id);
      const targetList = $('challenge-targets');
      const shown = targets ? `${def.id}|${MEDALS.map((m) => `${m}:${targets[m]}`).join('|')}|${medal}` : '';
      if (targetList.dataset.shown !== shown) {
        targetList.dataset.shown = shown;
        targetList.replaceChildren(...(targets ? MEDALS.map((m) => {
          const li = document.createElement('li');
          li.dataset.medal = m;
          // Held: this medal or a better one is held. A Gold best holds all three.
          if (medal && medalRank(m) <= medalRank(medal)) li.dataset.held = 'true';
          const target = document.createElement('b');
          // Compact, to sit on one line: the "Next:" line under it spells out what a target asks.
          target.textContent = isGetaway(def) && targets[m] === 0 ? 'Escape' : def.kind === 'time' ? formatMedalTime(targets[m]) : `${formatNumber(targets[m])} ${targets[m] === 1 ? 'pt' : 'pts'}`;
          li.append(medalBadge(m), `${MEDAL_NAMES[m]} `, target);
          return li;
        }) : []));
      }
      setText($('challenge-next'), best === null && targets
        ? `No medal yet. ${MEDAL_NAMES.bronze}: ${targetText(def, targets.bronze)}.`
        : nextLine(def, handling.id, best));
      setText($('gymkhana-handling'), device === 'controller'
        ? `${handling.name} handling, chosen on the title screen. Each handling mode keeps its own best.`
        : `${handling.name} handling. Press H to change it. Each handling mode keeps its own best.`);
      setText($('gymkhana-records-note'), recordsNote(def));
      if (isDriver(def)) showDriverMenu(def, handling, device, driverRecords);
    },

    // The line under the car before the clock starts: what to do, and the keys.
    showPrompt(el, game, device) {
      const show = game.state === 'ready' && !game.paused;
      el.hidden = !show;
      if (!show) return;
      const def = game.challengeDef;
      const text = `${def.brief} ${device === 'controller' ? 'RT to go.' : '↑ to go.'}`;
      const keys = device === 'controller' ? 'X retry · Menu pause' : 'R retry · P pause · ' + (isGetaway(def) ? 'Esc environments' : 'Esc title');
      el.dataset.kind = 'gymkhana';
      const key = `${text}|${keys}`;
      if (key === shownPrompt && el.childElementCount) return;
      shownPrompt = key;
      const line = document.createElement('span');
      line.textContent = text;
      const help = document.createElement('span');
      help.className = 'prompt-keys';
      help.textContent = keys;
      el.replaceChildren(line, help);
    },

    // The panel, once a frame while a challenge is driven.
    updateHud(game) {
      const def = game.challengeDef;
      const run = game.challenge;
      setText($('gym-name'), def.name);
      setText($('gym-handling'), game.handling.name);
      setText($('gym-clock'), formatClock(run.time));
      setText($('gym-stage'), run.phase === 'running' ? `Next: ${run.stage}` : run.stage);
      if (isDriver(def)) {
        updateDriverMeter(def, run, game);
        updateNav(def, run, game);
        updateDriverHud(def, run);
        return;
      }
      setText($('gym-gates'), def.layout === 'course' ? `Gates ${run.gates.filter(Boolean).length}/${run.gates.length}`
        : def.layout === 'slalom' ? `Cones ${run.next}/${def.geometry.count}`
          : isGetaway(def) ? `Footage ${def.geometry.cameras.map((_, i) => (run.cameras[i] ? '●' : '○')).join('')} ${run.nextCamera}/${def.geometry.cameras.length} · escape gate ${run.exitOpen ? 'open' : 'locked'}`
          : '');
      updateBust(def, run, game);
      updateNav(def, run, game);
      const left = isGetaway(def) ? def.timeLimit - run.time : Infinity;
      setText($('gym-cones'), isGetaway(def) ? (run.phase === 'running' && left <= 30 ? `${Math.ceil(left)} s left` : '')
        : !run.conesHit ? '' : def.kind === 'time'
          ? `${plural(run.conesHit, 'cone')} · +${run.conesHit * def.geometry.conePenalty} s` : `${plural(run.conesHit, 'cone')} hit`);
      const best = bestOf(def, game.handling.id);
      const held = medalOf(def, game.handling.id, best);
      if (isGetaway(def)) {
        // What is banked this run, the destruction bonus so far (both provisional until an escape),
        // and what their total would earn on an escape now.
        const targets = chaseTargets(def, game.handling.id);
        const banked = game.scoring.score;
        const smash = def.showmanship ? run.smashBonus : 0;
        const total = banked + smash;
        const up = targets ? ['silver', 'gold'].find((m) => total < targets[m]) : null;
        const tally = def.showmanship ? `Drift ${formatNumber(banked)} · Smash +${formatNumber(smash)}` : `Banked ${formatNumber(banked)}`;
        setText($('gym-best'), `${tally}${up ? ` · ${MEDAL_NAMES[up]} at ${formatNumber(targets[up])}` : targets ? ' · Gold if you escape' : ''}`);
        setText($('gym-medal'), `Best: ${formatValue(def, game.handling.id, best)}${held ? ` · ${MEDAL_NAMES[held]}` : ''}`);
        return;
      }
      setText($('gym-best'), `Best: ${formatValue(def, game.handling.id, best)}`);
      // The medal the saved best holds, and the target for the next one up. Never a medal for
      // this run: a time only counts once the gate is crossed and its penalties are added, and a
      // score only once it is banked. So the target names what is measured, and the run itself
      // is judged on the results sheet.
      const next = nextOf(def, game.handling.id, best);
      const target = !next ? '' : `${MEDAL_NAMES[next.medal]} ${isGetaway(def) && next.target === 0 ? 'escape' : def.kind === 'time'
        ? `${formatMedalTime(next.target)} total` : `${formatNumber(next.target)} banked`}`;
      setText($('gym-medal'), [held ? `${MEDAL_NAMES[held]} held` : '', target ? `Next: ${target}` : ''].filter(Boolean).join(' · '));
    },

    // What the banner says about a run's event: a cone has fallen.
    banner(def, event) {
      if (isDriver(def)) return driverBanner(event);
      if (isGetaway(def)) {
        if (event.type === 'missed') return { kind: 'lost', text: `CAM ${event.crossed} TOO SOON · GO BACK FOR CAM ${event.camera}` };
        if (event.type === 'wrongway') return { kind: 'penalty', text: `WRONG WAY · CAM ${event.camera} FILMS THE OTHER WAY` };
        if (event.type === 'smash') {
          const what = event.kind === 'fruit' ? 'FRUIT STAND' : 'BARRICADE';
          if (event.by === 'police') return { kind: 'lap', text: `THE COP TOOK OUT THE ${what}` };
          if (def.showmanship) return { kind: 'banked', text: `SMASH +${formatNumber(event.bonus)} · ${what}${event.combo ? ' · COMBO KEPT' : ''}` };
          return { kind: 'penalty', text: event.kind === 'fruit' ? 'FRUIT STAND! · SPEED LOST' : 'THROUGH THE BARRICADE · SPEED LOST' };
        }
        if (event.type === 'shot') {
          return { kind: 'banked', text: event.all ? 'ALL FOOTAGE CAPTURED · ESCAPE!'
            : `FOOTAGE ${event.camera}/${def.geometry.cameras.length}${event.drifting ? ' SIDEWAYS' : ''} · NEXT: CAM ${event.camera + 1}` };
        }
      }
      if (event.type !== 'cone') return null;
      return { kind: 'penalty', text: def.kind === 'time' ? `CONE +${event.penalty} S` : 'CONE HIT' };
    },

    // The sheet that ends a session, completed or failed.
    showResults(game) {
      const def = game.challengeDef;
      const run = game.challenge;
      if (isDriver(def)) {
        shownRows = '';
        showDriverResults(def, game, driverRecords);
        return;
      }
      const r = run.result;
      const failed = run.phase === 'failed';
      const handlingId = game.handling.id;
      const exactTime = !failed && !isGetaway(def) && needsMillisecondDisplay(def, handlingId, r.value);
      const { newBest, previousBest } = keeper(def);
      $('gymkhana-results').dataset.outcome = failed ? 'failed' : 'complete';
      $('gymkhana-results').dataset.layout = def.layout;
      $('gymkhana-results').dataset.driver = '';
      setText($('gr-eyebrow'), `${def.name} · ${game.handling.name} handling`);
      setText($('gr-title'), isGetaway(def)
        ? (failed ? (run.reason === 'busted' ? 'Busted' : /^missed camera/.test(run.reason) ? 'Upload cancelled' : 'Run failed') : isGetaway(def) && def.showmanship ? 'Getaway complete' : 'Escaped')
        : failed ? 'Run failed' : r.ended === 'banked' ? 'Drift banked' : 'Complete');
      setText($('gr-reason'), failed ? (isGetaway(def) && def.showmanship && run.reason === 'busted'
        ? `Upload cancelled: no medal and no score without an escape. ${failure(run.reason).replace(/^Busted\. /, '')}` : failure(run.reason)) : remark(def, r));
      setText($('gr-label'), isGetaway(def) && def.showmanship ? 'Showmanship' : def.kind === 'time' ? 'Time' : 'Score');
      setText($('gr-value'), formatValue(def, handlingId, failed ? null : r.value));
      $('gr-new').hidden = !newBest;
      const rows = isGetaway(def) ? urbanRows(r, failed) : def.layout === 'slalom' ? slalomRows(r, failed, exactTime) : def.kind === 'time' ? precisionRows(r, exactTime) : courseRows(r, failed);
      const key = rows.map((row) => row.join('=')).join('|');
      if (key !== shownRows) {
        shownRows = key;
        const stats = $('gr-stats');
        while (stats.children.length > 1) stats.lastElementChild.remove();
        for (const [name, value] of rows) {
          const row = document.createElement('div');
          const dt = document.createElement('dt');
          dt.textContent = name;
          const dd = document.createElement('dd');
          dd.textContent = value;
          row.append(dt, dd);
          stats.append(row);
        }
      }
      const best = bestOf(def, handlingId);

      // The medal: what this run earned, whether it is new, and what the next one takes. A failed
      // run earns nothing and the line is hidden. "NEW MEDAL" needs a saved NEW BEST whose medal
      // beats the medal the replaced record held, so a medal already held is never announced
      // again, and nothing unsaved is ever called new.
      const runMedal = failed ? null : medalOf(def, handlingId, r.value);
      const targets = targetsOf(def, handlingId);
      const line = $('gr-medal');
      line.hidden = failed || !targets;
      if (!line.hidden) {
        const isNew = newBest && medalRank(runMedal) > medalRank(medalOf(def, handlingId, previousBest));
        const saved = newBest || medalRank(medalOf(def, handlingId, best)) >= medalRank(runMedal);
        const words = runMedal
          ? `${MEDAL_NAMES[runMedal]} medal${isNew ? ' · NEW MEDAL' : ''}${saved ? '' : ' · not saved'}`
          : 'No medal this run';
        showMedal(line, runMedal, words);
        line.dataset.new = isNew ? 'true' : 'false';
      } else line.dataset.new = 'false';
      // The next target, from the saved best when there is one, or else from this run.
      const from = best ?? (failed ? null : r.value);
      setText($('gr-next'), failed || !targets ? '' : from === null
        ? `${MEDAL_NAMES.bronze} takes ${targetText(def, targets.bronze)}.`
        : nextLine(def, handlingId, from));
      setText($('gr-best'), best === null
        ? (isGetaway(def) ? 'No personal best yet. Only an escape with every camera\'s footage sets one.' : 'No personal best yet. Only a completed run sets one.')
        : `Personal best with ${game.handling.name} handling: ${formatValue(def, handlingId, best)}`);
      setText($('gr-records-note'), recordsNote(def));
    },
  };
}
