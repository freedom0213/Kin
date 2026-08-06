import { writeFile } from "node:fs/promises";

const transparentPixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4AWMAAQAABQABNtCI3QAAAABJRU5ErkJggg==",
  "base64",
);

await writeFile(new URL("../assets/splash-transparent.png", import.meta.url), transparentPixel);

console.log("Generated assets/splash-transparent.png");
