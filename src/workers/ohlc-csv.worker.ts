import type { PriceData } from '@/types';

const workerContext = self as unknown as {
  onmessage: ((event: MessageEvent<string>) => void) | null;
  postMessage: (message: { data?: PriceData[]; candidateTimes?: Record<string, Record<string, number>>; error?: string }) => void;
};

const nyWallTimeToUtc = (dateKey: string, hour: number, minute: number): number => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const wallTimeAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(wallTimeAsUtc));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const formattedWallTimeAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
  );
  return wallTimeAsUtc - (formattedWallTimeAsUtc - wallTimeAsUtc);
};

const findCandidateTimes = (data: PriceData[]): Record<string, Record<string, number>> => {
  const candlesByDate = new Map<string, PriceData[]>();
  for (const candle of data) {
    const dateKey = candle.date.toISOString().slice(0, 10);
    const dayCandles = candlesByDate.get(dateKey) ?? [];
    dayCandles.push(candle);
    candlesByDate.set(dateKey, dayCandles);
  }

  const candidates: Record<string, Record<string, number>> = {};
  const timeframes = [1, 5, 15, 30, 60, 240, 1440];

  for (const [dateKey, dayCandles] of candlesByDate) {
    const [year, month, day] = dateKey.split('-').map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;

    const sessionStart = nyWallTimeToUtc(dateKey, 9, 30);
    const sessionEnd = nyWallTimeToUtc(dateKey, 11, 0);

    for (const openingRangeMinutes of [5, 15]) {
      const rangeEnd = sessionStart + openingRangeMinutes * 60000;
      let rangeHigh = -Infinity;
      let rangeLow = Infinity;
      for (const candle of dayCandles) {
        const timestamp = candle.date.getTime();
        if (timestamp >= sessionStart && timestamp < rangeEnd) {
          rangeHigh = Math.max(rangeHigh, candle.high);
          rangeLow = Math.min(rangeLow, candle.low);
        }
      }
      if (rangeHigh === -Infinity || rangeLow === Infinity) continue;

      for (const timeframeMinutes of timeframes) {
        const interval = timeframeMinutes * 60000;
        const timeframeCandles: PriceData[] = [];
        let current: PriceData | null = null;

        for (const candle of dayCandles) {
          const timestamp = candle.date.getTime();
          const bucket = Math.floor(timestamp / interval) * interval;

          if (!current || current.date.getTime() !== bucket) {
            if (current) timeframeCandles.push(current);
            current = {
              ...candle,
              date: new Date(bucket),
              wick: [candle.low, candle.high],
            };
          } else {
            current.high = Math.max(current.high, candle.high);
            current.low = Math.min(current.low, candle.low);
            current.close = candle.close;
            current.wick = [current.low, current.high];
          }
        }
        if (current) timeframeCandles.push(current);

        const sessionCandles = timeframeCandles.filter(candle => {
          const bucketStart = candle.date.getTime();
          const bucketEnd = bucketStart + interval;
          return bucketEnd > rangeEnd && bucketEnd <= sessionEnd;
        });
        let sawUpBreak = false;
        let sawDownBreak = false;
        let candidateTime: number | undefined;

        for (const candle of sessionCandles) {
          const timestamp = candle.date.getTime();
          const retestedUpBreak = sawUpBreak && candle.low <= rangeHigh;
          const retestedDownBreak = sawDownBreak && candle.high >= rangeLow;
          if (retestedUpBreak || retestedDownBreak) {
            candidateTime = timestamp;
            break;
          }

          if (candle.close > rangeHigh) sawUpBreak = true;
          if (candle.close < rangeLow) sawDownBreak = true;
        }

        if (candidateTime !== undefined) {
          const key = `${timeframeMinutes}|${openingRangeMinutes}`;
          candidates[key] ??= {};
          candidates[key][dateKey] = candidateTime;
        }
      }
    }
  }

  return candidates;
};

workerContext.onmessage = (event: MessageEvent<string>) => {
  try {
    const text = event.data;
    const parsedData: PriceData[] = [];
    let lineStart = 0;
    let lineNumber = 0;

    while (lineStart < text.length) {
      const lineEnd = text.indexOf('\n', lineStart);
      const nextLineStart = lineEnd === -1 ? text.length : lineEnd + 1;
      const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd).trim();
      lineStart = nextLineStart;
      if (!line) continue;
      if (lineNumber++ === 0) continue;

      const columns = line.replace(/\r$/, '').split(',').map(value => value.trim());
      if (columns.length < 5) continue;

      const dateTimeString = columns[0].replace(' GMT', '');
      const [datePart, timePart] = dateTimeString.split(' ');
      if (!datePart || !timePart) continue;

      const [day, month, year] = datePart.split('.').map(Number);
      const [hour, minute, second] = timePart.split(':').map(Number);
      if ([day, month, year, hour, minute, second || 0].some(Number.isNaN)) continue;

      const date = new Date(Date.UTC(year, month - 1, day, hour, minute, Math.floor(second || 0)));
      const open = parseFloat(columns[1]);
      const high = parseFloat(columns[2]);
      const low = parseFloat(columns[3]);
      const close = parseFloat(columns[4]);
      const volumeValue = columns[5] === undefined ? NaN : parseFloat(columns[5]);
      if (isNaN(date.getTime()) || [open, high, low, close].some(Number.isNaN)) continue;

      parsedData.push({
        date,
        open,
        high,
        low,
        close,
        volume: isNaN(volumeValue) ? undefined : volumeValue,
        wick: [low, high],
      });
    }

    if (parsedData.length === 0) {
      workerContext.postMessage({ error: 'No valid data rows were parsed from the file.' });
      return;
    }

    parsedData.sort((left, right) => left.date.getTime() - right.date.getTime());
    workerContext.postMessage({ data: parsedData, candidateTimes: findCandidateTimes(parsedData) });
  } catch (error) {
    workerContext.postMessage({ error: error instanceof Error ? error.message : 'Could not parse the CSV file.' });
  }
};