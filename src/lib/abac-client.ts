import { auth } from "@/server/auth";
import { isActionCacheable, ABACAction } from "@/lib/abac-action-categories";
import { env } from "@/env";
import type { AbacRequest } from "@/lib/abac-types";
import { SignJWT } from "jose";
import prisma from "@/lib/prisma";
import { LRUCache } from "lru-cache";
import { createHash } from "crypto";

// Server-side cache for permissions with LRU eviction
// Key format: "userId:projectId:action"
const permissionCache = new LRUCache<string, boolean>({
  max: env.ABAC_CACHE_SIZE_LIMIT,
  ttl: env.ABAC_CACHE_TTL * 1000, // Convert seconds to milliseconds
  updateAgeOnGet: true, // LRU behavior: refresh age on access
});

function getCacheKey(userId: string, projectId: string, action: string): string {
  return `${userId}:${projectId}:${action}`;
}

function getCachedPermission(userId: string, projectId: string, action: string): boolean | null {
  const key = getCacheKey(userId, projectId, action);
  const cached = permissionCache.get(key);
  return cached !== undefined ? cached : null;
}

function setCachedPermission(userId: string, projectId: string, action: string, allowed: boolean): void {
  const key = getCacheKey(userId, projectId, action);
  permissionCache.set(key, allowed);
}

/**
 * Thrown when the ABAC service could not be reached, or answered with a
 * non-OK status / malformed body — i.e. we never got a real allow/deny
 * verdict from OPA. Distinct from a genuine `false` verdict, which means
 * OPA was reached and said no.
 *
 * Callers still end up fail-closed either way (no access is granted), but
 * this lets them log/report an outage as an outage (5xx) instead of
 * silently presenting it to the user as a permission denial (401/403).
 */
export class AbacUnreachableError extends Error {
  constructor(message: string = "ABAC service unavailable", options?: ErrorOptions) {
    super(message, options);
    this.name = "AbacUnreachableError";
  }
}
 
// A resolved subject, regardless of where it came from (session or API key)
type Subject = { id:string; role: string; email: string | null};


export async function checkPermission(
  projectId: string,
  action: ABACAction,
  options?: {
    resourceAttributes?: Record<string, any>;
    environments?: Record<string, any>;
  }
): Promise<boolean> {
  const session = await auth();
  
  if (!session?.user?.id) {
    return false;
  }

  // Get the user's role in the project
  const projectMember = await prisma.projectMember.findFirst({
    where: {
      userId: session.user.id,
      projectId: projectId,
    },
    select: {
      role: true,
    },
  });

  // If user is not a member of the project, deny access
  if (!projectMember) {
    return false;
  }
  
  // Check if action is cacheable and in cache
  if (isActionCacheable(action)) {
    const cached = getCachedPermission(session.user.id, projectId, action);
    if (cached !== null) {
      return cached;
    }
  }
  
  // Make direct ABAC call
  const [resourceType, actionType] = action.split(':'); // "settings:read" → ["settings", "read"]
  const abacToken = await createAbacToken(session.user.id);
  
  try {
    const response = await fetch(env.ABAC_SERVER_URL + '/request_access', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${abacToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subject: {
          id: session.user.id,
          role: projectMember.role,
          email: session.user.email,
        },
        resource: {
          id: projectId,
          type: resourceType,
        },
        environments: options?.environments || null,
        action: {
          name: actionType,
          metadata: {}
        },        
      } as AbacRequest),
    });
    
    if (!response.ok) {
      console.error(`ABAC request failed: ${response.status}`);
      throw new AbacUnreachableError(`ABAC service returned ${response.status}`);
    }
    
    const result = await response.json();
    const allowed = result.result || false;
    
    // Cache the result if the action is cacheable
    if (isActionCacheable(action)) {
      setCachedPermission(session.user.id, projectId, action, allowed);
    }
    
    return allowed;
  } catch (error) {
    if (error instanceof AbacUnreachableError) {
      throw error; // Already distinguished above; don't re-wrap
    }
    console.error('ABAC error:', error);
    // Network failure, timeout, malformed JSON, etc. — we never got a real
    // verdict from OPA, so this is an outage, not a "no". Still fail-closed
    // for the caller (no boolean `true` is ever returned here), but callers
    // can now tell the two cases apart instead of silently treating an
    // outage as a denial.
    throw new AbacUnreachableError("Failed to reach ABAC service", { cause: error });
  }
}

