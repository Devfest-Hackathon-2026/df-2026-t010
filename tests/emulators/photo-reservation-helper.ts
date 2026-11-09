export async function reserveForPath(uid: string, path: string, sizeBytes: number, contentType: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/png') {
  const { runReservePhotoUpload } = await import('../../functions/src/features/photos/operations')
  const match = /^crafts\/([^/]+)\/(materials|completion)\/([^/]+)\.[^.]+$/.exec(path)
  if (!match) throw new Error('Invalid test photo path')
  const result = await runReservePhotoUpload(uid, { craftId: match[1]!, photoId: match[3]!, kind: match[2] as 'materials' | 'completion', sizeBytes, contentType })
  if (result.path !== path) throw new Error('Unexpected test reservation path')
  return result
}
