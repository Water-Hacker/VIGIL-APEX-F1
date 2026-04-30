'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/**
 * <ToastProvider> + useToast() — minimal accessible notification primitive.
 *
 * Design constraints:
 *   - Zero deps. ~120 LOC.
 *   - Auto-dismiss after `duration_ms` (default 4500), pausable on hover.
 *   - Stacks bottom-right; aria-live=polite for non-error, =assertive for error.
 *   - Keyboard-accessible Close button + Escape dismisses the most recent.
 *   - Hooks into `<UiSounds>` if mounted: tone={success|warn|error|info}.
 *
 * Usage:
 *
 *   const toast = useToast();
 *   toast.push({ kind: 'success', title: 'Vote recorded', body: '4-of-5 quorum' });
 *
 * The provider is mounted once at the operator-pages layout level.
 */

export type ToastKind = 'info' | 'success' | 'warn' | 'error';

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  body?: string;
  duration_ms?: number;
}

interface ToastApi {
  push: (t: Omit<Toast, 'id'>) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) {
    // Silent no-op when no provider mounted (e.g. public-portal pages).
    return { push: () => '', dismiss: () => undefined, clear: () => undefined };
  }
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const tm = timersRef.current.get(id);
    if (tm) {
      clearTimeout(tm);
      timersRef.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const full: Toast = { id, duration_ms: 4500, ...t };
      setToasts((prev) => [...prev.slice(-7), full]);
      const tm = setTimeout(() => dismiss(id), full.duration_ms);
      timersRef.current.set(id, tm);
      // Best-effort sound cue
      const w = window as unknown as { __vigil_play_tone?: (k: ToastKind) => void };
      try {
        w.__vigil_play_tone?.(full.kind);
      } catch {
        /* ignore */
      }
      return id;
    },
    [dismiss],
  );

  const clear = useCallback(() => {
    for (const tm of timersRef.current.values()) clearTimeout(tm);
    timersRef.current.clear();
    setToasts([]);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && toasts.length > 0) {
        const last = toasts[toasts.length - 1];
        if (last) dismiss(last.id);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toasts, dismiss]);

  const api = useMemo(() => ({ push, dismiss, clear }), [push, dismiss, clear]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div role="region" aria-label="notifications" className="vigil-toast-stack">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            aria-live={t.kind === 'error' ? 'assertive' : 'polite'}
            className={`vigil-toast vigil-toast-${t.kind}`}
            data-kind={t.kind}
            onMouseEnter={() => {
              const tm = timersRef.current.get(t.id);
              if (tm) clearTimeout(tm);
            }}
            onMouseLeave={() => {
              const tm = setTimeout(() => dismiss(t.id), 1500);
              timersRef.current.set(t.id, tm);
            }}
          >
            <div className="vigil-toast-title">{t.title}</div>
            {t.body && <div className="vigil-toast-body">{t.body}</div>}
            <button
              type="button"
              className="vigil-toast-close"
              aria-label="dismiss"
              onClick={() => dismiss(t.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
