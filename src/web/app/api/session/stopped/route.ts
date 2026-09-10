import { Sandbox } from "@vercel/sandbox";
import { credentials, isToken, sandboxName } from "../../../../lib/sandbox";

/**
 * Called by the pty-server inside a sandbox when its game has exited, so the
 * VM stops (and snapshots the save) now instead of at its timeout. Knowing the
 * token is the proof: only that sandbox was ever told it.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { token?: unknown };
  const token = typeof body.token === "string" ? body.token : undefined;
  if (!isToken(token)) return new Response("bad token", { status: 400 });
  const sandbox = await Sandbox.get({
    ...credentials(),
    name: sandboxName(token),
    resume: false,
  });
  await sandbox.stop();
  return new Response(null, { status: 204 });
}
