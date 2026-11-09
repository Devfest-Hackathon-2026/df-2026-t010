import { describe, expect, it } from 'vitest'
import type { Material } from '@rekt/shared'
import { MAX_MATERIALS, addManual, materialOrigin, materialsState, mergeCandidates, readFields, removeItem, toggleTool, updateItem } from './materialDraft'

const ai = (id: string, name = '段ボール', unit = '枚'): Material => ({ id, name, quantity: 2, unit, source: 'ai', confidence: 0.8 })

describe('材料の編集（#11）', () => {
  it('未作成の材料文書は空・revision 0の未確定として扱う', () => {
    expect(materialsState(null)).toEqual({ revision: 0, items: [], tools: [], checks: [], confirmed: false })
  })

  it('AI候補・AIを人が直した行・手入力を区別する', () => {
    const items = addManual([ai('ai-1')], 'x', { name: 'ひも', quantity: 1, unit: '本' })
    const edited = updateItem(items, 'ai-1', { name: '段ボール', quantity: 3, unit: '枚' })!
    expect(edited.map(materialOrigin)).toEqual(['aiEdited', 'manual'])
    expect(edited[0]).toMatchObject({ quantity: 3, source: 'manual', confidence: null })
    expect(materialOrigin(ai('ai-2'))).toBe('ai')
  })

  it('値が変わらない保存はAI由来のまま残す', () => {
    const items = [ai('ai-1')]
    expect(updateItem(items, 'ai-1', { name: '段ボール', quantity: 2, unit: '枚' })).toBe(items)
  })

  it('別のタブで削除された行の編集・削除はnullで知らせる', () => {
    expect(updateItem([], 'gone', { name: 'a', quantity: 1, unit: '個' })).toBeNull()
    expect(removeItem([ai('ai-1')], 'gone')).toBeNull()
    expect(removeItem([ai('ai-1')], 'ai-1')).toEqual([])
  })

  it('入力値は契約の範囲で検証し、全角数字も受け付ける', () => {
    expect(readFields({ name: ' 紙コップ ', quantity: '１２', unit: '個' })).toEqual({ value: { name: '紙コップ', quantity: 12, unit: '個' } })
    expect(readFields({ name: '', quantity: '0', unit: '' })).toEqual({ problems: ['name', 'quantity', 'unit'] })
    expect(readFields({ name: 'a', quantity: '1e3', unit: '個' })).toEqual({ problems: ['quantity'] })
    expect(readFields({ name: 'a', quantity: '10001', unit: '個' })).toEqual({ problems: ['quantity'] })
  })

  it('候補の統合では同じIDや同じ名前・単位を二重に追加しない', () => {
    const current = [ai('ai-1'), addManual([], 'm', { name: '紙コップ', quantity: 6, unit: '個' })[0]!]
    const result = mergeCandidates(current, [ai('ai-1'), ai('ai-9', '紙コップ', '個'), ai('ai-10', 'ストロー', '本')])
    expect(result).toMatchObject({ added: 1, duplicates: 2, overflow: 0 })
    expect(result.items.map((item) => item.id)).toEqual(['ai-1', current[1]!.id, 'ai-10'])
  })

  it('上限を超える候補は追加しない', () => {
    const full = Array.from({ length: MAX_MATERIALS }, (_, index) => ai(`ai-${index}`, `材料${index}`))
    expect(mergeCandidates(full, [ai('ai-new', '新しい材料')])).toMatchObject({ added: 0, overflow: 1 })
  })

  it('工具の所持チェックを切り替える', () => {
    expect(toggleTool(['はさみ'], 'のり', true)).toEqual(['はさみ', 'のり'])
    expect(toggleTool(['はさみ', 'のり'], 'はさみ', false)).toEqual(['のり'])
    expect(toggleTool(['はさみ'], 'はさみ', true)).toEqual(['はさみ'])
  })
})
