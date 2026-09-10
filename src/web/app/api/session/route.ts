import { Sandbox } from "@vercel/sandbox";
import { cookies } from "next/headers";
import {
  credentials,
  ensureGameRunning,
  isToken,
  playerSandbox,
  sandboxName,
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

/** Forget this player: stop their sandbox and drop the cookie. The snapshot expires on its own. */
export async function DELETE(): Promise<Response> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  jar.delete(COOKIE);
  if (isToken(token)) {
    try {
      const sandbox = await Sandbox.get({
        ...credentials(),
        name: sandboxName(token),
        resume: false,
      });
      await sandbox.stop();
    } catch {
      // Nothing to stop.
    }
  }
  return new Response(null, { status: 204 });
}
