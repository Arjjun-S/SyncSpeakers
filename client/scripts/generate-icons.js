// Generates PWA icons from the source favicon.svg
// Usage: npm run generate:icons

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.join(projectRoot, "public");
const sourceSvg = path.join(publicDir, "favicon.svg");

const outputs = [
  { name: "pwa-192x192.png", size: 192 },
  { name: "pwa-512x512.png", size: 512 },
];

async function main() {
  if (!fs.existsSync(sourceSvg)) {
    console.error("Missing source icon:", sourceSvg);
    process.exit(1);
  }

  for (const out of outputs) {
    const dest = path.join(publicDir, out.name);
    await sharp(sourceSvg).resize(out.size, out.size).png().toFile(dest);
    console.log(`Generated ${dest}`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("Failed to generate icons:", err);
  process.exit(1);
});
