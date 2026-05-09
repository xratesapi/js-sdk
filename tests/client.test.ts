import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ApiError,
    AuthenticationError,
    Client,
    RateLimitError,
    ValidationError,
} from '../src/index.js';

interface MockedCall {
    url: string;
    init: RequestInit;
}

function makeFetch(responses: Array<{ status: number; body: unknown }>) {
    const calls: MockedCall[] = [];
    let index = 0;

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const next = responses[index++];
        if (!next) throw new Error('No mock response queued');
        calls.push({ url: String(input), init: init ?? {} });
        return new Response(JSON.stringify(next.body), {
            status: next.status,
            headers: { 'Content-Type': 'application/json' },
        });
    });

    return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe('Client', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('rejects empty API key', () => {
        expect(() => new Client('')).toThrow(/required/i);
    });

    it('sends Bearer token and parses successful latest()', async () => {
        const { fetchImpl, calls } = makeFetch([
            { status: 200, body: { base: 'USD', rates: { EUR: 0.92 } } },
        ]);
        const client = new Client('test-key', { fetch: fetchImpl });

        const result = await client.latest({ symbols: ['EUR', 'GBP'] });

        expect(result).toEqual({ base: 'USD', rates: { EUR: 0.92 } });
        expect(calls).toHaveLength(1);
        const call = calls[0]!;
        expect(call.url).toContain('/api/v1/latest');
        expect(call.url).toContain('base=USD');
        expect(call.url).toContain('symbols=EUR%2CGBP');
        const headers = call.init.headers as Record<string, string>;
        expect(headers.Authorization).toBe('Bearer test-key');
        expect(headers.Accept).toBe('application/json');
    });

    it('historical() validates date format', async () => {
        const client = new Client('k', { fetch: vi.fn() as unknown as typeof fetch });
        await expect(client.historical('2024-1-1')).rejects.toThrow(/YYYY-MM-DD/);
    });

    it('historical() hits the dated endpoint', async () => {
        const { fetchImpl, calls } = makeFetch([
            { status: 200, body: { date: '2024-01-15', rates: { EUR: 0.91 } } },
        ]);
        const client = new Client('k', { fetch: fetchImpl });

        await client.historical('2024-01-15', { base: 'EUR' });

        expect(calls[0]!.url).toContain('/api/v1/2024-01-15');
        expect(calls[0]!.url).toContain('base=EUR');
    });

    it('convert() forwards from/to/amount', async () => {
        const { fetchImpl, calls } = makeFetch([{ status: 200, body: { result: 92 } }]);
        const client = new Client('k', { fetch: fetchImpl });

        const out = await client.convert('USD', 'EUR', 100);

        expect(out).toEqual({ result: 92 });
        expect(calls[0]!.url).toMatch(/from=USD/);
        expect(calls[0]!.url).toMatch(/to=EUR/);
        expect(calls[0]!.url).toMatch(/amount=100/);
    });

    it('timeseries() includes start/end dates', async () => {
        const { fetchImpl, calls } = makeFetch([{ status: 200, body: { rates: {} } }]);
        const client = new Client('k', { fetch: fetchImpl });

        await client.timeseries({
            startDate: '2024-01-01',
            endDate: '2024-01-31',
            symbols: ['EUR'],
        });

        const url = calls[0]!.url;
        expect(url).toContain('start_date=2024-01-01');
        expect(url).toContain('end_date=2024-01-31');
        expect(url).toContain('symbols=EUR');
    });

    it('fluctuation() hits the fluctuation endpoint', async () => {
        const { fetchImpl, calls } = makeFetch([{ status: 200, body: { rates: {} } }]);
        const client = new Client('k', { fetch: fetchImpl });

        await client.fluctuation({ startDate: '2024-01-01', endDate: '2024-01-07' });

        expect(calls[0]!.url).toContain('/api/v1/fluctuation');
    });

    it('currencies() and status() work without parameters', async () => {
        const { fetchImpl, calls } = makeFetch([
            { status: 200, body: { currencies: { USD: 'US Dollar' } } },
            { status: 200, body: { status: 'ok' } },
        ]);
        const client = new Client('k', { fetch: fetchImpl });

        await client.currencies();
        await client.status();

        expect(calls[0]!.url).toContain('/api/v1/currencies');
        expect(calls[1]!.url).toContain('/api/v1/status');
    });

    it('maps 401 to AuthenticationError', async () => {
        const { fetchImpl } = makeFetch([
            { status: 401, body: { message: 'Invalid token' } },
        ]);
        const client = new Client('bad', { fetch: fetchImpl });

        await expect(client.latest()).rejects.toBeInstanceOf(AuthenticationError);
    });

    it('maps 429 to RateLimitError', async () => {
        const { fetchImpl } = makeFetch([
            { status: 429, body: { message: 'Slow down' } },
        ]);
        const client = new Client('k', { fetch: fetchImpl });

        await expect(client.latest()).rejects.toBeInstanceOf(RateLimitError);
    });

    it('maps 422 to ValidationError and exposes payload', async () => {
        const payload = { message: 'invalid', errors: { base: ['unsupported'] } };
        const { fetchImpl } = makeFetch([{ status: 422, body: payload }]);
        const client = new Client('k', { fetch: fetchImpl });

        try {
            await client.latest({ base: 'XXX' });
            expect.fail('expected ValidationError');
        } catch (err) {
            expect(err).toBeInstanceOf(ValidationError);
            const ve = err as ValidationError;
            expect(ve.status).toBe(422);
            expect(ve.payload).toEqual(payload);
        }
    });

    it('maps 500 to plain ApiError', async () => {
        const { fetchImpl } = makeFetch([{ status: 500, body: { message: 'oops' } }]);
        const client = new Client('k', { fetch: fetchImpl });

        await expect(client.latest()).rejects.toBeInstanceOf(ApiError);
    });

    it('throws ApiError on non-JSON response', async () => {
        const fetchImpl = vi.fn(
            async () =>
                new Response('<html>nope</html>', {
                    status: 200,
                    headers: { 'Content-Type': 'text/html' },
                }),
        ) as unknown as typeof fetch;
        const client = new Client('k', { fetch: fetchImpl });

        await expect(client.latest()).rejects.toBeInstanceOf(ApiError);
    });

    it('wraps fetch network errors in ApiError', async () => {
        const fetchImpl = vi.fn(async () => {
            throw new TypeError('network down');
        }) as unknown as typeof fetch;
        const client = new Client('k', { fetch: fetchImpl });

        await expect(client.latest()).rejects.toMatchObject({
            name: 'ApiError',
            status: 0,
        });
    });
});
