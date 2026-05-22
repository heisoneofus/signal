import React from "react";
import { Link, NavLink, useLocation } from "react-router-dom";

import { Icon } from "./Icons";

const navItems = [
  { to: "/upload", label: "Data", icon: "data" },
  { to: "/update", label: "AI Review", icon: "review" },
  { to: "/sessions", label: "Dashboard", icon: "dashboard" },
];

export function AppShell({ children }) {
  const location = useLocation();

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
              key={item.to}
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
