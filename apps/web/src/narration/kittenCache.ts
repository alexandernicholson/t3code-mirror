import {
  KITTEN_BASE_URL,
  KITTEN_FILES,
  KITTEN_REVISION,
} from "@t3tools/client-runtime/narration/kitten";

const DATABASE = "t3code:narration-models";
function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.addEventListener("upgradeneeded", () => request.result.createObjectStore("assets"));
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
    request.addEventListener("blocked", () =>
      reject(new Error("Narration cache is blocked. Close other T3 tabs and retry.")),
    );
  });
}
async function access<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await openDatabase();
  try {
    const transaction = db.transaction("assets", mode);
    const request = action(transaction.objectStore("assets"));
    await new Promise<void>((resolve, reject) => {
      transaction.addEventListener("complete", () => resolve());
      transaction.addEventListener("abort", () => reject(transaction.error));
      transaction.addEventListener("error", () => reject(transaction.error));
    });
    return request.result;
  } finally {
    db.close();
  }
}
const key = (name: string) => `${KITTEN_REVISION}/${name}`;
export async function isKittenCached() {
  for (const file of KITTEN_FILES) {
    const stored = await access("readonly", (store) => store.getKey(key(file.name)));
    if (stored === undefined) return false;
  }
  return true;
}
export async function clearKittenCache() {
  await access("readwrite", (store) => store.clear());
}
/** Only complete, length-checked files are committed, so interrupted downloads can be retried. */
export async function loadKittenFile(
  file: (typeof KITTEN_FILES)[number],
  onProgress: (loaded: number) => void,
) {
  const stored: unknown = await access("readonly", (store) => store.get(key(file.name)));
  if (stored instanceof ArrayBuffer && stored.byteLength === file.size) {
    onProgress(file.size);
    return stored;
  }
  const response = await fetch(`${KITTEN_BASE_URL}/${file.name}`);
  if (!response.ok || !response.body)
    throw new Error(
      `Kitten download failed (${response.status}). Check your connection and retry.`,
    );
  const reader = response.body.getReader();
  const data = new Uint8Array(file.size);
  let loaded = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (loaded + chunk.value.length > data.length)
        throw new Error("Unexpected Kitten model size.");
      data.set(chunk.value, loaded);
      loaded += chunk.value.length;
      onProgress(loaded);
    }
  } finally {
    await reader.cancel();
  }
  if (loaded !== file.size) throw new Error("Kitten download was incomplete. Please retry.");
  await access("readwrite", (store) => store.put(data.buffer, key(file.name)));
  return data.buffer;
}
