import type { PriceData } from '@/types';

export const findClosestIndex = (data: PriceData[], timestamp: number): number => {
    if (!data || data.length === 0) return 0;
  let low = 0;
  let high = data.length - 1;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (data[middle].date.getTime() < timestamp) low = middle + 1;
    else high = middle;
  }

  if (low === 0) return 0;
  const before = low - 1;
  return timestamp - data[before].date.getTime() <= data[low].date.getTime() - timestamp ? before : low;
};

export const findFirstIndexAtOrAfter = (data: PriceData[], timestamp: number): number => {
  let low = 0;
  let high = data.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (data[middle].date.getTime() < timestamp) low = middle + 1;
    else high = middle;
  }

  return low;
};

export const getTypicalCandleInterval = (data: PriceData[]): number => {
  const intervals: number[] = [];
  const startIndex = Math.max(1, data.length - 100);
  for (let index = startIndex; index < data.length; index++) {
    const interval = data[index].date.getTime() - data[index - 1].date.getTime();
    if (interval > 0) intervals.push(interval);
  }
  if (intervals.length === 0) return 60000;
  intervals.sort((left, right) => left - right);
  return intervals[Math.floor(intervals.length / 2)];
};

export function calculateEMA(data: PriceData[], period: number): (number | null)[] {
  if (!data || data.length === 0) return [];
  if (data.length < period) return new Array(data.length).fill(null);

  const ema: (number | null)[] = new Array(data.length).fill(null);
  const k = 2 / (period + 1);

  // Simple Moving Average for the first period to seed the EMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i].close;
  }
  let prevEma = sum / period;
  ema[period - 1] = prevEma;

  for (let i = period; i < data.length; i++) {
    const currentEma = (data[i].close - prevEma) * k + prevEma;
    ema[i] = currentEma;
    prevEma = currentEma;
  }

  return ema;
}
