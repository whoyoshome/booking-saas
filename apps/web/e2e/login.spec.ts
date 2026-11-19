import { test, expect } from '@playwright/test';
import { PASSWORD } from './support/session';

// Fresh, logged-out browser for every test in this file.

test('wrong password shows the API error and keeps the user on /login', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('cliente@tenant.dev');
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByText('Credenciales inválidas.')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('a protected page redirects to login and returns there after signing in', async ({ page }) => {
  await page.goto('/book');
  await expect(page).toHaveURL(/\/login\?from=%2Fbook$/);

  await page.getByLabel('Email').fill('cliente@tenant.dev');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/book$/);
  await expect(page.getByRole('heading', { name: 'New booking' })).toBeVisible();
  await expect(page.getByText('Client', { exact: true })).toBeVisible();
});
