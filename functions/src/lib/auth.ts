import type { CraftDocument, CraftStatus } from '@rekt/shared'
import { fail } from './errors'

export function requireUserId(auth: { uid: string } | undefined): string {
  if (!auth?.uid) fail('UNAUTHENTICATED')
  return auth.uid
}
export function requireCraftOwner(craft: Pick<CraftDocument, 'ownerUid'>, uid: string) {
  if (craft.ownerUid !== uid) fail('NOT_CRAFT_OWNER')
}
export function requireState(craft: Pick<CraftDocument, 'status'>, allowed: readonly CraftStatus[]) {
  if (!allowed.includes(craft.status)) fail('INVALID_CRAFT_STATE')
}
