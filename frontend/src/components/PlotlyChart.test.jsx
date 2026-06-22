import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const plotlyFactoryState = vi.hoisted(() => ({ supportsHeatmap: false }));
let resizeCallback;

vi.mock("react-plotly.js/factory", () => ({
  default: (plotly) => {
    plotlyFactoryState.supportsHeatmap = Boolean(plotly.__supportsHeatmap);
    return function MockPlot({ data, layout, config, revision }) {
      return (
        <div
          data-testid="plotly-inner"
          data-title={layout?.title?.text || ""}
          data-hover={data?.[0]?.hovertemplate || ""}
          data-modebar={String(config?.displayModeBar)}
          data-logo={String(config?.displaylogo)}
          data-plotly-heatmap={String(plotlyFactoryState.supportsHeatmap)}
          data-revision={String(revision)}
          data-width={String(layout?.width || "")}
          data-font-size={String(layout?.font?.size || "")}
          data-margin-bottom={String(layout?.margin?.b || "")}
          data-x-tick-size={String(layout?.xaxis?.tickfont?.size || "")}
          data-x-tickformat={String(layout?.xaxis?.tickformat || "")}
        >
          {data?.length ?? 0}
        </div>
      );
    };
  },
}));

vi.mock("plotly.js-dist-min", () => ({
  default: { __supportsHeatmap: true },
}));

afterEach(() => {
  resizeCallback = undefined;
  delete global.ResizeObserver;
});

describe("PlotlyChart", () => {
  it("loads Plotly through a lazy chart chunk", async () => {
    const { PlotlyChart } = await import("./PlotlyChart");

    render(<PlotlyChart figure={{ data: [{ x: ["EU"], y: [10] }], layout: {} }} title="Sales" />);

    expect(screen.getByText(/loading chart/i)).toBeInTheDocument();
    expect(await screen.findByTestId("plotly-inner")).toHaveTextContent("1");
  });

  it("removes duplicate Plotly titles and humanizes hover labels", async () => {
    const { PlotlyChart } = await import("./PlotlyChart");

    render(
      <PlotlyChart
        figure={{
          data: [{ x: ["2026-01-01"], y: [42], hovertemplate: "ticket_group=%{x}<br>ticket_count=%{y}<extra></extra>" }],
          layout: {
            title: { text: "Ticket Count by Group" },
            xaxis: { title: { text: "ticket_group" } },
            yaxis: { title: { text: "ticket_count" } },
          },
        }}
        title="Ticket Count by Group"
      />,
    );

    const chart = await screen.findByTestId("plotly-inner");
    expect(chart).toHaveAttribute("data-title", "");
    expect(chart).toHaveAttribute("data-hover", expect.stringContaining("Ticket Group"));
    expect(chart).toHaveAttribute("data-hover", expect.stringContaining("Ticket Count"));
  });

  it("feeds Plotly the observed container width for responsive redraws", async () => {
    global.ResizeObserver = class ResizeObserver {
      constructor(callback) {
        resizeCallback = callback;
      }

      observe() {
        resizeCallback([{ contentRect: { width: 360.8 } }]);
      }

      disconnect() {}
    };

    const { PlotlyChart } = await import("./PlotlyChart");

    render(<PlotlyChart figure={{ data: [{ x: ["Chat"], y: [12] }], layout: {} }} title="Tickets" />);

    const chart = await screen.findByTestId("plotly-inner");
    await waitFor(() => expect(chart).toHaveAttribute("data-width", "360"));
    expect(chart).toHaveAttribute("data-revision", "360");
  });

  it("uses larger chart typography and margins on narrow containers", async () => {
    global.ResizeObserver = class ResizeObserver {
      constructor(callback) {
        resizeCallback = callback;
      }

      observe() {
        resizeCallback([{ contentRect: { width: 390 } }]);
      }

      disconnect() {}
    };

    const { PlotlyChart } = await import("./PlotlyChart");

    render(
      <PlotlyChart
        figure={{
          data: [{ x: ["2026-01-01"], y: [42] }],
          layout: { xaxis: { title: { text: "created_at" } } },
        }}
        title="Tickets"
      />,
    );

    const chart = await screen.findByTestId("plotly-inner");
    await waitFor(() => expect(chart).toHaveAttribute("data-width", "390"));
    expect(chart).toHaveAttribute("data-font-size", "13");
    expect(chart).toHaveAttribute("data-x-tick-size", "12");
    expect(chart).toHaveAttribute("data-margin-bottom", "58");
  });

  it("formats date axes without Plotly's compact year suffix", async () => {
    const { PlotlyChart } = await import("./PlotlyChart");

    render(
      <PlotlyChart
        figure={{
          data: [{ x: ["2026-03-01", "2026-03-02"], y: [42, 48] }],
          layout: { xaxis: { title: { text: "date" } } },
        }}
        title="Tickets"
      />,
    );

    const chart = await screen.findByTestId("plotly-inner");
    expect(chart).toHaveAttribute("data-x-tickformat", "%b %-d");
  });

  it("loads the Plotly bundle that supports heatmap traces", async () => {
    const { PlotlyChart } = await import("./PlotlyChart");

    render(<PlotlyChart figure={{ data: [{ type: "heatmap", z: [[1]] }], layout: {} }} title="Heatmap" />);

    expect(await screen.findByTestId("plotly-inner")).toHaveAttribute("data-plotly-heatmap", "true");
  });

  it("keeps Plotly's embedded modebar hidden to avoid chart legend overlap", async () => {
    const { PlotlyChart } = await import("./PlotlyChart");

    render(<PlotlyChart figure={{ data: [{ x: ["Chat"], y: [12] }], layout: {} }} title="Tickets" />);

    const chart = await screen.findByTestId("plotly-inner");
    expect(chart).toHaveAttribute("data-modebar", "false");
    expect(chart).toHaveAttribute("data-logo", "false");
  });
});
