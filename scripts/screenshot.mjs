// One-off helper to generate README screenshots against a local dev instance.
// Not part of the build; run manually with `node scripts/screenshot.mjs`.
import { chromium } from "playwright";

const BASE = "http://localhost:5173";
const OUT = "docs/screenshots";

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

async function setup(theme, lang) {
  await page.goto(BASE);
  await page.evaluate(
    ({ theme, lang }) => {
      localStorage.setItem("fk_theme", theme);
      localStorage.setItem("fk_lang", lang);
    },
    { theme, lang },
  );
  await page.reload();
  await page.waitForLoadState("networkidle");
}

await page.goto(BASE);
await page.locator('input[type="email"]').fill("demo@example.com");
await page.locator('input[type="password"]').fill("demopassword123");
await page.locator('button[type="submit"]').click();
await page.waitForLoadState("networkidle");

await setup("light", "en");
await page.goto(`${BASE}/feeds`);
await page.waitForLoadState("networkidle");
await page.screenshot({ path: `${OUT}/feeds-light.png`, clip: { x: 0, y: 0, width: 1280, height: 460 } });

await setup("dark", "en");
await page.goto(`${BASE}/items`);
await page.waitForLoadState("networkidle");
await page.screenshot({ path: `${OUT}/items-dark.png`, clip: { x: 0, y: 0, width: 1280, height: 640 } });

await browser.close();
console.log("Screenshots written to", OUT);
