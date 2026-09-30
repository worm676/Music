import { generateBeat, EXAMPLE_PROMPTS, makeImpulse } from './beatgen.js';
import { audioBufferToWav } from './wav.js';

const $ = (sel, root = document) => root.querySelector(sel);
const TRACK_COLORS = ['#a855f7', '#e879f9', '#7c3aed', '#c084fc', '#8b5cf6', '#d946ef', '#6d28d9', '#f0abfc'];
const MIN_CLIP = 0.05;

// ======================================================================
// Audio engine
// ======================================================================
const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });

function buildBus(ac) {
  const input = ac.createGain();
  const reverbIn = ac.createGain();
  const reverb = ac.createConvolver();
  reverb.buffer = makeImpulse(ac, 2.6, 2.8);
  const reverbOut = ac.createGain();
  reverbOut.gain.value = 0.7;
  reverbIn.connect(reverb).connect(reverbOut).connect(input);
  const limiter = ac.createDynamicsCompressor();
  limiter.threshold.value = -1.5; limiter.knee.value = 0; limiter.ratio.value = 20;
  limiter.attack.value = 0.002; limiter.release.value = 0.1;
  input.connect(limiter).connect(ac.destination);
  return { input, reverbIn, out: limiter };
}

function buildTrackChain(ac, bus) {
  const input = ac.createGain(), fader = ac.createGain(), panner = ac.createStereoPanner(), send = ac.createGain();
  send.gain.value = 0;
  input.connect(fader).connect(panner).connect(bus.input);
  panner.connect(send).connect(bus.reverbIn);
  return { input, fader, panner, send };
}

function applyMix(track, chain, anySolo, immediate = false) {
  const audible = !track.mute && (!anySolo || track.solo);
  const vals = [[chain.fader.gain, audible ? track.volume : 0], [chain.panner.pan, track.pan], [chain.send.gain, audible ? track.reverb : 0]];
  for (const [param, v] of vals) {
    if (immediate) param.value = v;
    else param.setTargetAtTime(v, ctx.currentTime, 0.015);
  }
}

const bus = buildBus(ctx);
const analyser = ctx.createAnalyser();
analyser.fftSize = 2048;
bus.out.connect(analyser);

// ======================================================================
// State
// ======================================================================
let uid = 1;
const state = {
  bpm: 120,
  pxPerBeat: 40,
  snap: 1,
  tracks: [],
  clips: [],
  playhead: 0,
  playing: false,
  loop: false,
  loopStart: 0,
  loopEnd: 8,
  selectedClipId: null,
  recording: null,
};

const secPerBeat = () => 60 / state.bpm;
const pxPerSec = () => state.pxPerBeat / secPerBeat();
const snapTime = (t, alt = false) => {
  if (!state.snap || alt) return t;
  const g = state.snap * secPerBeat();
  return Math.round(t / g) * g;
};
const songEnd = () => state.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
const trackById = (id) => state.tracks.find((t) => t.id === id);
const clipById = (id) => state.clips.find((c) => c.id === id);
const headerW = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-w')) || 232;

// ======================================================================
// Tracks & clips
// ======================================================================
function addTrack(name, opts = {}) {
  const track = {
    id: uid++,
    name,
    color: TRACK_COLORS[state.tracks.length % TRACK_COLORS.length],
    volume: opts.volume ?? 0.8,
    pan: 0,
    reverb: opts.reverb ?? 0,
    mute: false,
    solo: false,
    armed: false,
  };
  track.chain = buildTrackChain(ctx, bus);
  state.tracks.push(track);
  if (opts.armed) armTrack(track.id, false);
  updateMix();
  renderAll();
  return track;
}

function removeTrack(id) {
  const t = trackById(id);
  if (!t) return;
  state.clips = state.clips.filter((c) => c.trackId !== id);
  t.chain.panner.disconnect();
  state.tracks = state.tracks.filter((x) => x.id !== id);
  refreshPlayback();
  renderAll();
}

function armTrack(id, render = true) {
  for (const t of state.tracks) t.armed = t.id === id ? !t.armed : false;
  if (render) renderAll();
}

function emptyTrack() {
  return state.tracks.find((t) => !t.armed && !state.clips.some((c) => c.trackId === t.id));
}

function addClip({ trackId, buffer, name, start = 0, offset = 0, duration }) {
  const clip = { id: uid++, trackId, buffer, name, start: Math.max(0, start), offset, duration: duration ?? buffer.duration - offset };
  state.clips.push(clip);
  return clip;
}

function deleteClip(id) {
  state.clips = state.clips.filter((c) => c.id !== id);
  if (state.selectedClipId === id) state.selectedClipId = null;
  refreshPlayback();
  renderAll();
}

function duplicateClip(id) {
  const c = clipById(id);
  if (!c) return;
  const copy = addClip({ ...c, start: c.start + c.duration });
  state.selectedClipId = copy.id;
  refreshPlayback();
  renderAll();
}

function splitClip(id, at) {
  const c = clipById(id);
  if (!c || at <= c.start + MIN_CLIP || at >= c.start + c.duration - MIN_CLIP) {
    return setStatus('Place the playhead inside the clip to split it.', 'error');
  }
  const cut = at - c.start;
  addClip({ trackId: c.trackId, buffer: c.buffer, name: c.name, start: at, offset: c.offset + cut, duration: c.duration - cut });
  c.duration = cut;
  refreshPlayback();
  renderAll();
}

