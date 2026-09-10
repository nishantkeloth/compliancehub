import { test as setup, expect } from "@playwright/test";

const authFile = "storageState.json";

setup("authenticate", async ({ page }) => {
  const email = process.env.CH_EMAIL;
  const password = process.env.CH_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Set CH_EMAIL and CH_PASSWORD in a local .env file (copy .env.example) before running these tests."
    );
  }

  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // A successful sign-in redirects to "/" (the dashboard).
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

  await page.context().storageState({ path: authFile });
});
