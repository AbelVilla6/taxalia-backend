import nodemailer from 'nodemailer';
import type { Env } from '../config.js';
import type { ContactSubmission } from './schemas.js';

export type ContactLanguage = 'en' | 'es';

export interface ContactMailInput extends ContactSubmission {
  requestId: string;
}

export type ContactSender = (input: ContactMailInput) => Promise<void>;

export class ContactMailerConfigError extends Error {
  readonly code = 'CONTACT_MAILER_NOT_CONFIGURED';

  constructor(message = 'Contact mailer is not configured.') {
    super(message);
    this.name = 'ContactMailerConfigError';
  }
}

function subjectFor(lang: ContactLanguage, prefix: string, name: string): string {
  const subject =
    lang === 'es'
      ? `Nuevo mensaje de contacto — ${name}`
      : `New contact form submission — ${name}`;
  return `${prefix} ${subject}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function createContactSender(env: Pick<Env, 'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_SECURE' | 'SMTP_USER' | 'SMTP_PASS' | 'CONTACT_EMAIL_TO' | 'CONTACT_EMAIL_FROM' | 'CONTACT_EMAIL_SUBJECT_PREFIX'>): ContactSender {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
    return async () => {
      throw new ContactMailerConfigError(
        'Set SMTP_HOST, SMTP_USER, and SMTP_PASS to enable contact form delivery. For Brevo, use your SMTP login and key.',
      );
    };
  }

  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });

  return async ({ name, email, message, lang = 'en', requestId }) => {
    const subject = subjectFor(lang, env.CONTACT_EMAIL_SUBJECT_PREFIX, name);
    const text = [
      `Name: ${name}`,
      `Email: ${email}`,
      `Language: ${lang}`,
      `Request ID: ${requestId}`,
      '',
      message,
    ].join('\n');
    const html = `
      <h2>New contact form submission</h2>
      <ul>
        <li><strong>Name:</strong> ${escapeHtml(name)}</li>
        <li><strong>Email:</strong> ${escapeHtml(email)}</li>
        <li><strong>Language:</strong> ${escapeHtml(lang)}</li>
        <li><strong>Request ID:</strong> ${escapeHtml(requestId)}</li>
      </ul>
      <p>${escapeHtml(message).replaceAll('\n', '<br />')}</p>
    `;

    await transport.sendMail({
      from: env.CONTACT_EMAIL_FROM,
      to: env.CONTACT_EMAIL_TO,
      replyTo: email,
      subject,
      text,
      html,
    });
  };
}
