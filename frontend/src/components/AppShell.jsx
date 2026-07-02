import React, { useEffect, useRef } from "react";
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
  const items = [
    { to: "/upload", label: "1. Upload Data", icon: "data" },
    { to: sessionId ? `/update/${sessionId}` : "/update", label: "2. Review", icon: "review" },
  ];

  if (sessionId) {
    items.push({ to: `/results/${sessionId}`, label: "3. Dashboard", icon: "dashboard" });
  }

  return [
    ...items,
    { to: "/sessions", label: "Sessions", icon: "database" },
    { to: "/product-updates", label: "Product Updates", icon: "calendar" },
  ];
}

export function AppShell({ children }) {
  const location = useLocation();
  const navRef = useRef(null);
  const currentSessionId = currentSessionFromLocation(location.pathname);
  const navItems = navItemsForSession(currentSessionId);

  useEffect(() => {
    const activeLink = navRef.current?.querySelector(".topnav__link--active");
    if (typeof activeLink?.scrollIntoView === "function") {
      activeLink.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }, [location.pathname, currentSessionId]);

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

        <nav className="topnav" aria-label="Primary navigation" ref={navRef}>
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
