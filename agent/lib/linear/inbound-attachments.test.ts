import { describe, expect, it, vi } from "vitest";

import { attachLinearInboundImages } from "./inbound-attachments";

const UPLOAD_URL = "https://uploads.linear.app/abc/shot.png";
const pngResponse = () =>
  new Response(new Uint8Array([137, 80, 78, 71]), {
    status: 200,
    headers: { "content-type": "image/png" },
  });

describe("attachLinearInboundImages", () => {
  it("returns text without image references unchanged and never fetches", async () => {
    const fetchMock = vi.fn();
    await expect(
      attachLinearInboundImages({
        content: "no images here",
        credentials: { accessToken: "tok" },
        fetch: fetchMock,
      }),
    ).resolves.toBe("no images here");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches a trusted upload with Bearer auth and replaces its markdown with alt text plus a file part", async () => {
    const fetchMock = vi.fn(async () => pngResponse());
    const result = await attachLinearInboundImages({
      content: `see ![screenshot](${UPLOAD_URL}) here`,
      credentials: { accessToken: "tok" },
      fetch: fetchMock,
    });
    expect(fetchMock).toHaveBeenCalledWith(UPLOAD_URL, {
      credentials: "omit",
      headers: { accept: "image/*", authorization: "Bearer tok" },
      redirect: "manual",
    });
    expect(result).toEqual([
      { text: "see screenshot here", type: "text" },
      {
        data: Buffer.from([137, 80, 78, 71]),
        mediaType: "image/png",
        type: "file",
      },
    ]);
  });

  it("returns file parts alone when the message is only an image", async () => {
    const result = await attachLinearInboundImages({
      content: `![](${UPLOAD_URL})`,
      credentials: { accessToken: "tok" },
      fetch: vi.fn(async () => pngResponse()),
    });
    expect(result).toEqual([
      {
        data: Buffer.from([137, 80, 78, 71]),
        mediaType: "image/png",
        type: "file",
      },
    ]);
  });

  it("never fetches untrusted origins or credentialed URLs", async () => {
    const fetchMock = vi.fn();
    const content =
      "![a](https://evil.example/x.png) ![b](https://user:pw@uploads.linear.app/x.png)";
    await expect(
      attachLinearInboundImages({
        content,
        credentials: { accessToken: "tok" },
        fetch: fetchMock,
      }),
    ).resolves.toBe(content);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a failed reference's markdown while attaching the successful one", async () => {
    const failedUrl = "https://uploads.linear.app/abc/missing.png";
    const fetchMock = vi.fn(async (url: RequestInfo | URL) =>
      url === UPLOAD_URL ? pngResponse() : new Response(null, { status: 404 }),
    );
    const result = await attachLinearInboundImages({
      content: `![ok](${UPLOAD_URL}) and ![gone](${failedUrl})`,
      credentials: { accessToken: "tok" },
      fetch: fetchMock,
    });
    expect(result).toEqual([
      { text: `ok and ![gone](${failedUrl})`, type: "text" },
      {
        data: Buffer.from([137, 80, 78, 71]),
        mediaType: "image/png",
        type: "file",
      },
    ]);
  });

  it("treats a non-image content-type as failure", async () => {
    const content = `![x](${UPLOAD_URL})`;
    await expect(
      attachLinearInboundImages({
        content,
        credentials: { accessToken: "tok" },
        fetch: vi.fn(
          async () =>
            new Response("<html></html>", {
              status: 200,
              headers: { "content-type": "text/html" },
            }),
        ),
      }),
    ).resolves.toBe(content);
  });

  it("returns the raw text when no access token resolves", async () => {
    vi.stubEnv("LINEAR_AGENT_ACCESS_TOKEN", "");
    vi.stubEnv("LINEAR_ACCESS_TOKEN", "");
    vi.stubEnv("LINEAR_API_KEY", "");
    vi.stubEnv("LINEAR_API_TOKEN", "");
    try {
      const fetchMock = vi.fn();
      const content = `![x](${UPLOAD_URL})`;
      await expect(
        attachLinearInboundImages({ content, fetch: fetchMock }),
      ).resolves.toBe(content);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("returns the raw text when the access token thunk throws", async () => {
    const content = `![x](${UPLOAD_URL})`;
    await expect(
      attachLinearInboundImages({
        content,
        credentials: {
          accessToken: () => {
            throw new Error("connect unavailable");
          },
        },
        fetch: vi.fn(),
      }),
    ).resolves.toBe(content);
  });

  it("passes non-string content through untouched", async () => {
    const parts = [{ text: "already multimodal", type: "text" as const }];

    await expect(attachLinearInboundImages({ content: parts })).resolves.toBe(
      parts,
    );
  });
});
