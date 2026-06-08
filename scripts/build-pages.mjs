import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";

const config = {
  GEMINI_PROXY_URL: process.env.GEMINI_PROXY_URL || "",
  GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-2.5-flash"
};

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await copyFile("index.html", "dist/index.html");
await writeFile("dist/.nojekyll", "");
await writeFile(
  "dist/config.js",
  `window.TRAINING_DASHBOARD_CONFIG = ${JSON.stringify(config, null, 2)};\n`
);
