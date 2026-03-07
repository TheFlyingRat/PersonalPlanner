import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { BRAND } from '@cadence/shared';

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.warn('[email] SMTP not configured. Emails will be logged to console.');
    transporter = nodemailer.createTransport({
      jsonTransport: true,
    });
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  return transporter;
}

function getFromAddress(): string {
  return process.env.SMTP_FROM || `${BRAND.name} <noreply@cadence.app>`;
}

function getAppUrl(): string {
  return process.env.CORS_ORIGIN || 'http://localhost:5173';
}

export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const appUrl = getAppUrl();
  const verifyUrl = `${appUrl}/verify-email?token=${encodeURIComponent(token)}`;

  const info = await getTransporter().sendMail({
    from: getFromAddress(),
    to: email,
    subject: `Verify your email - ${BRAND.name}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 16px;">Verify your email</h1>
        <p style="color: #555; line-height: 1.6; margin-bottom: 24px;">
          Click the button below to verify your email address and complete your ${BRAND.name} registration.
        </p>
        <a href="${verifyUrl}" style="display: inline-block; background: #171717; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500;">
          Verify Email
        </a>
        <p style="color: #888; font-size: 13px; margin-top: 32px; line-height: 1.5;">
          This link expires in 24 hours. If you didn't create a ${BRAND.name} account, you can ignore this email.
        </p>
      </div>
    `,
    text: `Verify your email\n\nVisit this link to verify your email: ${verifyUrl}\n\nThis link expires in 24 hours.`,
  });

  // Log to console when using jsonTransport (no SMTP configured)
  if (info.envelope === undefined && info.message) {
    console.log('[email] Verification email (console mode):', JSON.parse(info.message));
  }
}

export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const appUrl = getAppUrl();
  const resetUrl = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;

  const info = await getTransporter().sendMail({
    from: getFromAddress(),
    to: email,
    subject: `Reset your password - ${BRAND.name}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 16px;">Reset your password</h1>
        <p style="color: #555; line-height: 1.6; margin-bottom: 24px;">
          Click the button below to set a new password for your ${BRAND.name} account.
        </p>
        <a href="${resetUrl}" style="display: inline-block; background: #171717; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500;">
          Reset Password
        </a>
        <p style="color: #888; font-size: 13px; margin-top: 32px; line-height: 1.5;">
          This link expires in 1 hour. If you didn't request a password reset, you can ignore this email.
        </p>
      </div>
    `,
    text: `Reset your password\n\nVisit this link to reset your password: ${resetUrl}\n\nThis link expires in 1 hour.`,
  });

  if (info.envelope === undefined && info.message) {
    console.log('[email] Password reset email (console mode):', JSON.parse(info.message));
  }
}
