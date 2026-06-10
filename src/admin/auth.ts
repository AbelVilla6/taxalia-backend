import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { BlogDatabase } from '../content/db.js';

const SCRYPT_KEYLEN = 64;

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  salt: string;
  must_change_password: number;
}

export interface LoginResult {
  token: string;
  mustChangePassword: boolean;
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

  /**
   * Creates the admin user from env credentials if it does not exist yet.
   * Seeded accounts are flagged to force a password change on first login.
   */
  ensureAdminUser(username: string, password: string): void {
    const existing = this.db
      .prepare('SELECT id FROM users WHERE username = ?')
      .get(username);
    if (existing) return;

    const salt = randomBytes(16).toString('hex');
    this.db
      .prepare(
        'INSERT INTO users (username, password_hash, salt, must_change_password) VALUES (?, ?, ?, 1)',
      )
      .run(username, hashPassword(password, salt), salt);
  }

  /** Verifies credentials and opens a session. Returns null on bad credentials. */
  login(username: string, password: string): LoginResult | null {
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
    return { token, mustChangePassword: user.must_change_password === 1 };
  }

  /** Whether the user is still required to replace the seeded password. */
  mustChangePassword(username: string): boolean {
    const row = this.db
      .prepare('SELECT must_change_password AS flag FROM users WHERE username = ?')
      .get(username) as { flag: number } | undefined;
    return row?.flag === 1;
  }

  /**
   * Replaces the password after verifying the current one and clears the
   * first-login flag. Returns false when the current password is wrong.
   */
  changePassword(username: string, currentPassword: string, newPassword: string): boolean {
    const user = this.db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(username) as UserRow | undefined;
    if (!user) return false;
    if (!verifyPassword(currentPassword, user.salt, user.password_hash)) return false;

    const salt = randomBytes(16).toString('hex');
    this.db
      .prepare(
        'UPDATE users SET password_hash = ?, salt = ?, must_change_password = 0 WHERE id = ?',
      )
      .run(hashPassword(newPassword, salt), salt, user.id);
    return true;
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
