Vendored runtime libraries (no build step; mapped by the import map in app/index.html
and app/gallery.html). Files are copied unmodified from the npm registry tarballs.

  preact 10.29.8  (MIT)         npm pack preact@10.29.8
    preact/preact.module.js     <- package/dist/preact.module.js (+ .map)
    preact/hooks.module.js      <- package/hooks/dist/hooks.module.js (+ .map)
    preact/LICENSE
  htm 3.1.1       (Apache-2.0)  npm pack htm@3.1.1
    htm/htm.module.js           <- package/dist/htm.module.js
    htm/LICENSE

Import map specifiers: "preact", "preact/hooks", "htm".
To upgrade: npm pack the new version in a scratch directory, copy the same files,
bump the versions here and in docs/ui-guide.md, and run npm run test:browser.
