/**
 * Base class for every error thrown by the SDK. Network failures,
 * unexpected response bodies and unrecognised HTTP statuses all surface
 * as plain ApiError; the four subclasses below cover the cases callers
 * usually want to branch on.
 */
export class ApiError extends Error {
    public readonly status: number;

    constructor(message: string, status = 0, options?: { cause?: unknown }) {
        super(message, options);
        this.name = 'ApiError';
        this.status = status;
    }
}

export class AuthenticationError extends ApiError {
    constructor(message: string, status: number) {
        super(message, status);
        this.name = 'AuthenticationError';
    }
}

export class RateLimitError extends ApiError {
    constructor(message: string, status: number) {
        super(message, status);
        this.name = 'RateLimitError';
    }
}

export class ValidationError extends ApiError {
    public readonly payload: Record<string, unknown>;

    constructor(message: string, status: number, payload: Record<string, unknown>) {
        super(message, status);
        this.name = 'ValidationError';
        this.payload = payload;
    }
}
