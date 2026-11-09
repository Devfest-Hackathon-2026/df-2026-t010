import { TemplateSchema } from '@rekt/shared'
import type { Template } from '@rekt/shared'

// content/templates/*.json（#12でFE2が作成する検証済み作品）をビルドに同梱する。
// スキーマ（v2）に合わないファイルは公開せず、開発時に気づけるよう警告だけ出す。
// テスト用fixtureや試作前の作品はここに置かない（reuse-craft-v2）。
const files = import.meta.glob<unknown>('../../content/templates/*.json', { eager: true, import: 'default' })

export function parseTemplates(entries: Record<string, unknown>): Template[] {
  return Object.entries(entries).flatMap(([path, value]) => {
    const parsed = TemplateSchema.safeParse(value)
    if (parsed.success) return [parsed.data]
    console.warn(`[co-make] Invalid template skipped: ${path}`)
    return []
  })
}

export const verifiedTemplates: Template[] = parseTemplates(files)
