import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";

async function readLocalConfig() {
  try {
    const source = await readFile("config.js", "utf8");
    const window = {};
    new Function("window", source)(window);
    return window.TRAINING_DASHBOARD_CONFIG || {};
  } catch (error) {
    console.warn("Could not read local config.js, using environment defaults only.");
    return {};
  }
}

const localConfig = await readLocalConfig();

const config = {
  SUPABASE_URL:
    process.env.SUPABASE_URL ||
    localConfig.SUPABASE_URL ||
    "https://gomvlijafqagznoexdsx.supabase.co",
  SUPABASE_ANON_KEY:
    process.env.SUPABASE_ANON_KEY ||
    localConfig.SUPABASE_ANON_KEY ||
    "",
  GEMINI_PROXY_URL:
    process.env.GEMINI_PROXY_URL ||
    localConfig.GEMINI_PROXY_URL ||
    "https://gomvlijafqagznoexdsx.supabase.co/functions/v1/gemini-proxy",
  GEMINI_MODEL:
    process.env.GEMINI_MODEL ||
    localConfig.GEMINI_MODEL ||
    "gemini-3-flash-preview"
};

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await copyFile("index.html", "dist/index.html");
await writeFile("dist/.nojekyll", "");
await writeFile(
  "dist/config.js",
  `window.TRAINING_DASHBOARD_CONFIG = ${JSON.stringify(config, null, 2)};\n`
);
