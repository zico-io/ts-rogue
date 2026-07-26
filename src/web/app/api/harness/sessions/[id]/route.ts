import { NextResponse } from "next/server";
import { isHarnessSuperadmin } from "../../../../../lib/harness/authz";
import { getSessionTree } from "../../../../../lib/harness/sessions";

/**
 * A single session's subagent run tree with per-turn model/token/tool-count
 * data (HAR-50). Deny-by-default: returns 401 to every caller until HAR-54
 * lands a real superadmin check.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!isHarnessSuperadmin(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const result = await getSessionTree(id);
  if (!result.ok) {
    if (result.reason === "not_found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json(
      { session: null, unavailable: true, reason: result.reason },
      { status: 200 },
    );
  }
  return NextResponse.json({ session: result.session });
}
