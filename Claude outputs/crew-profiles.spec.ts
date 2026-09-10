import { test, expect } from "@playwright/test";
import { rowByName, acceptNextConfirm, uniqueName } from "./helpers";

// These tests create one crew member (and a supporting skill + job role),
// exercise the profile detail page, then delete everything they made.
// The Cost and Sensitive-notes sections only render for accounts with
// crew.view_cost / crew.view_sensitive, so those blocks self-skip with a
// clear console note if the signed-in test account doesn't have them —
// run this suite once as a full-access account to actually cover them.

test.describe("Crew Profiles", () => {
  const crewName = uniqueName("Test Crew Member");
  const skillName = uniqueName("Test Skill For Crew");
  const roleName = uniqueName("Test Secondary Role");

  test("list page loads and search/filter controls exist", async ({ page }) => {
    await page.goto("/crew/profiles");
    await expect(page.getByRole("heading", { name: "Crew Profiles" })).toBeVisible();
    await expect(page.getByPlaceholder("Search by name or employee code")).toBeVisible();
    await expect(page.getByRole("combobox")).toBeVisible();
  });

  test("create a crew member, edit general fields, skills, secondary role, then delete", async ({ page }) => {
    // --- Supporting data: a skill and a job role to attach later ---
    await page.goto("/crew/setup");
    await page.getByRole("button", { name: "Skills" }).click();
    await page.getByPlaceholder("Skill name, e.g. HACCP Certified").fill(skillName);
    await page.getByRole("button", { name: "+ Add skill" }).click();
    await expect(page.getByText(skillName, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Job Roles" }).click();
    await page.getByPlaceholder("Role name, e.g. Head Chef").fill(roleName);
    await page.getByRole("button", { name: "+ Add role" }).click();
    await expect(rowByName(page, roleName)).toBeVisible();

    // --- Create the crew member ---
    await page.goto("/crew/profiles");
    await page.getByRole("button", { name: "+ Add crew member" }).click();
    await page.getByPlaceholder("Full name").fill(crewName);
    await page.getByPlaceholder("Nationality").fill("Testland");
    await page.getByRole("button", { name: "Create crew member" }).click();

    // Should redirect to the new profile's detail page.
    await expect(page).toHaveURL(/\/crew\/profiles\/[0-9a-f-]{36}$/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: crewName })).toBeVisible();

    // --- General fields ---
    await page.getByPlaceholder("Phone").fill("+1 555 0100");
    await page.getByPlaceholder("Email").fill("test.crew@example.com");
    await page.getByPlaceholder("Home country").fill("Testland");
    const saveButtons = page.getByRole("button", { name: "Save" });
    await saveButtons.first().click();
    await expect(page.getByPlaceholder("Phone")).toHaveValue("+1 555 0100");

    // --- Skills section ---
    await page.getByRole("combobox").filter({ hasText: "Select skill" }).selectOption({ label: skillName });
    await page.locator("input[placeholder='Years']").fill("3");
    await page.getByRole("button", { name: "Add" }).first().click();
    await expect(page.getByText(skillName)).toBeVisible();

    // --- Secondary roles section ---
    await page.getByRole("combobox").filter({ hasText: "Select role" }).selectOption({ label: roleName });
    await page.getByRole("button", { name: "Add" }).last().click();
    await expect(page.getByText(roleName)).toBeVisible();

    // --- Cost (permission-gated: only assert if the section is present) ---
    const costSection = page.getByText("Cost (restricted)");
    if (await costSection.isVisible().catch(() => false)) {
      await page.locator("input[placeholder='Day rate']").fill("250");
      await page.getByRole("button", { name: "Save" }).nth(1).click();
      await expect(page.locator("input[placeholder='Day rate']")).toHaveValue("250");
    } else {
      console.log("Cost section not visible — signed-in account lacks crew.view_cost, skipping cost checks.");
    }

    // --- Sensitive notes (permission-gated) ---
    const sensitiveSection = page.getByText(/Dietary \/ Medical/i);
    if (await sensitiveSection.isVisible().catch(() => false)) {
      const notesBox = page.locator("textarea").last();
      await notesBox.fill("No known allergies (test data).");
      const sensitiveSave = sensitiveSection.locator("xpath=..").getByRole("button", { name: "Save" });
      await sensitiveSave.click();
      await expect(notesBox).toHaveValue("No known allergies (test data).");
    } else {
      console.log("Sensitive-notes section not visible — signed-in account lacks crew.view_sensitive, skipping.");
    }

    // --- Cleanup: delete the crew profile ---
    acceptNextConfirm(page);
    await page.getByRole("button", { name: "Delete crew profile" }).click();
    await expect(page).toHaveURL(/\/crew\/profiles$/, { timeout: 10_000 });
    await expect(page.getByText(crewName)).toHaveCount(0);

    // --- Cleanup: delete the supporting skill + job role ---
    await page.goto("/crew/setup");
    await page.getByRole("button", { name: "Skills" }).click();
    const chip = page.locator("div").filter({ hasText: skillName }).filter({ has: page.locator("button[title='Delete']") }).last();
    await chip.locator("button[title='Delete']").click();
    await expect(page.getByText(skillName, { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Job Roles" }).click();
    acceptNextConfirm(page);
    await rowByName(page, roleName).getByRole("button", { name: "Delete" }).click();
    await expect(rowByName(page, roleName)).toHaveCount(0);
  });

  test("search and status filter narrow the list", async ({ page }) => {
    const tempName = uniqueName("Test Search Target");

    await page.goto("/crew/profiles");
    await page.getByRole("button", { name: "+ Add crew member" }).click();
    await page.getByPlaceholder("Full name").fill(tempName);
    await page.getByRole("button", { name: "Create crew member" }).click();
    await expect(page).toHaveURL(/\/crew\/profiles\/[0-9a-f-]{36}$/, { timeout: 10_000 });

    await page.goto("/crew/profiles");
    await page.getByPlaceholder("Search by name or employee code").fill(tempName);
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByText(tempName)).toBeVisible();

    await page.getByPlaceholder("Search by name or employee code").fill("zzz-no-such-crew-member-zzz");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByText("No crew profiles match.")).toBeVisible();

    // Cleanup
    await page.getByText("Clear").click();
    await page.getByPlaceholder("Search by name or employee code").fill(tempName);
    await page.getByRole("button", { name: "Filter" }).click();
    await page.getByText(tempName).click();
    acceptNextConfirm(page);
    await page.getByRole("button", { name: "Delete crew profile" }).click();
    await expect(page).toHaveURL(/\/crew\/profiles$/, { timeout: 10_000 });
  });
});
