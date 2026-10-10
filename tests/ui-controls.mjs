// Open the actual UI affordance before exercising a relocated control.
export async function expose(page, selector) {
  const control = page.locator(selector);
  const menu = control.locator('xpath=ancestor::details[contains(@class,"dropdown")][1]');
  if (await menu.count() && await menu.getAttribute('open') === null)
    await menu.locator(':scope > summary').click();
  return control;
}
export async function uiClick(page, selector) {
  if (selector === '#pause') selector = '#main-play';
  await (await expose(page, selector)).click();
}
export async function uiCheck(page, selector, value) {
  const opened = selector === '#auto-record' && !await page.locator('#settings-dialog').evaluate(e=>e.open);
  if (opened) await uiClick(page, '#show-settings');
  const control = await expose(page,selector);
  if (value) await control.check(); else await control.uncheck();
  if (selector === '#strict') await page.locator('#dict-options > summary').click();
  if (opened) await page.locator('[data-close="settings-dialog"]').click();
}
