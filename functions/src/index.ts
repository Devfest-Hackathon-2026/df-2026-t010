import './runtime'
import { onCall } from 'firebase-functions/v2/https'
import { HealthResponseSchema } from '@rekt/shared'
import { requireUserId } from './lib/auth'
export { createCraft } from './features/crafts/index'
export { recognizeMaterials } from './features/materials/index'
export { editMaterials, confirmMaterials } from './features/materials/mutations'
export { startCraft, completeStep } from './features/production/index'
export { completeCraft } from './features/completion/index'
export { cleanupExpiredCrafts, cleanupLateCraftPhoto } from './features/cleanup/index'
export { reservePhotoUpload } from './features/photos/index'
export { generateProjects } from './features/projects/generation'
export { listGallery, getGalleryPost, listGalleryPage, publishCraft, galleryAction, listMyCrafts } from './features/gallery/index'

// 開発用の認証・疎通確認。業務APIはfeatures配下で実装し、ここからexportする。
export const health = onCall({ timeoutSeconds: 10, memory: '256MiB' }, (request) => {
  requireUserId(request.auth)
  return HealthResponseSchema.parse({ service: 'co-make', status: 'ok', version: 1 })
})
