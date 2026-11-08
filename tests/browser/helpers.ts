import { expect, type Page } from '@playwright/test';

/** SSR markup is visible before React is ready; the motion control exposes its ready state. */
export async function waitForHydration(page: Page) {
  const control = page.getByRole('button', { name: /^(Pause sprites|Animate sprites|Reduced motion)$/ });
  await expect(control).toBeVisible();
  await expect.poll(async () => control.evaluate(button =>
    !(button as HTMLButtonElement).disabled || button.textContent?.trim() === 'Reduced motion'),
  { message: 'Interactive controls should finish hydration before user actions' }).toBe(true);
}

