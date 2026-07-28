import { expect, test } from '@playwright/test';

test('public foundation route is usable', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: 'A quieter way to play.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Find a match' }),
  ).toHaveAttribute('href', '/play');
});

test('health-neutral app shell deep-links directly', async ({ page }) => {
  await page.goto('/play');

  await expect(
    page.getByRole('heading', { name: 'Good evening, SilentKnight482.' }),
  ).toBeVisible();
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Preview a game' }),
  ).toHaveAttribute('href', '/game/demo');
});

test('unknown routes render the product not-found state', async ({ page }) => {
  const response = await page.goto('/not-a-route');

  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole('heading', { name: 'That square does not exist.' }),
  ).toBeVisible();
});
