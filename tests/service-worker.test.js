import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function loadServiceWorker(overrides = {}) {
    const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
    const context = {
        self: {
            addEventListener: () => {},
            skipWaiting: () => Promise.resolve(),
            clients: { claim: () => Promise.resolve() }
        },
        caches: overrides.caches,
        fetch: overrides.fetch,
        Response,
        Headers,
        URL,
        Date,
        Promise,
        parseInt,
        setTimeout,
        clearTimeout
    };
    vm.createContext(context);
    new vm.Script(source, { filename: 'sw.js' }).runInContext(context);
    return { context, source };
}

test('Service Worker markiert alten API-Cache beim Offline-Fallback als stale', async () => {
    const cachedAt = Date.now() - 7 * 60 * 60 * 1000;
    const cachedResponse = new Response('{"hourly":{"time":[]}}', {
        status: 200,
        headers: {
            'content-type': 'application/json',
            'sw-cached-at': String(cachedAt)
        }
    });
    const { context } = await loadServiceWorker({
        fetch: async () => { throw new Error('offline'); },
        caches: {
            match: async () => cachedResponse,
            open: async () => ({ put: async () => {} }),
            keys: async () => []
        }
    });

    const response = await context.networkFirstWithCache(
        { url: 'https://api.open-meteo.com/v1/forecast?latitude=47' },
        'skycheck-api-v42'
    );
    assert.equal(response.headers.get('sw-cache-fallback'), 'true');
    assert.equal(response.headers.get('sw-cache-stale'), 'true');
    assert.equal(response.headers.get('sw-cached-at'), String(cachedAt));
});

test('Service Worker cached alle neuen RC1-Module unter einer einzigen v42-Version', async () => {
    const { source } = await loadServiceWorker({
        fetch: async () => new Response('', { status: 200 }),
        caches: {
            match: async () => null,
            open: async () => ({ put: async () => {} }),
            keys: async () => []
        }
    });
    assert.match(source, /skycheck-static-v42/);
    assert.match(source, /skycheck-api-v42/);
    assert.match(source, /\.\/js\/forecast-periods\.js/);
    assert.doesNotMatch(source, /skycheck-(?:static-|api-)?v32/);
});
