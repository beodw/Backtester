import { getToken } from 'next-auth/jwt';
import type { NextRequest } from 'next/server';

export async function getDriveAccessToken(request: NextRequest): Promise<string | null> {
  const secureCookie = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie,
  });
  if (!token?.driveAccessToken) return null;
  if (token.driveExpiresAt && Date.now() < token.driveExpiresAt - 60_000) {
    return token.driveAccessToken;
  }
  if (!token.driveRefreshToken) return null;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.AUTH_GOOGLE_ID ?? '',
      client_secret: process.env.AUTH_GOOGLE_SECRET ?? '',
      grant_type: 'refresh_token',
      refresh_token: token.driveRefreshToken,
    }),
  });
  if (!response.ok) return null;
  const refreshed = await response.json() as { access_token?: string };
  return refreshed.access_token ?? null;
}