function updateMix() {
  const anySolo = state.tracks.some((t) => t.solo);
  for (const t of state.tracks) applyMix(t, t.chain, anySolo);
}

// ======================================================================
// Transport
// ======================================================================
let sources = [];
let playStartCtx = 0;
let playStartPos = 0;
let playOrigin = 0;
let pendingLoop = null;
let nextClick = 0;

function scheduleFrom(pos, when, useLoop) {
  for (const clip of state.clips) {
    const track = trackById(clip.trackId);
    if (!track) continue;
    const end = clip.start + clip.duration;
    if (end <= pos) continue;
    if (useLoop && clip.start >= state.loopEnd) continue;
    const from = Math.max(pos, clip.start);
    const into = from - clip.start;
    let dur = clip.duration - into;
    if (useLoop) dur = Math.min(dur, state.loopEnd - from);
    if (dur <= 0.001) continue;
    const src = ctx.createBufferSource();
    src.buffer = clip.buffer;
    src.connect(track.chain.input);
    src.start(when + (from - pos), clip.offset + into, dur);
    sources.push(src);
  }
}

function stopSources() {
  for (const s of sources) { try { s.stop(); } catch { /* already stopped */ } s.disconnect(); }
  sources = [];
}

function currentPos() {
  if (!state.playing) return state.playhead;
  return playStartPos + Math.max(0, ctx.currentTime - playStartCtx);
}

const loopActive = () => state.loop && !state.recording && state.loopEnd > state.loopStart + 0.05;

async function play() {
  await ctx.resume();
  if (state.playing) return;
  if (loopActive() && (state.playhead < state.loopStart || state.playhead >= state.loopEnd)) state.playhead = state.loopStart;
  startTransport(state.playhead, ctx.currentTime + 0.05);
}

function startTransport(pos, when) {
  state.playing = true;
  playOrigin = pos;
  playStartPos = pos;
  playStartCtx = when;
  pendingLoop = null;
  nextClick = Math.ceil(pos / secPerBeat() - 1e-6) * secPerBeat();
  scheduleFrom(pos, when, loopActive());
  $('#btnPlay').classList.add('active');
  $('#btnPlay').textContent = '❚❚';
}

function pause() {
  if (!state.playing) return;
  state.playhead = currentPos();
  if (loopActive() && state.playhead >= state.loopEnd) state.playhead = state.loopStart;
  state.playing = false;
  stopSources();
  $('#btnPlay').classList.remove('active');
  $('#btnPlay').textContent = '▶';
  drawPlayhead();
}

function stop() {
  if (state.recording) stopRecording();
  const wasPlaying = state.playing;
  pause();
  state.playhead = wasPlaying ? playOrigin : 0;
  drawPlayhead();
  scrollToTime(state.playhead);
}

function togglePlay() {
  if (state.recording) return stopRecording();
  state.playing ? pause() : play();
}

// Restart scheduled audio after an edit so the change is heard immediately.
function refreshPlayback() {
  if (!state.playing || state.recording) return;
  const pos = currentPos();
  stopSources();
  const when = ctx.currentTime + 0.03;
  playStartPos = pos;
  playStartCtx = when;
  pendingLoop = null;
  scheduleFrom(pos, when, loopActive());
}

function seek(t) {
  state.playhead = Math.max(0, t);
  if (state.playing && !state.recording) {
    stopSources();
    startTransport(state.playhead, ctx.currentTime + 0.03);
  }
  drawPlayhead();
}

function click(when, accent) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = accent ? 1600 : 1100;
  g.gain.setValueAtTime(0.25, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
  o.connect(g).connect(ctx.destination);
  o.start(when);
  o.stop(when + 0.06);
}

function transportTick() {
  if (!state.playing) return;
  const now = ctx.currentTime;
  if (loopActive()) {
    const loopEndCtx = playStartCtx + (state.loopEnd - playStartPos);
    if (!pendingLoop && loopEndCtx - now < 0.2) {
      pendingLoop = loopEndCtx;
      scheduleFrom(state.loopStart, loopEndCtx, true);
    }
    if (pendingLoop && now >= pendingLoop) {
      playStartCtx = pendingLoop;
      playStartPos = state.loopStart;
      pendingLoop = null;
      nextClick = Math.ceil(state.loopStart / secPerBeat() - 1e-6) * secPerBeat();
    }
  }
  if ($('#metro').checked) {
    const spb = secPerBeat();
    while (nextClick < currentPos() + 0.15) {
      if (loopActive() && nextClick >= state.loopEnd) break;
      const when = playStartCtx + (nextClick - playStartPos);
      if (when >= now) click(when, Math.round(nextClick / spb) % 4 === 0);
      nextClick += spb;
    }
  }
}

// ======================================================================
// Recording (voice overlay)
// ======================================================================
let mic = null;

