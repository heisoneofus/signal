import React from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { AppShell } from "./components/AppShell";
import { LandingPage } from "./pages/LandingPage";
import { ResultsPage } from "./pages/ResultsPage";
import { RunPage } from "./pages/RunPage";
import { SessionsPage } from "./pages/SessionsPage";
import { UpdatePage } from "./pages/UpdatePage";

export default function App() {
  const location = useLocation();

  return (
    <AppShell>
      <div
        className="route-transition"
        data-route-path={location.pathname}
        data-testid="route-transition"
        key={location.pathname}
      >
        <Routes location={location}>
          <Route path="/" element={<LandingPage />} />
          <Route path="/upload" element={<RunPage />} />
          <Route path="/results/:sessionId" element={<ResultsPage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/update" element={<UpdatePage />} />
          <Route path="/update/:sessionId" element={<UpdatePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </AppShell>
  );
}
