import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import type { RobotMemory } from './types/robot';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
} as const;

export type OperationTypeValue = (typeof OperationType)[keyof typeof OperationType];

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationTypeValue;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo: Array<{
      providerId?: string | null;
      email?: string | null;
    }>;
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationTypeValue,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Startup Firestore connection check
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export interface UserProfileDoc {
  uid: string;
  displayName: string;
  preferredLanguage: string;
  voiceEnabled: boolean;
}

export interface RobotHighlightDoc {
  id: string;
  ownerId: string;
  speaker: 'user' | 'moxi';
  text: string;
  emotion: string;
  createdAtMs: number;
}

function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 80);
  return cleaned || `id_${Date.now()}`;
}

export async function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export async function signOutUser() {
  return signOut(auth);
}

export async function ensureUserProfile(user: User): Promise<UserProfileDoc> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data();
      return {
        uid: user.uid,
        displayName: String(data.displayName || user.displayName || 'Friend').slice(0, 120),
        preferredLanguage: String(data.preferredLanguage || 'Auto-detect (200+ languages)').slice(0, 60),
        voiceEnabled: typeof data.voiceEnabled === 'boolean' ? data.voiceEnabled : true,
      };
    }

    const initialProfile = {
      uid: user.uid,
      displayName: (user.displayName || 'Friend').slice(0, 120),
      preferredLanguage: 'Auto-detect (200+ languages)',
      voiceEnabled: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, initialProfile);
    return {
      uid: user.uid,
      displayName: initialProfile.displayName,
      preferredLanguage: initialProfile.preferredLanguage,
      voiceEnabled: initialProfile.voiceEnabled,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateUserPreferences(
  uid: string,
  updates: { displayName: string; preferredLanguage: string; voiceEnabled: boolean }
): Promise<void> {
  const path = `users/${uid}`;
  const ref = doc(db, 'users', uid);
  try {
    await updateDoc(ref, {
      displayName: updates.displayName.trim().slice(0, 120) || 'Friend',
      preferredLanguage: updates.preferredLanguage.trim().slice(0, 60) || 'Auto-detect (200+ languages)',
      voiceEnabled: Boolean(updates.voiceEnabled),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function upsertMemoryDoc(uid: string, key: string, value: string): Promise<void> {
  const cleanKey = key.trim().slice(0, 80);
  const cleanVal = value.trim().slice(0, 400);
  if (!cleanKey || !cleanVal) return;

  const memId = `mem_${sanitizeId(cleanKey.toLowerCase())}`;
  const path = `users/${uid}/memories/${memId}`;
  const ref = doc(db, 'users', uid, 'memories', memId);

  try {
    const existingSnap = await getDoc(ref);
    if (existingSnap.exists()) {
      await updateDoc(ref, {
        key: cleanKey,
        value: cleanVal,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        ownerId: uid,
        key: cleanKey,
        value: cleanVal,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteMemoryDoc(uid: string, memoryId: string): Promise<void> {
  const safeId = sanitizeId(memoryId);
  const path = `users/${uid}/memories/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'memories', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveHighlightDoc(
  uid: string,
  speaker: 'user' | 'moxi',
  text: string,
  emotion: string
): Promise<void> {
  const cleanText = text.trim().slice(0, 600);
  if (!cleanText) return;
  const highlightId = `hl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const path = `users/${uid}/highlights/${highlightId}`;
  try {
    await setDoc(doc(db, 'users', uid, 'highlights', highlightId), {
      ownerId: uid,
      speaker,
      text: cleanText,
      emotion: emotion.slice(0, 32) || 'happy',
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export function subscribeMemories(
  uid: string,
  onData: (memories: RobotMemory[]) => void,
  onErr?: (err: Error) => void
): Unsubscribe {
  const path = `users/${uid}/memories`;
  const q = query(collection(db, 'users', uid, 'memories'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: Array<RobotMemory & { _ms: number }> = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        const ts = d.updatedAt?.toDate ? d.updatedAt.toDate() : new Date();
        items.push({
          id: docSnap.id,
          key: String(d.key || ''),
          value: String(d.value || ''),
          updatedAt: ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          _ms: ts.getTime(),
        });
      });
      items.sort((a, b) => b._ms - a._ms);
      onData(items.map(({ _ms, ...rest }) => rest));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onErr?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeHighlights(
  uid: string,
  onData: (highlights: RobotHighlightDoc[]) => void,
  onErr?: (err: Error) => void
): Unsubscribe {
  const path = `users/${uid}/highlights`;
  const q = query(collection(db, 'users', uid, 'highlights'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: RobotHighlightDoc[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        const ts = d.createdAt?.toDate ? d.createdAt.toDate() : new Date();
        items.push({
          id: docSnap.id,
          ownerId: String(d.ownerId || uid),
          speaker: d.speaker === 'user' ? 'user' : 'moxi',
          text: String(d.text || ''),
          emotion: String(d.emotion || 'happy'),
          createdAtMs: ts.getTime(),
        });
      });
      items.sort((a, b) => b.createdAtMs - a.createdAtMs);
      onData(items.slice(0, 20));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onErr?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}
