import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
export class LoaderError extends Error {
    constructor(message) {
        super(message);
        this.name = 'LoaderError';
    }
}
function parseScalar(value) {
    const trimmed = value.trim();
    if (/^-?\d+$/.test(trimmed))
        return Number(trimmed);
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        const inner = trimmed.slice(1, -1).trim();
        if (!inner)
            return [];
        return inner.split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, ''));
    }
    return trimmed.replace(/^['"]|['"]$/g, '');
}
export function parseMarkdownFrontmatter(filePath, source) {
    const normalizedSource = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (!normalizedSource.startsWith('---\n')) {
        throw new LoaderError(`Artifact at ${filePath} is missing YAML frontmatter.`);
    }
    const end = normalizedSource.indexOf('\n---', 4);
    if (end === -1) {
        throw new LoaderError(`Artifact at ${filePath} has unparseable YAML frontmatter.`);
    }
    const yaml = normalizedSource.slice(4, end).split('\n');
    const bodyStart = normalizedSource.indexOf('\n', end + 4);
    const body = bodyStart === -1 ? '' : normalizedSource.slice(bodyStart + 1).trim();
    const frontmatter = {};
    for (let i = 0; i < yaml.length; i++) {
        const line = yaml[i];
        if (!line.trim())
            continue;
        const match = /^(\w+):\s*(.*)$/.exec(line);
        if (!match) {
            throw new LoaderError(`Artifact at ${filePath} has unparseable YAML line: ${line}`);
        }
        const [, key, rawValue] = match;
        if (rawValue === '|') {
            const block = [];
            while (i + 1 < yaml.length) {
                const next = yaml[i + 1];
                if (/^\s+\S/.test(next)) {
                    i++;
                    block.push(next.replace(/^ {2}/, ''));
                    continue;
                }
                // Blank lines belong to the block only when indented content follows.
                if (!next.trim()) {
                    let lookahead = i + 2;
                    while (lookahead < yaml.length && !yaml[lookahead].trim())
                        lookahead++;
                    if (lookahead < yaml.length && /^\s+\S/.test(yaml[lookahead])) {
                        while (i + 1 < lookahead) {
                            i++;
                            block.push('');
                        }
                        continue;
                    }
                }
                break;
            }
            frontmatter[key] = block.join('\n').trim();
            continue;
        }
        frontmatter[key] = parseScalar(rawValue);
    }
    return { frontmatter, body };
}
export async function loadMarkdownArtifacts(dir, schema) {
    const entries = await readdir(dir, { withFileTypes: true });
    const artifacts = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isFile() || !entry.name.endsWith('.md'))
            continue;
        const filePath = join(dir, entry.name);
        const source = await readFile(filePath, 'utf8');
        const { frontmatter, body } = parseMarkdownFrontmatter(filePath, source);
        const parsed = schema.safeParse(frontmatter);
        if (!parsed.success) {
            const issue = parsed.error.issues[0];
            const field = issue?.path.join('.') || '(root)';
            throw new LoaderError(`${basename(dir)} artifact at ${filePath} is missing or invalid required field '${field}'.`);
        }
        artifacts.push({ ...parsed.data, body, filePath });
    }
    assertUniqueIds(artifacts.map((artifact) => {
        const withId = artifact;
        return { id: withId.id, filePath: withId.filePath };
    }));
    return artifacts;
}
function assertUniqueIds(artifacts) {
    const seen = new Map();
    for (const artifact of artifacts) {
        const first = seen.get(artifact.id);
        if (first) {
            throw new LoaderError(`Duplicate artifact id '${artifact.id}' in ${first} and ${artifact.filePath}.`);
        }
        seen.set(artifact.id, artifact.filePath);
    }
}
