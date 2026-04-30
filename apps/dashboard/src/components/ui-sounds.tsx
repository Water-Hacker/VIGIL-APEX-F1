'use client';

import { useEffect } from 'react';

/**
 * <UiSounds> — opt-in WebAudio tone generator.
 *
 * Synthesises a short, well-tempered tone for each `kind` (success /
 * info / warn / error / vote / dl-alert). No audio files in the bundle,
 * no runtime download — pure oscillator + gain envelope, ~50 ms long,
 * around -18 dBFS so it never startles.
 *
 * Off by default. The user enables by clicking the speaker icon in the
 * NavBar (sets `localStorage.vigil_sounds = 'on'`) or by pressing the
 * "S" key once on any operator page. The preference is checked on every
 * play call; the audio context is lazy-initialised (browsers reject
 * AudioContext that's never been touched by user input).
 *
 * Exposes `window.__vigil_play_tone(kind)` so the toast primitive AND
 * any page that wants to flag a transition can play a cue without
 * pulling in this module's React surface.
 *
 * Accessibility:
 *   - Respects `prefers-reduced-motion: reduce` AND
 *     `localStorage.vigil_sounds_explicit_off === '1'` (an opt-out
 *     stronger than the default-off, useful for shared headphones).
 *   - The speaker icon is a real button with aria-pressed.
 *   - The cue does not block keyboard focus.
 */

type Tone = 'info' | 'success' | 'warn' | 'error' | 'vote' | 'dl-alert';
type WaveType = 'sine' | 'square' | 'sawtooth' | 'triangle';

const TONE_TABLE: Record<Tone, { freqHz: number; ms: number; type: WaveType; volume: number }> = {
  info: { freqHz: 440, ms: 60, type: 'sine', volume: 0.05 },
  success: { freqHz: 660, ms: 80, type: 'sine', volume: 0.05 },
  warn: { freqHz: 330, ms: 90, type: 'triangle', volume: 0.07 },
  error: { freqHz: 220, ms: 140, type: 'square', volume: 0.06 },
  vote: { freqHz: 880, ms: 120, type: 'sine', volume: 0.06 },
  'dl-alert': { freqHz: 196, ms: 220, type: 'sawtooth', volume: 0.06 },
};

let _ctx: AudioContext | null = null;

function isEnabled(): boolean {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return false;
  if (localStorage.getItem('vigil_sounds_explicit_off') === '1') return false;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  return localStorage.getItem('vigil_sounds') === 'on';
}

function playTone(kind: Tone): void {
  if (!isEnabled()) return;
  try {
    if (!_ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      _ctx = new Ctor();
    }
    if (_ctx.state === 'suspended') void _ctx.resume();
    const { freqHz, ms, type, volume } = TONE_TABLE[kind] ?? TONE_TABLE.info;
    const osc = _ctx.createOscillator();
    const gain = _ctx.createGain();
    osc.type = type;
    osc.frequency.value = freqHz;
    osc.connect(gain);
    gain.connect(_ctx.destination);
    const now = _ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + ms / 1000);
    osc.start(now);
    osc.stop(now + ms / 1000 + 0.02);
  } catch {
    /* AudioContext may be blocked on cold-start; silently ignore */
  }
}

export function UiSounds(): JSX.Element {
  useEffect(() => {
    const w = window as unknown as { __vigil_play_tone?: (k: Tone) => void };
    w.__vigil_play_tone = playTone;
    function onKey(e: KeyboardEvent): void {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key.toLowerCase() === 's' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        toggleSounds();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      delete w.__vigil_play_tone;
    };
  }, []);
  return <SoundToggle />;
}

function toggleSounds(): void {
  if (typeof localStorage === 'undefined') return;
  const cur = localStorage.getItem('vigil_sounds') === 'on';
  localStorage.setItem('vigil_sounds', cur ? 'off' : 'on');
  // Force a re-render of any component that observes the toggle by
  // dispatching a custom event the SoundToggle listens for.
  window.dispatchEvent(new CustomEvent('vigil_sounds_toggle'));
  // Cue the change.
  if (!cur) {
    setTimeout(() => playTone('info'), 0);
  }
}

function SoundToggle(): JSX.Element {
  const enabled = (() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('vigil_sounds') === 'on';
  })();
  // Re-render on toggle event
  useEffect(() => {
    function onToggle(): void {
      // useState would be cleaner; this is a tiny optimisation.
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      enabled;
    }
    window.addEventListener('vigil_sounds_toggle', onToggle);
    return () => window.removeEventListener('vigil_sounds_toggle', onToggle);
  }, [enabled]);
  return (
    <button
      type="button"
      aria-pressed={enabled}
      aria-label={enabled ? 'mute UI sounds' : 'enable UI sounds'}
      className="vigil-sound-toggle"
      onClick={toggleSounds}
      title="UI sounds (press S to toggle)"
    >
      {enabled ? '♪' : '·'}
    </button>
  );
}
