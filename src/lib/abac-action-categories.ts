export const ABAC_ACTIONS = {
  // Cacheable actions (read-only, frequent, low-risk)
  CACHEABLE: [
    'settings:read',
    'data:read',
    'task:read',
    'playground:read',
    'playground:write',
    'source:read', 
    'project:read',
    'statistics:read',
    'user:list',
    'sourceType:list',
  ],
  
  // Always verify (mutations, sensitive operations)
  ALWAYS_VERIFY: [
    'settings:write',
    'data:write',
    'data:delete',
    'task:write',
    'source:write',
    'statistics:write',
    'project:write',
    'project:delete',
    'user:invite',
    'user:delete',
    'user:edit',
  ],
} as const;

type CacheableAction = (typeof ABAC_ACTIONS)['CACHEABLE'][number];
type AlwaysVerifyAction = (typeof ABAC_ACTIONS)['ALWAYS_VERIFY'][number];
export type ABACAction = CacheableAction | AlwaysVerifyAction;

export function isActionCacheable(action: ABACAction): boolean {
  return ABAC_ACTIONS.CACHEABLE.includes(action as any);
}