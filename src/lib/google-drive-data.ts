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
const DRIVE_FOLDER_PATH = [
  'Trading Journals',
  'Opening Range Break',
  'Candle By Candle Journal',
];

type DriveFile = { id: string; name: string; mimeType?: string };

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

async function findFolder(
  accessToken: string,
  parentId: string,
  name: string,
): Promise<DriveFile> {
  const query = `'${escapeDriveQuery(parentId)}' in parents and name = '${escapeDriveQuery(name)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const folder = (await listDriveFiles(accessToken, query))[0];
  if (!folder) throw new Error(`Drive folder not found: ${name}`);
  return folder;
}

async function findYearArchive(
  accessToken: string,
  pair: string,
  year: number,
): Promise<DriveFile> {
  let parentId = 'root';
  for (const folderName of [...DRIVE_FOLDER_PATH, pair, 'M1_bid_ask_prices']) {
    parentId = (await findFolder(accessToken, parentId, folderName)).id;
  }

  const query = `'${escapeDriveQuery(parentId)}' in parents and name = '${year}.zip' and trashed = false`;
  const archive = (await listDriveFiles(accessToken, query))[0];
  if (!archive) throw new Error(`Drive archive not found for ${pair} ${year}.`);
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

function findZipEntry(zip: yauzl.ZipFile, side: 'Bid' | 'Ask'): Promise<yauzl.Entry> {
  return new Promise((resolve, reject) => {
    const matches: yauzl.Entry[] = [];
    zip.on('error', reject);
    zip.on('entry', entry => {
      const name = entry.fileName.split('/').at(-1) ?? '';
      if (!name.endsWith('/') && name.includes(`_${side}_`) && name.toLowerCase().endsWith('.csv')) {
        matches.push(entry);
      }
      zip.readEntry();
    });
    zip.on('end', () => {
      if (matches.length === 1) resolve(matches[0]);
      else reject(new Error(`ZIP must contain one ${side} CSV; found ${matches.length}.`));
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

async function aggregateSide(zipPath: string, side: 'Bid' | 'Ask'): Promise<Map<number, AggregatedOhlc>> {
  const zip = await openZip(zipPath);
  try {
    const entry = await findZipEntry(zip, side);
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
  pair: string,
  startYear: number,
  endYear: number,
) {
  const bidBars = new Map<number, AggregatedOhlc>();
  const askBars = new Map<number, AggregatedOhlc>();
  const tempDir = await mkdtemp(join(tmpdir(), 'orb-data-'));

  try {
    for (let year = startYear; year <= endYear; year++) {
      const archive = await findYearArchive(accessToken, pair, year);
      const response = await fetch(`${DRIVE_API}/files/${archive.id}?alt=media`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      });
      if (!response.ok || !response.body) {
        throw new Error(`Could not download the ${pair} ${year} ZIP (${response.status}).`);
      }

      const zipPath = join(tempDir, `${year}.zip`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(zipPath));
      mergeAggregatedBars(bidBars, await aggregateSide(zipPath, 'Bid'));
      mergeAggregatedBars(askBars, await aggregateSide(zipPath, 'Ask'));
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  return makePairedCandles(bidBars, askBars);
}