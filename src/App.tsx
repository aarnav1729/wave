// App.tsx
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from "react";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import RequestForm from "./pages/RequestForm";
import SWAVEDetail from "./pages/SWAVEDetail";
import Analytics from "./pages/Analytics";
import Security from "./pages/Security";
import NotFound from "./pages/NotFound";
import { initializeDefaultData, getCurrentUser } from "./lib/storage";

const queryClient = new QueryClient();

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const currentUser = getCurrentUser();

  // Not logged in → login
  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  // 🔒 Security user should NOT access normal routes → force /security
  if (currentUser.empemail?.toLowerCase() === "security@premierenergies.com") {
    return <Navigate to="/security" replace />;
  }

  return <>{children}</>;
};

const SecurityRoute = ({ children }: { children: React.ReactNode }) => {
  const currentUser = getCurrentUser();

  // Not logged in → login
  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  // Only security user can access /security
  if (currentUser.empemail?.toLowerCase() !== "security@premierenergies.com") {
    return <Navigate to="/overview" replace />;
  }

  return <>{children}</>;
};

const App = () => {
  useEffect(() => {
    void initializeDefaultData();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<Login />} />

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
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
