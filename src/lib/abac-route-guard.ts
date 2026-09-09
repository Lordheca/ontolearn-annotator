import { AbacUnreachableError } from "@/lib/abac-client";
 
/**
 * Runs an ABAC permission check for a raw /api/v1 Route Handler and returns
 * the Response to send immediately if the caller must be refused, or null
 * if it may proceed.
 *
 * 401 for a genuine denial, 503 when ABAC itself is unreachable
 * (AbacUnreachableError) — this lets the ML pipeline scripts that poll these
 * endpoints (playground.py, upload.py, 02_prediction.py, ...) tell "your API
 * key doesn't have access, stop" apart from "the auth service is down, retry
 * me later" instead of both looking like the same 401.
 *
 * @example
 * const denied = await checkAccessOrRespond(() =>
 *   checkPermissionForApiKey(request, params.projectId, "data:write")
 * );
 * if (denied) return denied;
 */
export async function checkAccessOrRespond(
  check: () => Promise<boolean>
): Promise<Response | null> {
  let allowed: boolean;
  try {
    allowed = await check();
  } catch (error) {
    if (error instanceof AbacUnreachableError) {
      return new Response(
        JSON.stringify({ error: "Authorization service unavailable" }),
        { status: 503, headers: { "content-type": "application/json" } }
      );
    }
    throw error;
  }
 
  if (!allowed) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
 
  return null;
}