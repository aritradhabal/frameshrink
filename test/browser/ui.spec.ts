import { test, expect } from "@playwright/test";
const workbench =
  process.env.FRAMESHRINK_WORKBENCH_URL ?? "http://127.0.0.1:4317";
test("local reducer, bundle export, clean replay and read-only import", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(workbench);
  await expect(
    page.getByText("Local runtime ready", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reduce fixture" }).click();
  await expect(
    page.getByText("Same failure preserved", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("#bytes")).toHaveText("746 → 252");
  await page.getByRole("button", { name: "Export regression bundle" }).click();
  await expect(page.locator("#bundle")).toContainText(".runs/exports/");
  await page.getByRole("button", { name: "Replay from clean state" }).click();
  await expect(page.locator("#replayResult")).toContainText(
    "Clean replay passed",
  );
  await page.screenshot({
    path: "evidence/workbench-desktop.png",
    fullPage: true,
  });
  await page.getByLabel("Failure family").selectOption("banned-opcode");
  await expect(page.locator("#bytes")).toHaveText("—");
  await page.getByRole("button", { name: "Reduce fixture" }).click();
  await expect(
    page.getByText("Same failure preserved", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("#bytes")).toHaveText("745 → 251");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "evidence/workbench-mobile.png",
    fullPage: true,
  });
  await page
    .locator("summary")
    .filter({ hasText: "Inspect an imported" })
    .click();
  await page
    .getByLabel("Imported transaction JSON")
    .fill('{"schemaVersion":1,"mode":"imported","raw":"0x06ff"}');
  await page.getByRole("button", { name: "Inspect payload" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Invalid imported payload",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  const csrf = await request.post(workbench + "/api/reduce", {
    data: {},
  });
  expect(csrf.status()).toBe(400);
  const host = await request.get(workbench + "/api/info", {
    headers: { host: "attacker.example" },
  });
  expect(host.status()).toBe(403);
});
