import { describe, expect, it, vi } from "vitest";

import {
  apiFetch,
  finalizeSession,
  listGoogleWorksheets,
  resolveApiBaseUrl,
  runGoogleSheetDataset,
  selectUploadStrategy,
  shouldUseStoredUploads,
  undoDashboardUpdate,
} from "./api";

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

  it("surfaces FastAPI detail messages instead of a generic request failure", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: { get: () => "application/json" },
      json: async () => ({ detail: "Not Found" }),
    });

    await expect(apiFetch("/missing")).rejects.toThrow("Not Found");
  });

  it("retries undo while the latest remote revision is still converging", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        headers: { get: () => "application/json" },
        json: async () => ({ code: "revision_not_available", message: "No previous dashboard revision is available." }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => ({ session_id: "session_123", revision_count: 1 }),
      });

    const restored = await undoDashboardUpdate("session_123", { retryDelays: [0] });

    expect(restored.revision_count).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("falls back to update mode if the session finalization route is unavailable", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: { get: () => "application/json" },
        json: async () => ({ detail: "Not Found" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => ({
          session_id: "session_123",
          session_status: "reviewed",
          dashboard_spec: { visuals: [] },
          figures: [],
          artifacts: [],
        }),
      });

    const result = await finalizeSession("session_123");

    expect(result.session_id).toBe("session_123");
    expect(global.fetch).toHaveBeenNthCalledWith(1, expect.stringContaining("/sessions/session_123/generate"), {
      method: "POST",
    });
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/update"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          session_id: "session_123",
          prompt: "Finalize dashboard without visual changes.",
        }),
      }),
    );
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

  it("lists Google worksheets through the API", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ spreadsheet_id: "sheet123", title: "Revenue Ops", worksheets: [] }),
    });

    const result = await listGoogleWorksheets("https://docs.google.com/spreadsheets/d/sheet123/edit", "token-123");

    expect(result.title).toBe("Revenue Ops");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/google-sheets/worksheets"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          spreadsheet_url: "https://docs.google.com/spreadsheets/d/sheet123/edit",
          access_token: "token-123",
        }),
      }),
    );
  });

  it("runs Google Sheet generation with the selected worksheet id", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ session_id: "session_123" }),
    });

    await runGoogleSheetDataset(
      "/generate",
      {
        spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet123/edit",
        worksheetId: "101",
        accessToken: "",
      },
      "Show revenue",
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/generate/google-sheets"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          spreadsheet_url: "https://docs.google.com/spreadsheets/d/sheet123/edit",
          worksheet_id: 101,
          access_token: null,
          context_text: "Show revenue",
        }),
      }),
    );
  });
});
