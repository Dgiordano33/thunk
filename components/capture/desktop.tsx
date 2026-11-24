"use client";
import { useEffect } from 'react';
import { CaptureInput } from './capture-input';
type Bridge = { hide: () => void; onShown?: (callback: () => void) => () => void };
const bridge = () => (window as Window & { thunkCapture?: Bridge }).thunkCapture;

/** The desktop app's floating Capture window. It stays loaded between uses, so each opening refocuses the field. */
export function DesktopCapture() {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') bridge()?.hide(); };
    window.addEventListener('keydown', key);
    const off = bridge()?.onShown?.(() => document.querySelector<HTMLInputElement>('input[aria-label="take a crack at"]')?.focus());
    return () => { window.removeEventListener('keydown', key); off?.(); };
  }, []);
  return <main className="p-5"><CaptureInput onSent={() => bridge()?.hide()} /></main>;
}
