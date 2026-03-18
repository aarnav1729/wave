// src/App.tsx
import React, { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";

import Login from "./pages/Login";
import Overview from "./pages/Overview";
import RequestForm from "./pages/RequestForm";
import SWAVEDetail from "./pages/SWAVEDetail";
import Analytics from "./pages/Analytics";
import Security from "./pages/Security";
import Masters from "./pages/Masters";
import NotFound from "./pages/NotFound";

import {
  initializeDefaultData,
  getCurrentUser,
  setCurrentUser,
  type Employee,
} from "./lib/storage";

const queryClient = new QueryClient();

// ✅ Configure DIGI origin via env (recommended), falls back to prod URL.
const DIGI_ORIGIN =
  (import.meta as any).env?.VITE_DIGI_ORIGIN?.trim() ||
  "https://digi.premierenergies.com";

const SECURITY_EMAIL = "northgate.p2@premierenergies.com";

function isSecurityEmail(email?: string | null) {
  return (
    String(email || "").trim().toLowerCase() === SECURITY_EMAIL
  );
}

function redirectToDigiLogin(returnTo?: string) {
  const to = returnTo || window.location.href;

  // DIGI Login supports: ?returnTo=<absoluteUrl> (standardize across apps)
  const url = `${DIGI_ORIGIN}/login?returnTo=${encodeURIComponent(to)}`;
  window.location.replace(url);
}

async function fetchWaveSessionEmail(): Promise<string | null> {
  const doSession = () =>
    fetch("/api/session", {
      credentials: "include",
    });

  let r = await doSession();

  // If access expired but refresh exists, refresh once then retry (DIGI-style)
  if (r.status === 401) {
    const rr = await fetch("/auth/refresh", {
      method: "POST",
      credentials: "include",
    }).catch(() => null);

    if (rr && rr.ok) {
      r = await doSession();
    }
  }

  if (!r.ok) return null;

  const data = await r.json().catch(() => null);
  const email = data?.user?.email || data?.email || null;
  return email ? String(email).trim().toLowerCase() : null;
}

async function fetchEmployeeByEmail(email: string): Promise<Employee | null> {
  try {
    const res = await fetch(
      `/api/employees/email/${encodeURIComponent(email)}`,
      {
        credentials: "include",
      }
    );
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    return (json?.data as Employee) || null;
  } catch {
    return null;
  }
}

/**
 * Bootstraps SSO:
 * - verifies DIGI-issued cookies via WAVE backend (/api/session)
 * - hydrates current employee into localStorage (wave_current_user)
 * - then loads default data (employees/requests) AFTER auth is valid
 */
const SsoBootstrap = ({ children }: { children: React.ReactNode }) => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const email = await fetchWaveSessionEmail();

        if (!email) {
          // No valid SSO -> clear local user (avoid stale login)
          setCurrentUser(null);
          if (!cancelled) setReady(true);
          return;
        }

        // Resolve full employee record from WAVE API (which should source from DIGI/EMP)
        const emp = await fetchEmployeeByEmail(email);

        if (emp) {
          setCurrentUser(emp);
        } else {
          // Fallback: minimal shape to avoid crashes if EMP lookup fails
          setCurrentUser({
            empid: email,
            empemail: email,
            empname: email,
            dept: "",
            subdept: "",
            emplocation: "",
            designation: "",
            activeflag: 1,
            managerid: "",
          });
        }

        // Now that auth is valid, hydrate app caches (requests/employees/etc)
        await initializeDefaultData();

        if (!cancelled) setReady(true);
      } catch {
        // Any unexpected error -> treat as unauthenticated
        setCurrentUser(null);
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  return <>{children}</>;
};

const DigiLoginRedirect = () => {
  const location = useLocation();

  useEffect(() => {
    // If user is already authenticated locally, do not bounce
    const u = getCurrentUser();
    if (u) {
      // Security user should land on /security
      if (isSecurityEmail(u.empemail)) {
        window.location.replace("/security");
      } else {
        window.location.replace("/overview");
      }
      return;
    }

    // Send them to DIGI login; come back to the page they intended
    const from = (location.state as any)?.from;
    const returnTo = from
      ? `${window.location.origin}${from.pathname}${from.search}${from.hash}`
      : `${window.location.origin}/overview`;

    redirectToDigiLogin(returnTo);
  }, [location]);

  return (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground">
      Redirecting to DIGI…
    </div>
  );
};

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const currentUser = getCurrentUser();
  const location = useLocation();

  // Not logged in -> force DIGI (preserve intended destination)
  if (!currentUser) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // 🔒 Security user should NOT access normal routes -> force /security
  if (isSecurityEmail(currentUser.empemail)) {
    return <Navigate to="/security" replace />;
  }

  return <>{children}</>;
};

const SecurityRoute = ({ children }: { children: React.ReactNode }) => {
  const currentUser = getCurrentUser();
  const location = useLocation();

  // Not logged in -> force DIGI (preserve intended destination)
  if (!currentUser) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Only security user can access /security
  if (!isSecurityEmail(currentUser.empemail)) {
    return <Navigate to="/overview" replace />;
  }

  return <>{children}</>;
};

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />

        <BrowserRouter>
          <SsoBootstrap>
            <Routes>
              {/* Root: send to overview if logged in, else to DIGI via /login */}
              <Route
                path="/"
                element={
                  getCurrentUser() ? (
                    isSecurityEmail(getCurrentUser()?.empemail) ? (
                      <Navigate to="/security" replace />
                    ) : (
                      <Navigate to="/overview" replace />
                    )
                  ) : (
                    <Navigate to="/login" replace />
                  )
                }
              />

              {/* SSO entry point (NO local OTP login) */}
              <Route path="/login" element={<DigiLoginRedirect />} />

              {/* Normal users only */}
              <Route
                path="/overview"
                element={
                  <ProtectedRoute>
                    <Overview />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/request"
                element={
                  <ProtectedRoute>
                    <RequestForm />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/swave/:ticketNumber"
                element={
                  <ProtectedRoute>
                    <SWAVEDetail />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/analytics"
                element={
                  <ProtectedRoute>
                    <Analytics />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/masters"
                element={
                  <ProtectedRoute>
                    <Masters />
                  </ProtectedRoute>
                }
              />

              {/* Security-only */}
              <Route
                path="/security"
                element={
                  <SecurityRoute>
                    <Security />
                  </SecurityRoute>
                }
              />

              {/* Catch-all */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </SsoBootstrap>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
