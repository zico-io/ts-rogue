import { cookies } from "next/headers";
import {
  ensureGameRunning,
  isToken,
  playerSandbox,
} from "../../../lib/sandbox";

export const maxDuration = 60;

const COOKIE = "tsr_token";

/**
 * Finds or makes the caller's sandbox and returns the WebSocket URL of the
 * game inside it. Anonymous: the cookie is the whole identity.
 */
export async function POST(request: Request): Promise<Response> {
  const jar = await cookies();
  let token = jar.get(COOKIE)?.value;
  if (!isToken(token)) {
    token = crypto.randomUUID();
    jar.set(COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 365 * 24 * 3600,
      path: "/",
    });
  }
  try {
    const sandbox = await playerSandbox(token);
    const query = new URL(request.url).searchParams.toString();
    const base = await ensureGameRunning(sandbox, query);
    const wsUrl = `${base.replace(/^https:/, "wss:")}/?token=${token}`;
    return Response.json({ wsUrl });
  } catch (error) {
    console.error("session:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
}
