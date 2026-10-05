export interface Ohlc {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface TimedOhlc extends Ohlc {
  timestamp: number;
}

export interface AggregatedOhlc extends Ohlc {
  firstTimestamp: number;
  lastTimestamp: number;
}

export interface PairedCandle {
  timestamp: number;
  bid: Ohlc;
  ask?: Ohlc;
}

export interface AutomatedOrbTrade {
  id: string;
  date: string;
  entryTime: number;
  exitTime: number | null;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  position: 'long' | 'short';
  realizedR: number;
  fullyClosed: boolean;
  premarketHigh: number;
  premarketLow: number;
}

export interface AutomatedOrbResult {
  candles: PairedCandle[];
  trades: AutomatedOrbTrade[];
  premarketByDate: Record<string, { high: number; low: number }>;
}

const HOUR_MS = 60 * 60 * 1000;
const NEW_YORK_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const NEW_YORK_OFFSET_BY_UTC_HOUR = new Map<number, number>();

const newYorkParts = (timestamp: number): Record<string, number> => {
  const utcHour = Math.floor(timestamp / HOUR_MS) * HOUR_MS;
  let offset = NEW_YORK_OFFSET_BY_UTC_HOUR.get(utcHour);
  if (offset === undefined) {
    const formattedParts = Object.fromEntries(
      NEW_YORK_TIME.formatToParts(new Date(utcHour))
        .filter(part => part.type !== 'literal')
        .map(part => [part.type, Number(part.value)]),
    );
    offset = Date.UTC(
      formattedParts.year,
      formattedParts.month - 1,
      formattedParts.day,
      formattedParts.hour,
      formattedParts.minute,
    ) - utcHour;
    NEW_YORK_OFFSET_BY_UTC_HOUR.set(utcHour, offset);
  }

  const local = new Date(timestamp + offset);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
  };
};

const dateKey = (year: number, month: number, day: number): string =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const previousDateKey = (year: number, month: number, day: number): string => {
  const previous = new Date(Date.UTC(year, month - 1, day - 1));
  return dateKey(previous.getUTCFullYear(), previous.getUTCMonth() + 1, previous.getUTCDate());
};

const newYorkWallTimeToUtc = (key: string, hour: number, minute: number): number => {
  const [year, month, day] = key.split('-').map(Number);
  const wallTimeAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let timestamp = wallTimeAsUtc;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = newYorkParts(timestamp);
    const formattedWallTimeAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
    );
    const correctedTimestamp = timestamp + wallTimeAsUtc - formattedWallTimeAsUtc;
    if (correctedTimestamp === timestamp) break;
    timestamp = correctedTimestamp;
  }
  return timestamp;
};

export const getNewYorkDateKey = (timestamp: number): string => {
  const parts = newYorkParts(timestamp);
  return dateKey(parts.year, parts.month, parts.day);
};

const getHourlyBucketStart = (timestamp: number): number => {
  const parts = newYorkParts(timestamp);
  const localMinute = parts.hour * 60 + parts.minute;
  const anchorDate = localMinute < 270
    ? previousDateKey(parts.year, parts.month, parts.day)
    : dateKey(parts.year, parts.month, parts.day);
  const anchorTimestamp = newYorkWallTimeToUtc(anchorDate, 4, 30);
  return anchorTimestamp + Math.floor((timestamp - anchorTimestamp) / HOUR_MS) * HOUR_MS;
};

export async function aggregateM1Rows(
  rows: AsyncIterable<TimedOhlc>,
): Promise<Map<number, AggregatedOhlc>> {
  const bars = new Map<number, AggregatedOhlc>();

  for await (const row of rows) {
    const bucket = getHourlyBucketStart(row.timestamp);
    const current = bars.get(bucket);
    if (!current) {
      bars.set(bucket, {
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        firstTimestamp: row.timestamp,
        lastTimestamp: row.timestamp,
      });
      continue;
    }

    current.high = Math.max(current.high, row.high);
    current.low = Math.min(current.low, row.low);
    if (row.timestamp < current.firstTimestamp) {
      current.open = row.open;
      current.firstTimestamp = row.timestamp;
    }
    if (row.timestamp >= current.lastTimestamp) {
      current.close = row.close;
      current.lastTimestamp = row.timestamp;
    }
  }

  return bars;
}

