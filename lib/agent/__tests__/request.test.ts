import { describe, expect, it } from "vitest";
import {
  AGENT_JSON_REQUEST_LIMIT,
  readBoundedJson,
} from "../request";

describe("bounded agent JSON requests", () => {
  it("rejects an oversized declared Content-Length before reading the stream", async () => {
    const request = new Request("http://test", {
      method: "POST",
      headers: { "Content-Length": String(AGENT_JSON_REQUEST_LIMIT + 1) },
      body: new ReadableStream({ pull() {} }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(readBoundedJson(request)).rejects.toMatchObject({
      status: 413,
      message: "Request body too large",
    });
  });

  it("caps chunked request bytes without relying on Content-Length", async () => {
    const chunk = new Uint8Array(40 * 1024).fill(120);
    const request = new Request("http://test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(chunk);
          controller.enqueue(chunk);
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(readBoundedJson(request)).rejects.toMatchObject({ status: 413 });
  });

  it("returns a safe bad-request error for malformed JSON", async () => {
    await expect(readBoundedJson(new Request("http://test", {
      method: "POST",
      body: "{not-json",
    }))).rejects.toMatchObject({ status: 400, message: "Invalid request body" });
  });
});
