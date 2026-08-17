const DB_NAME = 'imago-subject-library';
const DB_VERSION = 1;
const STORE_NAME = 'subjects';

export const SUBJECT_LIBRARY_CHANGED_EVENT = 'imago:subject-library-changed';
export const SUBJECT_LIBRARY_LIMIT = 8;
export const SUBJECT_LIBRARY_MAX_ITEM_BYTES = 12 * 1024 * 1024;
export const SUBJECT_LIBRARY_MAX_TOTAL_BYTES = 32 * 1024 * 1024;

export interface StoredSubjectCutout {
  id: string;
  name: string;
  blob: Blob;
  naturalWidth: number;
  naturalHeight: number;
  byteSize: number;
  createdAt: number;
  lastUsedAt: number;
}

export type SubjectCutoutRetentionRecord = Pick<
  StoredSubjectCutout,
  'id' | 'byteSize' | 'createdAt' | 'lastUsedAt'
>;

/**
 * Deterministically deduplicate and retain the newest records within both caps.
 * Kept separate from IndexedDB so the quota policy is easy to test.
 */
export function selectRetainedSubjectRecords<T extends SubjectCutoutRetentionRecord>(
  records: readonly T[],
  maxItems = SUBJECT_LIBRARY_LIMIT,
  maxTotalBytes = SUBJECT_LIBRARY_MAX_TOTAL_BYTES,
): T[] {
  if (maxItems <= 0 || maxTotalBytes <= 0) return [];

  const unique = new Map<string, T>();
  for (const record of records) {
    if (
      !record.id ||
      !Number.isFinite(record.byteSize) ||
      record.byteSize <= 0 ||
      record.byteSize > SUBJECT_LIBRARY_MAX_ITEM_BYTES
    ) {
      continue;
    }
    const current = unique.get(record.id);
    if (
      !current ||
      record.lastUsedAt > current.lastUsedAt ||
      (record.lastUsedAt === current.lastUsedAt && record.createdAt > current.createdAt)
    ) {
      unique.set(record.id, record);
    }
  }

  const newest = [...unique.values()].sort(
    (a, b) =>
      b.lastUsedAt - a.lastUsedAt || b.createdAt - a.createdAt || a.id.localeCompare(b.id),
  );
  const retained: T[] = [];
  let totalBytes = 0;
  for (const record of newest) {
    if (retained.length >= maxItems) break;
    if (totalBytes + record.byteSize > maxTotalBytes) continue;
    retained.push(record);
    totalBytes += record.byteSize;
  }
  return retained;
}

export function isSubjectBlobSizeAllowed(byteSize: number): boolean {
  return Number.isFinite(byteSize) && byteSize > 0 && byteSize <= SUBJECT_LIBRARY_MAX_ITEM_BYTES;
}

export async function hashSubjectBlob(blob: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Secure content hashing is unavailable');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  const hex = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex}`;
}

let databasePromise: Promise<IDBDatabase> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is unavailable'));
  }
  if (databasePromise) return databasePromise;

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };
    request.onerror = () => reject(request.error ?? new Error('Could not open cutout library'));
    request.onblocked = () => reject(new Error('Cutout library upgrade is blocked'));
  }).catch((error): never => {
    databasePromise = null;
    throw error;
  });
  databasePromise = opening;
  return opening;
}

function readRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Cutout library read failed'));
  });
}

function notifyChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SUBJECT_LIBRARY_CHANGED_EVENT));
  }
}

function queueWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(operation, operation);
  writeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function getSubjectCutout(database: IDBDatabase, id: string) {
  const transaction = database.transaction(STORE_NAME, 'readonly');
  return readRequest<StoredSubjectCutout | undefined>(
    transaction.objectStore(STORE_NAME).get(id),
  );
}

function writeAndPrune(database: IDBDatabase, record: StoredSubjectCutout): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const current = request.result as StoredSubjectCutout[];
      const retained = selectRetainedSubjectRecords([
        ...current.filter((candidate) => candidate.id !== record.id),
        record,
      ]);
      const retainedIds = new Set(retained.map((candidate) => candidate.id));
      for (const candidate of current) {
        if (!retainedIds.has(candidate.id)) store.delete(candidate.id);
      }
      if (retainedIds.has(record.id)) store.put(record);
    };
    request.onerror = () => transaction.abort();
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? request.error ?? new Error('Cutout save failed'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Cutout save failed'));
  });
}

function writeRecord(database: IDBDatabase, record: StoredSubjectCutout): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Cutout update failed'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Cutout update failed'));
  });
}

export async function listSubjectCutouts(): Promise<StoredSubjectCutout[]> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readonly');
  const records = await readRequest<StoredSubjectCutout[]>(
    transaction.objectStore(STORE_NAME).getAll(),
  );
  return selectRetainedSubjectRecords(records).filter(
    (record) => record.blob instanceof Blob && record.naturalWidth > 0 && record.naturalHeight > 0,
  );
}

export async function saveSubjectCutout(input: {
  blob: Blob;
  name: string;
  naturalWidth: number;
  naturalHeight: number;
}): Promise<StoredSubjectCutout | null> {
  if (
    !isSubjectBlobSizeAllowed(input.blob.size) ||
    input.naturalWidth <= 0 ||
    input.naturalHeight <= 0
  ) {
    return null;
  }

  const id = await hashSubjectBlob(input.blob);
  return queueWrite(async () => {
    const database = await openDatabase();
    const existing = await getSubjectCutout(database, id);
    const now = Date.now();
    const record: StoredSubjectCutout = {
      id,
      name: input.name.trim() || existing?.name || 'Reusable subject',
      blob: input.blob,
      naturalWidth: input.naturalWidth,
      naturalHeight: input.naturalHeight,
      byteSize: input.blob.size,
      createdAt: existing?.createdAt ?? now,
      lastUsedAt: now,
    };
    await writeAndPrune(database, record);
    notifyChanged();
    return record;
  });
}

export function touchSubjectCutout(id: string): Promise<void> {
  return queueWrite(async () => {
    const database = await openDatabase();
    const record = await getSubjectCutout(database, id);
    if (!record) return;
    await writeRecord(database, { ...record, lastUsedAt: Date.now() });
    notifyChanged();
  });
}

export function deleteSubjectCutout(id: string): Promise<void> {
  return queueWrite(async () => {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error('Cutout delete failed'));
      transaction.onerror = () => reject(transaction.error ?? new Error('Cutout delete failed'));
    });
    notifyChanged();
  });
}
