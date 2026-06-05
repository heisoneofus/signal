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

export default async function handler(request) {
  try {
    const token = resolveBlobToken();
    if (!token) {
      return Response.json({ error: "Vercel Blob token is not configured." }, { status: 500 });
    }

    const body = await request.json();
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

    return Response.json(jsonResponse);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Upload token generation failed." },
      { status: 400 },
    );
  }
}
