/* ============================================================================
 * audio.js — placeholder sound, synthesised so there are no audio files.
 *
 * docs/DESIGN.md asks only for placeholders in the slice: a soft sound per
 * deploy, a squelch when a Devourer eats, a rising tone as the Alarm climbs
 * past 60. Real sound design comes after the slice proves fun.
 *
 * Rules this module keeps:
 *   - The AudioContext is created on the first user gesture (browsers refuse
 *     to start one before), and never before the player has touched anything.
 *   - It must never throw. No AudioContext (old browser, locked-down webview)
 *     means silence, not a broken game.
 *   - Sounds are rate-limited per kind, so thirty Devourers eating in the same
 *     second do not become one loud buzz.
 * ========================================================================= */

let ctx = null;
let master = null;
let enabled = true;
const last = new Map();

export function setSoundEnabled(on) {
  enabled = !!on;
  if (master) master.gain.value = enabled ? 0.5 : 0;
}

/* Call from any user-gesture handler. Safe to call repeatedly. */
export function unlockAudio() {
  if (ctx) {
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return;
  }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = enabled ? 0.5 : 0;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
}

function ready(kind, gapMs) {
  if (!ctx || !enabled) return false;
  const now = performance.now();
  if (now - (last.get(kind) || 0) < gapMs) return false;
  last.set(kind, now);
  return true;
}

function tone(freq, dur, { type = "sine", gain = 0.2, slideTo = null, delay = 0 } = {}) {
  try {
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  } catch { /* never let sound break the game */ }
}

function noise(dur, { gain = 0.2, freq = 900 } = {}) {
  try {
    const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(master);
    src.start();
  } catch { /* silence is fine */ }
}

/* One entry point: the battle hands over the sim's events each frame. */
export function playEvents(events) {
  if (!ctx || !enabled) return;
  for (const e of events) {
    switch (e.type) {
      case "deploy": if (ready("deploy", 60)) tone(520, 0.12, { type: "triangle", gain: 0.16, slideTo: 780 }); break;
      case "eat": if (ready("eat", 110)) noise(0.12, { gain: 0.22, freq: 500 }); break;
      case "kill": if (ready("kill", 70)) tone(300, 0.08, { type: "square", gain: 0.05, slideTo: 180 }); break;
      case "ping": if (ready("ping", 400)) tone(880, 0.25, { gain: 0.12, slideTo: 1320 }); break;
      case "leak": if (ready("leak", 200)) tone(160, 0.3, { type: "sawtooth", gain: 0.08, slideTo: 90 }); break;
      case "burst": if (ready("burst", 150)) noise(0.2, { gain: 0.18, freq: 1600 }); break;
      case "sample": tone(660, 0.18, { gain: 0.14 }); tone(990, 0.22, { gain: 0.12, delay: 0.12 }); break;
      case "trained":
        tone(523, 0.2, { gain: 0.14 }); tone(659, 0.2, { gain: 0.14, delay: 0.15 }); tone(784, 0.35, { gain: 0.14, delay: 0.3 });
        break;
      case "copy": if (ready("copy", 120)) tone(1046, 0.1, { gain: 0.08 }); break;
      case "storm": noise(0.8, { gain: 0.3, freq: 300 }); tone(110, 0.8, { type: "sawtooth", gain: 0.1 }); break;
      case "phaseEnd": tone(440, 0.2, { gain: 0.1 }); tone(660, 0.3, { gain: 0.1, delay: 0.12 }); break;
      case "won":
        [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, { gain: 0.14, delay: i * 0.12 }));
        break;
      case "lost": [392, 330, 262].forEach((f, i) => tone(f, 0.4, { type: "triangle", gain: 0.12, delay: i * 0.18 })); break;
      default: break;
    }
  }
}

/* The Alarm above 60: a low pulse, faster the higher it goes. */
export function alarmPulse(alarm) {
  if (alarm <= 60) return;
  const gap = 1400 - (alarm - 60) * 22;
  if (ready("alarm", Math.max(350, gap))) tone(196 + (alarm - 60) * 3, 0.18, { type: "triangle", gain: 0.07 });
}
