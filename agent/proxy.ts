import { getToken } from "@vercel/connect";
import { defineSandboxProxy } from "@vercel/sandbox/proxy";
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse,
} from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

// Vercel Sandbox `forwardURL` credential broker: mint a fresh credential per
// request and inject it at the firewall, so no secret enters the sandbox and
// nothing expires in the policy. To broker a new service, add a case to
// brokerRequest and route its host to this proxy in agent/sandbox.ts.

const GITHUB_CONNECTOR = "github/ts-rogue-eve-github";

const mintGitHubToken = () =>
  getToken(GITHUB_CONNECTOR, { subject: { type: "app" }, scopes: ["*"] });

type Broker = "github" | "none";

function brokerFor(host: string): Broker {
  if (host === "github.com" || host.endsWith(".github.com")) return "github";
  return "none";
}

async function withGitHubAuth(
  request: Request,
  mint: () => Promise<string>,
): Promise<Request> {
  const token = await mint();
  const authorization = `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  const headers = new Headers(request.headers);
  headers.set("authorization", authorization);
  return new Request(request, { headers });
}

// Deps are injectable so dispatch is testable without minting or TLS.
export interface BrokerDeps {
  send?: (req: Request) => Promise<Response>;
  mintGitHub?: () => Promise<string>;
}

export async function brokerRequest(
  request: Request,
  host: string,
  { send = fetch, mintGitHub = mintGitHubToken }: BrokerDeps = {},
): Promise<Response> {
  switch (brokerFor(host)) {
    case "github":
      return send(await withGitHubAuth(request, mintGitHub));
    default:
      return send(request);
  }
}

const proxy = defineSandboxProxy((request, meta) =>
  brokerRequest(request, meta.host),
);

function toWebHeaders(nodeHeaders: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeHeaders)) {
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else if (value !== undefined) headers.set(key, value);
  }
  return headers;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Build Output Node function: bridge Node req/res to the web proxy, streaming
// both ways so a full private-repo `git clone` never buffers in memory.
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const host =
    firstHeader(req.headers["x-forwarded-host"]) ??
    req.headers.host ??
    "localhost";
  const scheme = firstHeader(req.headers["x-forwarded-proto"]) ?? "https";
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const request = new Request(`${scheme}://${host}${req.url ?? "/"}`, {
    method: req.method,
    headers: toWebHeaders(req.headers),
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: "half",
  } as RequestInit);

  const response = await proxy(request);
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  if (response.body)
    Readable.fromWeb(response.body as unknown as NodeReadableStream).pipe(res);
  else res.end();
}
