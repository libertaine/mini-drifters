// The page side of Gymkhana: the sheet where a challenge is chosen, the HUD panel while one is
// driven, and the sheet that shows how the run went. It fills elements that index.html already
// holds; main.js decides when each is showing and owns every key and button.
import { GYMKHANA_CHALLENGES } from './gymkhana.js';

const MPH_PER_MS = 2.23694;
const DEG = 180 / Math.PI;
const $ = (id) => document.getElementById(id);

const formatClock = (seconds) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
const formatNumber = (n) => Math.round(n).toLocaleString('en-US');
const formatValue = (def, value) => (value === null ? '--' : def.kind === 'time' ? `${value.toFixed(2)} s` : formatNumber(value));
const mph = (ms) => `${Math.round(ms * MPH_PER_MS)} mph`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

// Why a run failed, in a sentence that says what to do about it.
function failure(reason) {
  if (reason === 'left the box') return 'You left the box. Stay inside its painted edges, and come back out through the open end.';
  if (reason === 'turned before the turn zone') return 'You came back out before reaching the turn zone at the far end of the box.';
  if (reason === 'came out backwards') return 'The car has to come back out through the gate nose first.';
  if (reason === 'out of time') return 'Out of time.';
  if (reason === 'missed the finish') return 'You missed the finish gate.';
  const gate = /^missed gate (\d)$/.exec(reason);
  if (gate) return `You missed gate ${gate[1]}. Every gate has to be taken, in order.`;
  const lost = /^drift lost: (.+)$/.exec(reason);
  if (lost) return `The drift was lost: ${lost[1]}. One Drift fails when its combo is lost.`;
  return reason;
}

// What a completed run was, in a sentence.
function remark(def, r) {
  if (def.kind === 'time') {
    const cones = r.cones ? ` ${plural(r.cones, 'cone')} cost ${r.penalty} seconds.` : '';
    if (r.technique === 'reversed') return `Round in more than one move. It counts, but a slide is much quicker.${cones}`;
    if (r.technique === 'grip') return `Round on grip. The handbrake is quicker.${cones}`;
    return r.cones ? `Round in one slide.${cones}` : 'Round in one slide, and clean.';
  }
  if (r.ended === 'banked') return `The drift banked after ${Math.round(r.distance)} m of the course.`;
  if (r.score === 0) return 'Every gate, and no drift. Slide the bends to score.';
  return r.gatesDrifted === r.gates ? 'Every gate taken sideways.' : 'Every gate taken.';
}

function precisionRows(r) {
  const rows = [
    ['Driving time', `${r.time.toFixed(2)} s`],
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

// `records` is the gymkhana records keeper (gymkhana-records.js). `onChoose` is called after
// the player picks a challenge on the sheet.
export function createGymkhanaUi({ records, onChoose }) {
  let index = 0;
  const selected = () => GYMKHANA_CHALLENGES[index];

  function choose(which) {
    const i = typeof which === 'number' ? which : GYMKHANA_CHALLENGES.findIndex((c) => c.id === which);
    if (i < 0 || i >= GYMKHANA_CHALLENGES.length) return false;
    index = i;
    for (const input of inputs) input.checked = input.value === selected().id;
    return true;
  }

  // The challenges, as a radio group built the way the tracks and radio stations are.
  const inputs = GYMKHANA_CHALLENGES.map((def) => {
    const label = document.createElement('label');
    label.className = 'station';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'challenge';
    input.value = def.id;
    input.setAttribute('aria-describedby', 'challenge-brief');
    const name = document.createElement('span');
    name.textContent = def.name;
    label.append(input, name);
    $('challenges').append(label);
    input.addEventListener('change', () => { choose(def.id); onChoose(); });
    return input;
  });
  choose(0);

  const recordsNote = () => (!records.available ? 'Record storage unavailable. New improvements cannot be saved.'
    : records.readOnly ? 'Gymkhana records were saved by a newer version of Mini Drifters. They are kept, but cannot be updated here.' : '');

  let shownPrompt = '';
  let shownRows = '';

  return {
    inputs,
    selected,
    choose,
    // Left and Right on the sheet, wrapping.
    step(direction) {
      choose((index + direction + GYMKHANA_CHALLENGES.length) % GYMKHANA_CHALLENGES.length);
    },

    // The sheet: the selected challenge, its rules and its record in the selected handling mode.
    showMenu(handling, device) {
      const def = selected();
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
      setText($('challenge-best-label'), `Personal best · ${def.kind === 'time' ? 'Time' : 'Score'}`);
      setText($('challenge-best'), formatValue(def, records.bestFor(def.id, handling.id)));
      setText($('gymkhana-handling'), device === 'controller'
        ? `${handling.name} handling, chosen on the title screen. Each handling mode keeps its own best.`
        : `${handling.name} handling. Press H to change it. Each handling mode keeps its own best.`);
      setText($('gymkhana-records-note'), recordsNote());
    },

    // The line under the car before the clock starts: what to do, and the keys.
    showPrompt(el, game, device) {
      const show = game.state === 'ready' && !game.paused;
      el.hidden = !show;
      if (!show) return;
      const def = game.challengeDef;
      const text = `${def.brief} ${device === 'controller' ? 'RT to go.' : '↑ to go.'}`;
      const keys = device === 'controller' ? 'X retry · Menu pause' : 'R retry · P pause · Esc title';
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
      setText($('gym-gates'), def.layout === 'course' ? `Gates ${run.gates.filter(Boolean).length}/${run.gates.length}` : '');
      setText($('gym-cones'), !run.conesHit ? '' : def.kind === 'time'
        ? `${plural(run.conesHit, 'cone')} · +${run.conesHit * def.geometry.conePenalty} s` : `${plural(run.conesHit, 'cone')} hit`);
      setText($('gym-best'), `Best: ${formatValue(def, records.bestFor(def.id, game.handling.id))}`);
    },

    // What the banner says about a run's event: a cone has fallen.
    banner(def, event) {
      if (event.type !== 'cone') return null;
      return { kind: 'penalty', text: def.kind === 'time' ? `CONE +${event.penalty} S` : 'CONE HIT' };
    },

    // The sheet that ends a session, completed or failed.
    showResults(game) {
      const def = game.challengeDef;
      const run = game.challenge;
      const r = run.result;
      const failed = run.phase === 'failed';
      $('gymkhana-results').dataset.outcome = failed ? 'failed' : 'complete';
      setText($('gr-eyebrow'), `${def.name} · ${game.handling.name} handling`);
      setText($('gr-title'), failed ? 'Run failed' : r.ended === 'banked' ? 'Drift banked' : 'Complete');
      setText($('gr-reason'), failed ? failure(run.reason) : remark(def, r));
      setText($('gr-label'), def.kind === 'time' ? 'Time' : 'Score');
      setText($('gr-value'), formatValue(def, failed ? null : r.value));
      $('gr-new').hidden = !records.newBest;
      const rows = def.kind === 'time' ? precisionRows(r) : courseRows(r, failed);
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
      const best = records.bestFor(def.id, game.handling.id);
      setText($('gr-best'), best === null ? 'No personal best yet. Only a completed run sets one.'
        : `Personal best with ${game.handling.name} handling: ${formatValue(def, best)}`);
      setText($('gr-records-note'), recordsNote());
    },
  };
}
