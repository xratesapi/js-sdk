import {
    ApiError,
    AuthenticationError,
    RateLimitError,
    ValidationError,
} from './errors.js';

export const SDK_VERSION = '0.1.0';
export const DEFAULT_BASE_URL = 'https://xratesapi.com';

export interface ClientOptions {
    /** Override the API base URL (e.g. for staging or self-hosted deployments). */
    baseUrl?: string;
    /** Custom fetch implementation. Defaults to the global `fetch`. */
    fetch?: typeof fetch;
    /** Request timeout in milliseconds. Defaults to 10_000. */
    timeoutMs?: number;
}

export interface LatestOptions {
    base?: string;
    symbols?: string[];
}

export interface RangeOptions extends LatestOptions {
    startDate: string;
    endDate: string;
}

type Query = Record<string, string | number | undefined>;

/**
 * Thin HTTP client wrapping the XRates REST API. Stateless beyond the
 * API key — every method is one fetch call, errors map to the four
 * typed subclasses in `errors.ts`.
 */
export class Client {
    private readonly apiKey: string;
    private readonly baseUrl: string;
    private readonly fetchImpl: typeof fetch;
    private readonly timeoutMs: number;

    constructor(apiKey: string, options: ClientOptions = {}) {
        if (!apiKey) {
            throw new Error('XRates API key is required.');
        }
        this.apiKey = apiKey;
        this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
        this.fetchImpl = options.fetch ?? globalThis.fetch;
        this.timeoutMs = options.timeoutMs ?? 10_000;

        if (typeof this.fetchImpl !== 'function') {
            throw new Error(
                'No fetch implementation available. Pass `options.fetch` or run on Node 18+.',
            );
        }
    }

    /** Latest rates. `rates[T]` is "X T per 1 base". */
    async latest(options: LatestOptions = {}): Promise<Record<string, unknown>> {
        return this.get('/api/v1/latest', this.rateParams(options));
    }

    /** Historical rates for a specific date (YYYY-MM-DD). */
    async historical(
        date: string,
        options: LatestOptions = {},
    ): Promise<Record<string, unknown>> {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            throw new Error(`Date must be YYYY-MM-DD, got: ${date}`);
        }
        return this.get(`/api/v1/${date}`, this.rateParams(options));
    }

    /** Convert an amount between two currencies. */
    async convert(
        from: string,
        to: string,
        amount: number,
        date?: string,
    ): Promise<Record<string, unknown>> {
        const query: Query = { from, to, amount };
        if (date) query.date = date;
        return this.get('/api/v1/convert', query);
    }

    /** Time-series of rates between two dates. */
    async timeseries(options: RangeOptions): Promise<Record<string, unknown>> {
        const query = this.rateParams(options);
        query.start_date = options.startDate;
        query.end_date = options.endDate;
        return this.get('/api/v1/timeseries', query);
    }

    /** Rate fluctuation between two dates. */
    async fluctuation(options: RangeOptions): Promise<Record<string, unknown>> {
        const query = this.rateParams(options);
        query.start_date = options.startDate;
        query.end_date = options.endDate;
        return this.get('/api/v1/fluctuation', query);
    }

    /** List of supported currencies. */
    async currencies(): Promise<Record<string, unknown>> {
        return this.get('/api/v1/currencies', {});
    }

    /** Public status endpoint. */
    async status(): Promise<Record<string, unknown>> {
        return this.get('/api/v1/status', {});
    }

    private rateParams(options: LatestOptions): Query {
        const query: Query = { base: options.base ?? 'USD' };
        if (options.symbols && options.symbols.length > 0) {
            query.symbols = options.symbols.join(',');
        }
        return query;
    }

    private async get(path: string, query: Query): Promise<Record<string, unknown>> {
        const url = new URL(this.baseUrl + path);
        for (const [key, value] of Object.entries(query)) {
            if (value !== undefined) {
                url.searchParams.set(key, String(value));
            }
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        let response: Response;
        try {
            response = await this.fetchImpl(url.toString(), {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    Accept: 'application/json',
                    'User-Agent': `xratesapi-js/${SDK_VERSION}`,
                },
                signal: controller.signal,
            });
        } catch (cause) {
            const message =
                cause instanceof Error
                    ? `Network error talking to XRates: ${cause.message}`
                    : 'Network error talking to XRates.';
            throw new ApiError(message, 0, { cause });
        } finally {
            clearTimeout(timeout);
        }

        const status = response.status;
        const text = await response.text();
        let decoded: unknown;
        try {
            decoded = JSON.parse(text);
        } catch {
            throw new ApiError(`Unexpected non-JSON response from XRates (HTTP ${status}).`, status);
        }

        if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
            throw new ApiError(`Unexpected response shape from XRates (HTTP ${status}).`, status);
        }

        const payload = decoded as Record<string, unknown>;

        if (status === 200) {
            return payload;
        }

        const message =
            (typeof payload.message === 'string' && payload.message) ||
            (typeof payload.error === 'string' && payload.error) ||
            'XRates API error';

        if (status === 401 || status === 403) {
            throw new AuthenticationError(message, status);
        }
        if (status === 422) {
            throw new ValidationError(message, status, payload);
        }
        if (status === 429) {
            throw new RateLimitError(message, status);
        }
        throw new ApiError(message, status);
    }
}
