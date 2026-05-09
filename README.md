# @xratesapi/sdk

Official JavaScript / TypeScript SDK for the [XRates exchange rate API](https://xratesapi.com).

ESM-only, zero runtime dependencies, native `fetch` (Node 18+, Deno, Bun, modern browsers).

## Install

```bash
npm install @xratesapi/sdk
```

## Quick start

```ts
import { Client } from '@xratesapi/sdk';

const client = new Client(process.env.XRATES_API_KEY!);

const latest = await client.latest({ base: 'USD', symbols: ['EUR', 'GBP'] });
console.log(latest);

const conversion = await client.convert('USD', 'EUR', 100);
console.log(conversion);
```

## Methods

| Method | Endpoint |
| --- | --- |
| `latest({ base?, symbols? })` | `GET /api/v1/latest` |
| `historical(date, { base?, symbols? })` | `GET /api/v1/{YYYY-MM-DD}` |
| `convert(from, to, amount, date?)` | `GET /api/v1/convert` |
| `timeseries({ startDate, endDate, base?, symbols? })` | `GET /api/v1/timeseries` |
| `fluctuation({ startDate, endDate, base?, symbols? })` | `GET /api/v1/fluctuation` |
| `currencies()` | `GET /api/v1/currencies` |
| `status()` | `GET /api/v1/status` |

## Error handling

All errors extend `ApiError`. Branch on the typed subclasses for the cases you care about:

```ts
import {
    Client,
    ApiError,
    AuthenticationError,
    RateLimitError,
    ValidationError,
} from '@xratesapi/sdk';

try {
    await client.latest({ base: 'XXX' });
} catch (err) {
    if (err instanceof AuthenticationError) {
        // 401 / 403
    } else if (err instanceof RateLimitError) {
        // 429 — back off and retry
    } else if (err instanceof ValidationError) {
        console.error(err.payload); // raw response body
    } else if (err instanceof ApiError) {
        console.error(err.status, err.message);
    }
}
```

## Configuration

```ts
new Client(apiKey, {
    baseUrl: 'https://xratesapi.com', // override for staging/self-hosted
    timeoutMs: 10_000,                // request timeout
    fetch: customFetch,               // inject your own fetch
});
```

## License

MIT
