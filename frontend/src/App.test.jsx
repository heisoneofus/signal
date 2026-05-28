import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import App from "./App";

const routerFuture = { v7_relativeSplatPath: true, v7_startTransition: true };

describe("App routing", () => {
  it("renders the Signal landing page at the root route", () => {
    render(
      <MemoryRouter future={routerFuture} initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: /upload your data/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /upload csv/i })).toHaveAttribute("href", "/upload");
    expect(screen.getByTestId("landing-gradient-wave")).toHaveAttribute("aria-hidden", "true");
  });

  it("renders the dataset workflow at the upload route", () => {
    render(
      <MemoryRouter future={routerFuture} initialEntries={["/upload"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText(/dataset file/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /review draft dashboard/i })).toBeInTheDocument();
    expect(screen.getByTestId("route-transition")).toHaveAttribute("data-route-path", "/upload");
  });
});
