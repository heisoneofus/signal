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

const routerFuture = { v7_relativeSplatPath: true, v7_startTransition: true };

describe("frontend pages", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    global.fetch = vi.fn();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("submits dataset generation from the run page and opens review first", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ session_id: "session_123" }),
    });

    render(
      <MemoryRouter future={routerFuture}>
        <RunPage />
      </MemoryRouter>,
    );

    await userEvent.upload(screen.getByLabelText(/dataset file/i), new File(["region,sales\nEU,10"], "sales.csv", { type: "text/csv" }));
    await userEvent.type(screen.getByLabelText(/context/i), "Focus on sales by region");
    await userEvent.click(screen.getByRole("button", { name: /review draft dashboard/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/generate"),
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(navigateMock).toHaveBeenCalledWith("/update/session_123");
  });

  it("submits analyze-only runs into the review page", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ session_id: "session_123" }),
    });

    render(
      <MemoryRouter future={routerFuture}>
        <RunPage />
      </MemoryRouter>,
    );

    await userEvent.upload(screen.getByLabelText(/dataset file/i), new File(["region,sales\nEU,10"], "sales.csv", { type: "text/csv" }));
    await userEvent.click(screen.getByRole("button", { name: /analyze only/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/analyze"),
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(navigateMock).toHaveBeenCalledWith("/update/session_123");
  });

  it("submits Google Sheets generation after loading and choosing a worksheet", async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          spreadsheet_id: "sheet123",
          title: "Revenue Ops",
          worksheets: [
            { sheet_id: 0, title: "Q1 Sales", index: 0, row_count: 20, column_count: 4 },
            { sheet_id: 202, title: "Q2 Sales", index: 1, row_count: 30, column_count: 4 },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ session_id: "session_123" }),
      });

    render(
      <MemoryRouter future={routerFuture}>
        <RunPage />
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("tab", { name: /google sheets/i }));
    await userEvent.type(screen.getByLabelText(/google sheet url/i), "https://docs.google.com/spreadsheets/d/sheet123/edit");
    await userEvent.click(screen.getByRole("button", { name: /load sheets/i }));
    expect(await screen.findByRole("combobox", { name: /worksheet/i })).toHaveValue("0");

    await userEvent.selectOptions(screen.getByLabelText(/worksheet/i), "202");
    await userEvent.type(screen.getByLabelText(/context/i), "Focus on quarterly revenue");
    await userEvent.click(screen.getByRole("button", { name: /review draft dashboard/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/generate/google-sheets"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            spreadsheet_url: "https://docs.google.com/spreadsheets/d/sheet123/edit",
            worksheet_id: 202,
            access_token: null,
            context_text: "Focus on quarterly revenue",
          }),
        }),
      );
    });
    expect(navigateMock).toHaveBeenCalledWith("/update/session_123");
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
        dataset_profile: {
          row_count: 2,
          column_count: 2,
          missing_cells: 0,
          duplicate_rows: 0,
          quality_score: 100,
          filter_options: { region: ["EU", "US"] },
        },
        dashboard_spec: {
          title: "Sales Overview",
          visuals: [{
            id: "visual_1",
            title: "Sales by Region",
            chart_type: "bar",
            layout_size: "wide",
            confidence: 0.84,
            rationale: "A bar chart makes the regional comparison readable at a glance.",
          }],
          filters: ["region"],
        },
        figures: [{ data: [{ x: ["EU", "US"], y: [10, 20] }], layout: { title: { text: "Sales by Region" } } }],
        artifacts: [],
      }),
    });

    render(
      <MemoryRouter future={routerFuture} initialEntries={["/results/session_123"]}>
        <Routes>
          <Route path="/results/:sessionId" element={<ResultsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/sales overview/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /data quality assessment/i })).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(screen.getByRole("button", { name: /data quality assessment/i }));
    expect(screen.getByText(/primary metrics/i)).toBeInTheDocument();
    expect(screen.getByTestId("plotly-chart")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /region: eu/i })).toBeInTheDocument();
    const readingNote = screen.getByText(/why this view/i).closest("details");
    expect(readingNote).not.toHaveAttribute("open");
    expect(screen.getByText(/84% confidence/i)).toBeInTheDocument();
    await userEvent.click(screen.getByText(/why this view/i));
    expect(readingNote).toHaveAttribute("open");
    expect(screen.getByText(/regional comparison readable at a glance/i)).toBeInTheDocument();
    expect(screen.queryByText(/last 7 days/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\+12\.5%/i)).not.toBeInTheDocument();
  });

  it("shows a visible dashboard loading state while results are fetched", async () => {
    global.fetch.mockImplementationOnce(() => new Promise(() => {}));

    render(
      <MemoryRouter future={routerFuture} initialEntries={["/results/session_123"]}>
        <Routes>
          <Route path="/results/:sessionId" element={<ResultsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { level: 1, name: /loading dashboard/i })).toBeInTheDocument();
    expect(screen.getByText(/fetching the session, figures, and chart assets/i)).toBeInTheDocument();
  });

  it("keeps dashboard filter chips focused on readable categorical values", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        session_id: "session_123",
        status: "reviewed",
        analysis: {
          data_schema: { date: "datetime64[ns]", channel: "str", tickets: "int64" },
          metrics: { primary_metrics: ["tickets"], dimensions: ["channel"] },
          quality: { issues: [] },
        },
        dataset_profile: {
          row_count: 2,
          column_count: 3,
          missing_cells: 0,
          duplicate_rows: 0,
          quality_score: 100,
          filter_options: { date: ["2026-03-01", "2026-03-02"], channel: ["chat", "email_support"] },
        },
        dashboard_spec: {
          title: "Support Overview",
          visuals: [{ id: "visual_1", title: "Tickets by Channel", chart_type: "bar", layout_size: "wide" }],
          filters: ["date", "channel"],
        },
        figures: [{ data: [{ x: ["chat"], y: [10] }], layout: {} }],
        artifacts: [],
      }),
    });

    render(
      <MemoryRouter future={routerFuture} initialEntries={["/results/session_123"]}>
        <Routes>
          <Route path="/results/:sessionId" element={<ResultsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/support overview/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /date:/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /channel: chat/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /channel: email support/i })).toBeInTheDocument();
  });

  it("loads sessions and submits chart updates before generating the final dashboard", async () => {
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
          items: [{ session_id: "session_123", title: "Sales Overview", status: "reviewed", created_at: "now", updated_at: "now" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          session_id: "session_123",
          status: "reviewed",
          analysis: null,
          dataset_profile: { row_count: 1, column_count: 2, quality_score: 100, filter_options: { region: ["EU"] }, dimensions: ["region"] },
          dashboard_spec: {
            title: "Sales Overview",
            visuals: [{ id: "visual_1", chart_type: "bar", title: "Sales by Region", layout_size: "wide" }],
            filters: ["region"],
          },
          figures: [{ data: [{ x: ["EU"], y: [10] }], layout: {} }],
          artifacts: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          session_id: "session_123",
          session_status: "reviewed",
          dashboard_spec: { title: "Sales Overview", visuals: [{ id: "visual_1", chart_type: "scatter", title: "Updated" }], filters: ["region"] },
          figures: [{ data: [{ x: ["EU"], y: [10] }], layout: {} }],
          artifacts: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          session_id: "session_123",
          session_status: "reviewed",
          dashboard_spec: { title: "Sales Overview", visuals: [{ id: "visual_1", chart_type: "scatter", title: "Updated" }], filters: ["region"] },
          figures: [{ data: [{ x: ["EU"], y: [10] }], layout: {} }],
          artifacts: [],
        }),
      });

    render(
      <MemoryRouter future={routerFuture} initialEntries={["/sessions"]}>
        <Routes>
          <Route path="/sessions" element={<SessionsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/sales overview/i)).toBeInTheDocument();

    render(
      <MemoryRouter future={routerFuture} initialEntries={["/update/session_123"]}>
        <Routes>
          <Route path="/update/:sessionId" element={<UpdatePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("combobox", { name: /session id/i })).toHaveValue("session_123");
    expect(screen.getByTestId("plotly-chart")).toBeInTheDocument();
    expect(screen.getByText(/filters and dimensions/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/update prompt for sales by region/i), "Change to a scatter chart");
    await userEvent.click(screen.getByRole("button", { name: /update sales by region/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/update"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            session_id: "session_123",
            prompt: "For Sales by Region, Change to a scatter chart",
          }),
        }),
      );
    });
    expect(await screen.findByText(/scatter - confidence pending/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /generate dashboard/i }));
    expect(navigateMock).toHaveBeenCalledWith("/results/session_123");
  });

  it("applies one dashboard-level direction from the review canvas", async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ session_id: "session_123", title: "Sales Overview", status: "reviewed" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          session_id: "session_123",
          status: "reviewed",
          dataset_profile: { row_count: 1, column_count: 2, quality_score: 100 },
          dashboard_spec: {
            title: "Sales Overview",
            layout: "grid",
            theme: "light",
            visuals: [{ id: "visual_1", chart_type: "bar", title: "Sales by Region" }],
            filters: [],
          },
          figures: [{ data: [{ x: ["EU"], y: [10] }], layout: {} }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          session_id: "session_123",
          session_status: "reviewed",
          revision_count: 2,
          changed: true,
          changes: ["Switch layout to `tabs`."],
          warnings: [],
          dashboard_spec: {
            title: "Sales Overview",
            layout: "tabs",
            theme: "light",
            visuals: [{ id: "visual_1", chart_type: "bar", title: "Sales by Region" }],
            filters: [],
          },
          figures: [{ data: [{ x: ["EU"], y: [10] }], layout: {} }],
        }),
      });

    render(
      <MemoryRouter future={routerFuture} initialEntries={["/update/session_123"]}>
        <Routes>
          <Route path="/update/:sessionId" element={<UpdatePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: /tune the whole canvas/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /use tabs layout/i }));
    expect(screen.getByLabelText(/^instruction$/i)).toHaveValue("Use tabs layout");
    await userEvent.click(screen.getByRole("button", { name: /apply to dashboard/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/update"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ session_id: "session_123", prompt: "Use tabs layout" }),
        }),
      );
    });
    const receipt = await screen.findByRole("status");
    expect(receipt).toHaveTextContent(/1 dashboard change applied/i);
    expect(receipt).toHaveTextContent(/switch layout to `tabs`/i);
    expect(receipt).toHaveTextContent(/use tabs layout/i);
    expect(screen.getByRole("button", { name: /use sections layout/i })).toBeInTheDocument();
  });

  it("keeps an unsupported refinement editable and explains that no revision was created", async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ session_id: "session_123", title: "Sales Overview", status: "reviewed" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          session_id: "session_123",
          status: "reviewed",
          revision_count: 1,
          dataset_profile: { row_count: 2, column_count: 2, quality_score: 100 },
          dashboard_spec: {
            title: "Sales Overview",
            layout: "grid",
            theme: "light",
            visuals: [{ id: "visual_1", chart_type: "bar", title: "Sales by Region" }],
            filters: [],
          },
          figures: [{ data: [{ x: ["EU", "US"], y: [10, 20] }], layout: {} }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          session_id: "session_123",
          session_status: "reviewed",
          revision_count: 1,
          changed: false,
          changes: [],
          warnings: ["No structured patch operation could be inferred; keeping the current dashboard spec."],
          dashboard_spec: {
            title: "Sales Overview",
            layout: "grid",
            theme: "light",
            visuals: [{ id: "visual_1", chart_type: "bar", title: "Sales by Region" }],
            filters: [],
          },
          figures: [{ data: [{ x: ["EU", "US"], y: [10, 20] }], layout: {} }],
        }),
      });

    render(
      <MemoryRouter future={routerFuture} initialEntries={["/update/session_123"]}>
        <Routes>
          <Route path="/update/:sessionId" element={<UpdatePage />} />
        </Routes>
      </MemoryRouter>,
    );

    const input = await screen.findByLabelText(/^instruction$/i);
    await userEvent.type(input, "Make the dashboard more insightful");
    await userEvent.click(screen.getByRole("button", { name: /apply to dashboard/i }));

    const receipt = await screen.findByRole("status");
    expect(receipt).toHaveTextContent(/no dashboard change made/i);
    expect(receipt).toHaveTextContent(/no structured patch operation/i);
    expect(receipt).toHaveTextContent(/try naming a chart, chart type, layout, theme, filter, or axis/i);
    expect(input).toHaveValue("Make the dashboard more insightful");
    expect(screen.getByText(/revision 1/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /no ai changes to undo/i })).toBeDisabled();
  });

  it("restores the previous dashboard revision after an AI refinement", async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ session_id: "session_123", title: "Sales Overview", status: "reviewed" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          session_id: "session_123",
          status: "reviewed",
          revision_count: 1,
          dataset_profile: { row_count: 2, column_count: 2, quality_score: 100 },
          dashboard_spec: {
            title: "Sales Overview",
            layout: "grid",
            theme: "light",
            visuals: [{ id: "visual_1", chart_type: "bar", title: "Sales by Region" }],
            filters: [],
          },
          figures: [{ data: [{ x: ["EU", "US"], y: [10, 20] }], layout: {} }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          session_id: "session_123",
          session_status: "reviewed",
          revision_count: 2,
          dashboard_spec: {
            title: "Sales Overview",
            layout: "grid",
            theme: "dark",
            visuals: [{ id: "visual_1", chart_type: "bar", title: "Sales by Region" }],
            filters: [],
          },
          figures: [{ data: [{ x: ["EU", "US"], y: [10, 20] }], layout: {} }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          session_id: "session_123",
          session_status: "reviewed",
          revision_count: 1,
          dashboard_spec: {
            title: "Sales Overview",
            layout: "grid",
            theme: "light",
            visuals: [{ id: "visual_1", chart_type: "bar", title: "Sales by Region" }],
            filters: [],
          },
          figures: [{ data: [{ x: ["EU", "US"], y: [10, 20] }], layout: {} }],
        }),
      });

    render(
      <MemoryRouter future={routerFuture} initialEntries={["/update/session_123"]}>
        <Routes>
          <Route path="/update/:sessionId" element={<UpdatePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: /safe to experiment/i })).toBeInTheDocument();
    expect(screen.getByText(/revision 1/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /no ai changes to undo/i })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: /switch to dark theme/i }));
    await userEvent.click(screen.getByRole("button", { name: /apply to dashboard/i }));

    expect(await screen.findByText(/saved as revision 2/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /undo last ai change/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/sessions/session_123/undo"),
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(await screen.findByText(/restored revision 1/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /switch to dark theme/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /no ai changes to undo/i })).toBeDisabled();
  });

  it("surfaces low-confidence visuals as a focused review queue", async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ session_id: "session_123", title: "Sales Overview", status: "reviewed" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          session_id: "session_123",
          status: "reviewed",
          dataset_profile: { row_count: 12, column_count: 4, quality_score: 82 },
          dashboard_spec: {
            title: "Sales Overview",
            visuals: [
              { id: "visual_1", chart_type: "line", title: "Reliable trend", confidence: 0.82 },
              { id: "visual_2", chart_type: "scatter", title: "Uncertain tradeoff", confidence: 0.55 },
              { id: "visual_3", chart_type: "bar", title: "Regional mix", confidence: 0.68 },
            ],
            filters: [],
          },
          figures: [
            { data: [{}], layout: {} },
            { data: [{}, {}], layout: {} },
            { data: [{}, {}, {}], layout: {} },
          ],
        }),
      });

    render(
      <MemoryRouter future={routerFuture} initialEntries={["/update/session_123"]}>
        <Routes>
          <Route path="/update/:sessionId" element={<UpdatePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: /start with uncertainty/i })).toBeInTheDocument();
    expect(screen.getByText(/of 3 need attention/i)).toBeInTheDocument();
    expect(screen.getAllByTestId("plotly-chart").map((chart) => chart.textContent)).toEqual(["1", "2", "3"]);

    await userEvent.click(screen.getByRole("button", { name: /needs attention \(2\)/i }));

    expect(screen.queryByRole("heading", { name: /reliable trend/i })).not.toBeInTheDocument();
    expect(screen.getAllByTestId("plotly-chart").map((chart) => chart.textContent)).toEqual(["2", "3"]);
    expect(screen.getByText(/inspect 2 uncertain visuals/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /all visuals/i }));
    expect(screen.getByRole("heading", { name: /reliable trend/i })).toBeInTheDocument();
  });

  it("prevents final generation while a chart update is still applying", async () => {
    let resolveUpdate;
    const updatePromise = new Promise((resolve) => {
      resolveUpdate = resolve;
    });

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
          dataset_profile: { row_count: 1, column_count: 2, quality_score: 100, filter_options: { region: ["EU"] }, dimensions: ["region"] },
          dashboard_spec: {
            title: "Sales Overview",
            visuals: [{ id: "visual_1", chart_type: "bar", title: "Sales by Region", layout_size: "wide" }],
            filters: ["region"],
          },
          figures: [{ data: [{ x: ["EU"], y: [10] }], layout: {} }],
          artifacts: [],
        }),
      })
      .mockReturnValueOnce(updatePromise)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          session_id: "session_123",
          session_status: "generated",
          dashboard_spec: {
            title: "Sales Overview",
            visuals: [{ id: "visual_1", chart_type: "scatter", title: "Updated" }],
            filters: ["region"],
          },
          figures: [{ data: [{ x: ["EU"], y: [10] }], layout: {} }],
          artifacts: [],
        }),
      });

    render(
      <MemoryRouter future={routerFuture} initialEntries={["/update/session_123"]}>
        <Routes>
          <Route path="/update/:sessionId" element={<UpdatePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: /generate dashboard/i })).toBeEnabled();
    await userEvent.type(screen.getByLabelText(/update prompt for sales by region/i), "Change to a scatter chart");
    await userEvent.click(screen.getByRole("button", { name: /update sales by region/i }));

    const applyingButton = screen.getByRole("button", { name: /applying updates/i });
    expect(applyingButton).toBeDisabled();
    await userEvent.click(applyingButton);
    expect(navigateMock).not.toHaveBeenCalled();

    await act(async () => {
      resolveUpdate({
        ok: true,
        json: async () => ({
          session_id: "session_123",
          session_status: "reviewed",
          dashboard_spec: {
            title: "Sales Overview",
            visuals: [{ id: "visual_1", chart_type: "scatter", title: "Updated" }],
            filters: ["region"],
          },
          figures: [{ data: [{ x: ["EU"], y: [10] }], layout: {} }],
          artifacts: [],
        }),
      });
    });

    expect(await screen.findByRole("button", { name: /generate dashboard/i })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: /generate dashboard/i }));
    expect(navigateMock).toHaveBeenCalledWith("/results/session_123");
  });

  it("keeps dashboard generation disabled until the review draft finishes loading", async () => {
    let resolveSession;
    const sessionPromise = new Promise((resolve) => {
      resolveSession = resolve;
    });

    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [] }),
      })
      .mockReturnValueOnce(sessionPromise);

    render(
      <MemoryRouter future={routerFuture} initialEntries={["/update/session_123"]}>
        <Routes>
          <Route path="/update/:sessionId" element={<UpdatePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: /loading draft/i })).toBeDisabled();
    expect(screen.getByText(/wait for draft details/i)).toBeInTheDocument();
    expect(screen.getByText(/loading the active visualization plan/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /data quality assessment/i })).toHaveTextContent(/pending/i);
    expect(screen.queryByText(/100\/100/i)).not.toBeInTheDocument();

    resolveSession({
      ok: true,
      json: async () => ({
        session_id: "session_123",
        status: "reviewed",
        analysis: null,
        dataset_profile: { row_count: 1, column_count: 2, quality_score: 88, filter_options: { region: ["EU"] }, dimensions: ["region"] },
        dashboard_spec: {
          title: "Sales Overview",
          visuals: [{ id: "visual_1", chart_type: "bar", title: "Sales by Region", layout_size: "wide" }],
          filters: ["region"],
        },
        figures: [{ data: [{ x: ["EU"], y: [10] }], layout: {} }],
        artifacts: [],
      }),
    });

    expect(await screen.findByRole("button", { name: /generate dashboard/i })).toBeEnabled();
    expect(screen.getByText(/1 proposed visual/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /data quality assessment/i })).toHaveTextContent(/88\/100/i);
  });

  it("renders missing review draft figures from the session figure endpoint", async () => {
    global.fetch.mockImplementation((url) => {
      const target = String(url);
      if (target.endsWith("/sessions/session_123/figures")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            session_id: "session_123",
            figures: [{ data: [{ x: ["EU"], y: [10] }], layout: {} }],
          }),
        });
      }
      if (target.endsWith("/sessions/session_123")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            session_id: "session_123",
            status: "planned",
            analysis: null,
            dataset_profile: { row_count: 1, column_count: 2, quality_score: 88, filter_options: { region: ["EU"] }, dimensions: ["region"] },
            dashboard_spec: {
              title: "Sales Overview",
              visuals: [{ id: "visual_1", chart_type: "bar", title: "Sales by Region", layout_size: "wide" }],
              filters: ["region"],
            },
            figures: [],
            artifacts: [],
          }),
        });
      }
      if (target.endsWith("/sessions")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [] }),
        });
      }
      return Promise.reject(new Error(`Unhandled fetch: ${target}`));
    });

    render(
      <MemoryRouter future={routerFuture} initialEntries={["/update/session_123"]}>
        <Routes>
          <Route path="/update/:sessionId" element={<UpdatePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/1 proposed visual/i)).toBeInTheDocument();
    expect(await screen.findByTestId("plotly-chart")).toHaveTextContent("1");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/sessions/session_123/figures"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("filters, exports, and reorders charts on the results page", async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          session_id: "session_123",
          status: "reviewed",
          analysis: {
            data_schema: { region: "str", sales: "int64" },
            metrics: { primary_metrics: ["sales"], dimensions: ["region"] },
            quality: { issues: [] },
          },
          dataset_profile: {
            row_count: 2,
            column_count: 2,
            missing_cells: 0,
            duplicate_rows: 0,
            quality_score: 100,
            filter_options: { region: ["EU", "US"] },
          },
          dashboard_spec: {
            title: "Sales Overview",
            visuals: [
              { id: "visual_1", title: "Sales by Region", chart_type: "bar", layout_size: "standard" },
              { id: "visual_2", title: "Profit by Region", chart_type: "bar", layout_size: "standard" },
            ],
            filters: ["region"],
          },
          figures: [
            { data: [{ x: ["EU", "US"], y: [10, 20] }], layout: {} },
            { data: [{ x: ["EU", "US"], y: [4, 9] }], layout: {} },
          ],
          artifacts: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          session_id: "session_123",
          figures: [{ data: [{ x: ["EU"], y: [10] }], layout: {} }, { data: [{ x: ["EU"], y: [4] }], layout: {} }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          session_id: "session_123",
          status: "reviewed",
          analysis: null,
          dataset_profile: { quality_score: 100, filter_options: { region: ["EU", "US"] } },
          dashboard_spec: {
            title: "Sales Overview",
            visuals: [
              { id: "visual_2", title: "Profit by Region", chart_type: "bar" },
              { id: "visual_1", title: "Sales by Region", chart_type: "bar" },
            ],
            filters: ["region"],
          },
          figures: [
            { data: [{ x: ["EU"], y: [4] }], layout: {} },
            { data: [{ x: ["EU"], y: [10] }], layout: {} },
          ],
          artifacts: [],
        }),
      });

    const { container } = render(
      <MemoryRouter future={routerFuture} initialEntries={["/results/session_123"]}>
        <Routes>
          <Route path="/results/:sessionId" element={<ResultsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/sales overview/i)).toBeInTheDocument();
    expect(container.querySelector(".dashboard-content")).not.toHaveClass("dashboard-content--with-insights");
    expect(screen.getByRole("button", { name: /data quality assessment/i })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /drag to reorder profit by region/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /data quality assessment/i }));
    expect(container.querySelector(".dashboard-content")).toHaveClass("dashboard-content--with-insights");

    await userEvent.click(screen.getByRole("button", { name: /region: eu/i }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/sessions/session_123/figures"),
        expect.objectContaining({ method: "POST" }),
      );
    });

    await userEvent.click(screen.getByRole("button", { name: /export/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /snapshot url/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("/results/session_123"));

    navigator.clipboard.writeText.mockRejectedValueOnce(new Error("Permission denied"));
    await userEvent.click(screen.getByRole("button", { name: /export/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /snapshot url/i }));
    expect(await screen.findByText(/snapshot url copy unavailable/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /move profit by region up/i }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/sessions/session_123"),
        expect.objectContaining({ method: "PATCH" }),
      );
    });

    await userEvent.click(screen.getByRole("button", { name: /^present$/i }));
    expect(container.querySelector(".dashboard-page")).toHaveClass("dashboard-page--presentation");
    expect(screen.queryByRole("button", { name: /drag to reorder/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/ai reasoning/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy view link/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /copy view link/i }));
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(expect.stringContaining("present=1"));
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(expect.stringContaining("region=EU"));
    expect(await screen.findByText(/presentation link copied/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /exit presentation/i }));
    expect(screen.getByRole("button", { name: /^present$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /drag to reorder profit by region/i })).toBeInTheDocument();
  });

  it("renames dashboards from the sessions list", async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ session_id: "session_123", title: "Sales Overview", status: "reviewed", created_at: "2026-05-28T08:00:00Z", updated_at: "now" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          session_id: "session_123",
          status: "reviewed",
          dashboard_spec: { title: "Revenue Overview", visuals: [], filters: [] },
          figures: [],
          artifacts: [],
          dataset_profile: {},
        }),
      });

    render(
      <MemoryRouter future={routerFuture} initialEntries={["/sessions"]}>
        <Routes>
          <Route path="/sessions" element={<SessionsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/created may 28, 2026/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: /dashboard sessions/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /rename sales overview/i }));
    await userEvent.clear(screen.getByLabelText(/dashboard name/i));
    await userEvent.type(screen.getByLabelText(/dashboard name/i), "Revenue Overview");
    await userEvent.click(screen.getByRole("button", { name: /save dashboard name/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/sessions/session_123"),
        expect.objectContaining({ method: "PATCH" }),
      );
    });
    expect(await screen.findByText(/revenue overview/i)).toBeInTheDocument();
  });

  it("filters saved sessions by title, date, and session ID", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          { session_id: "session_sales_123", title: "Sales Overview", status: "reviewed", created_at: "2026-05-28T08:00:00Z" },
          { session_id: "session_support_456", title: "Support Health", status: "draft", created_at: "2026-06-02T08:00:00Z" },
        ],
      }),
    });

    render(
      <MemoryRouter future={routerFuture} initialEntries={["/sessions"]}>
        <Routes>
          <Route path="/sessions" element={<SessionsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const search = await screen.findByRole("searchbox", { name: /find a dashboard/i });
    expect(screen.getByText(/2 saved sessions/i)).toBeInTheDocument();

    await userEvent.type(search, "support_456");
    expect(screen.getByRole("heading", { name: /support health/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /sales overview/i })).not.toBeInTheDocument();
    expect(screen.getByText(/1 of 2 sessions/i)).toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.type(search, "may 28");
    expect(screen.getByRole("heading", { name: /sales overview/i })).toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.type(search, "no such dashboard");
    expect(screen.getByText(/no dashboards match/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /clear search/i }));
    expect(screen.getByRole("heading", { name: /support health/i })).toBeInTheDocument();
  });

  it("pins a dashboard and keeps it above newer sessions", async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            { session_id: "session_new", title: "New Dashboard", status: "reviewed", created_at: "2026-07-20T08:00:00Z", pinned: false },
            { session_id: "session_keep", title: "Keep Close", status: "reviewed", created_at: "2026-07-10T08:00:00Z", pinned: false },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          session_id: "session_keep",
          status: "reviewed",
          pinned: true,
          dashboard_spec: { title: "Keep Close", visuals: [], filters: [] },
          figures: [],
          artifacts: [],
          dataset_profile: {},
        }),
      });

    render(
      <MemoryRouter future={routerFuture} initialEntries={["/sessions"]}>
        <Routes>
          <Route path="/sessions" element={<SessionsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(await screen.findByRole("button", { name: /pin keep close/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenLastCalledWith(
        expect.stringContaining("/sessions/session_keep"),
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ pinned: true }),
        }),
      );
    });
    expect(screen.getByText(/1 pinned/i)).toBeInTheDocument();
    expect(screen.getByText(/pinned dashboard/i)).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "Keep Close",
      "New Dashboard",
    ]);
    expect(screen.getByRole("button", { name: /unpin keep close/i })).toHaveAttribute("aria-pressed", "true");
  });
});
