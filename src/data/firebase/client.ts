import { getApp, getApps, initializeApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions'
import { connectStorageEmulator, getStorage } from 'firebase/storage'
import { readEnvironment } from '../environment'

function initializeServices() {
  const env = readEnvironment(import.meta.env)
  if (env.VITE_DATA_MODE === 'mock') throw new Error('Firebase is disabled in mock mode.')
  const emulator = env.VITE_DATA_MODE === 'emulator'
  const app = getApps().length ? getApp() : initializeApp({
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    apiKey: emulator ? 'demo-api-key' : env.VITE_FIREBASE_API_KEY,
    authDomain: emulator ? `${env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com` : env.VITE_FIREBASE_AUTH_DOMAIN,
    appId: emulator ? 'demo-app-id' : env.VITE_FIREBASE_APP_ID,
    storageBucket: emulator ? `${env.VITE_FIREBASE_PROJECT_ID}.appspot.com` : env.VITE_FIREBASE_STORAGE_BUCKET,
  })
  if (!emulator && env.VITE_FIREBASE_APP_CHECK_SITE_KEY) {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(env.VITE_FIREBASE_APP_CHECK_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    })
  }
  const auth = getAuth(app)
  const firestore = getFirestore(app)
  const functions = getFunctions(app, env.VITE_FIREBASE_FUNCTIONS_REGION)
  const storage = getStorage(app)
  if (emulator) {
    const host = env.VITE_FIREBASE_EMULATOR_HOST
    connectAuthEmulator(auth, `http://${host}:9098`, { disableWarnings: true })
    connectFirestoreEmulator(firestore, host, 8085)
    connectFunctionsEmulator(functions, host, 5002)
    connectStorageEmulator(storage, host, 9198)
  }
  return { auth, firestore, functions, storage }
}

type Services = ReturnType<typeof initializeServices>
let services = import.meta.hot?.data.firebaseServices as Services | undefined

// 初期画面はmockのまま動く。Firebaseを利用する操作からだけ初期化する。
export function getFirebaseServices(): Services {
  return services ??= initializeServices()
}

if (import.meta.hot) {
  import.meta.hot.dispose((data) => { data.firebaseServices = services })
}
