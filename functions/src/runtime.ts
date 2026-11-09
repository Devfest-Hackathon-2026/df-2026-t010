import { setGlobalOptions } from 'firebase-functions/v2'

// Apply defaults before the callable modules create their handlers.
setGlobalOptions({
  region: 'asia-northeast1',
  maxInstances: 1,
  minInstances: 0,
  enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true',
})
