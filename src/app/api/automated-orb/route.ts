import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import type { NextRequest } from 'next/server';
import { runAutomatedOrb } from '@/lib/automated-orb';
import { loadPairCandles } from '@/lib/google-drive-data';

export const runtime = 'nodejs';
export const maxDuration = 300;

const PAIR_CONFIG = {
  EURUSD: { rrTarget: 1 },
  SP500: { rrTarget: 1 },
} as const;

type PairCode = keyof typeof PAIR_CONFIG;

async function getDriveAccessToken(request: NextRequest): Promise<string | null> {
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

export async function POST(request: NextRequest) {
  const driveAccessToken = await getDriveAccessToken(request);
  if (!driveAccessToken) {
    return NextResponse.json({ error: 'Connect Google Drive before running the ORB.' }, { status: 401 });
  }

  let body: { pair?: unknown; startYear?: unknown; endYear?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const pair = typeof body.pair === 'string' ? body.pair.trim().toUpperCase() : '';
  if (!Object.hasOwn(PAIR_CONFIG, pair)) {
    return NextResponse.json({ error: 'Supported pairs are EURUSD and SP500.' }, { status: 400 });
  }

  const startYear = Number(body.startYear);
  const endYear = Number(body.endYear);
  const currentYear = new Date().getUTCFullYear();
  if (
    !Number.isInteger(startYear) || !Number.isInteger(endYear) ||
    startYear < 2000 || endYear > currentYear || startYear > endYear ||
    endYear - startYear > 2
  ) {
    return NextResponse.json({ error: 'Choose a valid date range of at most three years.' }, { status: 400 });
  }

  try {
    const candles = await loadPairCandles(driveAccessToken, pair as PairCode, startYear, endYear);
    const result = runAutomatedOrb(candles, PAIR_CONFIG[pair as PairCode].rrTarget, startYear, endYear);
    return NextResponse.json({
      pair,
      startYear,
      endYear,
      candles: result.candles.map(candle => ({
        timestamp: candle.timestamp,
        bid: candle.bid,
        ask: candle.ask,
      })),
      trades: result.trades,
      premarketByDate: result.premarketByDate,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load Drive data.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
