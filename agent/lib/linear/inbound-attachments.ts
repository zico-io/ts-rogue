import type { UserContent } from "ai";
import type { LinearChannelConfig, LinearFetch } from "eve/channels/linear";

import { resolveLinearAccessToken } from "../credentials";

interface LinearUploadImageReference {
  readonly altText: string;
  readonly end: number;
  readonly start: number;
  readonly url: URL;
}

interface LinearImageFilePart {
  readonly data: Buffer;
  readonly mediaType: string;
  readonly type: "file";
}

const MARKDOWN_IMAGE_PATTERN =
  /!\[([^\]\r\n]*)\]\(\s*(?:<([^>\r\n]+)>|([^\s)\r\n]+))(?:\s+(?:"[^"\r\n]*"|'[^'\r\n]*'|\([^)\r\n]*\)))?\s*\)/gu;

export function extractLinearUploadImageReferences(
  text: string,
): LinearUploadImageReference[] {
  const references: LinearUploadImageReference[] = [];
  for (const match of text.matchAll(MARKDOWN_IMAGE_PATTERN)) {
    const rawUrl = match[2] ?? match[3];
    const start = match.index;
    if (rawUrl === undefined || start === undefined) continue;
    const url = parseLinearUploadUrl(rawUrl);
    if (url !== null) {
      references.push({
        altText: match[1] ?? "",
        end: start + match[0].length,
        start,
        url,
      });
    }
  }
  return references;
}

/**
 * Replaces markdown references to Linear uploads with authenticated inline file
 * parts so the model can see the images. Any fetch or credential failure leaves
 * the original text untouched.
 */
export async function attachLinearInboundImages(input: {
  readonly content: UserContent;
  readonly credentials?: LinearChannelConfig["credentials"];
  readonly fetch?: LinearFetch;
}): Promise<UserContent> {
  if (typeof input.content !== "string") return input.content;
  const references = extractLinearUploadImageReferences(input.content);
  if (references.length === 0) return input.content;
  let token: string;
  try {
    token = await resolveLinearAccessToken(input.credentials?.accessToken);
  } catch {
    return input.content;
  }
  const fetchImpl = input.fetch ?? fetch;
  const parts = await Promise.all(
    references.map((reference) =>
      fetchLinearUploadImage(reference.url, token, fetchImpl),
    ),
  );
  if (parts.every((part) => part === null)) return input.content;
  return buildLinearImageContent(input.content, references, parts);
}

function parseLinearUploadUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return url.origin !== "https://uploads.linear.app" ||
    url.username !== "" ||
    url.password !== ""
    ? null
    : url;
}

async function fetchLinearUploadImage(
  url: URL,
  token: string,
  fetchImpl: LinearFetch,
): Promise<LinearImageFilePart | null> {
  if (parseLinearUploadUrl(url.href) === null) return null;
  try {
    const response = await fetchImpl(url.href, {
      credentials: "omit",
      headers: { accept: "image/*", authorization: `Bearer ${token}` },
      redirect: "manual",
    });
    if (!response.ok) return null;
    const mediaType = readImageMediaType(response.headers.get("content-type"));
    if (mediaType === null) return null;
    return {
      data: Buffer.from(await response.arrayBuffer()),
      mediaType,
      type: "file",
    };
  } catch {
    return null;
  }
}

function readImageMediaType(header: string | null): string | null {
  const mediaType = header?.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType?.startsWith("image/") === true && mediaType.length > 6
    ? mediaType
    : null;
}

function buildLinearImageContent(
  text: string,
  references: readonly LinearUploadImageReference[],
  parts: ReadonlyArray<LinearImageFilePart | null>,
): UserContent {
  let cursor = 0;
  let remaining = "";
  const files: LinearImageFilePart[] = [];
  for (const [index, reference] of references.entries()) {
    const part = parts[index];
    if (part != null) {
      remaining += text.slice(cursor, reference.start);
      remaining += reference.altText;
      cursor = reference.end;
      files.push(part);
    }
  }
  remaining += text.slice(cursor);
  return remaining.trim().length === 0
    ? files
    : [{ text: remaining, type: "text" }, ...files];
}
