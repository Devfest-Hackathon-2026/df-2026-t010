import { fail } from '../../lib/errors'

export function recognitionEngine(mode: string, emulator: boolean, projectId: string | undefined): 'fixture' | 'gemini' | 'workers-ai' {
  if (mode === 'fixture' && emulator && projectId?.startsWith('demo-')) return 'fixture'
  if ((mode === 'gemini' || mode === 'workers-ai') && !emulator) return mode
  return fail('AI_DISABLED')
}
