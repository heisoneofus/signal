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

const API_BASE_URL = resolveApiBaseUrl();
const USE_STORED_UPLOADS = shouldUseStoredUploads();

function sanitizeFilename(filename) {
  return filename.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

async function parseResponse(response) {
  const contentType = response.headers?.get?.("content-type") || "application/json";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null
        ? payload.message || payload.code || payload.error || "Request failed"
        : "Request failed";
    throw new Error(message);
  }

  return payload;
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
  if (USE_STORED_UPLOADS) {
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

export async function updateDashboard(sessionId, prompt) {
  return apiFetch("/update", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ session_id: sessionId, prompt }),
  });
}
