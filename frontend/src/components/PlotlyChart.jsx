import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-basic-dist-min";

const Plot = createPlotlyComponent(Plotly);

export function PlotlyChart({ figure = {}, title }) {
  const sourceLayout = figure.layout || {};
  const resolvedTitle = sourceLayout.title || { text: title };

  return (
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
  );
}