// NEW — resolves an "Authorization: Bearer <key>" header to a subject, or null
/**
 * Check permission for a machine caller - a project-scoped API key (see the
 * ApiKey model in schema.prisma) - instead of a signed-in user.
 *
 * Used by the /api/v1 routes the ML pipeline scripts poll (examples/*./playground.py,
 * upload.py, 02_prediction.py), which authenticate with an API key header rather than
 * a NextAuth session. Unlike checkPermission, this does not look up a ProjectMember:
 * the caller must already have resolved `apiKeyId` from the request and confirmed it
 * is a live (non-revoked) key belonging to `projectId` before calling this - this
 * function only asks ABAC what that machine may do, not whether it belongs here.
 */

export async function resolveApiKey(
  request: Request,
  projectId: string
): Promise<Subject | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const plaintextKey = authHeader.slice("Bearer ".length).trim();
  if (!plaintextKey) {
    return null;
  }

  const hashedKey = createHash("sha256").update(plaintextKey).digest("hex");

  const apiKey = await prisma.apiKey.findUnique({ where: { hashedKey } });
  if (!apiKey || apiKey.revokedAt || apiKey.projectId !== projectId) {
    return null;
  }

  // Don't block the request on this — fire and forget.
  prisma.apiKey
    .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
    .catch((e) => console.error("Failed to update ApiKey.lastUsedAt:", e));

  return { id: `apikey:${apiKey.id}`, role: "MACHINE", email: null };
}

// NEW — same OPA check as checkPermission, entry point for machine callers
export async function checkPermissionForApiKey(
  request: Request,
  projectId: string,
  action: ABACAction,
  options?: {
    resourceAttributes?: Record<string, any>;
    environments?: Record<string, any>;
  }
): Promise<boolean> {
  const subject = await resolveApiKey(request, projectId);
  if (!subject) {
    return false;
  }
  return checkPermissionForSubject(subject, projectId, action, options);
}

// NEW — the actual OPA call, extracted so both paths above share it
async function checkPermissionForSubject(
  subject: Subject,
  projectId: string,
  action: ABACAction,
  options?: {
    resourceAttributes?: Record<string, any>;
    environments?: Record<string, any>;
  }
): Promise<boolean> {
  if (isActionCacheable(action)) {
    const cached = getCachedPermission(subject.id, projectId, action);
    if (cached !== null) {
      return cached;
    }
  }

  const [resourceType, actionType] = action.split(':');
  const abacToken = await createAbacToken(subject.id);

  try {
    const response = await fetch(env.ABAC_SERVER_URL + '/request_access', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${abacToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subject: { id: subject.id, role: subject.role, email: subject.email },
        resource: { id: projectId, type: resourceType },
        environments: options?.environments || null,
        action: { name: actionType, metadata: {} },
      } as AbacRequest),
    });

    if (!response.ok) {
      console.error(`ABAC request failed: ${response.status}`);
      throw new AbacUnreachableError('ABAC service returned ${response.status}');
    }

    const result = await response.json();
    const allowed = result.result || false;

    if (isActionCacheable(action)) {
      setCachedPermission(subject.id, projectId, action, allowed);
    }

    return allowed;
  } catch (error) {
    if (error instanceof AbacUnreachableError) {
      throw error; // Already distinguished above; don't re-wrap
    }
    console.error('ABAC error:', error);
    throw new AbacUnreachableError("Failed to reach ABAC service", { cause: error });
  }
}

/**
 * Create a signed JWT for ABAC server authentication
 * This is separate from NextAuth's encrypted session token
 */
async function createAbacToken(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(env.ABAC_SECRET);
  
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h') // Short-lived token for ABAC requests
    .sign(secret);    
  return token;
}