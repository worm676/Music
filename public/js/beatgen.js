// Prompt-to-beat generator.
// Parses a plain-English description ("dark trap beat with heavy 808s, 140 bpm")
// into musical parameters, then synthesizes drums, bass, chords and melody with
// the Web Audio API in an OfflineAudioContext. Everything runs in the browser.

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};
const SCALE_LABEL = { major: 'major', minor: 'minor', harmonic: 'harmonic minor', phrygian: 'phrygian', dorian: 'dorian' };

// Chord progressions as scale-degree indices (0 = tonic), one chord per bar.
const PROGRESSIONS = {
  minor: [[0, 5, 2, 6], [0, 3, 5, 4], [0, 6, 5, 6], [0, 2, 5, 4], [0, 5, 3, 4], [0, 0, 5, 6]],
  major: [[0, 4, 5, 3], [0, 5, 3, 4], [3, 4, 0, 5], [0, 3, 4, 3], [0, 2, 3, 4], [5, 3, 0, 4]],
};

// 16-step patterns per bar ('x' = hit). Arrays alternate bar by bar.
const GENRES = {
  trap: {
    label: 'Trap', words: ['trap', 'rage', 'atlanta', '808', 'travis', 'future'], bpm: 140, mode: 'minor', swing: 0,
    kick: ['x......x..x.....', 'x.........x..x..'], clap: ['........x.......'], snare: ['........x.......'],
    hat: ['x.x.x.x.x.x.x.x.'], rolls: 0.22, bass: '808', chords: 'pad', chordRhythm: 'whole', melody: 'bell',
    kickDecay: 0.28,
  },
  drill: {
    label: 'Drill', words: ['drill', 'uk drill', 'ny drill', 'brooklyn'], bpm: 142, mode: 'minor', swing: 0, scale: 'harmonic',
    kick: ['x.........x.....', 'x......x...x....'], snare: ['........x.....x.', '........x.......'],
    hat: ['x..x..x...x..x..', 'x..x..x.x.x..x..'], rolls: 0.08, bass: '808glide', chords: 'pad', chordRhythm: 'whole', melody: 'keys',
    kickDecay: 0.25,
  },
  boombap: {
    label: 'Boom Bap', words: ['boom bap', 'boombap', 'hip hop', 'hiphop', 'hip-hop', '90s', 'old school', 'golden era'], bpm: 90, mode: 'minor', swing: 0.14,
    kick: ['x.......x.x.....', 'x.....x...x..x..'], snare: ['....x.......x...'], hat: ['x.x.x.x.x.x.x.x.'], ohat: ['..............x.'],
    bass: 'sub', chords: 'keys', chordRhythm: 'hits', melody: null, sevenths: true, fills: true,
  },
  lofi: {
    label: 'Lo-fi', words: ['lofi', 'lo-fi', 'lo fi', 'chillhop', 'chill hop', 'study', 'chill'], bpm: 78, mode: 'minor', swing: 0.18,
    kick: ['x......x..x.....', 'x.........x.....'], snare: ['....x.......x...'], hat: ['x.x.x.xxx.x.x.x.'],
    bass: 'sub', chords: 'rhodes', chordRhythm: 'whole', melody: 'bell', sevenths: true, lofi: true, crackle: true,
  },
  house: {
    label: 'House', words: ['house', 'deep house', 'edm', 'dance', 'club', 'disco'], bpm: 124, mode: 'minor', swing: 0,
    kick: ['x...x...x...x...'], clap: ['....x.......x...'], hat: ['.x.x.x.x.x.x.x.x'], ohat: ['..x...x...x...x.'],
    bass: 'offbeat', chords: 'stab', chordRhythm: 'offbeat', melody: null, sevenths: true,
  },
  techno: {
    label: 'Techno', words: ['techno', 'industrial', 'rave', 'warehouse', 'berlin'], bpm: 130, mode: 'minor', swing: 0,
    kick: ['x...x...x...x...'], clap: ['....x.......x...'], hat: ['..x...x...x...x.'], perc: ['...x..x....x..x.'],
    bass: 'rolling', chords: null, chordRhythm: 'offbeat', melody: 'arp',
  },
  rnb: {
    label: 'R&B', words: ['r&b', 'rnb', 'r and b', 'slow jam', 'soul', 'neo soul', 'sensual', 'late night'], bpm: 72, mode: 'minor', swing: 0.1,
    kick: ['x......x.x......', 'x.........x..x..'], snare: ['....x.......x...'], hat: ['x.x.x.x.x.x.x.x.'], rolls: 0.06,
    bass: '808', chords: 'rhodes', chordRhythm: 'whole', melody: 'bell', sevenths: true,
  },
  pop: {
    label: 'Pop', words: ['pop', 'radio', 'catchy', 'anthem'], bpm: 110, mode: 'major', swing: 0,
    kick: ['x.......x.x.....'], clap: ['....x.......x...'], hat: ['x.x.x.x.x.x.x.x.'],
    bass: 'eighths', chords: 'keys', chordRhythm: 'quarters', melody: 'lead', fills: true,
  },
  reggaeton: {
    label: 'Reggaeton', words: ['reggaeton', 'dembow', 'latin', 'perreo', 'reggaetón'], bpm: 95, mode: 'minor', swing: 0,
    kick: ['x...x...x...x...'], snare: ['...x..x....x..x.'], hat: ['x.x.x.x.x.x.x.x.'],
    bass: 'follow', chords: 'pluck', chordRhythm: 'dembow', melody: 'pluck',
  },
  afrobeats: {
    label: 'Afrobeats', words: ['afrobeats', 'afrobeat', 'afro', 'amapiano', 'afropop', 'naija'], bpm: 105, mode: 'major', swing: 0.08,
    kick: ['x..x......x..x..', 'x..x...x..x.....'], perc: ['...x..x....x..x.'], shaker: ['xxxxxxxxxxxxxxxx'], clap: ['........x.......'],
    bass: 'follow', chords: 'keys', chordRhythm: 'dembow', melody: 'pluck', sevenths: true,
  },
  dnb: {
    label: 'Drum & Bass', words: ['drum and bass', 'drum & bass', 'dnb', 'd&b', 'jungle', 'liquid'], bpm: 172, mode: 'minor', swing: 0,
    kick: ['x.........x.....', 'x.........x..x..'], snare: ['....x.......x...'], hat: ['x.x.x.x.x.x.x.x.'],
    bass: 'reese', chords: 'pad', chordRhythm: 'whole', melody: null,
  },
  synthwave: {
    label: 'Synthwave', words: ['synthwave', 'retrowave', 'outrun', '80s', 'retro', 'vaporwave'], bpm: 100, mode: 'minor', swing: 0,
    kick: ['x...x...x...x...'], snare: ['....x.......x...'], hat: ['x.x.x.x.x.x.x.x.'],
    bass: 'eighths', chords: 'pad', chordRhythm: 'whole', melody: 'arp', fills: true,
  },
};

