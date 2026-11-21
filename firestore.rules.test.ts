/**
 * Verification specification for the Dirty Dozen security payloads against firestore.rules.
 * Executed against Firestore Rules emulator when available.
 */
export const DIRTY_DOZEN_CASES = [
  { id: 1, name: 'Unauthenticated Profile Read', path: '/users/userA', op: 'get', expected: 'PERMISSION_DENIED' },
  { id: 2, name: 'Unverified Email Write', path: '/users/userA', op: 'create', expected: 'PERMISSION_DENIED' },
  { id: 3, name: 'Cross-User Profile Hijack', path: '/users/userB', op: 'update', expected: 'PERMISSION_DENIED' },
  { id: 4, name: 'UID Spoofing on Create', path: '/users/userA', op: 'create', expected: 'PERMISSION_DENIED' },
  { id: 5, name: 'Shadow Field Injection', path: '/users/userA', op: 'create', expected: 'PERMISSION_DENIED' },
  { id: 6, name: 'Client-Forged Timestamp', path: '/users/userA/memories/mem1', op: 'create', expected: 'PERMISSION_DENIED' },
  { id: 7, name: 'Orphaned Memory Write', path: '/users/userA/memories/mem1', op: 'create', expected: 'PERMISSION_DENIED' },
  { id: 8, name: 'Oversized Memory Value', path: '/users/userA/memories/mem1', op: 'create', expected: 'PERMISSION_DENIED' },
  { id: 9, name: 'ID Poisoning', path: '/users/userA/memories/bad$id', op: 'create', expected: 'PERMISSION_DENIED' },
  { id: 10, name: 'Immutable Field Mutation', path: '/users/userA/memories/mem1', op: 'update', expected: 'PERMISSION_DENIED' },
  { id: 11, name: 'Invalid Speaker Enum', path: '/users/userA/highlights/h1', op: 'create', expected: 'PERMISSION_DENIED' },
  { id: 12, name: 'Cross-Tenant List Scraping', path: '/users/userB/memories', op: 'list', expected: 'PERMISSION_DENIED' },
] as const;
