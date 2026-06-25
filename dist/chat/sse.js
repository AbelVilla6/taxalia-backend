import { getRequestId } from '../observability/requestId.js';
export function errorEnvelope(c, code, message) {
    return {
        error: {
            code,
            message,
            requestId: getRequestId(c),
        },
    };
}
export function sseFormat(event) {
    return `data: ${JSON.stringify(event)}\n\n`;
}
export function deltaEvent(delta) {
    return { delta };
}
export function sseHeaders() {
    return {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    };
}
