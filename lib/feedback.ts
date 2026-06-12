// Звук + вибрация при сканировании — без файлов, через Web Audio API.
// Кладовщик слышит результат, не глядя на экран.

import type { ScanStatus } from './api';

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  // на iOS контекст может быть suspended до первого жеста
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq: number, durationMs: number, when = 0, volume = 0.15) {
  const audio = getCtx();
  if (!audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'square';
  osc.frequency.value = freq;
  gain.gain.value = volume;
  osc.connect(gain);
  gain.connect(audio.destination);
  const start = audio.currentTime + when;
  osc.start(start);
  osc.stop(start + durationMs / 1000);
}

function vibrate(pattern: number | number[]) {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(pattern);
  }
}

// Чистый высокий «пик» — позиция полностью собрана
function chimeOk() {
  tone(880, 90);
  vibrate(40);
}

// Двойной короткий — частично / принято, но не до конца
function chimePartial() {
  tone(660, 70);
  tone(660, 70, 0.11);
  vibrate([30, 40, 30]);
}

// Низкий «бзз» — ошибка (не найден / перебор)
function chimeError() {
  tone(180, 260, 0, 0.2);
  vibrate([120, 60, 120]);
}

export function feedbackForScan(status: ScanStatus) {
  switch (status) {
    case 'done':
    case 'manual':
      chimeOk();
      break;
    case 'partial':
      chimePartial();
      break;
    case 'not_found':
    case 'over_scanned':
      chimeError();
      break;
  }
}
