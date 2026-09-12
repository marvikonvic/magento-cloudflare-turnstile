const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {JSDOM, VirtualConsole} = require('jsdom');
const code = readFileSync(join(__dirname, '../../view/frontend/web/js/hyva/turnstile.js'), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
const form = (action, id = action) => `<form id="${id}" method="post" action="/${action}"><input name="username" value="test@example.com"><input name="password" value="test"><div class="actions-toolbar"><button>Submit</button></div></form>`;

async function setup(t, html, overrides = {}, api = true, prepare = () => {}) {
    const errors = [], observers = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => errors.push(error));
    const dom = new JSDOM(html, {url: 'https://example.com/', runScripts: 'outside-only', virtualConsole});
    t.after(() => {
        observers.forEach(observer => observer.disconnect());
        dom.window.close();
        assert.deepEqual(errors, []);
    });
    const w = dom.window;
    const NativeObserver = w.MutationObserver;
    w.MutationObserver = class extends NativeObserver {
        constructor(callback) { super(callback); observers.push(this); }
    };
    const config = {enabled: true, sitekey: 'public-test-key', theme: 'light', size: 'normal',
        forms: ['register', 'newsletter', 'login-ajax'], messages: {pending: 'Pending', error: 'Error', missing: 'Missing'},
        loginUrl: 'https://example.com/customer/ajax/login/', checkoutUrl: 'https://example.com/checkout/', ...overrides};
    const node = w.document.createElement('div');
    node.dataset.pixelopenTurnstileConfig = JSON.stringify(config);
    w.document.body.appendChild(node);
    const renders = [], resets = [], removes = [];
    if (api) w.turnstile = {render: (el, options) => {renders.push({el, options}); return String(renders.length - 1);},
        reset: id => resets.push(id), remove: id => removes.push(id)};
    prepare(w);
    w.eval(code);
    await tick();
    return {w, renders, resets, removes, node};
}

test('registration and newsletter have isolated tokens and preserve Alpine submission', async t => {
    const {w, renders} = await setup(t, form('customer/account/createpost/', 'register') + form('newsletter/subscriber/new/', 'newsletter'));
    assert.equal(renders.length, 2);
    const forms = [...w.document.forms];
    let alpineCalls = 0;
    forms[0].addEventListener('submit', () => alpineCalls++);
    assert.equal(forms[0].dispatchEvent(new w.Event('submit', {cancelable: true})), false);
    assert.equal(alpineCalls, 0);
    renders[0].options.callback('token-register');
    assert.equal(new w.FormData(forms[0]).get('cf-turnstile-response'), 'token-register');
    assert.equal(new w.FormData(forms[1]).get('cf-turnstile-response'), '');
    assert.equal(forms[0].dispatchEvent(new w.Event('submit', {cancelable: true})), true);
    assert.equal(alpineCalls, 1);
    assert.equal(renders[0].options['response-field'], false);
    assert.equal(forms[0].querySelector('.pixelopen-turnstile').nextElementSibling.className, 'actions-toolbar');
});

test('expired, timeout and failed challenges clear tokens', async t => {
    const {w, renders} = await setup(t, form('customer/account/createpost/'));
    for (const callback of ['expired-callback', 'timeout-callback', 'error-callback']) {
        renders[0].options.callback('token');
        renders[0].options[callback]();
        assert.equal(new w.FormData(w.document.forms[0]).get('cf-turnstile-response'), '');
        assert.equal(w.document.forms[0].dispatchEvent(new w.Event('submit', {cancelable: true})), false);
    }
});

test('disabled forms, GET requests and external actions are untouched', async t => {
    const {w, renders} = await setup(t, form('customer/account/loginpost/') + '<form method="get" action="/customer/account/createpost/"></form><form method="post" action="https://external.example/customer/account/createpost/"></form>');
    assert.equal(renders.length, 0);
    assert.equal(w.document.querySelectorAll('[name="cf-turnstile-response"]').length, 0);
});

test('all standard controller routes support store prefixes and path parameters', async t => {
    const cases = {register: 'customer/account/createpost', login: 'customer/account/loginPost', password: 'customer/account/forgotpasswordpost', contact: 'contact/index/post', review: 'review/product/post/id/12', 'send-friend': 'sendfriend/product/sendmail/id/12', newsletter: 'newsletter/subscriber/new'};
    const {renders} = await setup(t, Object.values(cases).map(route => form('index.php/en/' + route + '/')).join(''), {forms: Object.keys(cases)});
    assert.deepEqual(renders.map(r => r.options.action), Object.keys(cases));
});

test('missing key fails closed without loading Cloudflare', async t => {
    const {w, renders} = await setup(t, form('customer/account/createpost/'), {sitekey: ''});
    assert.equal(renders.length, 0);
    assert.equal(w.document.querySelector('[role="status"]').textContent, 'Missing');
    assert.equal(w.document.forms[0].dispatchEvent(new w.Event('submit', {cancelable: true})), false);
});

test('disabled module does not insert widgets or load API', async t => {
    const {w, renders} = await setup(t, form('customer/account/createpost/'), {enabled: false}, false);
    assert.equal(renders.length, 0);
    assert.equal(w.document.querySelectorAll('script, .pixelopen-turnstile').length, 0);
});

