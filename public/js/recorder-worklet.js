// Captures microphone samples with the AudioContext time of the first block,
// so recorded vocals can be placed sample-accurately on the timeline.
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.port.onmessage = (e) => {
      if (e.data === 'start') { this.recording = true; this.started = false; }
      if (e.data === 'stop') { this.recording = false; this.port.postMessage({ type: 'done' }); }
    };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (this.recording && ch) {
      if (!this.started) { this.started = true; this.port.postMessage({ type: 'start', time: currentTime }); }
      this.port.postMessage({ type: 'data', samples: ch.slice(0) });
    }
    return true;
  }
}
registerProcessor('recorder', RecorderProcessor);
