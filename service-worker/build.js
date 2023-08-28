const { generateSW } = require("workbox-build");

generateSW({
  globDirectory: "../src/",
  globPatterns: ["**/*"],
  swDest: "../src/service-worker.js",
}).then(({ count, size, warnings }) => {
  if (warnings.length > 0) {
    console.warn(
      "Warnings encountered while generating a service worker:",
      warnings.join("\n")
    );
  }

  console.log(
    `Generated a service worker, which will precache ${count} files, totaling ${size} bytes.`
  );
});
