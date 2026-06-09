import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { BlogDatabase } from '../content/db.js';

const SCRYPT_KEYLEN = 64;

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  salt: string;
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
}

function verifyPassword(password: string, salt: string, expected: string): boolean {
  const actual = scryptSync(password, salt, SCRYPT_KEYLEN);
  const expectedBuf = Buffer.from(expected, 'hex');
  if (actual.length !== expectedBuf.length) return false;
  return timingSafeEqual(actual, expectedBuf);
}

/**
 * Session-based auth for the admin panel. Passwords are hashed with scrypt
 * (Node built-in, no native dependency). Sessions are opaque random tokens
 * stored in SQLite and carried in an httpOnly cookie.
 */
export class AuthService {
  constructor(
    private readonly db: BlogDatabase,
    private readonly sessionTtlMs: number,
  ) {}

  /** Creates the admin user from env credentials if it does not exist yet. */
  ensureAdminUser(username: string, password: string): void {
    const existing = this.db
      .prepare('SELECT id FROM users WHERE username = ?')
      .get(username);
    if (existing) return;

    const salt = randomBytes(16).toString('hex');
    this.db
      .prepare(
        'INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)',
      )
      .run(username, hashPassword(password, salt), salt);
  }

  /** Verifies credentials and opens a session. Returns the token or null. */
  login(username: string, password: string): string | null {
    const user = this.db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(username) as UserRow | undefined;
    if (!user) return null;
    if (!verifyPassword(password, user.salt, user.password_hash)) return null;

    const token = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + this.sessionTtlMs;
    this.db
      .prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
      .run(token, user.id, expiresAt);
    return token;
  }

  /** Returns the username for a valid, unexpired session token, else null. */
  validate(token: string | undefined): string | null {
    if (!token) return null;
    const row = this.db
      .prepare(
        `SELECT s.expires_at AS expiresAt, u.username AS username
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token = ?`,
      )
      .get(token) as { expiresAt: number; username: string } | undefined;

    if (!row) return null;
    if (row.expiresAt < Date.now()) {
      this.logout(token);
      return null;
    }
    return row.username;
  }

  /** Destroys a session. */
  logout(token: string | undefined): void {
    if (!token) return;
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
}
