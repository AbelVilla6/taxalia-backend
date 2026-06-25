import { randomUUID } from 'node:crypto';
export const REQUEST_ID_HEADER = 'X-Request-Id';
export const requestIdMiddleware = async (c, next) => {
    const incoming = c.req.header(REQUEST_ID_HEADER);
    const requestId = incoming && incoming.length > 0 ? incoming : randomUUID();
    c.set('requestId', requestId);
    c.header(REQUEST_ID_HEADER, requestId);
    await next();
};
export function getRequestId(c) {
    return c.get('requestId') ?? randomUUID();
}
