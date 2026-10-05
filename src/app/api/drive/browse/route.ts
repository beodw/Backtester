import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getDriveAccessToken } from '@/lib/google-drive-auth';
import { browseDriveFolder } from '@/lib/google-drive-data';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const accessToken = await getDriveAccessToken(request);
  if (!accessToken) {
    return NextResponse.json({ error: 'Google Drive session missing or expired.' }, { status: 401 });
  }

  const folderId = request.nextUrl.searchParams.get('folderId') ?? 'root';
  if (!/^[A-Za-z0-9_-]+$/.test(folderId)) {
    return NextResponse.json({ error: 'Invalid Drive folder.' }, { status: 400 });
  }

  try {
    const files = await browseDriveFolder(accessToken, folderId);
    return NextResponse.json({ files });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not browse Google Drive.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}