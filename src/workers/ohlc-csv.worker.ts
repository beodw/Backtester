import type { PriceData } from '@/types';

const workerContext = self as unknown as {
  onmessage: ((event: MessageEvent<string>) => void) | null;
  postMessage: (message: { data?: PriceData[]; error?: string }) => void;
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
    workerContext.postMessage({ data: parsedData });
  } catch (error) {
    workerContext.postMessage({ error: error instanceof Error ? error.message : 'Could not parse the CSV file.' });
  }
};