async function ensureMic() {
  const deviceId = $('#micSelect').value;
  if (mic && mic.deviceId === deviceId) return mic;
  if (mic) releaseMic();
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access needs a secure page (https or localhost).');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  await ctx.audioWorklet.addModule(new URL('./recorder-worklet.js', import.meta.url));
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'recorder');
  const sink = ctx.createGain();
  sink.gain.value = 0;
  const monitor = ctx.createGain();
  monitor.gain.value = $('#monitor').checked ? 1 : 0;
  source.connect(node).connect(sink).connect(ctx.destination);
  source.connect(monitor).connect(bus.input);
  mic = { stream, source, node, monitor, deviceId };
  node.port.onmessage = onRecorderMessage;
  populateMics();
  return mic;
}

function releaseMic() {
  if (!mic) return;
  mic.stream.getTracks().forEach((t) => t.stop());
  mic.source.disconnect();
  mic.node.disconnect();
  mic = null;
}

async function populateMics() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const sel = $('#micSelect');
  const current = sel.value;
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  sel.innerHTML = '<option value="">Default microphone</option>' +
    devices.filter((d) => d.deviceId && d.deviceId !== 'default').map((d, i) => `<option value="${d.deviceId}">${escapeHtml(d.label || `Microphone ${i + 1}`)}</option>`).join('');
  sel.value = current;
}

async function startRecording() {
  let track = state.tracks.find((t) => t.armed);
  if (!track) {
    track = addTrack('Vocals', { reverb: 0.15 });
    armTrack(track.id);
  }
  try {
    await ctx.resume();
    await ensureMic();
  } catch (err) {
    return setStatus(`Mic unavailable: ${err.message}`, 'error');
  }
  pause();
  const spb = secPerBeat();
  const countIn = $('#countIn').checked ? 4 * spb : 0;
  const start = ctx.currentTime + 0.1;
  for (let i = 0; i < 4 && countIn; i++) click(start + i * spb, i === 0);

  state.recording = { trackId: track.id, pos: state.playhead, ctxStart: start + countIn, chunks: [], firstTime: null };
  mic.node.port.postMessage('start');
  startTransport(state.playhead, start + countIn);
  $('#btnRec').classList.add('active');
  setStatus(countIn ? 'Count-in… recording starts on the next bar.' : 'Recording…', 'ok');
}

function stopRecording() {
  if (!state.recording || !mic) return;
  mic.node.port.postMessage('stop');
  $('#btnRec').classList.remove('active');
}

function onRecorderMessage(e) {
  const rec = state.recording;
  const msg = e.data;
  if (!rec) return;
  if (msg.type === 'start') rec.firstTime = msg.time;
  else if (msg.type === 'data') {
    rec.chunks.push(msg.samples);
    let peak = 0;
    for (const v of msg.samples) peak = Math.max(peak, Math.abs(v));
    $('#micLevel').style.width = `${Math.min(100, peak * 140)}%`;
  } else if (msg.type === 'done') {
    state.recording = null;
    pause();
    $('#micLevel').style.width = '0%';
    finishRecording(rec);
  }
}

function finishRecording(rec) {
  const total = rec.chunks.reduce((n, c) => n + c.length, 0);
  if (!total || rec.firstTime === null) return setStatus('Nothing was recorded.', 'error');
  const data = new Float32Array(total);
  let o = 0;
  for (const c of rec.chunks) { data.set(c, o); o += c.length; }

  // Map captured samples to timeline position, compensating for round-trip latency.
  const sr = ctx.sampleRate;
  const latency = (ctx.outputLatency || 0) + (ctx.baseLatency || 0) + Number($('#latency').value || 0) / 1000;
  let pos = rec.pos + (rec.firstTime - latency - rec.ctxStart);
  let trim = 0;
  if (pos < rec.pos) { trim = Math.round((rec.pos - pos) * sr); pos = rec.pos; }
  if (trim >= total - sr * MIN_CLIP) return setStatus('Recording stopped before the count-in finished.', 'error');

  const buffer = ctx.createBuffer(1, total - trim, sr);
  buffer.copyToChannel(data.subarray(trim), 0);
  const take = state.clips.filter((c) => c.trackId === rec.trackId).length + 1;
  const clip = addClip({ trackId: rec.trackId, buffer, name: `Take ${take}`, start: pos });
  state.selectedClipId = clip.id;
  state.playhead = rec.pos;
  renderAll();
  setStatus(`Recorded ${buffer.duration.toFixed(1)}s onto “${trackById(rec.trackId).name}”.`, 'ok');
}

// ======================================================================
// Importing audio
// ======================================================================
async function decode(arrayBuffer) {
  return await ctx.decodeAudioData(arrayBuffer);
}

async function importFiles(files, { trackId = null, start = null } = {}) {
  const list = [...files].filter((f) => f.type.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|flac|aac|webm)$/i.test(f.name));
  if (!list.length) return setStatus('That file type is not supported. Try MP3 or WAV.', 'error');
  showBusy(`Decoding ${list.length > 1 ? `${list.length} files` : list[0].name}…`);
  try {
    for (const file of list) {
      const buffer = await decode(await file.arrayBuffer());
      const name = file.name.replace(/\.[^.]+$/, '');
      placeBuffer(buffer, name, { trackId, start });
    }
    setStatus(`Imported ${list.map((f) => f.name).join(', ')}`, 'ok');
  } catch (err) {
    setStatus(`Could not decode audio: ${err.message}`, 'error');
  } finally {
    hideBusy();
  }
}

