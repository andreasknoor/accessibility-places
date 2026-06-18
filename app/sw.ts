import { defaultCache } from "@serwist/next/worker"
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist"
import { Serwist, NetworkOnly } from "serwist"

declare global {
  interface ServiceWorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
  }
}

declare const self: ServiceWorkerGlobalScope

const serwist = new Serwist({
  precacheEntries:   self.__SW_MANIFEST,
  skipWaiting:       true,
  clientsClaim:      true,
  navigationPreload: true,
  runtimeCaching: [
    // Overpass-backed endpoints must always hit the network — their response
    // time can exceed Serwist's 10 s NetworkFirst timeout, causing the SW to
    // fall back to a stale or empty cache entry (visible as "no parking spots
    // in installed PWA"). NetworkOnly bypasses the cache entirely.
    {
      matcher: ({ url: { pathname }, sameOrigin }) =>
        sameOrigin && (
          pathname === "/api/nearby-parking" ||
          pathname === "/api/search" ||
          pathname === "/api/raw"
        ),
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
})

serwist.addEventListeners()
