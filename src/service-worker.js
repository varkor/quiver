importScripts("/workbox/workbox-sw.js");

workbox.setConfig({
  // NOTE: to use `debug`, you must either disable `modulePathPrefix` so dependencies are fetched from CDN, or vendor the dev versions by replacing instances of "prod.js" with "dev.js" in the relevant version of the Makefile.
  // debug: true,
  modulePathPrefix: "/workbox/",
});

workbox.routing.setDefaultHandler(new workbox.strategies.CacheFirst());
