/** Hyva adapter. MIT License; see LICENCE. No RequireJS, jQuery or Knockout dependency. */
(function () {
    'use strict';

    const routes = {
        register: /\/customer\/account\/createpost(?:\/|$)/i,
        login: /\/customer\/account\/loginpost(?:\/|$)/i,
        password: /\/customer\/account\/forgotpasswordpost(?:\/|$)/i,
        contact: /\/contact\/index\/post(?:\/|$)/i,
        review: /\/review\/product\/post(?:\/|$)/i,
        'send-friend': /\/sendfriend\/product\/sendmail(?:\/|$)/i,
        newsletter: /\/newsletter\/subscriber\/new(?:\/|$)/i,
        'login-ajax': /\/customer\/ajax\/login(?:\/|$)/i
    };
    let apiPromise;

    function loadApi() {
        if (window.turnstile && typeof window.turnstile.render === 'function') {
            return Promise.resolve(window.turnstile);
        }
        if (!apiPromise) {
            apiPromise = new Promise(function (resolve, reject) {
                const existing = document.querySelector('script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]');
                const script = existing || document.createElement('script');
                const started = Date.now();
                const timer = window.setInterval(function () {
                    if (window.turnstile && typeof window.turnstile.render === 'function') {
                        window.clearInterval(timer);
                        resolve(window.turnstile);
                    } else if (Date.now() - started > 15000) {
                        window.clearInterval(timer);
                        reject(new Error('Turnstile load timeout'));
                    }
                }, 50);
                script.addEventListener('error', function () {
                    window.clearInterval(timer);
                    reject(new Error('Turnstile load failed'));
                }, {once: true});
                if (!existing) {
                    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
                    script.async = true;
                    document.head.appendChild(script);
                }
            });
        }
        return apiPromise;
    }

    function start() {
        const node = document.querySelector('[data-pixelopen-turnstile-config]');
        if (!node || node.dataset.initialized) {
            return;
        }
        node.dataset.initialized = 'true';
        const config = JSON.parse(node.dataset.pixelopenTurnstileConfig);
        if (!config.enabled) {
            return;
        }
        const states = new Map();
        let loggedIn = false;

        function actionFor(form) {
            if (form.matches('#authentication-popup #login-form') && config.forms.includes('login-ajax')) {
                return 'login-ajax';
            }
            const url = new URL(form.action, window.location.href);
            if (url.origin !== window.location.origin || form.method.toLowerCase() !== 'post') {
                return null;
            }
            return config.forms.find(function (action) {
                return routes[action] && routes[action].test(url.pathname);
            });
        }

        function attach(form, action) {
            const wrapper = document.createElement('div');
            wrapper.className = 'pixelopen-turnstile';
            const widget = document.createElement('div');
            const message = document.createElement('p');
            message.setAttribute('role', 'status');
            message.setAttribute('aria-live', 'polite');
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = 'cf-turnstile-response';
            wrapper.append(widget, message, input);
            const toolbar = form.querySelector('.actions-toolbar');
            if (toolbar) {
                toolbar.before(wrapper);
            } else {
                form.appendChild(wrapper);
            }
            const state = {wrapper: wrapper, input: input, widgetId: null, api: null};
            states.set(form, state);

            function clear(text) {
                input.value = '';
                message.textContent = text || '';
            }

            function reset() {
                clear();
                if (state.api && state.widgetId !== null && state.widgetId !== undefined) {
                    state.api.reset(state.widgetId);
                }
            }

            async function login() {
                if (state.submitting || !form.reportValidity()) {
                    return;
                }
                state.submitting = true;
                const scope = window.Alpine && window.Alpine.$data ? window.Alpine.$data(form) : null;
                if (scope) {
                    scope.isLoading = true;
                }
                try {
                    const fields = new FormData(form);
                    const response = await window.fetch(config.loginUrl, {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: {'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest'},
                        body: JSON.stringify({
                            username: fields.get('username'),
                            password: fields.get('password'),
                            formKey: window.hyva.getFormKey(),
                            'cf-turnstile-response': input.value
                        })
                    });
                    if (!response.ok) {
                        throw new Error(config.messages.error);
                    }
                    const result = await response.json();
                    if (result.errors !== false) {
                        reset();
                        message.textContent = typeof result.message === 'string' ? result.message : config.messages.error;
                    } else {
                        window.location.assign(scope && scope.checkoutUrl || config.checkoutUrl);
                    }
                } catch (error) {
                    reset();
                    message.textContent = config.messages.error;
                } finally {
                    state.submitting = false;
                    if (scope) {
                        scope.isLoading = false;
                    }
                }
            }

            // Capture before Alpine submit handlers; server validation remains authoritative.
            state.submit = function (event) {
                if (!loggedIn && !input.value) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    message.textContent = config.messages.pending;
                } else if (action === 'login-ajax' && form.matches('#authentication-popup #login-form')) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    login();
                }
            };
            state.reset = reset;
            form.addEventListener('submit', state.submit, true);
            form.addEventListener('reset', reset);
            // AJAX consumers dispatch this after a request consumes the token, including failure.
            form.addEventListener('pixelopen-turnstile-reset', reset);

            if (!config.sitekey) {
                clear(config.messages.missing);
                return;
            }
            function render() {
                loadApi().then(function (api) {
                    if (!form.isConnected || loggedIn || states.get(form) !== state) {
                        return;
                    }
                    state.api = api;
                    state.widgetId = api.render(widget, {
                        sitekey: config.sitekey,
                        theme: config.theme,
                        size: config.size,
                        action: action,
                        'response-field': false,
                        callback: function (token) {
                            input.value = token;
                            message.textContent = '';
                        },
                        'expired-callback': function () { clear(config.messages.pending); },
                        'timeout-callback': function () { clear(config.messages.pending); },
                        'error-callback': function () { clear(config.messages.error); }
                    });
                    if (state.widgetId === undefined || state.widgetId === null) {
                        throw new Error('Turnstile render failed');
                    }
                }).catch(function () { clear(config.messages.error); });
            }
            if (form.matches('#authentication-popup #login-form') && window.IntersectionObserver) {
                state.visibility = new IntersectionObserver(function (entries) {
                    if (entries.some(function (entry) { return entry.isIntersecting; })) {
                        state.visibility.disconnect();
                        render();
                    }
                });
                state.visibility.observe(wrapper);
            } else {
                render();
            }
        }

        function remove(form, state) {
            states.delete(form);
            form.removeEventListener('submit', state.submit, true);
            form.removeEventListener('reset', state.reset);
            form.removeEventListener('pixelopen-turnstile-reset', state.reset);
            if (state.visibility) {
                state.visibility.disconnect();
            }
            if (state.api && state.widgetId !== null && state.widgetId !== undefined) {
                state.api.remove(state.widgetId);
            }
            state.wrapper.remove();
        }

        function scan() {
            states.forEach(function (state, form) {
                if (!form.isConnected || !state.wrapper.isConnected || loggedIn) {
                    remove(form, state);
                }
            });
            if (!loggedIn) {
                document.querySelectorAll('form').forEach(function (form) {
                    const action = actionFor(form);
                    if (action && !states.has(form)) {
                        attach(form, action);
                    }
                });
            }
        }

        window.addEventListener('private-content-loaded', function (event) {
            const customer = event.detail && event.detail.data && event.detail.data.customer;
            loggedIn = !!(customer && customer.firstname);
            scan();
        });
        window.addEventListener('pageshow', function (event) {
            if (event.persisted) {
                states.forEach(function (state) { state.reset(); });
            }
        });
        // Supports Alpine-inserted forms without replacing their submit handlers.
        new MutationObserver(scan).observe(document.body, {childList: true, subtree: true});
        scan();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, {once: true});
    } else {
        start();
    }
}());
