import { expect, mock, test } from '@fixtures';
import { ADMIN_MESSAGES } from '@pages/admin/alerts';
import { category, paginated, product } from '@support/admin-payloads';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';
import { storedToken } from '@support/session';
import { httpsUrl } from '@support/urls';

/** A payment endpoint the settings accept: made up, on example.com. */
const PAYMENT_ENDPOINT = httpsUrl('payments.example.com', '/check');

test.describe('Admin settings (mocked back office)', { tag: ['@mocked'] }, () => {
  test('saving stores the settings in the browser and confirms', async ({ adminSettings }) => {
    await expect(adminSettings.ecoBadge, 'the badge starts switched on').toBeChecked();
    await adminSettings.paymentEndpoint.fill(PAYMENT_ENDPOINT);
    await adminSettings.ecoBadge.uncheck();

    await adminSettings.save();

    await expect(adminSettings.feedback.filter({ hasText: ADMIN_MESSAGES.settingsSaved })).toBeVisible();
    await expect.poll(() => adminSettings.storedSetting('PAYMENT_ENDPOINT')).toBe(PAYMENT_ENDPOINT);
    await expect.poll(() => adminSettings.storedSetting('ECO_BADGE_ENABLED')).toBe('false');
  });

  test('switching geolocation on is stored and still on after a reload', async ({ adminSettings }) => {
    await expect(adminSettings.retrieveGeolocation, 'geolocation starts switched off').not.toBeChecked();

    await adminSettings.retrieveGeolocation.check();
    await adminSettings.save();

    await expect(adminSettings.feedback.filter({ hasText: ADMIN_MESSAGES.settingsSaved })).toBeVisible();
    await expect.poll(() => adminSettings.storedSetting('RETRIEVE_GEOLOCATION')).toBe('true');
    await adminSettings.reload();
    await expect(adminSettings.retrieveGeolocation).toBeChecked();
  });

  test('a payment endpoint that is not a URL is refused', { tag: ['@negative', '@bug'] }, async ({ adminSettings }) => {
    knownBug('ADM-16', 'the settings accept any text as the payment endpoint and report "Settings saved!".', { absence: true });
    await adminSettings.paymentEndpoint.fill('not a url');

    await adminSettings.save();

    // Any alert that names the endpoint will do: the pin does not prescribe the wording.
    await expect(adminSettings.feedback.filter({ hasText: /endpoint|url|invalid/i }), 'ADM-16: the settings say the endpoint is not valid').toBeVisible({ timeout: BUG_TIMEOUT });
  });

  test('Clear storage forgets the settings but keeps the admin signed in', async ({ adminSettings }) => {
    await adminSettings.paymentEndpoint.fill(PAYMENT_ENDPOINT);
    await adminSettings.save();
    await expect.poll(() => adminSettings.storedSetting('PAYMENT_ENDPOINT'), 'the setting was saved before it is cleared').toBe(PAYMENT_ENDPOINT);

    await adminSettings.clearStorage();

    await expect.poll(() => adminSettings.storedSetting('PAYMENT_ENDPOINT')).toBeNull();
    await expect.poll(() => storedToken(adminSettings.page)).not.toBeNull();
  });

  test('settings reach the shop: switching the CO₂ features off hides the CO₂ sorting in the shop', async ({ adminSettings, shop, apiMock }) => {
    // The shop's home asks for its products, filters and spec names: all answered here, so nothing depends on the real catalogue.
    await apiMock.use(
      mock.respond('QUERY', '/products', paginated([product], 9)),
      mock.respond('GET', '/categories/tree', [category]),
      mock.respond('GET', '/product-specs/names', []),
    );
    const sort = shop.home.filters.sort;
    await expect(adminSettings.co2Features, 'the features start switched on').toBeChecked();
    await shop.home.open();
    await expect(sort.getByRole('option', { name: /CO₂/ }).first(), 'the shop offers CO₂ sorting while the features are on').toBeAttached();
    await adminSettings.open();

    await adminSettings.switchOff(adminSettings.co2Features);
    await expect(adminSettings.feedback.filter({ hasText: ADMIN_MESSAGES.settingsSaved })).toBeVisible();
    await shop.home.open();

    await expect(sort.getByRole('option', { name: 'Name (A - Z)' })).toBeAttached();
    await expect(sort.getByRole('option', { name: /CO₂/ })).toHaveCount(0);
  });

  test('settings reach the shop: switching the eco-friendly badge off removes it from an eco product in the shop', async ({ adminSettings, shop, apiMock }) => {
    const eco = { ...product, is_eco_friendly: true };
    await apiMock.use(mock.respond('GET', /^\/products\/[^/]+$/, eco), mock.respond('GET', /^\/products\/[^/]+\/related$/, []));
    const shopProduct = shop.product;
    await expect(adminSettings.ecoBadge, 'the badge starts switched on').toBeChecked();
    await shopProduct.open(eco.id);
    await expect(shopProduct.ecoBadge, 'the shop shows the badge while it is on').toHaveText('ECO');
    await adminSettings.open();

    await adminSettings.switchOff(adminSettings.ecoBadge);
    await expect(adminSettings.feedback.filter({ hasText: ADMIN_MESSAGES.settingsSaved })).toBeVisible();
    await shopProduct.open(eco.id);

    await expect(shopProduct.name).toHaveText(eco.name);
    await expect(shopProduct.ecoBadge).toHaveCount(0);
  });
});