function placeBuffer(buffer, name, { trackId = null, start = null } = {}) {
  let track = trackId ? trackById(trackId) : emptyTrack();
  if (!track) track = addTrack(name);
  else if (/^(Track \d+|Instrumental)$/.test(track.name) && !trackId) track.name = name;
  const clip = addClip({ trackId: track.id, buffer, name, start: start ?? snapTime(state.playhead) });
  state.selectedClipId = clip.id;
  refreshPlayback();
  renderAll();
  return clip;
}

// ======================================================================
// AI beat generation
// ======================================================================
async function generate() {
  const prompt = $('#prompt').value.trim() || $('#prompt').placeholder;
  const bars = Number($('#bars').value);
  const stems = $('#stems').checked;
  const seed = Math.floor(Math.random() * 1e9);
  const btn = $('#btnGen');
  btn.disabled = true;
  showBusy('Composing your beat…');
  try {
    const projectBpm = $('#lockBpm').checked ? state.bpm : null;
    const result = await generateBeat({ prompt, bars, stems, seed, bpm: projectBpm, sampleRate: ctx.sampleRate });
    if (result.params.bpm !== state.bpm) setBpm(result.params.bpm);
    const start = snapTime(state.playhead, false);
    const barLen = 4 * secPerBeat();
    const startBar = Math.round(start / barLen) * barLen;
    for (const part of result.parts) {
      const name = `AI ${part.name}`;
      const track = emptyTrack() || addTrack(name, { reverb: 0 });
      if (/^(Track \d+|Instrumental)$/.test(track.name)) track.name = name;
      addClip({ trackId: track.id, buffer: part.buffer, name: `${part.name} · ${result.params.g.label}`, start: startBar, duration: result.loopDuration });
    }
    if (!state.loop) { state.loopStart = startBar; state.loopEnd = startBar + result.loopDuration; }
    $('#genInfo').textContent = `✦ ${result.info} · ${bars} bars`;
    refreshPlayback();
    renderAll();
    setStatus('Beat generated. Drag the clips, duplicate with Ctrl+D, or hit Space to play.', 'ok');
  } catch (err) {
    console.error(err);
    setStatus(`Generation failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    hideBusy();
  }
}

// ======================================================================
// Export
// ======================================================================
async function exportMix() {
  const end = songEnd();
  if (!end) return setStatus('Nothing to export yet.', 'error');
  showBusy('Rendering mixdown…');
  try {
    const sr = 44100;
    const off = new OfflineAudioContext(2, Math.ceil((end + 1.5) * sr), sr);
    const obus = buildBus(off);
    const anySolo = state.tracks.some((t) => t.solo);
    const chains = new Map();
    for (const t of state.tracks) {
      const chain = buildTrackChain(off, obus);
      applyMix(t, chain, anySolo, true);
      chains.set(t.id, chain);
    }
    for (const c of state.clips) {
      const src = off.createBufferSource();
      src.buffer = c.buffer;
      src.connect(chains.get(c.trackId).input);
      src.start(c.start, c.offset, c.duration);
    }
    const rendered = await off.startRendering();
    const blob = audioBufferToWav(rendered);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nightshade-mix-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    setStatus(`Exported ${rendered.duration.toFixed(1)}s WAV.`, 'ok');
  } catch (err) {
    setStatus(`Export failed: ${err.message}`, 'error');
  } finally {
    hideBusy();
  }
}

// ======================================================================
// Rendering: tracks, clips, waveforms, ruler, playhead
// ======================================================================
const rowsEl = $('#rows');
const scroller = $('#scroller');
const timelineEl = $('#timeline');
const rulerCanvas = $('#ruler');

const peakCache = new WeakMap();
const PEAK_BLOCK = 256;
function getPeaks(buffer) {
  let p = peakCache.get(buffer);
  if (p) return p;
  const n = Math.ceil(buffer.length / PEAK_BLOCK);
  const min = new Float32Array(n), max = new Float32Array(n);
  const chans = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  for (let b = 0; b < n; b++) {
    let lo = 1, hi = -1;
    const s1 = Math.min(buffer.length, (b + 1) * PEAK_BLOCK);
    for (const ch of chans) for (let i = b * PEAK_BLOCK; i < s1; i++) { const v = ch[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    min[b] = lo; max[b] = hi;
  }
  p = { min, max, rate: buffer.sampleRate / PEAK_BLOCK };
  peakCache.set(buffer, p);
  return p;
}

function drawWave(clip, canvas) {
  const w = Math.max(1, Math.min(4096, Math.round(clip.duration * pxPerSec())));
  const h = Math.max(10, canvas.clientHeight || 60);
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  const { min, max, rate } = getPeaks(clip.buffer);
  const secPerPx = clip.duration / w;
  g.fillStyle = 'rgba(245, 235, 255, 0.85)';
  const mid = h / 2;
  for (let x = 0; x < w; x++) {
    const t0 = clip.offset + x * secPerPx;
    const b0 = Math.floor(t0 * rate), b1 = Math.max(b0 + 1, Math.floor((t0 + secPerPx) * rate));
    let lo = 0, hi = 0;
    for (let b = b0; b < b1 && b < min.length; b++) { if (min[b] < lo) lo = min[b]; if (max[b] > hi) hi = max[b]; }
    const y0 = mid - hi * mid * 0.95, y1 = mid - lo * mid * 0.95;
    g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
  }
}

function contentWidth() {
  const minSec = 64 * 4 * secPerBeat();
  const needed = songEnd() + 16 * 4 * secPerBeat();
  return Math.ceil(Math.max(minSec, needed, state.loopEnd + 8) * pxPerSec());
}

function renderAll() {
  const cw = contentWidth();
  timelineEl.style.width = `${headerW() + cw}px`;
  timelineEl.style.setProperty('--beat-px', `${state.pxPerBeat}px`);
  timelineEl.style.setProperty('--bar-px', `${state.pxPerBeat * 4}px`);

  rowsEl.innerHTML = '';
  for (const t of state.tracks) {
    const row = document.createElement('div');
    row.className = `track-row${t.armed ? ' armed' : ''}`;
    row.dataset.track = t.id;
    row.style.setProperty('--c', t.color);
    row.innerHTML = `
      <div class="track-header">
        <div class="th-top">
          <input class="name" value="${escapeHtml(t.name)}" spellcheck="false">
          <button class="mini m${t.mute ? ' on' : ''}" title="Mute">M</button>
          <button class="mini s${t.solo ? ' on' : ''}" title="Solo">S</button>
          <button class="mini r${t.armed ? ' on' : ''}" title="Arm for recording">R</button>
          <button class="mini del" title="Delete track">✕</button>
        </div>
        <div class="th-knobs">
          <label>VOL<input type="range" class="vol" min="0" max="1.2" step="0.01" value="${t.volume}"></label>
          <label>PAN<input type="range" class="pan" min="-1" max="1" step="0.01" value="${t.pan}"></label>
          <label>FX<input type="range" class="fx" min="0" max="1" step="0.01" value="${t.reverb}"></label>
        </div>
      </div>
      <div class="lane" style="width:${cw}px"></div>`;
    rowsEl.appendChild(row);
  }
  for (const c of state.clips) renderClip(c);
  $('#emptyHint').classList.toggle('hidden', state.clips.length > 0);
  drawRuler();
  drawPlayhead();
  drawLoop();
}

function laneFor(trackId) {
  return rowsEl.querySelector(`.track-row[data-track="${trackId}"] .lane`);
}

function renderClip(clip) {
  let el = rowsEl.querySelector(`.clip[data-id="${clip.id}"]`);
  const lane = laneFor(clip.trackId);
  if (!lane) return;
  const track = trackById(clip.trackId);
  if (!el) {
    el = document.createElement('div');
    el.className = 'clip';
    el.dataset.id = clip.id;
    el.innerHTML = '<div class="clip-name"></div><canvas></canvas><div class="edge l"></div><div class="edge r"></div>';
  }
  if (el.parentElement !== lane) lane.appendChild(el);
  el.style.setProperty('--c', track.color);
  el.style.left = `${clip.start * pxPerSec()}px`;
  el.style.width = `${Math.max(4, clip.duration * pxPerSec())}px`;
  el.classList.toggle('selected', clip.id === state.selectedClipId);
  $('.clip-name', el).textContent = clip.name;
  $('.clip-name', el).title = clip.name;
  drawWave(clip, $('canvas', el));
}

function drawRuler() {
  const width = Math.max(1, scroller.clientWidth - headerW());
  const dpr = window.devicePixelRatio || 1;
  rulerCanvas.style.width = `${width}px`;
  rulerCanvas.style.height = '30px';
  rulerCanvas.width = width * dpr;
  rulerCanvas.height = 30 * dpr;
  const g = rulerCanvas.getContext('2d');
  g.scale(dpr, dpr);
  g.fillStyle = '#000';
  g.fillRect(0, 0, width, 30);
  const scroll = scroller.scrollLeft;
  const pxBeat = state.pxPerBeat;

  if (state.loop || state.loopEnd > state.loopStart) {
    const x0 = state.loopStart * pxPerSec() - scroll, x1 = state.loopEnd * pxPerSec() - scroll;
    g.fillStyle = state.loop ? 'rgba(168,85,247,0.45)' : 'rgba(168,85,247,0.15)';
    g.fillRect(x0, 0, x1 - x0, 6);
  }

  const barPx = pxBeat * 4;
  const barStep = barPx < 30 ? (barPx < 12 ? 8 : 4) : barPx < 60 ? 2 : 1;
  const firstBeat = Math.floor(scroll / pxBeat);
  const lastBeat = Math.ceil((scroll + width) / pxBeat);
  g.font = '10px ui-monospace, monospace';
  g.textBaseline = 'top';
  for (let b = firstBeat; b <= lastBeat; b++) {
    const x = Math.round(b * pxBeat - scroll) + 0.5;
    const isBar = b % 4 === 0;
    if (!isBar && pxBeat < 10) continue;
    g.strokeStyle = isBar ? 'rgba(192,132,252,0.8)' : 'rgba(168,85,247,0.35)';
    g.beginPath();
    g.moveTo(x, isBar ? 12 : 21);
    g.lineTo(x, 30);
    g.stroke();
    if (isBar && (b / 4) % barStep === 0) {
      g.fillStyle = '#d8c4ff';
      g.fillText(String(b / 4 + 1), x + 3, 10);
    }
  }
  const px = currentPos() * pxPerSec() - scroll;
  g.fillStyle = '#e879f9';
  g.beginPath();
  g.moveTo(px - 6, 18);
  g.lineTo(px + 6, 18);
  g.lineTo(px, 29);
  g.fill();
}

function drawPlayhead() {
  const pos = currentPos();
  $('#playhead').style.left = `${headerW() + pos * pxPerSec()}px`;
  const m = Math.floor(pos / 60), s = pos - m * 60;
  $('#timeDisplay').textContent = `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
  const beats = pos / secPerBeat();
  $('#barDisplay').textContent = `BAR ${Math.floor(beats / 4) + 1}.${Math.floor(beats % 4) + 1}`;
}

function drawLoop() {
  const el = $('#loopRegion');
  el.classList.toggle('hidden', !state.loop);
  el.style.left = `${headerW() + state.loopStart * pxPerSec()}px`;
  el.style.width = `${(state.loopEnd - state.loopStart) * pxPerSec()}px`;
}

function scrollToTime(t) {
  const x = t * pxPerSec();
  const view = scroller.clientWidth - headerW();
  if (x < scroller.scrollLeft || x > scroller.scrollLeft + view - 40) scroller.scrollLeft = Math.max(0, x - 40);
}

const meterCanvas = $('#meter');
const meterData = new Float32Array(analyser.fftSize);
let meterPeak = 0;
function drawMeter() {
  analyser.getFloatTimeDomainData(meterData);
  let peak = 0;
  for (const v of meterData) peak = Math.max(peak, Math.abs(v));
  meterPeak = Math.max(peak, meterPeak * 0.94);
  const g = meterCanvas.getContext('2d');
  const w = meterCanvas.width, h = meterCanvas.height;
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  const grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, '#6d28d9');
  grad.addColorStop(0.75, '#c084fc');
  grad.addColorStop(1, '#ff3d7f');
  g.fillStyle = grad;
  g.fillRect(0, 3, w * Math.min(1, meterPeak), h - 6);
}

function frame() {
  transportTick();
  if (state.playing) {
    drawPlayhead();
    drawRuler();
    const x = currentPos() * pxPerSec();
    const view = scroller.clientWidth - headerW();
    if (!drag && (x > scroller.scrollLeft + view - 30 || x < scroller.scrollLeft)) scroller.scrollLeft = Math.max(0, x - 30);
  }
  drawMeter();
  requestAnimationFrame(frame);
}

// ======================================================================
// Interaction: clip dragging / trimming
// ======================================================================
let drag = null;

function trackAtY(y) {
  for (const row of rowsEl.children) {
    const r = row.getBoundingClientRect();
    if (y >= r.top && y < r.bottom) return Number(row.dataset.track);
  }
  return null;
}

rowsEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const el = e.target.closest('.clip');
  if (!el) {
    if (e.target.classList.contains('lane')) {
      state.selectedClipId = null;
      rowsEl.querySelectorAll('.clip.selected').forEach((c) => c.classList.remove('selected'));
      const x = e.clientX - e.target.getBoundingClientRect().left;
      seek(snapTime(x / pxPerSec(), e.altKey));
      drawRuler();
    }
    return;
  }
  const clip = clipById(Number(el.dataset.id));
  const mode = e.target.classList.contains('l') ? 'trimL' : e.target.classList.contains('r') ? 'trimR' : 'move';
  state.selectedClipId = clip.id;
  rowsEl.querySelectorAll('.clip.selected').forEach((c) => c.classList.remove('selected'));
  el.classList.add('selected');
  drag = { clip, el, mode, x0: e.clientX, start: clip.start, offset: clip.offset, duration: clip.duration, moved: false };
  el.setPointerCapture(e.pointerId);
  e.preventDefault();
});

