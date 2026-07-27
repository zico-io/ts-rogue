import { NextResponse } from "next/server";
import { isHarnessSuperadmin } from "../../../../lib/harness/authz";
import { listRecentRootSessions } from "../../../../lib/harness/sessions";

/**
 * Recent root agent sessions with title, trigger, status, and token totals
 * (HAR-50). Deny-by-default: returns 401 to every caller until HAR-54 lands
 * a real superadmin check, and never reaches Vercel (so `VERCEL_TOKEN` is
 * never at risk) for a rejected caller.
 */
export async function GET(request: Request): Promise<Response> {
  if (!isHarnessSuperadmin(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await listRecentRootSessions();
  if (!result.ok) {
    return NextResponse.json(
      { sessions: [], unavailable: true, reason: result.reason },
      { status: 200 },
    );
  }
  return NextResponse.json({ sessions: result.sessions });
}
