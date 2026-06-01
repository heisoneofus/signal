import React, { Suspense, useEffect, useRef, useState } from "react";

const Plot = React.lazy(async () => {
  const [{ default: createPlotlyComponent }, { default: Plotly }] = await Promise.all([
    import("react-plotly.js/factory"),
    import("plotly.js-basic-dist-min"),
  ]);

  return { default: createPlotlyComponent(Plotly) };
});

function humanizeFieldName(name = "") {
  const cleaned = String(name)
    .replace(/^__bucket_(day|week|month)_/i, "")
    .replace(/^__count__$/i, "count")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return "";
  }
  return cleaned.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function humanizeHoverTemplate(template = "") {
  return String(template).replace(/(^|<br>)([A-Za-z0-9_.-]+)=/g, (_match, prefix, fieldName) => {
    return `${prefix}${humanizeFieldName(fieldName)}: `;
  });
}

function humanizeTrace(trace = {}) {
  const next = { ...trace };
  if (typeof next.name === "string") {
    next.name = humanizeFieldName(next.name);
  }
  if (typeof next.legendgroup === "string") {
    next.legendgroup = humanizeFieldName(next.legendgroup);
  }
  if (typeof next.hovertemplate === "string") {
    next.hovertemplate = humanizeHoverTemplate(next.hovertemplate);
  }
  return next;
}

function humanizeAxis(axis = {}) {
  const next = { ...axis };
  const rawTitle = typeof next.title === "string" ? next.title : next.title?.text;
  if (rawTitle) {
    next.title = { ...(typeof next.title === "object" ? next.title : {}), text: humanizeFieldName(rawTitle) };
  }
  return next;
}

export function PlotlyChart({ figure = {}, title }) {
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const sourceLayout = figure.layout || {};
  const data = (figure.data || []).map(humanizeTrace);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return undefined;
    }

    function applyWidth(width) {
      if (width > 0) {
        setContainerWidth(Math.floor(width));
      }
    }

    applyWidth(element.getBoundingClientRect().width);

    if (typeof ResizeObserver === "undefined") {
      const handleResize = () => applyWidth(element.getBoundingClientRect().width);
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }

    const observer = new ResizeObserver((entries) => {
      applyWidth(entries[0]?.contentRect?.width || 0);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="plotly-chart-frame" ref={containerRef}>
      <Suspense fallback={<div className="chart-loading">Loading chart...</div>}>
        <Plot
          className="plotly-chart"
          data={data}
          layout={{
            ...sourceLayout,
            autosize: true,
            ...(containerWidth ? { width: containerWidth } : {}),
            font: { color: "#cbd5e1", family: "Inter, sans-serif", size: 12 },
            margin: { l: 42, r: 18, t: 20, b: 42 },
            paper_bgcolor: "rgba(0,0,0,0)",
            plot_bgcolor: "#080f20",
            xaxis: {
              gridcolor: "#1d293d",
              linecolor: "#263754",
              zerolinecolor: "#263754",
              ...humanizeAxis(sourceLayout.xaxis || {}),
            },
            yaxis: {
              gridcolor: "#1d293d",
              linecolor: "#263754",
              zerolinecolor: "#263754",
              ...humanizeAxis(sourceLayout.yaxis || {}),
            },
            legend: {
              ...(sourceLayout.legend || {}),
              title: sourceLayout.legend?.title?.text
                ? { ...sourceLayout.legend.title, text: humanizeFieldName(sourceLayout.legend.title.text) }
                : sourceLayout.legend?.title,
              font: { color: "#9dafd4", ...(sourceLayout.legend?.font || {}) },
            },
            hoverlabel: {
              bgcolor: "#f8fafc",
              bordercolor: "#38bdf8",
              font: { color: "#0f172a", family: "Inter, sans-serif", size: 12 },
              ...(sourceLayout.hoverlabel || {}),
            },
            title: { text: "" },
          }}
          config={{
            displaylogo: false,
            responsive: true,
            modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"],
          }}
          revision={containerWidth}
          useResizeHandler
          style={{ width: "100%", height: "100%" }}
        />
      </Suspense>
    </div>
  );
}
