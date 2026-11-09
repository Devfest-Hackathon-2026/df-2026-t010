import { onSchedule } from 'firebase-functions/v2/scheduler'
import { onObjectFinalized } from 'firebase-functions/v2/storage'
import { info } from 'firebase-functions/logger'
import { purgeLateCraftObject, runRetentionCleanup } from './operations'

export const cleanupExpiredCrafts = onSchedule({
  schedule: 'every 15 minutes', timeZone: 'Asia/Tokyo', region: 'asia-northeast1',
  timeoutSeconds: 300, memory: '256MiB', maxInstances: 1, minInstances: 0, concurrency: 1,
  retryCount: 3, minBackoffSeconds: 300, maxBackoffSeconds: 900,
}, async () => {
  const summary = await runRetentionCleanup()
  info('craft_cleanup_summary', summary)
  if (summary.failed > 0 || summary.invalid > 0) throw new Error('Craft cleanup requires retry or inspection')
})

// Cleans uploads authorized before the parent was removed but finalized later.
// Delete only the event's generation, and only when a private marker exists.
export const cleanupLateCraftPhoto = onObjectFinalized({
  region: 'asia-northeast1', timeoutSeconds: 60, memory: '256MiB',
  maxInstances: 1, minInstances: 0, concurrency: 1, retry: true,
}, async (event) => {
  await purgeLateCraftObject(event.data.bucket, event.data.name, String(event.data.generation))
})
