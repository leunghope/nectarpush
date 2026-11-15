import { expect, test } from '@playwright/test';

/**
 * 14 — Auth forms must leave breathing room between the last field and the
 * submit button (the design baseline has ~20px; a `:last-of-type` override had
 * collapsed it to zero).
 */
test.use({ storageState: { cookies: [], origins: [] } });

for (const path of ['/login', '/register', '/reset']) {
  test(`14 auth spacing ${path}`, async ({ page }) => {
    await page.goto(path);
    const form = page.locator('.auth-form');
    await expect(form).toBeVisible();

    const lastInput = form.locator('.field input').last();
    const submit = form.locator('button[type="submit"]');
    await expect(lastInput).toBeVisible();
    await expect(submit).toBeVisible();

    const inputBox = await lastInput.boundingBox();
    const submitBox = await submit.boundingBox();
    expect(inputBox, 'last input box').not.toBeNull();
    expect(submitBox, 'submit box').not.toBeNull();

    const gap = submitBox!.y - (inputBox!.y + inputBox!.height);
    expect(gap, `gap below last input on ${path}`).toBeGreaterThanOrEqual(16);
  });
}