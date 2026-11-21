class RobotSoundEngine {
  private ctx: AudioContext | null = null;
  public muted = false;

  private getContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private playTone(freqStart: number, freqEnd: number, duration: number, type: OscillatorType = 'sine', gainVal = 0.08, delay = 0) {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, now);
    if (freqEnd !== freqStart) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), now + duration);
    }

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(gainVal, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  playBoot() {
    this.playTone(380, 540, 0.14, 'sine', 0.07, 0);
    this.playTone(540, 760, 0.16, 'sine', 0.08, 0.12);
    this.playTone(760, 1040, 0.22, 'triangle', 0.07, 0.25);
  }

  playChirp(high = false) {
    const base = high ? 780 : 560;
    this.playTone(base, base * 1.28, 0.09, 'sine', 0.06, 0);
  }

  playPoke(annoyed: boolean) {
    if (annoyed) {
      this.playTone(320, 180, 0.12, 'sawtooth', 0.05, 0);
      this.playTone(260, 150, 0.14, 'square', 0.04, 0.1);
    } else {
      this.playTone(620, 390, 0.11, 'triangle', 0.07, 0);
    }
  }

  playPurr() {
    this.playTone(240, 280, 0.18, 'sine', 0.06, 0);
    this.playTone(360, 420, 0.22, 'sine', 0.05, 0.12);
    this.playTone(480, 560, 0.24, 'triangle', 0.05, 0.26);
  }

  playShutter() {
    this.playTone(960, 620, 0.06, 'triangle', 0.06, 0);
    this.playTone(1180, 880, 0.07, 'sine', 0.05, 0.06);
  }

  playSingMelody() {
    const notes = [523.25, 659.25, 783.99, 659.25, 1046.5];
    notes.forEach((n, idx) => {
      this.playTone(n, n * 1.02, 0.14, 'triangle', 0.06, idx * 0.13);
    });
  }
}

export const soundFx = new RobotSoundEngine();
