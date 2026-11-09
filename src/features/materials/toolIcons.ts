import type { Icon } from '@phosphor-icons/react'
import { CircleIcon } from '@phosphor-icons/react/dist/csr/Circle'
import { CylinderIcon } from '@phosphor-icons/react/dist/csr/Cylinder'
import { DropIcon } from '@phosphor-icons/react/dist/csr/Drop'
import { HammerIcon } from '@phosphor-icons/react/dist/csr/Hammer'
import { LinkSimpleIcon } from '@phosphor-icons/react/dist/csr/LinkSimple'
import { NeedleIcon } from '@phosphor-icons/react/dist/csr/Needle'
import { PaintBrushIcon } from '@phosphor-icons/react/dist/csr/PaintBrush'
import { PenIcon } from '@phosphor-icons/react/dist/csr/Pen'
import { PencilIcon } from '@phosphor-icons/react/dist/csr/Pencil'
import { PencilSimpleLineIcon } from '@phosphor-icons/react/dist/csr/PencilSimpleLine'
import { RecordIcon } from '@phosphor-icons/react/dist/csr/Record'
import { RulerIcon } from '@phosphor-icons/react/dist/csr/Ruler'
import { ScissorsIcon } from '@phosphor-icons/react/dist/csr/Scissors'
import { WrenchIcon } from '@phosphor-icons/react/dist/csr/Wrench'

// Checked in order, so specific names (pliers, glue stick, pencil) come before broader ones (pen, glue).
const rules: [RegExp, Icon][] = [
  [/はさみ|ハサミ|鋏|scissors/, ScissorsIcon],
  [/カッター|ナイフ|cutter|knife/, PencilSimpleLineIcon],
  [/定規|ものさし|物差し|ruler/, RulerIcon],
  [/テープ|tape/, CircleIcon],
  [/スティック|glue stick/, CylinderIcon],
  [/のり|糊|ボンド|接着|glue/, DropIcon],
  [/ホッチキス|ホチキス|stapler/, LinkSimpleIcon],
  [/穴あけ|パンチ|punch/, RecordIcon],
  [/ペンチ|プライヤー|pliers/, WrenchIcon],
  [/鉛筆|えんぴつ|pencil/, PencilIcon],
  [/ペン|マーカー|\bpen\b|marker/, PenIcon],
  [/筆|ブラシ|brush/, PaintBrushIcon],
  [/針|needle/, NeedleIcon],
  [/金づち|かなづち|ハンマー|hammer/, HammerIcon],
]

/** 工具名からアイコンを選ぶ。該当しない工具は共通の工具アイコンにする。 */
export function toolIcon(name: string): Icon {
  const normalized = name.normalize('NFKC').toLowerCase()
  return rules.find(([pattern]) => pattern.test(normalized))?.[1] ?? WrenchIcon
}
