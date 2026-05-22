// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";

const { default: uploadsHandler } = await import("../../api/uploads.js");

describe("Vercel Blob upload route", () => {
  const originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
  const originalAliasToken = process.env.VERCEL_BLOB_READ_WRITE_TOKEN;

  afterEach(() => {
    if (originalBlobToken === undefined) {
      delete process.env.BLOB_READ_WRITE_TOKEN;
    } else {
      process.env.BLOB_READ_WRITE_TOKEN = originalBlobToken;
    }
    if (originalAliasToken === undefined) {
      delete process.env.VERCEL_BLOB_READ_WRITE_TOKEN;
    } else {
      process.env.VERCEL_BLOB_READ_WRITE_TOKEN = originalAliasToken;
    }
  });

  it("uses the Vercel Blob token alias when signing client upload tokens", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    process.env.VERCEL_BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_teststore_testsecret";

    const response = await uploadsHandler(
      new Request("https://signal.example/api/uploads", {
        method: "POST",
        body: JSON.stringify({
          type: "blob.generate-client-token",
          payload: {
            pathname: "uploads/demo.csv",
            clientPayload: null,
            multipart: true,
          },
        }),
      }),
    );

    const payload = await response.json();

    expect(payload.type).toBe("blob.generate-client-token");
    expect(payload.clientToken).toMatch(/^vercel_blob_client_teststore_/);
  });
});