export const EXAMPLE_PROMPTS = [
  'dark trap beat with heavy 808s and eerie bells, 140 bpm',
  'chill lofi hip hop with dusty rhodes and vinyl crackle',
  'aggressive UK drill in F# minor with piano',
  '90s boom bap with jazzy piano',
  'uplifting house groove with bright chords',
  'smooth late night R&B slow jam',
  'afrobeats summer vibe with plucky melody',
  'retro synthwave arp driving at night',
];

// ---------- helpers ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const on = (pattern, step) => !!pattern && pattern[step] === 'x';

const SAT_CURVES = {};
function satCurve(k) {
  if (SAT_CURVES[k]) return SAT_CURVES[k];
  const n = 2048, c = new Float32Array(n), norm = Math.tanh(k);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / norm; }
  return (SAT_CURVES[k] = c);
}

function noiseBuffer(ctx) {
  const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export function makeImpulse(ctx, seconds = 2, decay = 3) {
  const len = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

// Exponential ADSR on an AudioParam; returns the time the voice is silent.
function adsr(param, t, dur, { a = 0.005, d = 0.2, s = 0.5, r = 0.2, peak = 1 }) {
  const sus = Math.max(0.0001, peak * s);
  param.setValueAtTime(0.0001, t);
  param.exponentialRampToValueAtTime(peak, t + a);
  param.exponentialRampToValueAtTime(sus, t + a + d);
  const hold = Math.max(t + a + d, t + dur);
  param.setValueAtTime(sus, hold);
  param.exponentialRampToValueAtTime(0.0001, hold + r);
  return hold + r;
}

function osc(ctx, type, freq, t) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  return o;
}

function send(ctx, node, bus, wet) {
  node.connect(bus.dry);
  if (wet > 0) {
    const g = ctx.createGain();
    g.gain.value = wet;
    node.connect(g).connect(bus.wet);
  }
}

// ---------- prompt parsing ----------
function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function parseKey(t) {
  const acc = (a) => (!a ? 0 : /#|♯|sharp/.test(a) ? 1 : -1);
  let m = t.match(/\b([a-g])\s*(#|♯|b|♭|sharp|flat)?\s*(major|minor|maj|min)\b/);
  if (m) return { root: (NOTE_NAMES.indexOf(m[1].toUpperCase()) + acc(m[2]) + 12) % 12, mode: m[3].startsWith('maj') ? 'major' : 'minor' };
  m = t.match(/\b([a-g])(#|b)?m\b/);
  if (m) return { root: (NOTE_NAMES.indexOf(m[1].toUpperCase()) + acc(m[2]) + 12) % 12, mode: 'minor' };
  return null;
}

export function parsePrompt(text = '', seed = 1) {
  const t = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `;
  const has = (...words) => words.some((w) => t.includes(w));
  const rng = mulberry32(seed ^ hashString(t));

  let genre = 'trap', best = 0;
  for (const [key, g] of Object.entries(GENRES)) {
    let score = 0;
    for (const w of g.words) if (t.includes(w)) score += w.length;
    if (score > best) { best = score; genre = key; }
  }
  const g = GENRES[genre];

  let bpm = g.bpm;
  const bpmMatch = t.match(/(\d{2,3})\s*(bpm|beats per minute)/);
  const explicitBpm = !!bpmMatch;
  if (bpmMatch) bpm = Number(bpmMatch[1]);
  else {
    if (has('fast', 'hype', 'energetic', 'uptempo', 'up-tempo', 'bouncy')) bpm *= 1.07;
    if (has('slow', 'relaxed', 'laid back', 'laid-back', 'mellow', 'sleepy')) bpm *= 0.92;
  }
  bpm = Math.round(Math.min(200, Math.max(60, bpm)));

  let mode = g.mode;
  if (has('happy', 'uplifting', 'bright', 'summer', 'joy', 'fun ', 'sunny', 'feel good', 'feel-good', 'euphoric', 'hopeful', 'romantic')) mode = 'major';
  if (has('dark', 'sad', 'eerie', 'evil', 'sinister', 'aggressive', 'emotional', 'melanchol', 'haunting', 'spooky', 'menacing', 'gloomy')) mode = 'minor';
  const key = parseKey(t);
  if (key) mode = key.mode;
  const root = key ? key.root : Math.floor(rng() * 12);
  let scale = mode;
  if (mode === 'minor') {
    if (g.scale) scale = g.scale;
    if (has('eerie', 'evil', 'sinister', 'haunting', 'spooky', 'menacing', 'horror', 'creepy')) scale = 'harmonic';
    if (has('jazzy', 'jazz', 'smooth', 'soulful')) scale = 'dorian';
  }

  let chords = g.chords, melody = g.melody;
  if (has('piano', 'keys')) { chords = 'keys'; if (!melody) melody = 'keys'; }
  if (has('rhodes', 'electric piano', 'e-piano')) chords = 'rhodes';
  if (has(' pad', 'ambient', 'atmospher', 'strings', 'choir', 'cinematic', 'lush')) chords = 'pad';
  if (has('stab')) chords = 'stab';
  if (has('bell')) melody = 'bell';
  if (has('pluck', 'guitar', 'harp', 'marimba', 'kalimba')) melody = 'pluck';
  if (has('lead', 'flute', 'whistle', 'synth melody')) melody = 'lead';
  if (has('arp')) melody = 'arp';
  if (has('melodic', 'melody') && !melody) melody = 'bell';

  const parts = { drums: true, bass: true, chords: !!chords, melody: !!melody };
  if (has('no drums', 'drumless', 'without drums')) parts.drums = false;
  if (has('no melody', 'without melody')) parts.melody = false;
  if (has('no chords', 'without chords')) parts.chords = false;
  if (has('no bass', 'no 808', 'without bass')) parts.bass = false;
  if (has('drums only', 'only drums', 'just drums')) Object.assign(parts, { bass: false, chords: false, melody: false });

  const heavy = has('heavy', 'hard', 'distorted', 'punchy', 'slap', 'bass boosted', 'aggressive', 'loud');
  const soft = has('soft', 'gentle', 'calm', 'quiet', 'mellow');
  const crackle = !!g.crackle || has('vinyl', 'crackle', 'dusty', 'tape');
  const lofi = !!g.lofi || has('dusty', 'tape', 'lofi', 'lo-fi', 'muffled');
  const sevenths = !!g.sevenths || has('jazzy', 'jazz', 'neo soul', 'lush', 'smooth');

  return {
    prompt: text,
    genre, g, bpm, explicitBpm, root, mode, scale,
    progression: pick(rng, PROGRESSIONS[mode]),
    chords, melody, parts, heavy, soft, crackle, lofi, sevenths,
    swing: g.swing || 0,
  };
}

export function describe(p) {
  const layers = [];
  if (p.parts.drums) layers.push('drums');
  if (p.parts.bass) layers.push(p.g.bass.startsWith('808') ? '808' : 'bass');
  if (p.parts.chords) layers.push(`${p.chords} chords`);
  if (p.parts.melody) layers.push(`${p.melody} melody`);
  return `${p.g.label} · ${p.bpm} BPM · ${NOTE_NAMES[p.root]} ${SCALE_LABEL[p.scale]} · ${layers.join(', ')}`;
}

// ---------- timing ----------
function stepTime(p, bar, step) {
  const sd = 60 / p.bpm / 4;
  return (bar * 16 + step) * sd + (step % 2 ? p.swing * sd : 0);
}

function chordNotes(p, degree, base, count) {
  const sc = SCALES[p.scale], notes = [];
  for (let i = 0; i < count; i++) {
    const d = degree + i * 2;
    notes.push(base + p.root + sc[d % 7] + 12 * Math.floor(d / 7));
  }
  return notes;
}

// ---------- drum voices ----------
function kick(ctx, bus, t, vel, decay = 0.45) {
  const o = osc(ctx, 'sine', 160, t), g = ctx.createGain();
  o.frequency.exponentialRampToValueAtTime(48, t + 0.11);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vel, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.001, t + decay);
  o.connect(g); send(ctx, g, bus, 0);
  o.start(t); o.stop(t + decay + 0.05);
  const c = osc(ctx, 'triangle', 1200, t), cg = ctx.createGain();
  c.frequency.exponentialRampToValueAtTime(200, t + 0.02);
  cg.gain.setValueAtTime(vel * 0.3, t);
  cg.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
  c.connect(cg); send(ctx, cg, bus, 0);
  c.start(t); c.stop(t + 0.03);
}

function noiseHit(ctx, bus, noise, t, { type = 'highpass', freq = 7000, q = 0.7, decay = 0.05, vel = 0.3, wet = 0 }) {
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noise;
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(vel, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + decay);
  src.connect(f).connect(g); send(ctx, g, bus, wet);
  src.start(t, Math.random()); src.stop(t + decay + 0.02);
}

function snare(ctx, bus, noise, t, vel) {
  noiseHit(ctx, bus, noise, t, { type: 'bandpass', freq: 1900, q: 0.6, decay: 0.22, vel: vel * 0.8, wet: 0.2 });
  const o = osc(ctx, 'triangle', 220, t), g = ctx.createGain();
  o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
  g.gain.setValueAtTime(vel * 0.6, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  o.connect(g); send(ctx, g, bus, 0.1);
  o.start(t); o.stop(t + 0.15);
}

function clap(ctx, bus, noise, t, vel) {
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noise; f.type = 'bandpass'; f.frequency.value = 1300; f.Q.value = 0.9;
  g.gain.setValueAtTime(0.0001, t);
  for (let i = 0; i < 3; i++) {
    g.gain.setValueAtTime(vel, t + i * 0.011);
    g.gain.exponentialRampToValueAtTime(vel * 0.2, t + i * 0.011 + 0.009);
  }
  g.gain.setValueAtTime(vel, t + 0.033);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.23);
  src.connect(f).connect(g); send(ctx, g, bus, 0.25);
  src.start(t, Math.random()); src.stop(t + 0.26);
}

function rim(ctx, bus, t, vel) {
  const o = osc(ctx, 'square', 1700, t), f = ctx.createBiquadFilter(), g = ctx.createGain();
  f.type = 'bandpass'; f.frequency.value = 1700; f.Q.value = 4;
  g.gain.setValueAtTime(vel, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  o.connect(f).connect(g); send(ctx, g, bus, 0.15);
  o.start(t); o.stop(t + 0.05);
}

function renderDrums(ctx, bus, p, rng, bars) {
  const g = p.g, noise = noiseBuffer(ctx), sd = 60 / p.bpm / 4;
  const kv = p.heavy ? 1 : p.soft ? 0.65 : 0.85;
  for (let bar = 0; bar < bars; bar++) {
    const pat = (arr) => (arr ? arr[bar % arr.length] : null);
    const K = pat(g.kick), S = pat(g.snare), C = pat(g.clap), H = pat(g.hat), O = pat(g.ohat), P = pat(g.perc), SH = pat(g.shaker);
    const fillBar = g.fills && bar % 4 === 3;
    for (let s = 0; s < 16; s++) {
      const t = stepTime(p, bar, s);
      if (on(K, s)) kick(ctx, bus, t, kv, g.kickDecay || 0.45);
      if (on(S, s)) snare(ctx, bus, noise, t, 0.55);
      if (on(C, s)) clap(ctx, bus, noise, t, 0.5);
      if (fillBar && s >= 13 && !on(S, s) && rng() < 0.6) snare(ctx, bus, noise, t, 0.3 + rng() * 0.2);
      if (on(H, s)) {
        if (g.rolls && s % 2 === 0 && s < 14 && rng() < g.rolls) {
          const n = rng() < 0.5 ? 3 : 4;
          for (let i = 0; i < n; i++) noiseHit(ctx, bus, noise, t + (i * 2 * sd) / n, { vel: 0.16 + i * 0.03, decay: 0.03 });
        } else {
          noiseHit(ctx, bus, noise, t, { vel: (s % 4 === 0 ? 0.22 : 0.15) + rng() * 0.05, decay: 0.045 });
        }
      }
      if (on(O, s)) noiseHit(ctx, bus, noise, t, { freq: 6500, vel: 0.14, decay: 0.28 });
      if (on(P, s)) rim(ctx, bus, t, 0.18);
      if (on(SH, s)) noiseHit(ctx, bus, noise, t, { type: 'bandpass', freq: 6000, q: 1.2, vel: s % 4 === 2 ? 0.12 : 0.06, decay: 0.05 });
    }
  }
  if (p.crackle) {
    const end = bars * 16 * sd;
    const hiss = ctx.createBufferSource(), hf = ctx.createBiquadFilter(), hg = ctx.createGain();
    hiss.buffer = noise; hiss.loop = true; hf.type = 'bandpass'; hf.frequency.value = 3000; hg.gain.value = 0.012;
    hiss.connect(hf).connect(hg).connect(bus.dry);
    hiss.start(0); hiss.stop(end);
    for (let tt = 0; tt < end; tt += 0.02 + rng() * 0.15) {
      noiseHit(ctx, bus, noise, tt, { freq: 2500, vel: 0.02 + rng() * 0.08, decay: 0.004 });
    }
  }
}

// ---------- bass ----------
function voice808(ctx, bus, t, dur, midi, vel, heavy, glideFrom) {
  const f = mtof(midi), o = osc(ctx, 'sine', glideFrom ? mtof(glideFrom) : f * 1.5, t);
  o.frequency.exponentialRampToValueAtTime(f, t + (glideFrom ? 0.09 : 0.04));
  const sh = ctx.createWaveShaper(); sh.curve = satCurve(heavy ? 5 : 2);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vel, t + 0.004);
  g.gain.exponentialRampToValueAtTime(vel * 0.45, t + Math.max(0.05, dur));
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.05, dur) + 0.08);
  o.connect(sh).connect(g); send(ctx, g, bus, 0);
  o.start(t); o.stop(t + dur + 0.12);
}

function voiceSynthBass(ctx, bus, t, dur, midi, vel, { type = 'sawtooth', cutoff = 700, detune = 0 } = {}) {
  const f = mtof(midi), lp = ctx.createBiquadFilter(), g = ctx.createGain();
  lp.type = 'lowpass'; lp.Q.value = 3;
  lp.frequency.setValueAtTime(cutoff * 2.2, t);
  lp.frequency.exponentialRampToValueAtTime(cutoff, t + 0.12);
  const end = adsr(g.gain, t, dur, { a: 0.005, d: 0.1, s: 0.7, r: 0.06, peak: vel });
  const oscs = detune ? [-detune, detune] : [0];
  for (const dt of oscs) {
    const o = osc(ctx, type, f, t); o.detune.value = dt;
    o.connect(lp); o.start(t); o.stop(end + 0.02);
  }
  const sub = osc(ctx, 'sine', f, t); sub.connect(g); sub.start(t); sub.stop(end + 0.02);
  lp.connect(g); send(ctx, g, bus, 0);
}

function renderBass(ctx, bus, p, rng, bars) {
  const g = p.g, sd = 60 / p.bpm / 4, style = g.bass;
  let prev = null;
  for (let bar = 0; bar < bars; bar++) {
    const deg = p.progression[bar % p.progression.length];
    const pc = (p.root + SCALES[p.scale][deg % 7]) % 12;
    const low = pc < 4 ? 36 + pc : 24 + pc; // 808 register (E1..D#2)
    const synth = 36 + pc;
    if (style === '808' || style === '808glide' || style === 'sub' || style === 'follow') {
      const K = g.kick[bar % g.kick.length];
      const hits = [];
      for (let s = 0; s < 16; s++) if (K[s] === 'x') hits.push(s);
      hits.forEach((s, i) => {
        const next = i + 1 < hits.length ? hits[i + 1] : 16;
        const t = stepTime(p, bar, s), dur = (next - s) * sd * 0.95;
        if (style === 'sub') return voiceSynthBass(ctx, bus, t, dur, synth, 0.45, { type: 'triangle', cutoff: 400 });
        if (style === 'follow') return voiceSynthBass(ctx, bus, t, Math.min(dur, sd * 2), synth, 0.4, { cutoff: 600 });
        let note = low;
        if (i > 0 && rng() < 0.25) note += rng() < 0.5 ? 12 : 7;
        const glide = style === '808glide' && prev !== null && prev !== note && rng() < 0.45 ? prev : null;
        voice808(ctx, bus, t, dur, note, p.heavy ? 0.75 : 0.6, p.heavy, glide);
        prev = note;
      });
    } else if (style === 'offbeat') {
      for (const s of [2, 6, 10, 14]) voiceSynthBass(ctx, bus, stepTime(p, bar, s), sd * 1.6, synth, 0.42, { cutoff: 500 });
    } else if (style === 'eighths') {
      for (let s = 0; s < 16; s += 2) voiceSynthBass(ctx, bus, stepTime(p, bar, s), sd * 1.7, synth + (s === 14 && rng() < 0.3 ? 12 : 0), 0.36, { cutoff: 900 });
    } else if (style === 'rolling') {
      for (let s = 0; s < 16; s++) if (s % 4) voiceSynthBass(ctx, bus, stepTime(p, bar, s), sd * 0.8, synth, 0.38, { cutoff: 450 });
    } else if (style === 'reese') {
      voiceSynthBass(ctx, bus, stepTime(p, bar, 0), 16 * sd * 0.98, synth, 0.4, { cutoff: 380, detune: 18 });
    }
  }
}

// ---------- chords & melody voices ----------
function voiceKeys(ctx, bus, t, dur, midi, vel, wet = 0.25) {
  const f = mtof(midi), lp = ctx.createBiquadFilter(), g = ctx.createGain();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(Math.min(9000, f * 10), t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(400, f * 2.5), t + 1.2);
  const end = adsr(g.gain, t, dur, { a: 0.004, d: 0.9, s: 0.25, r: 0.35, peak: vel });
  const o1 = osc(ctx, 'triangle', f, t), o2 = osc(ctx, 'sine', f * 2, t), g2 = ctx.createGain();
  g2.gain.value = 0.25;
  o1.connect(lp); o2.connect(g2).connect(lp);
  lp.connect(g); send(ctx, g, bus, wet);
  for (const o of [o1, o2]) { o.start(t); o.stop(end + 0.02); }
}

function voiceRhodes(ctx, bus, t, dur, midi, vel, wet = 0.3) {
  const f = mtof(midi), g = ctx.createGain(), trem = ctx.createGain(), lfo = osc(ctx, 'sine', 4.5, t), lfoAmt = ctx.createGain();
  const end = adsr(g.gain, t, dur, { a: 0.006, d: 1.2, s: 0.35, r: 0.4, peak: vel });
  trem.gain.value = 0.85; lfoAmt.gain.value = 0.15;
  lfo.connect(lfoAmt).connect(trem.gain);
  const o1 = osc(ctx, 'sine', f, t), o2 = osc(ctx, 'sine', f * 3.01, t), tine = ctx.createGain();
  tine.gain.setValueAtTime(0.35, t); tine.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
  o1.connect(g); o2.connect(tine).connect(g);
  g.connect(trem); send(ctx, trem, bus, wet);
  for (const o of [o1, o2, lfo]) { o.start(t); o.stop(end + 0.02); }
}

function voicePad(ctx, bus, t, dur, midi, vel, wet = 0.45) {
  const f = mtof(midi), lp = ctx.createBiquadFilter(), g = ctx.createGain();
  lp.type = 'lowpass'; lp.frequency.value = 1300; lp.Q.value = 0.4;
  const end = adsr(g.gain, t, dur, { a: 0.35, d: 0.4, s: 0.8, r: 0.9, peak: vel });
  const oscs = [-9, 9].map((dt) => { const o = osc(ctx, 'sawtooth', f, t); o.detune.value = dt; o.connect(lp); return o; });
  lp.connect(g); send(ctx, g, bus, wet);
  for (const o of oscs) { o.start(t); o.stop(end + 0.02); }
}

function voiceStab(ctx, bus, t, dur, midi, vel, wet = 0.3) {
  const f = mtof(midi), lp = ctx.createBiquadFilter(), g = ctx.createGain();
  lp.type = 'lowpass'; lp.Q.value = 4;
  lp.frequency.setValueAtTime(3500, t); lp.frequency.exponentialRampToValueAtTime(500, t + 0.18);
  const end = adsr(g.gain, t, dur, { a: 0.003, d: 0.12, s: 0.3, r: 0.1, peak: vel });
  const oscs = [osc(ctx, 'sawtooth', f, t), osc(ctx, 'square', f * 1.003, t)];
  for (const o of oscs) { o.connect(lp); o.start(t); o.stop(end + 0.02); }
  lp.connect(g); send(ctx, g, bus, wet);
}

function voicePluck(ctx, bus, t, dur, midi, vel, wet = 0.3) {
  const f = mtof(midi), lp = ctx.createBiquadFilter(), g = ctx.createGain();
  lp.type = 'lowpass'; lp.Q.value = 2;
  lp.frequency.setValueAtTime(Math.min(12000, f * 12), t); lp.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.25);
  const end = adsr(g.gain, t, Math.min(dur, 0.3), { a: 0.002, d: 0.25, s: 0.15, r: 0.2, peak: vel });
  const o = osc(ctx, 'sawtooth', f, t);
  o.connect(lp).connect(g); send(ctx, g, bus, wet);
  o.start(t); o.stop(end + 0.02);
}

function voiceBell(ctx, bus, t, dur, midi, vel, wet = 0.4) {
  const f = mtof(midi), car = osc(ctx, 'sine', f, t), mod = osc(ctx, 'sine', f * 3.5, t), modG = ctx.createGain(), g = ctx.createGain();
  modG.gain.setValueAtTime(f * 2.5, t); modG.gain.exponentialRampToValueAtTime(1, t + 1.2);
  mod.connect(modG).connect(car.frequency);
  const end = adsr(g.gain, t, dur, { a: 0.002, d: 1.4, s: 0.05, r: 0.6, peak: vel });
  car.connect(g); send(ctx, g, bus, wet);
  for (const o of [car, mod]) { o.start(t); o.stop(end + 0.02); }
}

function voiceLead(ctx, bus, t, dur, midi, vel, wet = 0.3) {
  const f = mtof(midi), lp = ctx.createBiquadFilter(), g = ctx.createGain(), vib = osc(ctx, 'sine', 5.5, t), vibAmt = ctx.createGain();
  lp.type = 'lowpass'; lp.frequency.value = 2600;
  vibAmt.gain.value = 8;
  const end = adsr(g.gain, t, dur, { a: 0.02, d: 0.2, s: 0.7, r: 0.15, peak: vel });
  const oscs = [osc(ctx, 'square', f, t), osc(ctx, 'sawtooth', f, t)];
  oscs[1].detune.value = 7;
  for (const o of oscs) { vib.connect(vibAmt).connect(o.detune); o.connect(lp); o.start(t); o.stop(end + 0.02); }
  vib.start(t); vib.stop(end + 0.02);
  lp.connect(g); send(ctx, g, bus, wet);
}

const VOICES = { keys: voiceKeys, rhodes: voiceRhodes, pad: voicePad, stab: voiceStab, pluck: voicePluck, bell: voiceBell, lead: voiceLead, arp: voicePluck };

const CHORD_RHYTHMS = {
  whole: [[0, 16]],
  hits: [[0, 6], [10, 5]],
  offbeat: [[2, 1], [6, 1], [10, 1], [14, 1]],
  quarters: [[0, 3.5], [4, 3.5], [8, 3.5], [12, 3.5]],
  dembow: [[3, 1.5], [6, 2], [11, 1.5], [14, 2]],
};

function renderChords(ctx, bus, p, rng, bars) {
  const voice = VOICES[p.chords] || voiceKeys, sd = 60 / p.bpm / 4;
  const rhythm = p.chords === 'pad' ? CHORD_RHYTHMS.whole : CHORD_RHYTHMS[p.g.chordRhythm] || CHORD_RHYTHMS.whole;
  const base = p.root >= 6 ? 36 : 48;
  const vel = (p.chords === 'pad' ? 0.07 : 0.11) * (p.soft ? 0.8 : 1);
  for (let bar = 0; bar < bars; bar++) {
    const notes = chordNotes(p, p.progression[bar % p.progression.length], base, p.sevenths ? 4 : 3);
    for (const [s, len] of rhythm) {
      const t = stepTime(p, bar, s);
      notes.forEach((n, i) => voice(ctx, bus, t + (p.chords === 'keys' || p.chords === 'rhodes' ? i * 0.008 : 0), len * sd, n, vel));
    }
  }
}

function makeMotif(rng, density, len = 32) {
  const notes = [];
  let deg = Math.floor(rng() * 5);
  for (let s = 0; s < len; s += 2) {
    const first = s === 0;
    if (!first && rng() > density) continue;
    deg = Math.max(0, Math.min(9, deg + pick(rng, [-2, -1, -1, 0, 1, 1, 2, 3, -3])));
    const sub = rng() < 0.15 ? 1 : 0; // occasional 16th-note push
    notes.push({ step: s + sub, deg });
  }
  notes.forEach((n, i) => (n.len = Math.min(6, (i + 1 < notes.length ? notes[i + 1].step : len) - n.step)));
  return notes;
}

function renderMelody(ctx, bus, p, rng, bars) {
  const sd = 60 / p.bpm / 4, sc = SCALES[p.scale];
  const voice = VOICES[p.melody] || voiceBell;
  const base = (p.melody === 'bell' ? 72 : 60) - (p.root >= 6 ? 12 : 0);
  const vel = { bell: 0.14, pluck: 0.16, lead: 0.08, keys: 0.15, arp: 0.1 }[p.melody] * (p.soft ? 0.8 : 1);

  if (p.melody === 'arp') {
    for (let bar = 0; bar < bars; bar++) {
      const notes = chordNotes(p, p.progression[bar % p.progression.length], base, 3);
      const seq = [...notes, notes[0] + 12, ...notes.slice(1).map((n) => n + 12)];
      for (let s = 0; s < 16; s++) voice(ctx, bus, stepTime(p, bar, s), sd * 0.9, seq[s % seq.length], vel);
    }
    return;
  }

  const density = { bell: 0.4, pluck: 0.55, lead: 0.35, keys: 0.45 }[p.melody] || 0.4;
  const A = makeMotif(rng, density), B = makeMotif(rng, density);
  for (let bar = 0; bar < bars; bar += 2) {
    const motif = bar % 8 === 6 ? B : A;
    for (const n of motif) {
      const b = bar + Math.floor(n.step / 16);
      if (b >= bars) continue;
      let deg = n.deg;
      if (n.step % 8 === 0) {
        // Land strong beats on a chord tone of the current chord.
        const root = p.progression[b % p.progression.length];
        const tones = [root, root + 2, root + 4, root + 7, root + 9];
        deg = tones.reduce((best, d) => (Math.abs(d - deg) < Math.abs(best - deg) ? d : best), tones[0]);
      }
      const midi = base + p.root + sc[deg % 7] + 12 * Math.floor(deg / 7);
      voice(ctx, bus, stepTime(p, b, n.step % 16), n.len * sd, midi, vel);
    }
  }
}

const RENDERERS = { drums: renderDrums, bass: renderBass, chords: renderChords, melody: renderMelody };
const PART_SEED = { drums: 11, bass: 23, chords: 37, melody: 51 };
export const PART_LABELS = { drums: 'Drums', bass: 'Bass / 808', chords: 'Chords', melody: 'Melody' };

async function renderParts(parts, p, seed, bars, sampleRate) {
  const loop = (bars * 16 * 60) / p.bpm / 4;
  const len = Math.ceil((loop + 1.5) * sampleRate);
  const ctx = new OfflineAudioContext(2, len, sampleRate);

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.15;
  const out = ctx.createGain(); out.gain.value = 0.9;
  comp.connect(out).connect(ctx.destination);
  const dry = ctx.createGain();
  if (p.lofi) {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200;
    dry.connect(lp).connect(comp);
  } else dry.connect(comp);
  const conv = ctx.createConvolver(); conv.buffer = makeImpulse(ctx, 1.8, 3.5);
  const wetOut = ctx.createGain(); wetOut.gain.value = 0.6;
  conv.connect(wetOut).connect(dry);
  const bus = { dry, wet: conv };

  for (const part of parts) RENDERERS[part](ctx, bus, p, mulberry32(seed * 7919 + PART_SEED[part]), bars);
  const buffer = await ctx.startRendering();

  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  if (peak > 0.95) {
    const k = 0.95 / peak;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] *= k;
    }
  }
  return { buffer, loop };
}

/**
 * Generate a beat from a text description.
 * @returns {Promise<{params, info, loopDuration, parts: {key, name, buffer}[]}>}
 */
export async function generateBeat({ prompt, bars = 8, stems = true, seed = 1, bpm = null, sampleRate = 44100 }) {
  const p = parsePrompt(prompt, seed);
  if (bpm && !p.explicitBpm) p.bpm = bpm;
  const active = Object.keys(RENDERERS).filter((k) => p.parts[k]);
  if (!active.length) throw new Error('Nothing to generate — every layer was turned off.');

  const parts = [];
  let loopDuration = 0;
  if (stems) {
    for (const key of active) {
      const { buffer, loop } = await renderParts([key], p, seed, bars, sampleRate);
      loopDuration = loop;
      parts.push({ key, name: PART_LABELS[key], buffer });
    }
  } else {
    const { buffer, loop } = await renderParts(active, p, seed, bars, sampleRate);
    loopDuration = loop;
    parts.push({ key: 'mix', name: `${p.g.label} beat`, buffer });
  }
  return { params: p, info: describe(p), loopDuration, parts };
}
