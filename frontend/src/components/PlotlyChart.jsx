import React, { Suspense } from "react";

const Plot = React.lazy(async () => {
  const [{ default: createPlotlyComponent }, { default: Plotly }] = await Promise.all([
    import("react-plotly.js/factory"),
    import("plotly.js-basic-dist-min"),
  ]);

  return { default: createPlotlyComponent(Plotly) };
});

export function PlotlyChart({ figure = {}, title }) {
  const sourceLayout = figure.layout || {};
  const resolvedTitle = sourceLayout.title || { text: title };

  return (
    <Suspense fallback={<div className="chart-loading">Loading chart...</div>}>
      <Plot
        className="plotly-chart"
        data={figure.data || []}
        layout={{
          ...sourceLayout,
          autosize: true,
          font: { color: "#cbd5e1", family: "Inter, sans-serif" },
          margin: { l: 32, r: 20, t: 56, b: 32 },
          paper_bgcolor: "rgba(0,0,0,0)",
          plot_bgcolor: "#080f20",
          xaxis: {
            gridcolor: "#1d293d",
            linecolor: "#263754",
            zerolinecolor: "#263754",
            ...(sourceLayout.xaxis || {}),
          },
          yaxis: {
            gridcolor: "#1d293d",
            linecolor: "#263754",
            zerolinecolor: "#263754",
            ...(sourceLayout.yaxis || {}),
          },
          title: typeof resolvedTitle === "string" ? { text: resolvedTitle } : resolvedTitle,
        }}
        config={{ displaylogo: false, responsive: true }}
        useResizeHandler
        style={{ width: "100%", height: "100%" }}
      />
    </Suspense>
  );
}
