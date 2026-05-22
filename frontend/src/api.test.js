import { describe, expect, it, vi } from "vitest";

import { apiFetch, resolveApiBaseUrl, selectUploadStrategy, shouldUseStoredUploads } from "./api";

describe("api helpers", () => {
  it("prefers an explicit API base URL override", () => {
    expect(resolveApiBaseUrl({ explicitBaseUrl: "https://api.example.com", isDev: false })).toBe(
      "https://api.example.com",
    );
  });

  it("uses the local backend during development by default", () => {
    expect(resolveApiBaseUrl({ explicitBaseUrl: "", isDev: true })).toBe("http://127.0.0.1:8000");
  });

  it("uses the same-origin Vercel API path in production by default", () => {
    expect(resolveApiBaseUrl({ explicitBaseUrl: "", isDev: false })).toBe("/api");
  });

  it("explains how to recover when the local API server is unreachable", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(apiFetch("/generate")).rejects.toThrow(/Start the backend with: uv run uvicorn backend\.main:app --reload/i);
  });

  it("keeps direct uploads disabled outside production unless explicitly enabled", () => {
    expect(shouldUseStoredUploads({ explicitOverride: "", isProd: false })).toBe(false);
    expect(shouldUseStoredUploads({ explicitOverride: "true", isProd: false })).toBe(true);
  });

  it("keeps direct API uploads enabled in production unless stored uploads are explicit", () => {
    expect(shouldUseStoredUploads({ explicitOverride: "", isProd: true })).toBe(false);
    expect(shouldUseStoredUploads({ explicitOverride: "true", isProd: true })).toBe(true);
    expect(shouldUseStoredUploads({ explicitOverride: "false", isProd: true })).toBe(false);
  });

  it("uses direct uploads by default but switches large production files to Blob storage", () => {
    expect(
      selectUploadStrategy({
        explicitOverride: "",
        isProd: true,
        fileSize: 2 * 1024 * 1024,
      }),
    ).toBe("direct");
    expect(
      selectUploadStrategy({
        explicitOverride: "",
        isProd: true,
        fileSize: 6 * 1024 * 1024,
      }),
    ).toBe("blob");
    expect(
      selectUploadStrategy({
        explicitOverride: "false",
        isProd: true,
        fileSize: 6 * 1024 * 1024,
      }),
    ).toBe("direct");
  });
});