rowsEl.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const { clip } = drag;
  const dt = (e.clientX - drag.x0) / pxPerSec();
  if (Math.abs(e.clientX - drag.x0) > 2) drag.moved = true;
  if (!drag.moved) return;
  drag.el.classList.add('dragging');
  if (drag.mode === 'move') {
    clip.start = Math.max(0, snapTime(drag.start + dt, e.altKey));
    const tid = trackAtY(e.clientY);
    if (tid && tid !== clip.trackId) clip.trackId = tid;
  } else if (drag.mode === 'trimL') {
    const bufferStart = drag.start - drag.offset;
    let s = snapTime(drag.start + dt, e.altKey);
    s = Math.min(Math.max(s, bufferStart, 0), drag.start + drag.duration - MIN_CLIP);
    clip.start = s;
    clip.offset = drag.offset + (s - drag.start);
    clip.duration = drag.duration - (s - drag.start);
  } else {
    const bufferEnd = drag.start - drag.offset + clip.buffer.duration;
    let end = snapTime(drag.start + drag.duration + dt, e.altKey);
    end = Math.max(Math.min(end, bufferEnd), clip.start + MIN_CLIP);
    clip.duration = end - clip.start;
  }
  renderClip(clip);
});

function endDrag() {
  if (!drag) return;
  drag.el.classList.remove('dragging');
  const changed = drag.moved;
  drag = null;
  if (changed) {
    refreshPlayback();
    renderAll();
  }
}
rowsEl.addEventListener('pointerup', endDrag);
rowsEl.addEventListener('pointercancel', endDrag);

