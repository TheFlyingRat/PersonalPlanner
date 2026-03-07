import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'crypto';
import type { Response } from 'express';
import type { JwtPayload } from '@cadence/shared/auth-types';

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is required');
  return secret;
}

function getJwtRefreshSecret(): string {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) throw new Error('JWT_REFRESH_SECRET environment variable is required');
  return secret;
}

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: ACCESS_TOKEN_EXPIRY });
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, getJwtSecret()) as JwtPayload;
}

export function generateRefreshToken(): string {
  return randomBytes(40).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function getRefreshTokenExpiry(): string {
  return new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS).toISOString();
}

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const cookieDomain = process.env.COOKIE_DOMAIN; // e.g. '.theflyingrat.com' for cross-subdomain

  res.cookie('access_token', accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 15 * 60 * 1000, // 15 minutes
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });

  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: REFRESH_TOKEN_EXPIRY_MS,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });
}

export function getAccessTokenCookieName(): string {
  return 'access_token';
}

export function clearAuthCookies(res: Response): void {
  const cookieDomain = process.env.COOKIE_DOMAIN;
  res.clearCookie('access_token', { path: '/', ...(cookieDomain ? { domain: cookieDomain } : {}) });
  res.clearCookie('refresh_token', { path: '/api/auth', ...(cookieDomain ? { domain: cookieDomain } : {}) });
}
