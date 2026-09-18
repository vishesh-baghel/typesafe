import type { Label } from './tagging';
import type { EvidenceTier, RawPost, ScoredPost } from './types';

export const DB_NAME = 'downweight';
export const DB_VERSION = 2;
export const STORE = 'scores';
export const LABEL_STORE = 'labels';

export interface CacheEntry {
  post: ScoredPost;
  storedAt: number;
}

/**
 * Judgments keyed by X status id.
 *
 * This is what makes a slider free. The model runs once per post; every threshold change
 * afterwards is arithmetic over what is already here. It also absorbs X's virtualised
 * scroll, which unmounts and remounts the same card repeatedly as you move: without the
 * cache, scrolling up and back down would re-score the entire timeline.
 */
export function openCache(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'post.id' });
      // v2. The reader's own verdicts, kept separately from the model's: they outlive any
      // particular judgment, and clearing one must never clear the other.
      if (!db.objectStoreNames.contains(LABEL_STORE)) {
        db.createObjectStore(LABEL_STORE, { keyPath: 'post.id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
  });
}

const promisify = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'));
  });

export async function getScored(db: IDBDatabase, id: string): Promise<ScoredPost | null> {
  const tx = db.transaction(STORE, 'readonly');
  const entry = await promisify<CacheEntry | undefined>(tx.objectStore(STORE).get(id));
  return entry?.post ?? null;
}

export async function getMany(
  db: IDBDatabase,
  ids: readonly string[],
): Promise<Map<string, ScoredPost>> {
  if (ids.length === 0) return new Map();
  const tx = db.transaction(STORE, 'readonly');
  const store = tx.objectStore(STORE);
  const entries = await Promise.all(ids.map((id) => promisify<CacheEntry | undefined>(store.get(id))));

  const out = new Map<string, ScoredPost>();
  for (const entry of entries) if (entry) out.set(entry.post.id, entry.post);
  return out;
}

const tierOf = (t: EvidenceTier | undefined) => t ?? 1;

/**
 * Writes unless it would be a downgrade.
 *
 * A post can be scored twice: once at tier 1 when it scrolls past with no replies
 * fetched, then again at tier 2 once they arrive. The second write is an upgrade and must
 * land. The reverse, a tier-1 result arriving after a tier-2 one because a later reply
 * fetch failed, would silently throw away the better judgment and make `rage_bait`
 * flicker between available and not. Refusing the downgrade is cheaper than ordering the
 * writes.
 *
 * Returns whether the write happened, so callers can tell a no-op from a failure.
 */
export async function putScored(db: IDBDatabase, post: ScoredPost): Promise<boolean> {
  const existing = await getScored(db, post.id);
  if (existing && tierOf(existing.evidenceTier) > tierOf(post.evidenceTier)) return false;

  const tx = db.transaction(STORE, 'readwrite');
  await promisify(tx.objectStore(STORE).put({ post, storedAt: Date.now() } satisfies CacheEntry));
  return true;
}

export async function clearCache(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(STORE, 'readwrite');
  await promisify(tx.objectStore(STORE).clear());
}

/** One post the reader gave a verdict on, with the judgment that was on screen at the time. */
export interface LabelRecord {
  post: RawPost;
  scored: ScoredPost;
  label: Label;
  at: number;
}

export async function putLabel(db: IDBDatabase, record: LabelRecord): Promise<void> {
  const tx = db.transaction(LABEL_STORE, 'readwrite');
  await promisify(tx.objectStore(LABEL_STORE).put(record));
}

export async function removeLabel(db: IDBDatabase, id: string): Promise<void> {
  const tx = db.transaction(LABEL_STORE, 'readwrite');
  await promisify(tx.objectStore(LABEL_STORE).delete(id));
}

export async function allLabels(db: IDBDatabase): Promise<LabelRecord[]> {
  const tx = db.transaction(LABEL_STORE, 'readonly');
  return promisify(tx.objectStore(LABEL_STORE).getAll() as IDBRequest<LabelRecord[]>);
}
