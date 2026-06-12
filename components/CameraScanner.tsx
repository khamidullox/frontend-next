'use client';

import { useEffect, useRef, useState } from 'react';

// Нативный Barcode Detection API (Chrome на Android, Edge). Без npm-зависимостей.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare global { interface Window { BarcodeDetector?: any } }

export function isCameraScanSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'BarcodeDetector' in window &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

export default function CameraScanner({
  onDetected,
  onClose,
  continuous = false,
}: {
  onDetected: (code: string) => void;
  onClose: () => void;
  // continuous: не останавливаться после первого скана (для проверки нескольких позиций)
  continuous?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const lastCode = useRef('');
  const lastAt = useRef(0);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let detector: any = null;

    async function start() {
      try {
        if (!isCameraScanSupported()) {
          setError('Камера-сканер не поддерживается этим браузером. Используйте Chrome на Android или USB-сканер.');
          return;
        }
        detector = new window.BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf', 'codabar'],
        });
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        tick();
      } catch (e) {
        setError('Нет доступа к камере: ' + (e as Error).message);
      }
    }

    async function tick() {
      if (stopped || !videoRef.current || !detector) return;
      try {
        const codes = await detector.detect(videoRef.current);
        if (codes.length > 0) {
          const value = String(codes[0].rawValue || '').trim();
          const now = Date.now();
          // в непрерывном режиме один и тот же ШК не чаще раза в 1.5с
          const isDup = value === lastCode.current && now - lastAt.current < 1500;
          if (value && !isDup) {
            lastCode.current = value;
            lastAt.current = now;
            if (navigator.vibrate) navigator.vibrate(60);
            onDetected(value);
            if (!continuous) return; // одиночный режим — родитель закроет
            setFlash(value);
            setTimeout(() => setFlash(''), 800);
          }
        }
      } catch {
        // отдельные кадры могут падать — игнорируем
      }
      raf = requestAnimationFrame(tick);
    }

    start();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
  }, [onDetected, continuous]);

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex flex-col items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl overflow-hidden w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="relative bg-black aspect-[3/4]">
          <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
          {/* Рамка прицела */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-3/4 h-1/3 border-2 border-green-400 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        </div>
        <div className="p-3">
          {error ? (
            <p className="text-red-500 text-sm mb-2">{error}</p>
          ) : flash ? (
            <p className="text-xs text-green-600 font-semibold mb-2 text-center">✓ {flash}</p>
          ) : (
            <p className="text-xs text-gray-500 mb-2 text-center">
              Наведите камеру на штрихкод{continuous ? ' (можно подряд)' : ''}
            </p>
          )}
          <button
            onClick={onClose}
            className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 rounded-xl font-semibold text-gray-700 text-sm"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
