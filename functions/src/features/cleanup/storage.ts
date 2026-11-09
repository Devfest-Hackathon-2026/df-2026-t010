import { getStorage } from 'firebase-admin/storage'
import { IdSchema } from '@rekt/shared'

export async function deleteCraftObjects(craftId: string): Promise<boolean> {
  IdSchema.parse(craftId)
  const prefix = `crafts/${craftId}/`
  const bucket = getStorage().bucket()
  // Always start at the first remaining page: deleting while following page
  // offsets can skip objects. Include noncurrent generations in versioned buckets.
  for (let page = 0; page < 5; page++) {
    const [files] = await bucket.getFiles({ prefix, versions: true, autoPaginate: false, maxResults: 100 })
    if (files.length === 0) return true
    for (let offset = 0; offset < files.length; offset += 10) {
      const results = await Promise.allSettled(files.slice(offset, offset + 10).map(async (file) => {
        const generation = String(file.metadata.generation)
        if (!file.name.startsWith(prefix) || !/^[1-9][0-9]{0,19}$/.test(generation)) throw new Error('Invalid object listing')
        await bucket.file(file.name, { generation }).delete({ ignoreNotFound: true })
      }))
      if (results.some((result) => result.status === 'rejected')) throw new Error('Object deletion failed')
    }
  }
  const [remaining] = await bucket.getFiles({ prefix, versions: true, autoPaginate: false, maxResults: 1 })
  return remaining.length === 0
}

export async function deleteObjectGeneration(bucket: string, name: string, generation: string) {
  if (!/^[1-9][0-9]{0,19}$/.test(generation)) throw new Error('Invalid object generation')
  await getStorage().bucket(bucket).file(name, { generation }).delete({ ignoreNotFound: true })
}