rowsEl.addEventListener('dblclick', (e) => {
  const el = e.target.closest('.clip');
  if (el) seek(clipById(Number(el.dataset.id)).start);
});

// Track header controls
rowsEl.addEventListener('click', (e) => {
  const row = e.target.closest('.track-row');
  if (!row || !e.target.classList.contains('mini')) return;
  const t = trackById(Number(row.dataset.track));
  const b = e.target;
  if (b.classList.contains('m')) t.mute = !t.mute;
  else if (b.classList.contains('s')) t.solo = !t.solo;
  else if (b.classList.contains('r')) return armTrack(t.id);
  else if (b.classList.contains('del')) {
    const n = state.clips.filter((c) => c.trackId === t.id).length;
    if (n && !confirm(`Delete “${t.name}” and its ${n} clip(s)?`)) return;
    return removeTrack(t.id);
  }
  b.classList.toggle('on');
  updateMix();
});

rowsEl.addEventListener('input', (e) => {
  const row = e.target.closest('.track-row');
  if (!row) return;
  const t = trackById(Number(row.dataset.track));
  const v = Number(e.target.value);
  if (e.target.classList.contains('vol')) t.volume = v;
  else if (e.target.classList.contains('pan')) t.pan = v;
  else if (e.target.classList.contains('fx')) t.reverb = v;
  else if (e.target.classList.contains('name')) { t.name = e.target.value; return; }
  updateMix();
});

