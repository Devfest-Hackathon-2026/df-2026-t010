import type { HealthGateway } from '../contracts'

export const mockHealthGateway: HealthGateway = {
  async check() {
    return { service: 'co-make', status: 'ok', version: 1 }
  },
}
