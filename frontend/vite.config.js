import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const previewApiTarget = process.env.SIGNAL_PREVIEW_API_TARGET || "http://127.0.0.1:8000";

function previewSpaFallback() {
  return {
    name: "signal-preview-spa-fallback",
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = request.url || "/";
        if (url !== "/api" && !url.startsWith("/api/")) {
          next();
          return;
        }

        const target = new URL(url, previewApiTarget);
        const proxyRequest = http.request(
          target,
          {
            method: request.method,
            headers: {
              ...request.headers,
              host: target.host,
            },
          },
          (proxyResponse) => {
            response.writeHead(proxyResponse.statusCode || 502, proxyResponse.headers);
            proxyResponse.pipe(response);
          },
        );

        proxyRequest.on("error", () => {
          response.statusCode = 502;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify({ message: `Unable to reach Signal API preview target at ${previewApiTarget}` }));
        });

        request.pipe(proxyRequest);
      });

      return () => {
        server.middlewares.use((request, response, next) => {
          const method = request.method || "GET";
          const url = request.url || "/";
          const acceptsHtml = String(request.headers.accept || "").includes("text/html");

          if (
            !["GET", "HEAD"].includes(method) ||
            !acceptsHtml ||
            url === "/api" ||
            url.startsWith("/api/") ||
            path.extname(url.split("?")[0])
          ) {
            next();
            return;
          }

          response.statusCode = 200;
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          fs.createReadStream(path.join(rootDir, "dist", "index.html")).pipe(response);
        });
      };
    },
  };
}

export default defineConfig({
  plugins: [react(), previewSpaFallback()],
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.js",
  },
});
