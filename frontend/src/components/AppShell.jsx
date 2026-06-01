import React from "react";
import { Link, NavLink, useLocation } from "react-router-dom";

import { Icon } from "./Icons";

function currentSessionFromLocation(pathname) {
  const routeMatch = pathname.match(/^\/(?:update|results)\/([^/]+)/);
  if (routeMatch?.[1]) {
    return routeMatch[1];
  }
  try {
    return window.localStorage.getItem("signal.currentSessionId") || "";
  } catch {
    return "";
  }
}

function navItemsForSession(sessionId) {
  return [
    { to: "/upload", label: "1. Upload Data", icon: "data" },
    { to: sessionId ? `/update/${sessionId}` : "/update", label: "2. Review", icon: "review" },
    { to: sessionId ? `/results/${sessionId}` : "/sessions", label: "3. Dashboard", icon: "dashboard" },
    { to: "/sessions", label: "Sessions", icon: "database" },
  ];
}

export function AppShell({ children }) {
  const location = useLocation();
  const currentSessionId = currentSessionFromLocation(location.pathname);
  const navItems = navItemsForSession(currentSessionId);

  if (location.pathname === "/") {
    return children;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand-link" to="/">
          <span className="brand-mark">
            <Icon name="signal" size={17} />
          </span>
          <span>Signal</span>
        </Link>

        <nav className="topnav" aria-label="Primary navigation">
          {navItems.map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              className={({ isActive }) => `topnav__link${isActive ? " topnav__link--active" : ""}`}
            >
              <Icon name={item.icon} size={15} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="system-status">
          <span className="live-dot" />
          <span>System Online</span>
        </div>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
