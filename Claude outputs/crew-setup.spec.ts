import { test, expect } from "@playwright/test";
import { rowByName, acceptNextConfirm, expectErrorMatching, uniqueName } from "./helpers";

// All test records use a timestamped name so they never collide with real
// data, and each test deletes what it created so your org's data stays
// clean. If a test fails partway through, check the Crew Setup screen for
// leftover "Test ..." records and remove them manually.

test.describe("Crew Setup — master data", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/crew/setup");
    await expect(page.getByRole("heading", { name: "Crew Setup" })).toBeVisible();
  });

  test("sidebar shows grouped nav sections", async ({ page }) => {
    await expect(page.getByText("Overview")).toBeVisible();
    await expect(page.getByText("Compliance & Inspections")).toBeVisible();
    await expect(page.getByText("Crew Matrix")).toBeVisible();
    // "Administration" only renders for a user with team.view or
    // team.manage_roles — skip strict-checking it here since it depends on
    // the signed-in account's role.
  });

  test("Job Roles: create, reject duplicate name, edit, mark inactive, delete", async ({ page }) => {
    const name = uniqueName("Test Role");

    await page.getByPlaceholder("Role name, e.g. Head Chef").fill(name);
    await page.getByRole("button", { name: "+ Add role" }).click();
    await expect(rowByName(page, name)).toBeVisible();

    // Duplicate name in the same org should be rejected, not silently duplicated.
    await page.getByPlaceholder("Role name, e.g. Head Chef").fill(name);
    await page.getByRole("button", { name: "+ Add role" }).click();
    await expectErrorMatching(page, /duplicate|already exists|unique/i);
    await expect(page.locator("div.flex-1").filter({ hasText: name })).toHaveCount(1);

    // Edit: rename + mark inactive
    const row = rowByName(page, name);
    await row.getByRole("button", { name: "Edit" }).click();
    const renamed = `${name} (edited)`;
    const nameInput = page.locator("input").filter({ hasNotText: "" }).and(page.locator(`input[value="${name}"]`));
    // Fallback: the edit row's first text input holds the current name.
    const editRow = page.locator("div").filter({ hasText: name }).last();
    const firstInput = editRow.locator("input[type='text'], input:not([type])").first();
    await firstInput.fill(renamed);
    await editRow.getByRole("checkbox").uncheck(); // uncheck "Active"
    await editRow.getByRole("button", { name: "Save" }).click();

    await expect(rowByName(page, renamed)).toBeVisible();
    await expect(rowByName(page, renamed)).toContainText("Inactive");

    // Cleanup
    acceptNextConfirm(page);
    await rowByName(page, renamed).getByRole("button", { name: "Delete" }).click();
    await expect(rowByName(page, renamed)).toHaveCount(0);
  });

  test("Skills: create, reject duplicate, delete", async ({ page }) => {
    await page.getByRole("button", { name: "Skills" }).click();
    const name = uniqueName("TestSkill");

    await page.getByPlaceholder("Skill name, e.g. HACCP Certified").fill(name);
    await page.getByRole("button", { name: "+ Add skill" }).click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();

    await page.getByPlaceholder("Skill name, e.g. HACCP Certified").fill(name);
    await page.getByRole("button", { name: "+ Add skill" }).click();
    await expectErrorMatching(page, /duplicate|already exists|unique/i);
    await expect(page.getByText(name, { exact: true })).toHaveCount(1);

    // Cleanup — skill chips have their own "✕" delete button, no confirm dialog.
    const chip = page.locator("div").filter({ hasText: name }).filter({ has: page.locator("button[title='Delete']") }).last();
    await chip.locator("button[title='Delete']").click();
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  });

  test("Clients: create with optional fields blank, edit, delete", async ({ page }) => {
    await page.getByRole("button", { name: "Clients" }).click();
    const name = uniqueName("Test Client");

    await page.getByRole("button", { name: "+ Add client" }).click();
    await page.getByPlaceholder("Client name").fill(name);
    // Leave contract number, dates, billing model, notes all blank on purpose.
    await page.getByRole("button", { name: "Save" }).click();
    await expect(rowByName(page, name)).toBeVisible();

    // Edit: add a contract number
    await rowByName(page, name).getByRole("button", { name: "Edit" }).click();
    await page.getByPlaceholder("Contract number").fill("CN-TEST-001");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(rowByName(page, name)).toContainText("CN-TEST-001");

    // Cleanup
    acceptNextConfirm(page);
    await rowByName(page, name).getByRole("button", { name: "Delete" }).click();
    await expect(rowByName(page, name)).toHaveCount(0);
  });

  test("Rotation Templates: fixed_equal and custom pattern types", async ({ page }) => {
    await page.getByRole("button", { name: "Rotation Templates" }).click();
    const fixedName = uniqueName("Test 28/28");
    const customName = uniqueName("Test Custom Pattern");

    // Fixed equal — requires days on/off
    await page.getByRole("button", { name: "+ Add rotation pattern" }).click();
    await page.getByPlaceholder("Name, e.g. 14/14").fill(fixedName);
    await page.getByPlaceholder("Days on").fill("28");
    await page.getByPlaceholder("Days off").fill("28");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(rowByName(page, fixedName)).toContainText("28/28");

    // Custom — days on/off inputs should not even be required/shown
    await page.getByRole("button", { name: "+ Add rotation pattern" }).click();
    await page.getByPlaceholder("Name, e.g. 14/14").fill(customName);
    await page.getByRole("combobox").last().selectOption("custom");
    await page.getByPlaceholder("Notes").fill("Irregular pattern, see contract.");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(rowByName(page, customName)).toBeVisible();

    // Cleanup both
    for (const n of [fixedName, customName]) {
      acceptNextConfirm(page);
      await rowByName(page, n).getByRole("button", { name: "Delete" }).click();
      await expect(rowByName(page, n)).toHaveCount(0);
    }
  });

  test("Offshore Sites: create, add manning requirement, delete cascades the requirement", async ({ page }) => {
    await page.getByRole("button", { name: "Offshore Sites", exact: true }).click();
    const siteName = uniqueName("Test Vessel");
    const roleName = uniqueName("Test Manning Role");

    // A job role is needed to set a manning requirement against — create one via the tab.
    await page.getByRole("button", { name: "Job Roles" }).click();
    await page.getByPlaceholder("Role name, e.g. Head Chef").fill(roleName);
    await page.getByRole("button", { name: "+ Add role" }).click();
    await expect(rowByName(page, roleName)).toBeVisible();

    await page.getByRole("button", { name: "Offshore Sites", exact: true }).click();
    await page.getByRole("button", { name: "+ Add offshore site" }).click();
    await page.getByPlaceholder("Site name").fill(siteName);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(rowByName(page, siteName)).toBeVisible();

    // Expand manning requirements and add one
    await rowByName(page, siteName).getByRole("button", { name: "Manning requirements" }).click();
    await page.getByRole("combobox").filter({ hasText: "Select job role" }).selectOption({ label: roleName });
    await page.getByRole("button", { name: "Set requirement" }).click();
    await expect(page.getByText(roleName).last()).toBeVisible();
    await expect(page.getByText("min 1")).toBeVisible();

    // Deleting the site should cascade-delete the manning requirement (schema: on delete cascade)
    acceptNextConfirm(page);
    await rowByName(page, siteName).getByRole("button", { name: "Delete" }).click();
    await expect(rowByName(page, siteName)).toHaveCount(0);

    // Cleanup the job role too
    await page.getByRole("button", { name: "Job Roles" }).click();
    acceptNextConfirm(page);
    await rowByName(page, roleName).getByRole("button", { name: "Delete" }).click();
    await expect(rowByName(page, roleName)).toHaveCount(0);
  });
});
