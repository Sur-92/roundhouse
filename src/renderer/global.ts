import type { RoundhouseApi } from '@shared/types'

declare global {
  interface Window {
    roundhouse: RoundhouseApi
  }
}

export {}
