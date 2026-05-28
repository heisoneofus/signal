import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-plotly.js/factory", () => ({
  default: () =>
    function MockPlot({ data, layout, config }) {
      return (
        <div
          data-testid="plotly-inner"
          data-title={layout?.title?.text || ""}
          data-hover={data?.[0]?.hovertemplate || ""}
          data-logo={String(config?.displaylogo)}
        >
          {data?.length ?? 0}
        </div>
      );
    },
}));

vi.mock("plotly.js-basic-dist-min", () => ({
  default: {},
}));

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
});
