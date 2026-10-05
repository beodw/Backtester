import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { runAutomatedOrb } from '@/lib/automated-orb';
import { getDriveAccessToken } from '@/lib/google-drive-auth';
import { loadPairCandles } from '@/lib/google-drive-data';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const driveAccessToken = await getDriveAccessToken(request);
  if (!driveAccessToken) {
    return NextResponse.json({ error: 'Connect Google Drive before running the ORB.' }, { status: 401 });
  }

  let body: { pair?: unknown; folderId?: unknown; rrTarget?: unknown; startYear?: unknown; endYear?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const pair = typeof body.pair === 'string' ? body.pair.trim().toUpperCase() : '';
  const folderId = typeof body.folderId === 'string' ? body.folderId : '';
  const rrTarget = Number(body.rrTarget ?? 1);
  if (!/^[A-Z0-9._-]{1,16}$/.test(pair)) {
    return NextResponse.json({ error: 'Enter a pair code using letters or numbers.' }, { status: 400 });
  }
  if (!/^[A-Za-z0-9_-]+$/.test(folderId)) {
    return NextResponse.json({ error: 'Choose the Drive folder that contains the yearly ZIP files.' }, { status: 400 });
  }
  if (!Number.isFinite(rrTarget) || rrTarget <= 0 || rrTarget > 10) {
    return NextResponse.json({ error: 'RR target must be greater than 0 and at most 10.' }, { status: 400 });
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
    const candles = await loadPairCandles(driveAccessToken, folderId, startYear, endYear);
    const result = runAutomatedOrb(candles, rrTarget, startYear, endYear);
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