import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parse } from 'csv-parse';
import * as yauzl from 'yauzl';
import {
  aggregateM1Rows,
  makePairedCandles,
  mergeAggregatedBars,
  type AggregatedOhlc,
  type TimedOhlc,
} from '@/lib/automated-orb';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';

export type DriveFile = { id: string; name: string; mimeType?: string };

const escapeDriveQuery = (value: string): string =>
  value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");

async function listDriveFiles(accessToken: string, query: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: query,
      pageSize: '1000',
      fields: 'nextPageToken,files(id,name,mimeType)',
      orderBy: 'name',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const response = await fetch(`${DRIVE_API}/files?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`Google Drive search failed (${response.status}).`);
    }
    const result = await response.json() as { files?: DriveFile[]; nextPageToken?: string };
    files.push(...(result.files ?? []));
    pageToken = result.nextPageToken;
  } while (pageToken);

  return files;
}

export async function browseDriveFolder(accessToken: string, folderId: string): Promise<DriveFile[]> {
  const query = `'${escapeDriveQuery(folderId)}' in parents and trashed = false`;
  return listDriveFiles(accessToken, query);
}

async function findYearArchive(
  accessToken: string,
  folderId: string,
  year: number,
): Promise<DriveFile> {
  const query = `'${escapeDriveQuery(folderId)}' in parents and name = '${year}.zip' and trashed = false`;
  const archive = (await listDriveFiles(accessToken, query))[0];
  if (!archive) throw new Error(`Drive archive not found: ${year}.zip in the selected folder.`);
  return archive;
}

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false, decodeStrings: true }, (error, zip) => {
      if (error || !zip) reject(error ?? new Error('Could not open ZIP archive.'));
      else resolve(zip);
    });
  });
}

function findZipEntry(zip: yauzl.ZipFile, side: 'Bid' | 'Ask', year: number): Promise<yauzl.Entry> {
  return new Promise((resolve, reject) => {
    const matches: yauzl.Entry[] = [];
    zip.on('error', reject);
    zip.on('entry', entry => {
      const expectedDirectory = `${year}/`;
      const entryPath = entry.fileName.replaceAll('\\', '/');
      const relativePath = entryPath.startsWith(expectedDirectory)
        ? entryPath.slice(expectedDirectory.length)
        : '';
      if (
        relativePath &&
        !relativePath.includes('/') &&
        relativePath.includes(`_${side}_`) &&
        relativePath.toLowerCase().endsWith('.csv')
      ) {
        matches.push(entry);
      }
      zip.readEntry();
    });
    zip.on('end', () => {
      if (matches.length === 1) resolve(matches[0]);
      else reject(new Error(`ZIP ${year}.zip must contain one ${side} CSV directly inside its ${year}/ folder; found ${matches.length}.`));
    });
    zip.readEntry();
  });
}

function openZipEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) reject(error ?? new Error('Could not read ZIP entry.'));
      else resolve(stream);
    });
  });
}

async function aggregateSide(zipPath: string, side: 'Bid' | 'Ask', year: number): Promise<Map<number, AggregatedOhlc>> {
  const zip = await openZip(zipPath);
  try {
    const entry = await findZipEntry(zip, side, year);
    const csvStream = await openZipEntry(zip, entry);
    const records = csvStream.pipe(parse({ columns: true, skip_empty_lines: true, bom: true }));

    async function* timedRows(): AsyncGenerator<TimedOhlc> {
      for await (const row of records as AsyncIterable<Record<string, string>>) {
        const match = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(row['Time (UTC)']?.trim() ?? '');
        if (!match) continue;
        const [, day, month, year, hour, minute, second] = match;
        const open = Number(row.Open);
        const high = Number(row.High);
        const low = Number(row.Low);
        const close = Number(row.Close);
        if (![open, high, low, close].every(Number.isFinite)) continue;
        yield {
          timestamp: Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)),
          open,
          high,
          low,
          close,
        };
      }
    }

    return await aggregateM1Rows(timedRows());
  } finally {
    zip.close();
  }
}

export async function loadPairCandles(
  accessToken: string,
  folderId: string,
  startYear: number,
  endYear: number,
) {
  const bidBars = new Map<number, AggregatedOhlc>();
  const askBars = new Map<number, AggregatedOhlc>();
  const tempDir = await mkdtemp(join(tmpdir(), 'orb-data-'));

  try {
    for (let year = startYear; year <= endYear; year++) {
      const archive = await findYearArchive(accessToken, folderId, year);
      const response = await fetch(`${DRIVE_API}/files/${archive.id}?alt=media`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      });
      if (!response.ok || !response.body) {
        throw new Error(`Could not download ${year}.zip from the selected Drive folder (${response.status}).`);
      }

      const zipPath = join(tempDir, `${year}.zip`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(zipPath));
      mergeAggregatedBars(bidBars, await aggregateSide(zipPath, 'Bid', year));
      mergeAggregatedBars(askBars, await aggregateSide(zipPath, 'Ask', year));
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  return makePairedCandles(bidBars, askBars);
}