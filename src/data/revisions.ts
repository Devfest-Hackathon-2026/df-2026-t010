import { pendingProjectLocale } from '@rekt/shared'
import type { ProductionDocument } from '@rekt/shared'

// #17 古いrevisionの排除。APIの応答と購読（別タブ・再接続後の再送を含む）は逆順に届くことがあるため、
// 画面は受け取った制作を直接上書きせず、production.revision が大きい方だけを残す。
export function latestProduction(current: ProductionDocument | null, incoming: ProductionDocument | null): ProductionDocument | null {
  if (!incoming) return current
  if (!current || current.template.id !== incoming.template.id) return incoming
  if (incoming.revision === current.revision && pendingProjectLocale(current.template) && !pendingProjectLocale(incoming.template)) return incoming
  return incoming.revision > current.revision ? incoming : current
}
