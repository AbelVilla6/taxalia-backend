import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { z } from 'zod';

export type LoadedArtifact<T> = T & {
  body: string;
  filePath: string;
};

export class LoaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoaderError';
  }
}

type FrontmatterValue = string | number | string[];
type Frontmatter = Record<string, FrontmatterValue>;

function parseScalar(value: string): FrontmatterValue {
  const trimmed = value.trim();
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, ''));
  }
  return trimmed.replace(/^['"]|['"]$/g, '');
}

export function parseMarkdownFrontmatter(filePath: string, source: string): {
  frontmatter: Frontmatter;
  body: string;
} {
  if (!source.startsWith('---\n')) {
    throw new LoaderError(`Artifact at ${filePath} is missing YAML frontmatter.`);
  }

  const end = source.indexOf('\n---', 4);
  if (end === -1) {
    throw new LoaderError(`Artifact at ${filePath} has unparseable YAML frontmatter.`);
  }

  const yaml = source.slice(4, end).split('\n');
  const bodyStart = source.indexOf('\n', end + 4);
  const body = bodyStart === -1 ? '' : source.slice(bodyStart + 1).trim();
  const frontmatter: Frontmatter = {};

  for (let i = 0; i < yaml.length; i++) {
    const line = yaml[i];
    if (!line.trim()) continue;
    const match = /^(\w+):\s*(.*)$/.exec(line);
    if (!match) {
      throw new LoaderError(`Artifact at ${filePath} has unparseable YAML line: ${line}`);
    }

    const [, key, rawValue] = match;
    if (rawValue === '|') {
      const block: string[] = [];
      while (i + 1 < yaml.length && /^\s+/.test(yaml[i + 1])) {
        i++;
        block.push(yaml[i].replace(/^ {2}/, ''));
      }
      frontmatter[key] = block.join('\n').trim();
      continue;
    }

    frontmatter[key] = parseScalar(rawValue);
  }

  return { frontmatter, body };
}

export async function loadMarkdownArtifacts<T extends z.ZodRawShape & { id: z.ZodString }>(
  dir: string,
  schema: z.ZodObject<T>,
): Promise<Array<LoadedArtifact<z.infer<typeof schema>>>> {
  const entries = await readdir(dir, { withFileTypes: true });
  const artifacts: Array<LoadedArtifact<z.infer<typeof schema>>> = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

    const filePath = join(dir, entry.name);
    const source = await readFile(filePath, 'utf8');
    const { frontmatter, body } = parseMarkdownFrontmatter(filePath, source);
    const parsed = schema.safeParse(frontmatter);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path.join('.') || '(root)';
      throw new LoaderError(
        `${basename(dir)} artifact at ${filePath} is missing or invalid required field '${field}'.`,
      );
    }
    artifacts.push({ ...parsed.data, body, filePath });
  }

  assertUniqueIds(
    artifacts.map((artifact) => {
      const withId = artifact as unknown as { id: string; filePath: string };
      return { id: withId.id, filePath: withId.filePath };
    }),
  );
  return artifacts;
}

function assertUniqueIds(artifacts: Array<{ id: string; filePath: string }>): void {
  const seen = new Map<string, string>();
  for (const artifact of artifacts) {
    const first = seen.get(artifact.id);
    if (first) {
      throw new LoaderError(
        `Duplicate artifact id '${artifact.id}' in ${first} and ${artifact.filePath}.`,
      );
    }
    seen.set(artifact.id, artifact.filePath);
  }
}
