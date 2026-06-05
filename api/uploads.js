import { handleUpload } from "@vercel/blob/client";

const ALLOWED_CONTENT_TYPES = [
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
  "application/x-parquet",
  "application/parquet",
];

function resolveBlobToken() {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_BLOB_READ_WRITE_TOKEN;
}

function sendJson(response, payload, status = 200) {
  if (!response) {
    return Response.json(payload, { status });
  }

  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
  return undefined;
}

async function readJsonBody(request) {
  if (typeof request.json === "function") {
    return request.json();
  }

  if (request.body !== undefined) {
    if (typeof request.body === "string") {
      return JSON.parse(request.body);
    }
    if (Buffer.isBuffer(request.body)) {
      return JSON.parse(request.body.toString("utf8"));
    }
    if (typeof request.body === "object") {
      return request.body;
    }
  }

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export default async function handler(request, response) {
  try {
    if (request.method && request.method !== "POST") {
      return sendJson(response, { error: "Method not allowed." }, 405);
    }

    const token = resolveBlobToken();
    if (!token) {
      return sendJson(response, { error: "Vercel Blob token is not configured." }, 500);
    }

    const body = await readJsonBody(request);
    const jsonResponse = await handleUpload({
      body,
      request,
      token,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith("uploads/")) {
          throw new Error("Uploads must be stored under the uploads/ prefix.");
        }

        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          addRandomSuffix: false,
          tokenPayload: JSON.stringify({ pathname }),
        };
      },
    });

    return sendJson(response, jsonResponse);
  } catch (error) {
    return sendJson(
      response,
      { error: error instanceof Error ? error.message : "Upload token generation failed." },
      400,
    );
  }
}
