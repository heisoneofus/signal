import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AppShell } from "./AppShell";

describe("AppShell", () => {
  it("uses the Signal brand in the shell", () => {
    render(
      <MemoryRouter initialEntries={["/upload"]}>
        <AppShell>
          <div>Content</div>
        </AppShell>
      </MemoryRouter>,
    );

    expect(screen.getByText("Signal")).toBeInTheDocument();
  });
});