export const mergeAggregatedBars = (
  target: Map<number, AggregatedOhlc>,
  incoming: Map<number, AggregatedOhlc>,
): void => {
  for (const [bucket, bar] of incoming) {
    const current = target.get(bucket);
    if (!current) {
      target.set(bucket, { ...bar });
      continue;
    }

    current.high = Math.max(current.high, bar.high);
    current.low = Math.min(current.low, bar.low);
    if (bar.firstTimestamp < current.firstTimestamp) {
      current.firstTimestamp = bar.firstTimestamp;
      current.open = bar.open;
    }
    if (bar.lastTimestamp > current.lastTimestamp) {
      current.lastTimestamp = bar.lastTimestamp;
      current.close = bar.close;
    }
  }
};

export const makePairedCandles = (
  bidBars: Map<number, AggregatedOhlc>,
  askBars: Map<number, AggregatedOhlc>,
): PairedCandle[] => {
  return Array.from(bidBars.entries())
    .sort(([left], [right]) => left - right)
    .map(([bucket, bid]) => ({
      timestamp: bucket + HOUR_MS,
      bid,
      ask: askBars.get(bucket),
    }));
};

export function runAutomatedOrb(
  candles: PairedCandle[],
  rrTarget: number,
  startYear: number,
  endYear: number,
): AutomatedOrbResult {
  const candlesByDate = new Map<string, PairedCandle[]>();
  for (const candle of candles) {
    const date = getNewYorkDateKey(candle.timestamp);
    const year = Number(date.slice(0, 4));
    if (year < startYear || year > endYear) continue;
    const dayCandles = candlesByDate.get(date) ?? [];
    dayCandles.push(candle);
    candlesByDate.set(date, dayCandles);
  }

  const premarketByDate: AutomatedOrbResult['premarketByDate'] = {};
  const trades: AutomatedOrbTrade[] = [];

  for (const [date, dayCandles] of candlesByDate) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;

    const premarket = dayCandles.filter(candle => {
      const parts = newYorkParts(candle.timestamp);
      const minute = parts.hour * 60 + parts.minute;
      return minute > 270 && minute <= 570;
    });
    if (premarket.length === 0) continue;

    const premarketHigh = Math.max(...premarket.map(candle => candle.bid.high));
    const premarketLow = Math.min(...premarket.map(candle => candle.bid.low));
    premarketByDate[date] = { high: premarketHigh, low: premarketLow };

    const breakout = dayCandles.find(candle => {
      const parts = newYorkParts(candle.timestamp);
      const minute = parts.hour * 60 + parts.minute;
      return minute > 570 && minute <= 660 &&
        (candle.bid.close > premarketHigh || candle.bid.close < premarketLow);
    });
    if (!breakout) continue;

    const position = breakout.bid.close > premarketHigh ? 'long' : 'short';
    const entryPrice = breakout.bid.close;
    const stopLoss = position === 'long' ? premarketLow : premarketHigh;
    const riskDistance = Math.abs(entryPrice - stopLoss);
    if (!Number.isFinite(riskDistance) || riskDistance <= 0) continue;

    const takeProfit = entryPrice + (position === 'long' ? 1 : -1) * rrTarget * riskDistance;
    const exitClose = (candle: PairedCandle): number =>
      position === 'long' ? candle.bid.close : (candle.ask?.close ?? candle.bid.close);
    const exit = candles.find(candle => {
      if (candle.timestamp <= breakout.timestamp) return false;
      const close = exitClose(candle);
      return position === 'long'
        ? close <= stopLoss || close >= takeProfit
        : close >= stopLoss || close <= takeProfit;
    });
    const fullyClosed = exit !== undefined;
    const realizedR = exit
      ? ((exitClose(exit) - entryPrice) / riskDistance) * (position === 'long' ? 1 : -1)
      : 0;

    trades.push({
      id: `${date}-${breakout.timestamp}`,
      date,
      entryTime: breakout.timestamp,
      exitTime: exit?.timestamp ?? null,
      entryPrice,
      stopLoss,
      takeProfit,
      position,
      realizedR,
      fullyClosed,
      premarketHigh,
      premarketLow,
    });
  }

  return { candles, trades, premarketByDate };
}