import { describe, expect, it } from 'vitest'
import { CircleIcon } from '@phosphor-icons/react/dist/csr/Circle'
import { CylinderIcon } from '@phosphor-icons/react/dist/csr/Cylinder'
import { DropIcon } from '@phosphor-icons/react/dist/csr/Drop'
import { LinkSimpleIcon } from '@phosphor-icons/react/dist/csr/LinkSimple'
import { PenIcon } from '@phosphor-icons/react/dist/csr/Pen'
import { PencilIcon } from '@phosphor-icons/react/dist/csr/Pencil'
import { PencilSimpleLineIcon } from '@phosphor-icons/react/dist/csr/PencilSimpleLine'
import { RecordIcon } from '@phosphor-icons/react/dist/csr/Record'
import { RulerIcon } from '@phosphor-icons/react/dist/csr/Ruler'
import { ScissorsIcon } from '@phosphor-icons/react/dist/csr/Scissors'
import { WrenchIcon } from '@phosphor-icons/react/dist/csr/Wrench'
import ja from '../../i18n/locales/ja/common.json'
import en from '../../i18n/locales/en/common.json'
import { toolIcon } from './toolIcons'

describe('toolIcon', () => {
  const expected = [ScissorsIcon, PencilSimpleLineIcon, RulerIcon, CircleIcon, CircleIcon, CylinderIcon, DropIcon, LinkSimpleIcon, PenIcon, RecordIcon]

  it('gives every suggested tool its own icon in both languages', () => {
    expect(ja.toolSuggestions.map(toolIcon)).toEqual(expected)
    expect(en.toolSuggestions.map(toolIcon)).toEqual(expected)
  })

  it('matches added tools by name and keeps a generic icon for unknown ones', () => {
    expect(toolIcon('マスキングテープ')).toBe(CircleIcon)
    expect(toolIcon('鉛筆')).toBe(PencilIcon)
    expect(toolIcon('ペンチ')).toBe(WrenchIcon)
    expect(toolIcon('Pencil')).toBe(PencilIcon)
    expect(toolIcon('ﾊｻﾐ')).toBe(ScissorsIcon)
    expect(toolIcon('ラジオペンチ')).toBe(WrenchIcon)
    expect(toolIcon('mystery tool')).toBe(WrenchIcon)
  })
})
