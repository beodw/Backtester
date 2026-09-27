import type { PriceData } from '@/types';

export const findClosestIndex = (data: PriceData[], timestamp: number): number => {
    if (!data || data.length === 0) return 0;
    return data.reduce((prev, curr, index) => {
        const prevDiff = Math.abs(data[prev].date.getTime() - timestamp);
        const currDiff = Math.abs(curr.date.getTime() - timestamp);
        return currDiff < prevDiff ? index : prev;
    }, 0);
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
