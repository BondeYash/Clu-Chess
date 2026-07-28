import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const VISUAL_WIDTHS = [320, 390, 768, 1024, 1440] as const;
const MAJOR_ROUTES = ['/', '/play', '/game/demo', '/learn/king', '/settings'];

for (const width of VISUAL_WIDTHS) {
  test(`game fixture matches the ${width}px visual contract`, async ({
    page,
  }) => {
    await page.setViewportSize({ height: 900, width });
    await page.goto('/game/demo');
    await page.evaluate(() => document.fonts.ready);

    await expect(
      page.getByRole('grid', { name: 'Demonstration chessboard' }),
    ).toBeVisible();
    await expect(page).toHaveScreenshot(`game-${width}.png`, {
      animations: 'disabled',
      fullPage: true,
    });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test('major Phase 2 routes have no automated accessibility violations', async ({
  page,
}) => {
  for (const route of MAJOR_ROUTES) {
    await page.goto(route);
    await page.evaluate(() => document.fonts.ready);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(results.violations, `${route} accessibility violations`).toEqual([]);
  }
});

test('the board keyboard model works in the browser', async ({ page }) => {
  await page.goto('/game/demo');
  const f3 = page.getByRole('gridcell', { name: /f3,/ });
  await f3.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('gridcell', { name: /g3,/ })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByRole('gridcell', { name: /a3,/ })).toBeFocused();
  await page.keyboard.press('Control+Home');
  await expect(page.getByRole('gridcell', { name: /a8,/ })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.getByText('a8 selected')).toBeAttached();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Selection cleared')).toBeAttached();
});

test('forced-colour mode preserves explicit board state', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.goto('/game/demo');

  const selected = page.getByRole('gridcell', {
    name: /f3, white knight, selected/,
  });
  await expect(selected).toHaveCSS('border-top-color', 'rgb(0, 0, 0)');
  await expect(selected).toHaveAttribute('aria-selected', 'true');
});

test('mobile controls and board targets remain operable', async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto('/play');
  await expect(
    page.getByRole('navigation', { name: 'Application' }).last(),
  ).toBeVisible();

  await page.goto('/game/demo');

  const squareBox = await page
    .getByRole('gridcell', { name: /f3,/ })
    .boundingBox();
  expect(squareBox?.width).toBeGreaterThanOrEqual(32);
  expect(squareBox?.height).toBeGreaterThanOrEqual(32);

  await page.goto('/settings');
  const resetButton = page.getByRole('button', {
    name: 'Start with a new identity',
  });
  const buttonBox = await resetButton.boundingBox();
  expect(buttonBox?.height).toBeGreaterThanOrEqual(44);
});

test('font and image loading stay within the layout-shift budget', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const metrics = globalThis as typeof globalThis & {
      __cluchessCumulativeLayoutShift: number;
    };
    metrics.__cluchessCumulativeLayoutShift = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          hadRecentInput: boolean;
          value: number;
        };
        if (!shift.hadRecentInput) {
          metrics.__cluchessCumulativeLayoutShift += shift.value;
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });

  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  const images = page.locator('img');
  await expect(images).toHaveCount(1);
  await expect(images.first()).toHaveAttribute('width');
  await expect(images.first()).toHaveAttribute('height');
  const cumulativeLayoutShift = await page.evaluate(
    () =>
      (
        globalThis as typeof globalThis & {
          __cluchessCumulativeLayoutShift: number;
        }
      ).__cluchessCumulativeLayoutShift,
  );
  expect(cumulativeLayoutShift).toBeLessThanOrEqual(0.1);
});

test('content reflows at 200 percent without horizontal clipping', async ({
  page,
}) => {
  await page.setViewportSize({ height: 900, width: 768 });
  await page.goto('/settings');
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(
    page.getByRole('button', { name: 'Start with a new identity' }),
  ).toBeVisible();
});
