import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { AUTH_FILE } from './support/session';
import { createPendingBooking } from './support/api';
import { openServiceStep, pickDateWithSlots } from './support/booking-wizard';

/**
 * axe-core against WCAG 2.0/2.1 A + AA, on every main screen and on each
 * wizard step. Any violation fails the test — no rules are disabled.
 * axe catches what's machine-checkable (labels, contrast, ARIA); the
 * keyboard tests below cover what it can't (focus order, focus moving
 * to the new step, a visible focus indicator).
 */
async function expectNoAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const readable = violations.map(
    (v) => `[${v.impact}] ${v.id}: ${v.help}\n    ${v.nodes.map((n) => n.target.join(' ')).join('\n    ')}`,
  );
  expect(readable, readable.join('\n')).toEqual([]);
}

/** Global :focus-visible style draws a Tailwind ring (a box-shadow). */
async function expectVisibleFocus(locator: Locator) {
  await expect(locator).toBeFocused();
  const indicator = await locator.evaluate((el) => {
    const style = getComputedStyle(el);
    return { boxShadow: style.boxShadow, outline: style.outlineStyle };
  });
  expect(indicator.boxShadow !== 'none' || indicator.outline !== 'none').toBe(true);
}

test.describe('logged out', () => {
  test('login page has no axe violations', async ({ page }) => {
    await page.goto('/login');
    await expectNoAxeViolations(page);
  });

  test('login works with the keyboard alone and the error is announced', async ({ page }) => {
    // Only the response is stubbed here: this test is about keyboard
    // operability, the real 401 is covered in login.spec.ts. A real
    // request would also count against the 5/min login throttle.
    await page.route('**/auth/login', (route) =>
      route.fulfill({ status: 401, json: { message: 'Credenciales inválidas.' } }),
    );
    await page.goto('/login');
    // The prerendered HTML only has the Suspense fallback ("Cargando…");
    // the form appears after hydration, which can finish after `load`.
    // Tabbing before that leaves focus on <body>.
    await expect(page.getByLabel('Tenant')).toBeVisible();

    // Tab order follows the visual order of the form.
    await page.keyboard.press('Tab');
    await expectVisibleFocus(page.getByLabel('Tenant'));
    await page.keyboard.press('Tab');
    await expectVisibleFocus(page.getByLabel('Email'));
    await page.keyboard.press('Tab');
    const quickFill = page.getByRole('button', { name: 'Cuenta cliente' });
    await expectVisibleFocus(quickFill);
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Email')).toHaveValue('cliente@tenant.dev');

    await page.keyboard.press('Tab'); // "Cuenta admin"
    await page.keyboard.press('Tab');
    await expectVisibleFocus(page.getByLabel('Password'));
    await page.keyboard.type('wrong-password-123');
    await page.keyboard.press('Enter'); // submits the form

    // role="alert" makes screen readers announce it without moving focus.
    // (Next.js adds its own empty route-announcer alert, hence by text.)
    await expect(page.getByText('Credenciales inválidas.')).toHaveAttribute('role', 'alert');
    await expectNoAxeViolations(page);
  });
});

test.describe('admin', () => {
  test.use({ storageState: AUTH_FILE.admin });

  test('dashboard with pending bookings and the AI box has no axe violations', async ({ page, request }) => {
    await createPendingBooking(request);
    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: 'Aceptar' }).first()).toBeVisible();
    await expect(page.getByLabel('Pregunta para el asistente')).toBeVisible();
    await expectNoAxeViolations(page);
  });

  for (const url of ['/alerts', '/alerts?demo=1']) {
    test(`alerts center (${url}) has no axe violations`, async ({ page, request }) => {
      await createPendingBooking(request);
      await page.goto(url);
      await expect(page.getByRole('list', { name: 'Reservas por urgencia' })).toBeVisible();
      await expectNoAxeViolations(page);
    });
  }
});

test.describe('client', () => {
  test.use({ storageState: AUTH_FILE.client });

  test('dashboard has no axe violations', async ({ page, request }) => {
    await createPendingBooking(request);
    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: 'Cancelar solicitud' }).first()).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('wizard branch step has no axe violations', async ({ page }) => {
    await page.goto('/book');
    await expect(page.getByRole('heading', { name: 'Sucursal' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sucursal Centro' }).first()).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('booking wizard: keyboard-only, focus follows each step, no axe violations', async ({ page, request }) => {
    await openServiceStep(page, request);

    // After the (deep-link) auto-advance, focus lands on the step heading.
    await expect(page.getByRole('heading', { name: 'Servicio' })).toBeFocused();
    await expectNoAxeViolations(page);

    await page.keyboard.press('Tab');
    await expectVisibleFocus(page.getByRole('button', { name: /Corte de cabello/ }));
    await page.keyboard.press('Enter');

    // The pressed button is gone; focus moved to the new step, not <body>.
    await expect(page.getByRole('heading', { name: 'Con quién' })).toBeFocused();
    await expectNoAxeViolations(page);

    await page.keyboard.press('Tab');
    await expectVisibleFocus(page.getByRole('button', { name: 'ana@tenant-a.dev' }));
    const todaysGrid = page.waitForResponse((r) => r.url().includes('/availability?'));
    await page.keyboard.press('Enter');
    await todaysGrid;
    await expect(page.getByRole('heading', { name: 'Horario' })).toBeFocused();

    const { slots } = await pickDateWithSlots(page, 42);
    await expectNoAxeViolations(page);

    // Tab walks the native date input's own segments (month/day/year in
    // Chromium) before leaving it — browser behavior, not ours.
    const dateInput = page.getByLabel('Fecha');
    await dateInput.focus();
    for (let i = 0; i < 5 && (await dateInput.evaluate((el) => el === document.activeElement)); i++) {
      await page.keyboard.press('Tab');
    }
    await expectVisibleFocus(page.getByRole('button', { name: slots[0].startLocal, exact: true }));
    await page.keyboard.press('Enter');

    await expect(page.getByRole('heading', { name: 'Confirmar' })).toBeFocused();
    await expect(page.getByRole('list', { name: 'Pasos de la reserva' }).locator('[aria-current="step"]')).toContainText('Confirmar');
    await expectNoAxeViolations(page);

    await page.keyboard.press('Tab');
    await expectVisibleFocus(page.getByRole('button', { name: 'Confirmar reserva' }));
    await page.keyboard.press('Enter');

    await expect(page.getByRole('heading', { name: /Reserva creada/ })).toBeFocused();
    await expectNoAxeViolations(page);
  });
});