rowsEl.addEventListener('dblclick', (e) => {
  if (!e.target.matches('.th-knobs input')) return;
  const t = trackById(Number(e.target.closest('.track-row').dataset.track));
  if (e.target.classList.contains('vol')) t.volume = e.target.value = 0.8;
  if (e.target.classList.contains('pan')) t.pan = e.target.value = 0;
  if (e.target.classList.contains('fx')) t.reverb = e.target.value = 0;
  updateMix();
});

// Drop audio files directly onto a lane
rowsEl.addEventListener('dragover', (e) => {
  const lane = e.target.closest('.lane');
  if (!lane) return;
  e.preventDefault();
  rowsEl.querySelectorAll('.lane.over').forEach((l) => l !== lane && l.classList.remove('over'));
  lane.classList.add('over');
});
rowsEl.addEventListener('dragleave', (e) => e.target.classList?.remove('over'));
rowsEl.addEventListener('drop', (e) => {
  const lane = e.target.closest('.lane');
  if (!lane) return;
  e.preventDefault();
  e.stopPropagation();
  lane.classList.remove('over');
  const x = e.clientX - lane.getBoundingClientRect().left;
  importFiles(e.dataTransfer.files, { trackId: Number(lane.parentElement.dataset.track), start: snapTime(x / pxPerSec()) });
});

// ======================================================================
// Ruler: seek / scrub, shift+drag sets loop region
// ======================================================================
let rulerDrag = null;
rulerCanvas.addEventListener('pointerdown', (e) => {
  const t = (e.offsetX + scroller.scrollLeft) / pxPerSec();
  rulerCanvas.setPointerCapture(e.pointerId);
  if (e.shiftKey) {
    const s = snapTime(t, e.altKey);
    rulerDrag = { mode: 'loop', anchor: s };
    state.loopStart = s;
    state.loopEnd = s;
  } else {
    rulerDrag = { mode: 'seek' };
    seek(snapTime(t, e.altKey));
  }
  drawRuler();
});
rulerCanvas.addEventListener('pointermove', (e) => {
  if (!rulerDrag) return;
  const t = Math.max(0, snapTime((e.offsetX + scroller.scrollLeft) / pxPerSec(), e.altKey));
  if (rulerDrag.mode === 'loop') {
    state.loopStart = Math.min(rulerDrag.anchor, t);
    state.loopEnd = Math.max(rulerDrag.anchor, t);
    drawLoop();
  } else if (!state.playing) {
    state.playhead = t;
    drawPlayhead();
  }
  drawRuler();
});
rulerCanvas.addEventListener('pointerup', () => {
  if (rulerDrag?.mode === 'loop' && state.loopEnd - state.loopStart > 0.05) {
    setLoop(true);
    setStatus(`Loop set: bar ${(state.loopStart / (4 * secPerBeat()) + 1).toFixed(2)} → ${(state.loopEnd / (4 * secPerBeat()) + 1).toFixed(2)}`, 'ok');
  }
  rulerDrag = null;
});

function setLoop(on) {
  state.loop = on;
  if (on && state.loopEnd - state.loopStart < 0.05) {
    state.loopStart = 0;
    state.loopEnd = songEnd() || 4 * 4 * secPerBeat();
  }
  $('#btnLoop').classList.toggle('active', on);
  drawLoop();
  drawRuler();
  refreshPlayback();
}

scroller.addEventListener('scroll', drawRuler);
window.addEventListener('resize', renderAll);

// ======================================================================
// Context menu
// ======================================================================
const menu = $('#ctxMenu');
function openMenu(x, y, items) {
  menu.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.innerHTML = `${it.label}${it.key ? `<span>${it.key}</span>` : ''}`;
    if (it.danger) b.className = 'danger';
    b.onclick = () => { closeMenu(); it.action(); };
    menu.appendChild(b);
  }
  menu.classList.remove('hidden');
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
}
function closeMenu() { menu.classList.add('hidden'); }
document.addEventListener('pointerdown', (e) => { if (!menu.contains(e.target)) closeMenu(); });

