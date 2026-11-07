// Sound cues for a loud kitchen, made with the browser's own audio, so there
// are no sound files to license. Browsers allow audio after the first click.
let audio;

function beep(freq, start, length, wave = "sine", volume = 0.25) {
  audio ??= new (window.AudioContext || window.webkitAudioContext)();
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  const t = audio.currentTime + start;
  osc.type = wave;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + length);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + length);
}

export const chime = () => { beep(660, 0, 0.18); beep(990, 0.15, 0.3); };          // rising: good
export const buzz = () => { beep(170, 0, 0.25, "square", 0.15); beep(170, 0.32, 0.25, "square", 0.15); }; // low: fix it

export function say(text) {
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}
