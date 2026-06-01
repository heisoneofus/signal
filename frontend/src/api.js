export function resolveApiBaseUrl({
  explicitBaseUrl = import.meta.env.VITE_API_BASE_URL || "",
  isDev = import.meta.env.DEV,
} = {}) {
  const normalizedBaseUrl = explicitBaseUrl.trim();
  if (normalizedBaseUrl) {
    return normalizedBaseUrl.replace(/\/$/, "");
  }
  return isDev ? "http://127.0.0.1:8000" : "/api";
}

export function shouldUseStoredUploads({
  explicitOverride = import.meta.env.VITE_USE_STORED_UPLOADS || "",
  isProd = import.meta.env.PROD,
} = {}) {
  const normalizedOverride = explicitOverride.trim().toLowerCase();
  if (normalizedOverride === "true") {
    return true;
  }
  if (normalizedOverride === "false") {
    return false;
  }
  return false;
}

export function selectUploadStrategy({
  explicitOverride = import.meta.env.VITE_USE_STORED_UPLOADS || "",
  thresholdMb = import.meta.env.VITE_STORED_UPLOAD_THRESHOLD_MB || "4.5",
  isProd = import.meta.env.PROD,
  fileSize = 0,
} = {}) {
  const normalizedOverride = explicitOverride.trim().toLowerCase();
  if (normalizedOverride === "true") {
    return "blob";
  }
  if (normalizedOverride === "false") {
    return "direct";
  }

  const thresholdBytes = Number.parseFloat(thresholdMb) * 1024 * 1024;
  if (isProd && Number.isFinite(thresholdBytes) && fileSize > thresholdBytes) {
    return "blob";
  }
  return "direct";
}

const API_BASE_URL = resolveApiBaseUrl();

class ApiRequestError extends Error {
  constructor(message, { status, payload } = {}) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.payload = payload;
  }
}

function sanitizeFilename(filename) {
  return filename.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

async function parseResponse(response) {
  const contentType = response.headers?.get?.("content-type") || "application/json";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null
        ? payload.message || payload.detail || payload.code || payload.error || "Request failed"
        : "Request failed";
    throw new ApiRequestError(message, { status: response.status, payload });
  }

  return payload;
}

function isMissingFinalizeRoute(error) {
  if (error?.status !== 404) {
    return false;
  }
  if (typeof error.payload === "object" && error.payload !== null && error.payload.code) {
    return false;
  }
  return error.message === "Not Found" || error.message === "Request failed";
}

export async function apiFetch(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, options);
  } catch (error) {
    const target = API_BASE_URL || "the same-origin API";
    throw new Error(
      `Unable to reach Signal API at ${target}. Start the backend with: uv run uvicorn backend.main:app --reload`,
      { cause: error },
    );
  }
  return parseResponse(response);
}

async function uploadDatasetToBlob(file) {
  const { upload } = await import("@vercel/blob/client");
  const timestamp = Date.now();
  const safeName = sanitizeFilename(file.name || "dataset.csv");
  return upload(`uploads/${timestamp}-${safeName}`, file, {
    access: "private",
    handleUploadUrl: "/api/uploads",
    multipart: true,
  });
}

export async function uploadDataset(path, file, contextText) {
  if (selectUploadStrategy({ fileSize: file.size }) === "blob") {
    const uploaded = await uploadDatasetToBlob(file);
    return apiFetch(`${path}/stored`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dataset_key: uploaded.pathname,
        filename: file.name || "dataset.csv",
        context_text: contextText.trim() || null,
      }),
    });
  }

  const formData = new FormData();
  formData.append("dataset", file);
  if (contextText.trim()) {
    formData.append("context_text", contextText.trim());
  }
  return apiFetch(path, {
    method: "POST",
    body: formData,
  });
}

export async function fetchSession(sessionId) {
  return apiFetch(`/sessions/${sessionId}`);
}

export async function fetchSessions() {
  return apiFetch("/sessions");
}

export async function patchSession(sessionId, patch) {
  return apiFetch(`/sessions/${sessionId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
}

export async function renderSessionFigures(sessionId, filters = {}) {
  return apiFetch(`/sessions/${sessionId}/figures`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filters }),
  });
}

export async function finalizeSession(sessionId) {
  try {
    return await apiFetch(`/sessions/${sessionId}/generate`, {
      method: "POST",
    });
  } catch (error) {
    if (!isMissingFinalizeRoute(error)) {
      throw error;
    }
    return updateDashboard(sessionId, "Finalize dashboard without visual changes.");
  }
}

export async function updateDashboard(sessionId, prompt) {
  return apiFetch("/update", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ session_id: sessionId, prompt }),
  });
}