rowsEl.addEventListener('contextmenu', (e) => {
  const el = e.target.closest('.clip');
  if (!el) return;
  e.preventDefault();
  const clip = clipById(Number(el.dataset.id));
  state.selectedClipId = clip.id;
  renderAll();
  openMenu(e.clientX, e.clientY, [
    { label: 'Duplicate', key: 'Ctrl+D', action: () => duplicateClip(clip.id) },
    { label: 'Split at playhead', key: 'S', action: () => splitClip(clip.id, currentPos()) },
    { label: 'Rename…', action: () => { const n = prompt('Clip name', clip.name); if (n) { clip.name = n; renderAll(); } } },
    { label: 'Loop this clip', action: () => { state.loopStart = clip.start; state.loopEnd = clip.start + clip.duration; setLoop(true); } },
    { label: 'Move to new track', action: () => { const t = addTrack(clip.name); clip.trackId = t.id; renderAll(); } },
    { label: 'Delete', key: 'Del', danger: true, action: () => deleteClip(clip.id) },
  ]);
});

// ======================================================================
// Controls
// ======================================================================
function setBpm(v) {
  const bpm = Math.min(240, Math.max(40, Math.round(v) || 120));
  if (bpm === state.bpm) return;
  const wasPlaying = state.playing;
  if (wasPlaying) pause();
  state.bpm = bpm;
  $('#bpm').value = bpm;
  renderAll();
  if (wasPlaying) play();
}

$('#btnPlay').onclick = togglePlay;
$('#btnStop').onclick = stop;
$('#btnRec').onclick = () => (state.recording ? stopRecording() : startRecording());
$('#btnLoop').onclick = () => setLoop(!state.loop);
$('#btnAddTrack').onclick = () => addTrack(`Track ${state.tracks.length + 1}`);
$('#btnExport').onclick = exportMix;
$('#bpm').onchange = (e) => setBpm(Number(e.target.value));
$('#snap').onchange = (e) => (state.snap = Number(e.target.value));
$('#zoom').oninput = (e) => {
  const center = (scroller.scrollLeft + (scroller.clientWidth - headerW()) / 2) / pxPerSec();
  state.pxPerBeat = Number(e.target.value);
  renderAll();
  scroller.scrollLeft = Math.max(0, center * pxPerSec() - (scroller.clientWidth - headerW()) / 2);
  drawRuler();
};
$('#monitor').onchange = (e) => { if (mic) mic.monitor.gain.value = e.target.checked ? 1 : 0; };
$('#micSelect').onchange = () => { if (mic && !state.recording) releaseMic(); };

// Tabs
document.querySelectorAll('.tabs button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.tabs button, .tab').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    $(`#tab-${b.dataset.tab}`).classList.add('active');
    if (b.dataset.tab === 'voice') populateMics();
  };
});

// Import tab
const dropZone = $('#dropZone');
$('#fileInput').onchange = (e) => { importFiles(e.target.files); e.target.value = ''; };
['dragenter', 'dragover'].forEach((ev) => dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => dropZone.addEventListener(ev, () => dropZone.classList.remove('over')));
dropZone.addEventListener('drop', (e) => { e.preventDefault(); importFiles(e.dataTransfer.files); });

// Voice tab
$('#vocalInput').onchange = (e) => {
  const armed = state.tracks.find((t) => t.armed);
  importFiles(e.target.files, { trackId: armed?.id ?? null, start: snapTime(state.playhead) });
  e.target.value = '';
};

// AI tab
const chips = $('#chips');
for (const p of EXAMPLE_PROMPTS) {
  const c = document.createElement('button');
  c.className = 'chip';
  c.textContent = p;
  c.onclick = () => { $('#prompt').value = p; };
  chips.appendChild(c);
}
$('#btnGen').onclick = generate;
$('#prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate(); });

// Whole-window file drop falls back to importing as a new track
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer?.files?.length && !e.target.closest('.lane, .drop')) importFiles(e.dataTransfer.files);
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input[type="text"], input[type="url"], input[type="number"], input.name, textarea, select')) return;
  const sel = state.selectedClipId;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { if (sel) { e.preventDefault(); deleteClip(sel); } }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); if (sel) duplicateClip(sel); }
  else if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) { if (sel) splitClip(sel, currentPos()); }
  else if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey) { state.recording ? stopRecording() : startRecording(); }
  else if (e.key.toLowerCase() === 'l' && !e.ctrlKey && !e.metaKey) setLoop(!state.loop);
  else if (e.key === 'Home' || e.key === 'Enter') { seek(0); scrollToTime(0); }
  else if (e.key === 'Escape') closeMenu();
});

// ======================================================================
// UI helpers
// ======================================================================
function setStatus(msg, kind = '') {
  const el = $('#status');
  el.textContent = msg;
  el.className = `status ${kind}`;
}
function showBusy(text) { $('#busyText').textContent = text; $('#busy').classList.remove('hidden'); }
function hideBusy() { $('#busy').classList.add('hidden'); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ======================================================================
// Boot
// ======================================================================
addTrack('Instrumental');
addTrack('Vocals', { reverb: 0.15, armed: true });
setStatus('Ready. Import an instrumental or generate a beat.');
requestAnimationFrame(frame);

// Exposed for debugging in the console.
window.studio = { state, ctx, generate, exportMix };
