# Hyva compatibility

The `hyva_default` layout handle selects the adapter only for Hyva store views.
Luma/RequireJS/Knockout templates, checkout UI components, Admin templates and
server-side validation are preserved. No extra Magento module or hard dependency
on Hyva is required. See [Hyva layout handles](https://docs.hyva.io/hyva-themes/writing-code/layout-and-templates/the-hyva_-layout-handles.html).

## Supported forms

Standard POST forms: registration, login, forgotten password, contact, reviews,
send-to-friend and newsletter. Forms are located by their same-origin Magento
controller action, including store-code prefixes and product parameters, so the
adapter does not depend on Luma's form containers. Each form gets its own token.
The adapter also supports Hyva's `#authentication-popup #login-form` JSON login
flow, including token renewal after a rejected request. Hidden popup widgets
render when visible.

Only enabled forms receive widgets. The public site key and store configuration
are cacheable; the secret key and customer data are never emitted by the adapter.
Hyva's `private-content-loaded` event handles the existing logged-in-user exemption.
Scripts are external and need no `eval`, inline event handlers, jQuery or Knockout.
The existing Cloudflare CSP whitelist remains required. No Tailwind build is needed.

## Install this branch

Run in the Magento project directory with its usual filesystem owner:

```sh
composer config repositories.pixelopen-turnstile-fork vcs https://github.com/marvikonvic/magento-cloudflare-turnstile
composer require 'pixelopen/magento-cloudflare-turnstile:dev-hyva-compatibility' --prefer-dist
bin/magento module:enable PixelOpen_CloudflareTurnstile
bin/magento setup:upgrade
bin/magento setup:di:compile
bin/magento cache:clean
```

Use your normal maintenance/deployment process. In production mode also deploy
static content for the actual store locales before reopening the storefront.
Existing installations keep the same module name and configuration paths.
The Composer version is derived from the VCS branch; no stable release is claimed.

In **Stores > Configuration > Services > Cloudflare Turnstile**, set the matching
site/secret keys, enable Storefront and select the desired forms. For registration
only, select `register`. Disable competing native CAPTCHA/reCAPTCHA for that form;
do not disable protection on unrelated forms or the Admin just to use this adapter.

## Integration boundaries

- This is a Hyva Themes adapter, not an integration with Hyva Checkout/Magewire,
  third-party checkout forms, REST or GraphQL account creation.
- Customized AJAX forms must serialize `cf-turnstile-response` and dispatch
  `pixelopen-turnstile-reset` on their form after a request consumes the token.
  The built-in Hyva authentication popup handles this automatically. Other custom
  JSON serializers are not intercepted or globally patched.
- Custom controller routes need an explicit adapter and server validation mapping.
  Existing per-block Luma theme/size overrides do not apply to the Hyva adapter;
  it uses the store-view theme and size settings.
- Keep other Turnstile integrations from attaching a second widget to the same
  form. Disabled JavaScript or missing tokens are still rejected by the existing
  server observer for configured guest POST forms.

## Verification

```sh
npm ci
npm test
```

Tests use jsdom and a mocked Cloudflare API: isolated form tokens, expiration,
load failures, dynamic forms, private-content changes, popup JSON requests and
Luma component behavior. They do not prove live Cloudflare validation or Magento
layout rendering. PHP lint and XML parsing can run without Magento; DI compilation,
static-content deployment and browser smoke tests require a Magento installation.

Before deployment acceptance, check both Luma and Hyva store views: register a
test customer, submit without a token (must fail), replay a consumed token (must
fail), verify newsletter plus registration together, retry a failed popup login,
and confirm Siteverify validations in Cloudflare. Check desktop/mobile layouts
and the browser console, with full-page cache enabled.

### Confirmed on Stagento.com

The user verified the Hyva registration flow with commit `6c1e306` installed:

- The Turnstile widget displayed successfully.
- Registration with a valid token created a customer account.
- Cloudflare analytics recorded one Siteverify request and one valid token.
- Submitting registration without `cf-turnstile-response`, bypassing the frontend
  submit handler, was rejected by the server with a security validation error.

These results confirm the basic Hyva registration flow, including server-side
rejection of a missing token. Token replay, other forms, Luma runtime, and the
complete desktop/mobile and cache test matrix remain unverified.

## Srpski

Modul zadržava postojeći Luma/Knockout i Admin prikaz, a za Hyva temu automatski
učitava zaseban JavaScript bez RequireJS-a. Podešavanja i serverska provera tokena
ostaju zajednički. Na Stagento.com potvrđeni su prikaz widgeta, uspešna registracija
sa validnim tokenom i uspešna Cloudflare Siteverify provera. Test bez tokena je
takođe prošao: server je odbio registraciju bez Turnstile tokena.
Ova potvrda važi za osnovni tok Hyva registracije. Posebni checkout sistemi,
REST/GraphQL i prilagođene AJAX forme zahtevaju zasebnu integraciju.
