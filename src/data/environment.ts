import { z } from 'zod'

const EnvironmentSchema = z.object({
  VITE_DATA_MODE: z.enum(['mock', 'emulator', 'firebase']).default('mock'),
  VITE_FIREBASE_PROJECT_ID: z.string().min(1).default('demo-co-make'),
  VITE_FIREBASE_EMULATOR_HOST: z.string().min(1).default('127.0.0.1'),
  VITE_FIREBASE_FUNCTIONS_REGION: z.string().min(1).default('asia-northeast1'),
  VITE_FIREBASE_API_KEY: z.string().optional(),
  VITE_FIREBASE_AUTH_DOMAIN: z.string().optional(),
  VITE_FIREBASE_APP_ID: z.string().optional(),
  VITE_FIREBASE_STORAGE_BUCKET: z.string().optional(),
  VITE_FIREBASE_APP_CHECK_SITE_KEY: z.string().optional(),
})

export function readEnvironment(values: Record<string, unknown>) {
  const env = EnvironmentSchema.parse(values)
  if (env.VITE_DATA_MODE === 'emulator' && !env.VITE_FIREBASE_PROJECT_ID.startsWith('demo-')) {
    throw new Error('Emulator mode requires a demo- project ID.')
  }
  if (env.VITE_DATA_MODE === 'firebase') {
    if (env.VITE_FIREBASE_PROJECT_ID.startsWith('demo-')) {
      throw new Error('Firebase mode requires a real project ID.')
    }
    for (const key of ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_APP_ID', 'VITE_FIREBASE_STORAGE_BUCKET', 'VITE_FIREBASE_APP_CHECK_SITE_KEY'] as const) {
      if (!env[key]?.trim()) throw new Error(`Missing Firebase web setting: ${key}`)
    }
  }
  return env
}
