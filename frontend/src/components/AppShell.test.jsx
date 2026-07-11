import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "./AppShell";

const routerFuture = { v7_relativeSplatPath: true, v7_startTransition: true };

describe("AppShell", () => {
  afterEach(() => {
    delete HTMLElement.prototype.scrollIntoView;
    window.localStorage.clear();
  });

  it("uses the Signal brand in the shell", () => {
    render(
      <MemoryRouter future={routerFuture} initialEntries={["/upload"]}>
        <AppShell>
          <div>Content</div>
        </AppShell>
      </MemoryRouter>,
    );

    expect(screen.getByText("Signal")).toBeInTheDocument();
  });

  it("does not show a dashboard link before a session exists", () => {
    window.localStorage.clear();

    render(
      <MemoryRouter future={routerFuture} initialEntries={["/upload"]}>
        <AppShell>
          <div>Content</div>
        </AppShell>
      </MemoryRouter>,
    );

    expect(screen.queryByRole("link", { name: /3\. dashboard/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sessions/i })).toHaveAttribute("href", "/sessions");
    expect(screen.getByRole("link", { name: /product updates/i })).toHaveAttribute("href", "/product-updates");
  });

  it("shows review-first workflow navigation with current session links", () => {
    window.localStorage.setItem("signal.currentSessionId", "session_123");

    render(
      <MemoryRouter future={routerFuture} initialEntries={["/results/session_123"]}>
        <AppShell>
          <div>Content</div>
        </AppShell>
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /1\. upload data/i })).toHaveAttribute("href", "/upload");
    expect(screen.getByRole("link", { name: /2\. review/i })).toHaveAttribute("href", "/update/session_123");
    expect(screen.getByRole("link", { name: /3\. dashboard/i })).toHaveAttribute("href", "/results/session_123");
    expect(screen.getByRole("link", { name: /sessions/i })).toHaveAttribute("href", "/sessions");
    expect(screen.getByRole("link", { name: /product updates/i })).toHaveAttribute("href", "/product-updates");
    expect(screen.queryByText(/ai review/i)).not.toBeInTheDocument();
  });

  it("scrolls the active workflow step into view on route load", () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    render(
      <MemoryRouter future={routerFuture} initialEntries={["/results/session_123"]}>
        <AppShell>
          <div>Content</div>
        </AppShell>
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /3\. dashboard/i })).toHaveClass("topnav__link--active");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "center" });
  });

  it("removes application chrome for presentation links", () => {
    const { container } = render(
      <MemoryRouter future={routerFuture} initialEntries={["/results/session_123?present=1"]}>
        <AppShell>
          <div>Presentation content</div>
        </AppShell>
      </MemoryRouter>,
    );

    expect(screen.getByText("Presentation content")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /primary navigation/i })).not.toBeInTheDocument();
    expect(container.querySelector(".app-shell")).toHaveClass("app-shell--presentation");
  });
});
