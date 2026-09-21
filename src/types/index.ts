
export interface PriceData {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  wick: [number, number];
}

// Added to fix a type error in InteractiveChart
export interface Trade {
    id: string;
    entryDate: Date;
    entryPrice: number;
    type: 'win' | 'loss';
}

export interface RiskRewardTool {
  id: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  entryDate: Date;
  widthInPoints: number;
  position: 'long' | 'short';
  discretionaryExitDate?: Date; // New field for discretionary exit review
}

export interface PriceMarker {
  id: string;
  price: number;
  label?: string;
  isDeletable?: boolean;
}

export interface OpeningRange {
  high: number;
  low: number;
}

export interface MeasurementPoint {
  index: number;
  price: number;
}

export interface MeasurementTool {
  id: string;
  startPoint: MeasurementPoint;
  endPoint: MeasurementPoint;
}

export interface JournalTrade {
  pair: string;
  dateTaken: Date;
  dateClosed: Date;
  maxR: number;
  status: 'traded' | 'not traded' | 'default';
  originalRow: string[]; // To preserve the original CSV row data
  originalOutcome: 'Win' | 'Loss';
  outcome: 'Win' | 'Loss';
}
