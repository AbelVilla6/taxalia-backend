import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { BlogDatabase } from '../content/db.js';
import { execute, queryOne } from '../content/db.js';

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
 * stored in MySQL and carried in an httpOnly cookie.
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
  async ensureAdminUser(username: string, password: string): Promise<void> {
    const existing = await queryOne<{ id: number }>(
      this.db,
      'SELECT id FROM users WHERE username = ? LIMIT 1',
      [username],
    );
    if (existing) return;

    const salt = randomBytes(16).toString('hex');
    await execute(
      this.db,
      'INSERT INTO users (username, password_hash, salt, must_change_password) VALUES (?, ?, ?, 1)',
      [username, hashPassword(password, salt), salt],
    );
  }

  /** Verifies credentials and opens a session. Returns null on bad credentials. */
  async login(username: string, password: string): Promise<LoginResult | null> {
    const user = await queryOne<UserRow>(
      this.db,
      'SELECT * FROM users WHERE username = ? LIMIT 1',
      [username],
    );
    if (!user) return null;
    if (!verifyPassword(password, user.salt, user.password_hash)) return null;

    const token = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + this.sessionTtlMs;
    await execute(this.db, 'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', [
      token,
      user.id,
      expiresAt,
    ]);
    return { token, mustChangePassword: user.must_change_password === 1 };
  }

  /** Whether the user is still required to replace the seeded password. */
  async mustChangePassword(username: string): Promise<boolean> {
    const row = await queryOne<{ flag: number }>(
      this.db,
      'SELECT must_change_password AS flag FROM users WHERE username = ? LIMIT 1',
      [username],
    );
    return row?.flag === 1;
  }

  /**
   * Replaces the password after verifying the current one and clears the
   * first-login flag. Returns false when the current password is wrong.
   */
  async changePassword(username: string, currentPassword: string, newPassword: string): Promise<boolean> {
    const user = await queryOne<UserRow>(
      this.db,
      'SELECT * FROM users WHERE username = ? LIMIT 1',
      [username],
    );
    if (!user) return false;
    if (!verifyPassword(currentPassword, user.salt, user.password_hash)) return false;

    const salt = randomBytes(16).toString('hex');
    await execute(
      this.db,
      'UPDATE users SET password_hash = ?, salt = ?, must_change_password = 0 WHERE id = ?',
      [hashPassword(newPassword, salt), salt, user.id],
    );
    return true;
  }

  /** Returns the username for a valid, unexpired session token, else null. */
  async validate(token: string | undefined): Promise<string | null> {
    if (!token) return null;
    const row = await queryOne<{ expiresAt: number; username: string }>(
      this.db,
      `SELECT s.expires_at AS expiresAt, u.username AS username
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`,
      [token],
    );

    if (!row) return null;
    if (row.expiresAt < Date.now()) {
      await this.logout(token);
      return null;
    }
    return row.username;
  }

  /** Destroys a session. */
  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    await execute(this.db, 'DELETE FROM sessions WHERE token = ?', [token]);
  }
}
