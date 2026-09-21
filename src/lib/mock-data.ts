import type { PriceData } from '@/types';

function generateMockPriceData(numPoints = 5000): PriceData[] {
  const data: PriceData[] = [];
  let lastClose = 100;
  
  // Start date calculation to end roughly "now"
  const startDate = new Date();
  startDate.setMinutes(startDate.getMinutes() - numPoints);

  for (let i = 0; i < numPoints; i++) {
    const date = new Date(startDate);
    date.setMinutes(date.getMinutes() + i);

    const open = lastClose + (Math.random() - 0.5) * 0.2; // Smaller moves for 1m timeframe
    const volatility = Math.random() * 0.5 + 0.1;
    const close = open + (Math.random() - 0.5) * volatility;
    
    const high = Math.max(open, close) + Math.random() * 0.1;
    const low = Math.min(open, close) - Math.random() * 0.1;

    data.push({
      date,
      open,
      high,
      low,
      close,
      wick: [low, high],
    });

    lastClose = close;
  }
  return data;
}

export const mockPriceData = generateMockPriceData(525600);
