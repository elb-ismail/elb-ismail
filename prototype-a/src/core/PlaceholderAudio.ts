import type { EventBus } from './EventBus';
import type { Rng } from './Rng';

// Two placeholder tones, nothing more: a soft chime when the beacon is planted and a low note on arriving
// home. Pitch variation uses the audio RNG stream, which never feeds back into the simulation.
// Deliberately silent about the doorway.

export class PlaceholderAudio {
  private ctx: AudioContext | null = null;

  constructor(bus: EventBus, private rng: Rng) {
    bus.on(e => {
      if (e.type === 'beaconPlanted') this.tone(660, 0.9, 0.08);
      if (e.type === 'homeReached') this.tone(196, 1.4, 0.1);
    });
  }

  /** Browsers only allow audio after a user gesture. */
  unlock(): void {
    if (this.ctx) return;
    try { this.ctx = new AudioContext(); } catch { this.ctx = null; }
  }

  private tone(freq: number, seconds: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = freq * (1 + this.rng.range(-0.02, 0.02));
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + seconds + 0.05);
    o.onended = () => { o.disconnect(); g.disconnect(); };
  }
}
