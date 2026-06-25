export class PipelineError extends Error {
    code;
    status;
    constructor(code, status, message) {
        super(message);
        this.code = code;
        this.status = status;
        this.name = 'PipelineError';
    }
}
export function isOllamaUnreachable(err) {
    if (!err || typeof err !== 'object')
        return false;
    const code = err.code;
    return code === 'OLLAMA_UNREACHABLE';
}
export function isModelMissing(err) {
    if (!err || typeof err !== 'object')
        return false;
    const code = err.code;
    return code === 'MODEL_MISSING';
}
