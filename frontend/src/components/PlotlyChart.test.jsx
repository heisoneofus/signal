import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-plotly.js/factory", () => ({
  default: () =>
    function MockPlot({ data }) {
      return <div data-testid="plotly-inner">{data?.length ?? 0}</div>;
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
});