test('one API script serves multiple forms; load failure remains closed', async t => {
    const {w} = await setup(t, form('customer/account/createpost/') + form('newsletter/subscriber/new/'), {}, false);
    const scripts = w.document.querySelectorAll('script');
    assert.equal(scripts.length, 1);
    scripts[0].dispatchEvent(new w.Event('error'));
    await tick();
    assert.deepEqual([...w.document.querySelectorAll('[role="status"]')].map(n => n.textContent), ['Error', 'Error']);
    assert.equal(w.document.forms[0].dispatchEvent(new w.Event('submit', {cancelable: true})), false);
});

test('dynamic forms initialize once and removed widgets are disposed', async t => {
    const {w, renders, removes} = await setup(t, '');
    w.document.body.insertAdjacentHTML('beforeend', form('customer/account/createpost/'));
    await tick();
    w.document.body.appendChild(w.document.createElement('span'));
    await tick();
    assert.equal(renders.length, 1);
    w.document.forms[0].remove();
    await tick();
    assert.deepEqual(removes, ['0']);
});

test('private content removes widgets on login and restores them on logout', async t => {
    const {w, renders, removes} = await setup(t, form('newsletter/subscriber/new/'));
    w.dispatchEvent(new w.CustomEvent('private-content-loaded', {detail: {data: {customer: {firstname: 'Customer'}}}}));
    assert.equal(w.document.querySelector('.pixelopen-turnstile'), null);
    assert.deepEqual(removes, ['0']);
    w.dispatchEvent(new w.CustomEvent('private-content-loaded', {detail: {data: {customer: {}}}}));
    await tick();
    assert.equal(renders.length, 2);
});

test('back-forward cache and AJAX completion reset single-use tokens including widget ID zero', async t => {
    const {w, renders, resets} = await setup(t, form('customer/account/createpost/'));
    renders[0].options.callback('token');
    w.dispatchEvent(new w.PageTransitionEvent('pageshow', {persisted: true}));
    assert.deepEqual(resets, ['0']);
    assert.equal(new w.FormData(w.document.forms[0]).get('cf-turnstile-response'), '');
    w.document.forms[0].dispatchEvent(new w.Event('pixelopen-turnstile-reset'));
    assert.deepEqual(resets, ['0', '0']);
});

test('Hyva authentication popup sends token in JSON and resets after rejected login', async t => {
    const {w, renders, resets} = await setup(t, '<div id="authentication-popup">' + form('', 'login-form') + '</div>');
    w.hyva = {getFormKey: () => 'test-form-key'};
    const scope = {isLoading: false};
    w.Alpine = {$data: () => scope};
    let payload, calls = 0;
    w.fetch = async (url, options) => {calls++; payload = JSON.parse(options.body); return {ok: true, json: async () => ({errors: true, message: '<b>Invalid login</b>'})};};
    renders[0].options.callback('login-token');
    w.document.forms[0].dispatchEvent(new w.Event('submit', {cancelable: true}));
    w.document.forms[0].dispatchEvent(new w.Event('submit', {cancelable: true}));
    await tick();
    assert.equal(calls, 1);
    assert.equal(payload['cf-turnstile-response'], 'login-token');
    assert.equal(payload.username, 'test@example.com');
    assert.equal(payload.formKey, 'test-form-key');
    assert.deepEqual(resets, ['0']);
    assert.equal(scope.isLoading, false);
    assert.equal(w.document.querySelector('[role="status"]').textContent, '<b>Invalid login</b>');
    assert.equal(w.document.querySelector('[role="status"] b'), null);
});

test('Luma Knockout component keeps configured form gating and widget options', () => {
    const vm = require('node:vm');
    let component, rendered;
    const context = {window: {}, define: (deps, factory) => {component = factory({}, {mage: {__: s => s}}, {extend: x => x});}, turnstile: {render: (el, options) => {rendered = options; return 'luma-widget';}}};
    vm.runInNewContext(readFileSync(join(__dirname, '../../view/base/web/js/view/component.js'), 'utf8'), context);
    component.config = {enabled: true, sitekey: 'luma-key', forms: ['register'], theme: 'auto', size: 'normal'};
    component.action = 'register';
    component.element = {};
    assert.equal(component.canShow(), true);
    component.render();
    assert.equal(rendered.sitekey, 'luma-key');
    assert.equal(component.widgetId, 'luma-widget');
    component.action = 'newsletter';
    assert.equal(component.canShow(), false);
});

test('popup waits until visible before rendering and disconnects its visibility observer', async t => {
    let notify, disconnected = 0;
    const {renders} = await setup(t, '<div id="authentication-popup">' + form('', 'login-form') + '</div>', {}, true, w => {
        w.IntersectionObserver = class {
            constructor(callback) { notify = callback; }
            observe() {}
            disconnect() { disconnected++; }
        };
    });
    assert.equal(renders.length, 0);
    notify([{isIntersecting: false}]);
    await tick();
    assert.equal(renders.length, 0);
    notify([{isIntersecting: true}]);
    await tick();
    assert.equal(renders.length, 1);
    assert.equal(disconnected, 1);
});

test('API loading resolves pending forms without injecting a second script', async t => {
    const {w} = await setup(t, form('customer/account/createpost/'), {}, false);
    let rendered = 0;
    w.turnstile = {render: () => {rendered++; return '0';}, remove: () => {}};
    await new Promise(resolve => setTimeout(resolve, 70));
    assert.equal(rendered, 1);
    assert.equal(w.document.querySelectorAll('script').length, 1);
});
