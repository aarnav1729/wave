import { useEffect, useState } from "react";

const DIGI_ORIGIN =
  (import.meta as any).env?.VITE_DIGI_ORIGIN || "https://digi.premierenergies.com";

function redirectToDigi(returnTo: string) {
  const base = String(DIGI_ORIGIN).replace(/\/+$/, "");
  window.location.replace(`${base}/login?returnTo=${encodeURIComponent(returnTo)}`);
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const run = async () => {
      try {
        const doSession = async () =>
          fetch("/api/session", { credentials: "include" });

        let r = await doSession();

        if (r.status === 401) {
          const rr = await fetch("/auth/refresh", {
            method: "POST",
            credentials: "include",
          }).catch(() => null);

          if (rr && rr.ok) r = await doSession();
        }

        if (!r.ok) {
          redirectToDigi(window.location.href);
          return;
        }

        setReady(true);
      } catch {
        redirectToDigi(window.location.href);
      }
    };
    run();
  }, []);

  if (!ready) return null;
  return <>{children}</>;
}