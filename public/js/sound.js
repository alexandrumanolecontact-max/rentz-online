let audioCtx = null;

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playTone({ freq = 440, type = 'sine', duration = 0.1, gain = 0.12, delay = 0 } = {}) {
  const ctx = getAudioContext();
  if (!ctx) return;

  const start = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);

  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(g);
  g.connect(ctx.destination);

  osc.start(start);
  osc.stop(start + duration + 0.02);
}

export function playCardTapSound(volume = 0.7) {
  const v = Math.max(0, Math.min(1, volume)) * 0.14;
  if (v <= 0.002) return;
  playTone({ freq: 260, type: 'triangle', duration: 0.055, gain: v });
}

export function playYourTurnAlert(volume = 0.7) {
  const v = Math.max(0, Math.min(1, volume)) * 0.16;
  if (v <= 0.002) return;
  playTone({ freq: 587.33, type: 'sine', duration: 0.11, gain: v, delay: 0 });
  playTone({ freq: 783.99, type: 'sine', duration: 0.16, gain: v, delay: 0.09 });
}

export function playCountdownTick(volume = 0.7) {
  const v = Math.max(0, Math.min(1, volume)) * 0.1;
  if (v <= 0.002) return;
  playTone({ freq: 880, type: 'sine', duration: 0.045, gain: v });
}

export function triggerTurnVibration() {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(75);
    } catch {
      // Ignorăm dacă dispozitivul nu suportă vibrații
    }
  }
}
