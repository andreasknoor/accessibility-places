// Self-destructing service worker.
//
// A caching service worker was accidentally shipped to production: a brief
// switch to a webpack build (v3.84–v3.86) made @serwist/next emit a precaching
// SW, which was then committed by accident. Returning visitors got it installed
// in their browser, where it served stale/broken cached assets — the map looked
// broken on the deployed site while an incognito window (no SW) worked fine.
//
// This file replaces that SW. Browsers re-fetch /sw.js on navigation, compare it
// byte-for-byte, and install this version when it differs. On activation it
// deletes every cache, unregisters itself, and reloads open tabs so they fetch
// fresh from the network. After that the client has no service worker.
//
// Keep this deployed until returning visitors have all picked it up. Do not
// replace it with a caching SW unless the PWA story is intentionally rebuilt
// (and never commit a generated Serwist sw.js again — it is a build artifact).

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) {
        client.navigate(client.url);
      }
    })()
  );
});
