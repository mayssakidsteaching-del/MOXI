# Security Specification — MOXI Living Desk Robot

## 1. Data Invariants
1. **Owner-Only Profile (`/users/{userId}`)**: A `UserProfile` document can only be read or written by the authenticated, email-verified user whose `request.auth.uid == userId`, with `uid` matching `userId` and server-validated `createdAt`/`updatedAt == request.time`.
2. **Master Gate on Subcollections**: No `RobotMemory` (`/users/{userId}/memories/{memoryId}`) or `RobotHighlight` (`/users/{userId}/highlights/{highlightId}`) can be created unless the parent `/users/{userId}` document exists and `ownerId == request.auth.uid == userId`.
3. **Immutable Ownership & Creation Time**: On `update`, `uid`, `ownerId`, and `createdAt` cannot change, and `updatedAt` must equal `request.time`.
4. **Strict Payload Boundaries**: Shadow/ghost fields (`isAdmin`, `role`, `isVerified`), oversized strings (> maxLength), and non-alphanumeric IDs (> 128 chars) are rejected at the rule layer.
5. **Query Enforcer**: `allow list` on subcollections checks `resource.data.ownerId == request.auth.uid` without `get()`/`exists()` lookups.

## 2. The "Dirty Dozen" Attack Payloads
1. **Unauthenticated Profile Read**: Read `/users/userA` with `auth: null` -> `PERMISSION_DENIED`.
2. **Unverified Email Write**: Create `/users/userA` with `email_verified: false` -> `PERMISSION_DENIED`.
3. **Cross-User Profile Hijack**: Read or write `/users/userB` while signed in as `userA` -> `PERMISSION_DENIED`.
4. **UID Spoofing on Create**: Create `/users/userA` with `{ uid: 'userB', ... }` -> `PERMISSION_DENIED`.
5. **Shadow / Ghost Field Injection**: Create `/users/userA` with extra field `{ isAdmin: true }` -> `PERMISSION_DENIED`.
6. **Client-Forged Timestamp**: Create `/users/userA/memories/mem1` with client `Date` instead of `request.time` -> `PERMISSION_DENIED`.
7. **Orphaned Memory Write**: Create `/users/userA/memories/mem1` before `/users/userA` exists -> `PERMISSION_DENIED`.
8. **Oversized Memory Value (DoW)**: Create memory with `value` of 1,500 chars (> 400 max) -> `PERMISSION_DENIED`.
9. **ID Poisoning**: Create document with ID containing `../bad$id!` -> `PERMISSION_DENIED`.
10. **Immutable Field Mutation**: Update memory changing `ownerId` or `createdAt` -> `PERMISSION_DENIED`.
11. **Invalid Speaker Enum**: Create highlight with `speaker: 'admin'` -> `PERMISSION_DENIED`.
12. **Cross-Tenant List Scraping**: List `/users/userB/memories` while signed in as `userA` -> `PERMISSION_DENIED`.
