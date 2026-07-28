import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { installSessionMock } from './session-mock';

test('first visit retries one protected create without duplicating identity', async ({
  page,
}) => {
  const mock = await installSessionMock(page, {
    createFirstVisit: true,
    loseFirstCreateResponse: true,
  });

  await page.goto('/play');
  await expect(
    page.getByRole('heading', { name: 'Good evening, SilentKnight482.' }),
  ).toBeVisible();

  expect(mock.createKeys).toHaveLength(2);
  expect(mock.createKeys[0]).toBe(mock.createKeys[1]);
  expect(mock.createKeys[0]).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
});

test('reset replaces the guest only after server confirmation', async ({
  page,
}) => {
  const mock = await installSessionMock(page);
  await page.goto('/settings');

  await expect(
    page.getByRole('main').getByText('SilentKnight482', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Start with a new identity' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Start with a new identity?' }),
  ).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze())
      .violations,
  ).toEqual([]);
  await page
    .getByRole('button', { name: 'Reset and create new guest' })
    .click();

  await expect(
    page.getByRole('main').getByText('CopperBishop731', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('A new guest identity is ready')).toBeVisible();
  expect(mock.resetKeys).toHaveLength(1);
  expect(mock.currentName()).toBe('CopperBishop731');
});

test('JWT remains per-tab and never reaches localStorage or the URL', async ({
  page,
}) => {
  const consoleMessages: string[] = [];
  page.on('console', (message) => consoleMessages.push(message.text()));
  await installSessionMock(page);
  await page.goto('/play');
  await expect(page.getByText('Session ready', { exact: true })).toBeVisible();

  const storage = await page.evaluate(() => ({
    localValues: Object.values(window.localStorage),
    sessionToken: sessionStorage.getItem('cluchess:v1:socket-token'),
    url: location.href,
  }));
  expect(storage.sessionToken).toContain('private-jwt');
  expect(JSON.stringify(storage.localValues)).not.toContain('private-jwt');
  expect(storage.url).not.toContain('private-jwt');
  expect(JSON.stringify(consoleMessages)).not.toContain('private-jwt');
});

test('active identity loss never creates a replacement guest', async ({
  page,
}) => {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'cluchess:v1:active-game-hint',
      '44444444-4444-4444-8444-444444444444',
    );
    sessionStorage.setItem('cluchess:v1:socket-token', 'expired-private-jwt');
  });
  const mock = await installSessionMock(page, { createFirstVisit: true });

  await page.goto('/play');

  await expect(
    page.getByRole('heading', {
      name: 'Your active identity could not be recovered',
    }),
  ).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze())
      .violations,
  ).toEqual([]);
  expect(mock.createKeys).toHaveLength(0);
});
