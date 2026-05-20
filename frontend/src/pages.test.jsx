import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ResultsPage } from "./pages/ResultsPage";
import { ProcessingPanel, RunPage } from "./pages/RunPage";
import { SessionsPage } from "./pages/SessionsPage";
import { UpdatePage } from "./pages/UpdatePage";

const navigateMock = vi.fn();

vi.mock("./components/PlotlyChart", () => ({
  PlotlyChart: ({ figure }) => <div data-testid="plotly-chart">{figure?.data?.length ?? 0}</div>,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

describe("frontend pages", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    global.fetch = vi.fn();
  });

  it("submits dataset generation from the run page", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ session_id: "session_123" }),
    });

    render(
      <MemoryRouter>
        <RunPage />
      </MemoryRouter>,
    );

    await userEvent.upload(screen.getByLabelText(/dataset file/i), new File(["region,sales\nEU,10"], "sales.csv", { type: "text/csv" }));
    await userEvent.type(screen.getByLabelText(/context/i), "Focus on sales by region");
    await userEvent.click(screen.getByRole("button", { name: /generate dashboard/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/generate"),
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(navigateMock).toHaveBeenCalledWith("/results/session_123");
  });

  it("updates the processing screen while generation is running", async () => {
    vi.useFakeTimers();

    try {
      render(<ProcessingPanel />);

      expect(screen.getByRole("heading", { name: /architecting your dashboard/i })).toBeInTheDocument();
      expect(screen.getByText(/this may take a minute or two/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/current processing step/i)).toHaveTextContent(/uploading dataset/i);

      await act(async () => {
        vi.advanceTimersByTime(1900);
      });

      expect(screen.getByLabelText(/current processing step/i)).toHaveTextContent(/reading columns/i);
      expect(screen.getByText(/\[DAT\]/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders results page details and plotly figures", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        session_id: "session_123",
        status: "reviewed",
        analysis: {
          data_schema: { region: "str", sales: "int64" },
          metrics: { primary_metrics: ["sales"] },
          quality: { issues: [] },
        },
        dashboard_spec: {
          title: "Sales Overview",
          visuals: [{ id: "visual_1", title: "Sales by Region", chart_type: "bar" }],
          filters: ["region"],
        },
        figures: [{ data: [{ x: ["EU", "US"], y: [10, 20] }], layout: { title: { text: "Sales by Region" } } }],
        artifacts: [],
      }),
    });

    render(
      <MemoryRouter initialEntries={["/results/session_123"]}>
        <Routes>
          <Route path="/results/:sessionId" element={<ResultsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/sales overview/i)).toBeInTheDocument();
    expect(screen.getByText(/primary metrics/i)).toBeInTheDocument();
    expect(screen.getByTestId("plotly-chart")).toBeInTheDocument();
    expect(screen.getAllByText(/region/i).length).toBeGreaterThan(0);
  });

  it("loads sessions and submits dashboard updates", async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ session_id: "session_123", title: "Sales Overview", status: "reviewed", created_at: "now", updated_at: "now" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          session_id: "session_123",
          status: "reviewed",
          analysis: null,
          dashboard_spec: { title: "Sales Overview", visuals: [], filters: [] },
          figures: [],
          artifacts: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          session_id: "session_123",
          session_status: "reviewed",
          dashboard_spec: { title: "Sales Overview", visuals: [{ chart_type: "scatter", title: "Updated" }], filters: ["region"] },
          figures: [{ data: [{ x: ["EU"], y: [10] }], layout: {} }],
          artifacts: [],
        }),
      });

    render(
      <MemoryRouter initialEntries={["/sessions"]}>
        <Routes>
          <Route path="/sessions" element={<SessionsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/sales overview/i)).toBeInTheDocument();

    render(
      <MemoryRouter initialEntries={["/update/session_123"]}>
        <Routes>
          <Route path="/update/:sessionId" element={<UpdatePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByDisplayValue("session_123")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/update prompt/i), "Change to a scatter chart");
    await userEvent.click(screen.getByRole("button", { name: /apply update/i }));

    expect(await screen.findByText(/scatter/i)).toBeInTheDocument();
  });
});
