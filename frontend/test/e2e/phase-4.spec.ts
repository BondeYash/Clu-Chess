import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { installSessionMock } from './session-mock';

const gameId = '44444444-4444-4444-8444-444444444444';

test('authoritative game recovery is accessible, sticky, and independently scrollable', async ({
  page,
}) => {
  await installSessionMock(page, { activeGameId: gameId });
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto(`/game/${gameId}`);

  await expect(
    page.getByRole('heading', { name: 'Your board is safe.' }),
  ).toBeVisible();
  await expect(page.getByText('Version 7')).toBeVisible();
  await expect(
    page.getByRole('grid', {
      name: 'Recovered game board, white orientation',
    }),
  ).toBeVisible();

  const details = page.getByRole('complementary', {
    name: 'Recovered game details',
  });
  const moveHistory = page.getByRole('region', { name: 'Move history' });
  await expect(details).toHaveCSS('position', 'sticky');
  await expect(moveHistory).toHaveCSS('overflow-y', 'auto');
  expect(
    await moveHistory.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    ),
  ).toBe(true);
  await page.evaluate(() => window.scrollTo({ top: 600 }));
  const bannerBox = await page.locator('.transport-banner').boundingBox();
  const detailsBox = await details.boundingBox();
  expect(bannerBox).not.toBeNull();
  expect(detailsBox).not.toBeNull();
  expect(detailsBox!.y).toBeGreaterThanOrEqual(
    bannerBox!.y + bannerBox!.height + 8,
  );
  await page.addStyleTag({
    content:
      'html{scroll-behavior:auto!important}.connection-badge{visibility:hidden!important}.transport-banner{display:none!important}',
  });
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await expect(page).toHaveScreenshot('recovery-layout-desktop.png', {
    animations: 'disabled',
  });
  await moveHistory.focus();
  await expect(moveHistory).toBeFocused();

  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze())
      .violations,
  ).toEqual([]);
});

test('recovery layout becomes static on narrow and zoom-equivalent viewports', async ({
  page,
}) => {
  await installSessionMock(page, { activeGameId: gameId });
  await page.setViewportSize({ height: 720, width: 768 });
  await page.goto(`/game/${gameId}`);

  const details = page.getByRole('complementary', {
    name: 'Recovered game details',
  });
  await expect(details).toHaveCSS('position', 'static');
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.addStyleTag({
    content:
      'html{scroll-behavior:auto!important}.connection-badge{visibility:hidden!important}.transport-banner{display:none!important}',
  });
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await expect(page).toHaveScreenshot('recovery-layout-narrow.png', {
    animations: 'disabled',
  });

  const moveHistory = page.getByRole('region', { name: 'Move history' });
  await moveHistory.focus();
  await expect(moveHistory).toBeFocused();
  await moveHistory.press('End');
  expect(
    await moveHistory.evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(0);
});

test('transport loss preserves the last confirmed board', async ({ page }) => {
  const mock = await installSessionMock(page, { activeGameId: gameId });
  await page.goto(`/game/${gameId}`);
  await expect(
    page.getByRole('grid', {
      name: 'Recovered game board, white orientation',
    }),
  ).toBeVisible();

  mock.failSnapshots(true);
  await page.getByRole('button', { name: 'Refresh safe position' }).click();
  await expect.poll(() => mock.snapshotCalls()).toBeGreaterThan(1);
  await expect(
    page.getByRole('grid', {
      name: 'Recovered game board, white orientation',
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      'This is the last confirmed server snapshot. It remains visible while live updates reconnect.',
    ),
  ).toBeVisible();
});

test('private deep links reveal no game or player details', async ({
  page,
}) => {
  await installSessionMock(page, {
    activeGameId: null,
    privateSnapshotStatus: 403,
  });
  await page.goto(`/game/${gameId}`);

  await expect(
    page.getByRole('heading', {
      name: 'This game is not available to this guest',
    }),
  ).toBeVisible();
  await expect(page.getByText('NobleRook91')).toHaveCount(0);
  await expect(page.getByText('Guest authentication is required')).toHaveCount(
    0,
  );
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze())
      .violations,
  ).toEqual([]);
});

test('active game capability changes play navigation into resume navigation', async ({
  page,
}) => {
  await installSessionMock(page, { activeGameId: gameId });
  await page.goto('/play');

  await expect(
    page.getByRole('heading', { name: 'Active game protected' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Resume game' })).toHaveAttribute(
    'href',
    `/game/${gameId}`,
  );
  await expect(
    page.getByRole('navigation', { name: 'Application' }).first(),
  ).toContainText('Resume');
});

test('invalid game identifiers use the product not-found boundary', async ({
  page,
}) => {
  const mock = await installSessionMock(page);
  await page.goto('/game/not-a-valid-game-id');

  await expect(
    page.getByRole('heading', { name: 'That square does not exist.' }),
  ).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    /noindex/,
  );
  expect(mock.snapshotCalls()).toBe(0);
});
