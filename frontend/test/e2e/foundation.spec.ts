import { expect, test } from '@playwright/test';

test('public foundation route is usable', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: 'Chess with the noise turned down.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Enter the board' }),
  ).toHaveAttribute('href', '/play');
});

test('health-neutral app shell deep-links directly', async ({ page }) => {
  await page.goto('/play');

  await expect(
    page.getByRole('heading', { name: 'Your next game will begin here.' }),
  ).toBeVisible();
  await expect(page.getByText('App shell online')).toBeVisible();
});

test('unknown routes render the product not-found state', async ({ page }) => {
  const response = await page.goto('/not-a-route');

  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole('heading', { name: 'That square does not exist.' }),
  ).toBeVisible();
});
