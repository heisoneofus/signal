import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import App from "./App";

describe("App routing", () => {
  it("renders the Signal landing page at the root route", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: /upload your data/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /upload csv/i })).toHaveAttribute("href", "/upload");
  });

  it("renders the dataset workflow at the upload route", () => {
    render(
      <MemoryRouter initialEntries={["/upload"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText(/dataset file/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate dashboard/i })).toBeInTheDocument();
  });
});
