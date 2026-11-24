// Circuit Tour (v0.9.0): the Tour's sheets and HUD panel. It only draws: what a Tour is worth is
// tour.js, what is saved is tour-store.js, and main.js decides when.
import {
  TOUR_LENGTHS, TOUR_FIELDS, RIVALS, PLAYER_ID, SERIES_POINTS, JOKER_MULTIPLIER,
  standing, standings, roundTable, tourOutcome, titleOpen, roundStakes,
  roundMultiplier, jokerState, pointsBreakdown,
} from './tour.js';
import { bestsKey } from './tour-store.js';

const RIVAL = Object.fromEntries(RIVALS.map((r) => [r.id, r]));
const ordinal = (n) => `P${n}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pts = (n) => (n === 1 ? '1 pt' : `${n} pts`);
const capital = (text) => `${text[0].toUpperCase()}${text.slice(1)}`;

// The Joker in a few words, wherever it is explained. The rules card on the Tour menu says it in
// full; the round sheet repeats the part that matters for that round.
export const JOKER_HEADLINE = 'Double your championship points in one round. Choose wisely.';
export const JOKER_RULES = 'One per Tour. Play it on a round’s sheet before you drive, in any round but the final, which already counts double for everyone. Save it for a circuit you’re strong on.';
const JOKER_BADGE = { available: 'Joker available', selected: `Joker selected ×${JOKER_MULTIPLIER}`, used: 'Joker used', locked: 'Joker unused' };

export function createTourUi({ $, trackName, trackMeta, formatNumber, onChoice }) {
  const setText = (id, text) => { const el = $(id); if (el.textContent !== text) el.textContent = text; };

  // --- The Tour sheet's two choices, built once like the title's handling modes. -------------
  const groups = {
    length: { el: 'tour-lengths', options: Object.values(TOUR_LENGTHS).map((l) => ({ id: l.id, name: `${l.name.replace(' Tour', '')} · ${l.rounds}` })) },
    field: { el: 'tour-fields', options: Object.values(TOUR_FIELDS).map((f) => ({ id: f.id, name: f.name })) },
  };
  const inputs = {};
  for (const [group, { el, options }] of Object.entries(groups)) {
    inputs[group] = options.map((option) => {
      const label = document.createElement('label');
      label.className = 'station';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = `tour-${group}`;
      input.value = option.id;
      input.dataset.group = group;
      const name = document.createElement('span');
      name.textContent = option.name;
      label.append(input, name);
      $(el).append(label);
      input.addEventListener('change', () => onChoice(group, option.id));
      return input;
    });
  }
  setText('tour-joker-rules-headline', JOKER_HEADLINE);
  setText('tour-joker-rules-text', JOKER_RULES);

  // A list of rows: place, a colour chip, a name, a score and points, and an optional note.
  function fill(id, rows) {
    const list = $(id);
    list.replaceChildren(...rows.map((row) => {
      const li = document.createElement('li');
      if (row.player) li.dataset.player = 'true';
      if (row.joker) li.dataset.joker = 'true';
      const cell = (className, text) => { const span = document.createElement('span'); span.className = className; span.textContent = text; return span; };
      const chip = cell('tour-chip', '');
      if (row.color) chip.style.setProperty('--chip', row.color);
      li.append(cell('tour-place', row.place ?? ''), chip, cell('tour-name', row.name), cell('tour-score', row.score ?? ''),
        cell('tour-points', row.points ?? ''), cell('tour-move', row.move ?? ''));
      if (row.title) li.title = row.title;
      return li;
    }));
  }

  const colorOf = (id) => (id === PLAYER_ID ? '#ffb627' : RIVAL[id]?.color ?? '#b8b3a5');
  const settings = (t) => `${TOUR_LENGTHS[t.length].name} · ${TOUR_FIELDS[t.field].name} · ${t.handling === 'revised' ? 'Power' : 'Classic'}`;

  function standingsRows(t, before = null) {
    const after = standings(t);
    const was = before ? Object.fromEntries(before.map((r) => [r.id, r.position])) : null;
    return after.map((r) => {
      const delta = was ? was[r.id] - r.position : 0;
      return { place: ordinal(r.position), name: r.name, color: colorOf(r.id), score: '', points: String(r.points), player: r.player,
        move: !was || t.results.length < 2 ? '' : delta > 0 ? `▲${delta}` : delta < 0 ? `▼${-delta}` : '–' };
    });
  }

  // "P2 = 7 pts × 2 Joker = 14 pts": how a round's points were made, multipliers spelt out.
  function breakdownText(t, i) {
    const r = t.results[i];
    if (r.dnf) return 'DNF · 0 pts';
    const b = pointsBreakdown(t, i);
    const steps = [];
    if (b.joker > 1) steps.push(`× ${b.joker} Joker`);
    if (b.final > 1) steps.push(`× ${b.final} final`);
    return steps.length ? `${ordinal(r.position)} = ${pts(b.base)} ${steps.join(' ')} = ${pts(b.total)}` : `${ordinal(r.position)} = ${pts(b.total)}`;
  }

  // The Joker's line on the Tour menu's Continue box and on the final sheet.
  function jokerSummary(t) {
    if (t.jokerRound === null) return t.status === 'complete' ? 'Joker not played.' : 'Joker available.';
    const r = t.results[t.jokerRound];
    return `Joker used in round ${t.jokerRound + 1} (${trackName(r.trackId)}: ${pts(r.basePoints)} → ${pts(r.points)}).`;
  }

  // One sentence on what this round decides, from the posted scores (tour.js roundStakes).
  function stakesText(t, jokerArmed) {
    const st = roundStakes(t, { joker: jokerArmed });
    if (!st) return '';
    const or = (p) => (p === 1 ? 'win the round' : `finish P${p} or better`);
    const anyPlace = RIVALS.length + 1;
    if (st.final) {
      if (st.champion === anyPlace) return 'Final round: the title is already yours. Drive for the round win.';
      if (st.champion) return `Final round: you are champion if you ${or(st.champion)}.`;
      if (st.podium) return `Final round: the title is out of reach. ${capital(or(st.podium))} for a podium.`;
      return 'Final round: no podium is in reach, but every place still counts.';
    }
    if (st.lead === anyPlace) return 'You stay top of the table whatever happens here.';
    if (st.lead) return `${capital(or(st.lead))} and you lead the Tour.`;
    return titleOpen(t) === false ? 'The title is out of reach, but every place still counts.'
      : 'Nothing you do here can take the lead yet: score big and stay in touch.';
  }

  // The round sheet's Joker panel: available, selected, used, or unused in the final.
  function renderJoker(t, jokerArmed) {
    const j = jokerState(t, { armed: jokerArmed });
    const panel = $('tour-joker-panel');
    panel.dataset.joker = j.state;
    panel.dataset.lastChance = j.lastChance ? 'true' : 'false';
    setText('tour-joker-badge', j.lastChance && j.state === 'available' ? 'Joker · last chance' : JOKER_BADGE[j.state]);
    const win = SERIES_POINTS[0];
    let text;
    if (j.state === 'available') {
      text = j.lastChance
        ? `Play it to double your points here: a win would score ${win * JOKER_MULTIPLIER} instead of ${win}. The final counts double already, so this is the last round it can be played.`
        : `Play it to double your points in this round: a win would score ${win * JOKER_MULTIPLIER} instead of ${win}. One per Tour, never in the final. Save it for a circuit you’re strong on.`;
    } else if (j.state === 'selected') {
      text = 'Your points this round are doubled. It is spent when you finish the round; leave the round and you keep it. Press it again to take it back.';
    } else if (j.state === 'used') {
      text = jokerSummary(t).replace(/^Joker used/, 'Played');
    } else {
      text = 'The final already counts double for everyone, so the Joker cannot be played here.';
    }
    setText('tour-joker-text', text);
    const button = $('tour-joker');
    button.hidden = !(j.state === 'available' || j.state === 'selected');
    button.setAttribute('aria-pressed', jokerArmed ? 'true' : 'false');
    button.dataset.armed = jokerArmed ? 'true' : 'false';
    const label = jokerArmed ? `Joker selected ×${JOKER_MULTIPLIER}` : 'Play Joker';
    if (button.textContent !== label) button.textContent = label;
  }

  return {
    inputs,
    groupOf: (input) => input?.dataset?.group ?? null,

    renderMenu({ choice, handlingName, handlingId, active, bests, notice, storeNote, device }) {
      for (const [group, list] of Object.entries(inputs)) for (const input of list) input.checked = input.value === choice[group];
      const pill = $('tour-handling');
      pill.dataset.handling = handlingId;
      setText('tour-handling', `${handlingName} handling.${device === 'keyboard' ? ' Press H to change it.' : ''}`);
      const length = TOUR_LENGTHS[choice.length];
      const field = TOUR_FIELDS[choice.field];
      setText('tour-choice-note', `${length.rounds} circuits, three laps each (about ${length.rounds === 4 ? '10' : '20'} minutes). Places score ${SERIES_POINTS.join('-')}, and the final round counts double for everyone. ${plural(length.restarts, 'restart')} for the whole Tour. ${field.name}: ${field.summary}`);
      const best = bests?.[bestsKey({ ...choice, handling: handlingId })];
      setText('tour-best', !best ? `No ${length.name} finished here yet.`
        : `Here: ${plural(best.finished, 'Tour')} finished · ${plural(best.champion, 'title')} · best finish ${best.bestPlace ? ordinal(best.bestPlace) : '--'} · best ${pts(best.bestPoints ?? 0)}`);
      const box = $('tour-continue');
      box.hidden = !active;
      if (active) {
        const s = standings(active).find((r) => r.player);
        const where = active.results.length === 0 ? 'Not started' : `${ordinal(s.position)} on ${pts(s.points)}`;
        setText('tour-continue-text', `${settings(active)} · Round ${active.round + 1} of ${active.lineup.length}: ${trackName(active.lineup[active.round])}. ${where}. ${jokerSummary(active)}`);
      }
      setText('tour-start', active ? 'New Tour' : 'Start Tour');
      setText('tour-notice', notice ?? '');
      setText('tour-store-note', storeNote ?? '');
    },

    renderIntro(t, { jokerArmed, pb }) {
      const i = t.round;
      const id = t.lineup[i];
      const meta = trackMeta(id);
      const mult = roundMultiplier(t, i) * (jokerArmed ? JOKER_MULTIPLIER : 1);
      $('tour-round').style.setProperty('--track-accent', meta.accent);
      $('tour-round').dataset.joker = jokerArmed ? 'true' : 'false';
      setText('tour-round-eyebrow', `${settings(t)} · Round ${i + 1} of ${t.lineup.length}${i === t.lineup.length - 1 ? ' · Final round · double points' : ''}`);
      setText('tour-round-title', trackName(id));
      setText('tour-round-venue', meta.blurb);
      setText('tour-marks-head', mult > 1 ? `Scores to beat · your points ×${mult}` : 'Scores to beat');
      // The points column is what the player would score by finishing in that place.
      fill('tour-marks', t.marks[i].map((m, place) => ({ place: ordinal(place + 1), name: m.name, color: colorOf(m.id), score: formatNumber(m.score),
        points: pts(SERIES_POINTS[place] * mult), title: RIVAL[m.id]?.tagline })));
      setText('tour-standings-head', i === 0 ? 'The field' : 'Standings');
      fill('tour-round-standings', i === 0
        ? RIVALS.map((r) => ({ place: '', name: r.name, color: r.color, score: '', points: '', title: r.tagline, move: '' })).concat([{ place: '', name: 'You', color: colorOf(PLAYER_ID), player: true }])
        : standingsRows(t));
      setText('tour-lineup', `Lineup: ${t.lineup.map((id, k) => (k === i ? `[${trackName(id)}]` : trackName(id))).join(' → ')}`);
      setText('tour-stakes', stakesText(t, jokerArmed));
      setText('tour-round-pb', pb === null ? 'No personal best here yet in this handling.' : `Your best score here: ${formatNumber(pb)}.`);
      setText('tour-round-note', `${plural(t.restartsLeft, 'restart')} left for the Tour. You drive last.`);
      renderJoker(t, jokerArmed);
    },

    renderResult(t, { before, newBests, run, notice }) {
      const i = t.results.length - 1;
      const r = t.results[i];
      const id = r.trackId;
      $('tour-result').dataset.place = r.position ?? '';
      $('tour-result').dataset.joker = r.joker ? 'true' : 'false';
      setText('tour-result-eyebrow', `${settings(t)} · Round ${i + 1} of ${t.lineup.length} · ${trackName(id)}`);
      setText('tour-result-title', r.dnf ? 'Did not finish' : r.position === 1 ? 'Round win' : `${ordinal(r.position)} in the round`);
      setText('tour-result-line', `${formatNumber(r.score)} drift points · ${breakdownText(t, i)}`);
      fill('tour-result-round', roundTable(t, i).map((row) => ({ place: ordinal(row.position), name: row.name, color: colorOf(row.id), score: row.dnf ? 'DNF' : formatNumber(row.score),
        points: `+${row.points}`, player: row.player, joker: row.player && r.joker, move: row.player && r.joker ? `×${JOKER_MULTIPLIER}` : '' })));
      fill('tour-result-standings', standingsRows(t, before));
      const notes = [];
      if (r.joker) notes.push(`Joker played: your ${pts(r.basePoints)} for ${ordinal(r.position)} became ${pts(r.points)}. It is used for the rest of the Tour.`);
      if (newBests?.score) notes.push(`New best score on ${trackName(id)}.`);
      if (newBests?.fastestLap) notes.push('New fastest lap.');
      if (run?.voidedLaps) notes.push(`${plural(run.voidedLaps, 'lap')} not counted (${formatNumber(run.forfeited)} points left out).`);
      const next = t.lineup[t.round];
      if (next) notes.push(`Next: ${trackName(next)}${t.round === t.lineup.length - 1 ? ', the double-points final' : ''}.`);
      if (titleOpen(t) === false) notes.push('The title is out of reach now. Podium places still count.');
      setText('tour-result-notes', [notice, ...notes].filter(Boolean).join(' '));
    },

    renderFinal(t, { before, best, previousBest, notice }) {
      const o = tourOutcome(t);
      const sheet = $('tour-final');
      sheet.dataset.trophy = o.trophy ?? '';
      setText('tour-final-eyebrow', `${settings(t)} · Tour code ${t.code}`);
      setText('tour-final-title', o.place === 1 ? 'Tour champion' : o.place === 2 ? 'Runner-up' : o.place === 3 ? 'Third overall' : `Finished ${ordinal(o.place)}`);
      const wins = t.results.filter((r) => r.position === 1).length;
      setText('tour-final-line', `${pts(o.points)} · ${plural(wins, 'round win')}${o.sweep ? ' · Clean sweep' : ''}`);
      fill('tour-final-standings', standingsRows(t, before));
      fill('tour-final-rounds', t.results.map((r, i) => ({ place: `R${i + 1}`, name: trackName(r.trackId), color: trackMeta(r.trackId).accent,
        score: r.dnf ? 'DNF' : formatNumber(r.score), points: `${r.dnf ? 'DNF' : ordinal(r.position)} · ${pts(r.points)}`, joker: r.joker,
        move: r.joker ? `×${JOKER_MULTIPLIER}` : '', title: breakdownText(t, i) })));
      const improved = !previousBest || (best && ((best.bestPoints ?? 0) > (previousBest.bestPoints ?? 0)
        || (best.bestPlace ?? 99) < (previousBest.bestPlace ?? 99)));
      const bestLine = !best ? ''
        : `${improved ? 'New Tour best here. ' : ''}${plural(best.finished, 'Tour')} finished here · ${plural(best.champion, 'title')} · best ${ordinal(best.bestPlace ?? 6)}, ${pts(best.bestPoints ?? 0)}.`;
      setText('tour-final-best', [notice, jokerSummary(t), bestLine].filter(Boolean).join(' '));
    },

    // The HUD panel, every frame. Returns where the player stands, for the overtaking banners.
    updateHud(t, round, { score, comboValue, jokerArmed }) {
      const s = standing(t, round, score);
      const panel = $('tour-hud');
      const st = round === t.lineup.length - 1 ? roundStakes(t, { joker: jokerArmed }) : null;
      const target = !st?.champion ? '' : st.champion === RIVALS.length + 1 ? ' · Title won' : ` · Title: ${st.champion === 1 ? 'win' : `P${st.champion}`}`;
      setText('tour-hud-round', `${round === t.lineup.length - 1 ? `Final round${roundMultiplier(t, round) > 1 ? ' ×2' : ''}` : `Round ${round + 1}/${t.lineup.length}`}${jokerArmed ? ` · Joker ×${JOKER_MULTIPLIER}` : ''}${target}`);
      panel.dataset.joker = jokerArmed ? 'true' : 'false';
      setText('tour-hud-place', ordinal(s.position));
      panel.dataset.place = String(s.position);
      const marks = t.marks[round];
      const leadBy = s.position === 1 ? score - (marks[0]?.score ?? 0) : 0;
      setText('tour-hud-next', s.next ? `Next: ${RIVAL[s.next.id]?.short ?? s.next.name} ${formatNumber(s.next.score)} · +${formatNumber(s.gap)}`
        : `Leading by ${formatNumber(leadBy)}`);
      const banked = score + comboValue;
      const gain = comboValue > 0 ? standing(t, round, banked).position : s.position;
      setText('tour-hud-bank', gain < s.position ? `Bank it → ${ordinal(gain)}` : '');
      return s;
    },
  };
}
