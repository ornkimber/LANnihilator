export type Cue = "cover" | "click" | "siren" | "sever" | "restore" | "failure";
let context: AudioContext | undefined;
let muted = false;
const active = new Set<OscillatorNode>();
export function setMuted(value: boolean): void {
  muted = value;
  if (value)
    for (const oscillator of active) {
      try {
        oscillator.stop();
      } catch {
        /* Already stopped. */
      }
    }
}
export function play(cue: Cue): void {
  if (muted) return;
  try {
    context ??= new AudioContext();
    void context.resume().catch(() => {});
    const now = context.currentTime;
    const tones: Record<Cue, [number, number, number, number][]> = {
      cover: [
        [190, 70, 0, 0.12],
        [900, 250, 0.08, 0.06],
      ],
      click: [[150, 40, 0, 0.08]],
      siren: [
        [440, 800, 0, 0.25],
        [800, 440, 0.25, 0.25],
        [440, 800, 0.5, 0.25],
      ],
      sever: [
        [350, 60, 0, 0.35],
        [75, 40, 0.2, 0.25],
      ],
      restore: [
        [330, 330, 0, 0.12],
        [440, 440, 0.13, 0.12],
        [660, 660, 0.26, 0.2],
      ],
      failure: [
        [95, 85, 0, 0.18],
        [95, 75, 0.23, 0.22],
      ],
    };
    for (const [from, to, delay, duration] of tones[cue]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = cue === "siren" ? "sine" : "triangle";
      oscillator.frequency.setValueAtTime(from, now + delay);
      oscillator.frequency.exponentialRampToValueAtTime(
        to,
        now + delay + duration,
      );
      gain.gain.setValueAtTime(0, now + delay);
      gain.gain.linearRampToValueAtTime(0.075, now + delay + 0.007);
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + duration);
      oscillator.connect(gain).connect(context.destination);
      active.add(oscillator);
      oscillator.onended = () => {
        active.delete(oscillator);
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(now + delay);
      oscillator.stop(now + delay + duration + 0.01);
    }
  } catch {
    /* Audio failure must never prevent an adapter operation. */
  }
}
