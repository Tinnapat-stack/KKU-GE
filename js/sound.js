// The two short sounds the app makes, built out of oscillators rather than files.
//
// This project ships no dependencies and no build step, and every byte here also has
// to be cached for offline use, so a pair of mp3s would be the most expensive part of
// the app. Two sine notes describe "saved" just as well and cost nothing.
//
// Income rises, expense falls. They are the same interval in opposite directions, so
// they sound like one family, and the direction alone says which one happened without
// the user looking at the screen.
//
// Adding another moment later means one more entry in TUNES and one call to play().

const KEY = 'psw_sound';

// Deliberately quiet. This is a confirmation, not an alert.
const MASTER = 0.14;

const TUNES = {
  // A5 then E6
  income: { notes: [880, 1318.51], gap: 0.07, hold: 0.16, level: 1 },
  // E5 then A4, and a touch softer, because money leaving should not feel like a prize
  expense: { notes: [659.25, 440], gap: 0.075, hold: 0.18, level: 0.85 },
};

let audio = null;
let master = null;

export function soundOn() {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

// Built on demand, never at load: a browser blocks an AudioContext created outside a
// user gesture and leaves it suspended forever.
function context() {
  if (audio) return audio;

  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;

  try {
    audio = new Ctor();
  } catch {
    return null;
  }

  master = audio.createGain();
  master.gain.value = MASTER;
  master.connect(audio.destination);
  return audio;
}

function note(ctx, freq, at, hold, level) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, at);

  // A note that starts at full volume clicks, so it fades in over 12ms and then
  // decays. Exponential ramps cannot touch zero, hence the tiny floor.
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(level, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + hold);

  osc.connect(gain);
  gain.connect(master);

  osc.start(at);
  osc.stop(at + hold + 0.02);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
}

// Called from a click handler, which is what makes resuming allowed.
export function play(name) {
  if (!soundOn()) return;

  const tune = TUNES[name];
  if (!tune) return;

  const ctx = context();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => null);

  const start = ctx.currentTime + 0.01;
  tune.notes.forEach((freq, i) => {
    note(ctx, freq, start + i * tune.gap, tune.hold, tune.level);
  });
}

export function initSound() {
  const box = document.getElementById('sound-toggle');
  if (!box) return;

  box.checked = soundOn();
  box.addEventListener('change', () => {
    try {
      localStorage.setItem(KEY, box.checked ? 'on' : 'off');
    } catch {
      // Storage blocked: the setting still holds for this visit.
    }
    // Turning it on is itself a tap, so this is a legal moment to wake the audio up
    // and let the user hear what they just switched on.
    if (box.checked) play('income');
  });

  // Waking the audio on the first tap anywhere means the first save is not the one
  // that gets swallowed while iOS is still resuming.
  const wake = () => {
    if (!soundOn()) return;
    const ctx = context();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => null);
  };
  window.addEventListener('pointerdown', wake, { once: true });
  window.addEventListener('keydown', wake, { once: true });
}
