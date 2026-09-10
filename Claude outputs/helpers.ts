import { Page, expect } from "@playwright/test";

/**
 * Every Crew Setup list row (job role, client, rotation template, offshore
 * site) renders as:
 *   <div class="... p-3 flex items-center gap-3 ...">
 *     <div class="flex-1 ...">
 *       <span>{name}</span> ...
 *     </div>
 *     <button>Edit</button>
 *     <button>Delete</button>
 *   </div>
 * This finds the outer row div for a given (unique) name so Edit/Delete
 * clicks apply to the right record instead of the first one on the page.
 */
export function rowByName(page: Page, name: string) {
  return page.locator("div.flex-1").filter({ hasText: name }).locator("xpath=..");
}

/** Accepts the native window.confirm() dialog the Delete buttons trigger. */
export function acceptNextConfirm(page: Page) {
  page.once("dialog", (dialog) => dialog.accept());
}

/** Waits for the page's error banner (ErrorLine component) to show text matching `pattern`. */
export async function expectErrorMatching(page: Page, pattern: RegExp) {
  await expect(page.getByText(pattern).first()).toBeVisible({ timeout: 5_000 });
}

export function uniqueName(prefix: string) {
  return `${prefix} ${Date.now()}`;
}
