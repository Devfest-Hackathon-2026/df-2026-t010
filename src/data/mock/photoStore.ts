// Completion photos are kept outside localStorage to avoid duplicating large
// base64 strings in every gallery record and exhausting its small quota.
import { GatewayError } from '@rekt/shared'

// 端末の空き容量不足・プライベートブラウズ等でIndexedDBに置けないときは、写真の上限として扱う。
// 画面は「材料は手入力・完成は写真なし」で続けられる（PHOTO_LIMIT_REACHED）。
export function photoStoreError(cause: unknown): GatewayError {
  if (cause instanceof GatewayError) return cause
  const name = typeof cause === 'object' && cause !== null && 'name' in cause ? String(cause.name) : ''
  if (/QuotaExceeded|InvalidState|Unknown|NotAllowed|Security/.test(name) || typeof indexedDB === 'undefined') return new GatewayError('PHOTO_LIMIT_REACHED')
  return new GatewayError('INTERNAL_ERROR')
}
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('co-make-completion-photos-v3', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('photos')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export async function putMockPhoto(path: string, blob: Blob) {
  let db: IDBDatabase
  try { db = await database() } catch (cause) { throw photoStoreError(cause) }
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('photos', 'readwrite')
      const photos = tx.objectStore('photos')
      const existing = photos.getKey(path)
      // The same transaction checks and writes the key, including across tabs.
      existing.onsuccess = () => { if (existing.result === undefined) photos.add(blob, path) }
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error)
    })
  } catch (cause) { throw photoStoreError(cause) } finally { db.close() }
}
export async function getMockPhotoBlob(path: string): Promise<Blob | null> {
  let db: IDBDatabase
  // 開けない（プライベートブラウズ・削除済み等）ときは写真なしとして扱い、記録の表示は続ける。
  try { db = await database() } catch { return null }
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const request = db.transaction('photos').objectStore('photos').get(path)
      request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null)
      request.onerror = () => reject(request.error)
    })
  } finally { db.close() }
}

export async function getMockPhoto(path: string): Promise<string | null> {
  const blob = await getMockPhotoBlob(path)
  if (!blob) return null
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
