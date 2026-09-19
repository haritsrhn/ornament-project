"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";

type ToastFn = (message: string) => void;

const ToastContext = createContext<ToastFn>(() => {});

/** Every successful admin action confirms with the same dark pill, ~2.6s. */
export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState("");
  // React 19: useRef wajib punya argumen awal (tidak ada lagi overload 0-argumen).
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const toast = useCallback((next: string) => {
    setMessage(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(""), 2600);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div aria-live="polite" role="status">
        {message ? (
          <div className="fixed bottom-6.6 left-1/2 z-[90] flex -translate-x-1/2 items-center gap-2.5 rounded-pill bg-neutral-900 px-[22px] py-3.5 text-admin text-[#f5ead8] shadow-lg">
            <Check size={16} strokeWidth={2.75} className="text-accent-400" aria-hidden />
            {message}
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}
