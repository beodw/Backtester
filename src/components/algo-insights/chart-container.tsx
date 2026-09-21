
"use client";

import { useState, useEffect, useRef } from "react";
import { Download, ArrowUp, ArrowDown, Settings, Calendar as CalendarIcon, ChevronRight, ChevronsRight, Target, Trash2, FileUp, Lock, Unlock, Ruler, FileBarChart, Undo, Redo, GripVertical, BookOpen, ThumbsUp, ThumbsDown, FileDown, Forward, FastForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InteractiveChart, type ChartClickData } from "@/components/algo-insights/interactive-chart";
import { mockPriceData } from "@/lib/mock-data";
import type { RiskRewardTool as RRToolType, PriceMarker, MeasurementTool as MeasurementToolType, MeasurementPoint, PriceData, JournalTrade, OpeningRange } from "@/types";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";


type TradeLogEntry = {
    TradeID: string;
    Timestamp: string;
    CandleNumber: number;
    EntryPrice: number;
    StopLossPrice: number;
    CurrentPrice_Open: number;
    CurrentPrice_High: number;
    CurrentPrice_Low: number;
    CurrentPrice_Close: number;
    MFE_R: number;
    MAE_R: number;
    DrawdownFromMFE_R: number;
    'Trade Status': 'Active' | 'StopLoss' | 'EndOfData';
    DiscretionaryClose: boolean;
};


type DrawingState = {
    rrTools: RRToolType[];
    priceMarkers: PriceMarker[];
    measurementTools: MeasurementToolType[];
};

type SessionState = {
    drawingState: DrawingState;
    selectedDate: string; // Stored as ISO string
    fileName: string;
    askFileName: string;
    journalFileName: string;
    journalTrades: JournalTrade[];
    selectedPair: string;
};

type DayResult = 'win' | 'loss' | 'modified';

const formatDateForCsvTimestamp = (date: Date): string => {
    if (!date) return '';
    return date.toISOString();
};

const getTimeframeMinutes = (timeframe: string): number => {
    switch (timeframe) {
        case '5m': return 5;
        case '15m': return 15;
        case '30m': return 30;
        case '1H': return 60;
        case '4H': return 240;
        case '1D': return 1440;
        default: return 1;
    }
};


const generateTradeLog = (
    tool: RRToolType,
    priceData: PriceData[],
    timeframe: string,
): TradeLogEntry[] => {
    const log: TradeLogEntry[] = [];
    const entryIndex = priceData.findIndex(p => p.date.getTime() >= tool.entryDate.getTime());

    if (entryIndex === -1) return [];
    
    const tradeID = formatDateForCsvTimestamp(tool.entryDate);
    const riskInPrice = Math.abs(tool.entryPrice - tool.stopLoss);
    if (riskInPrice <= 0) return [];
    
    let maePointer = tool.entryPrice;
    let mfePrice = tool.entryPrice;

    for (let i = entryIndex; i < priceData.length; i++) {
        const candle = priceData[i];
        let tradeStatus: 'Active' | 'StopLoss' | 'EndOfData' = 'Active';
        const intervalMs = getTimeframeMinutes(timeframe) * 60 * 1000;
        const candleBucket = Math.floor(candle.date.getTime() / intervalMs);
        const nextCandleBucket = i + 1 < priceData.length
            ? Math.floor(priceData[i + 1].date.getTime() / intervalMs)
            : candleBucket;
        const isTimeframeClose = timeframe === '1m' || candleBucket !== nextCandleBucket;

        if (isTimeframeClose && ((tool.position === 'long' && candle.close <= tool.stopLoss) || (tool.position === 'short' && candle.close >= tool.stopLoss))) {
            tradeStatus = 'StopLoss';
        } else if (i === priceData.length - 1) {
             tradeStatus = 'EndOfData';
        }

        if (tool.position === 'long') {
            mfePrice = Math.max(mfePrice, candle.high);
        } else { // Short position
            mfePrice = Math.min(mfePrice, candle.low);
        }
        
        let currentMaePointer = maePointer;
        if (tradeStatus === 'StopLoss') {
            // Cap MAE at stop loss price
            currentMaePointer = tool.stopLoss;
        } else {
            if (tool.position === 'long') {
                currentMaePointer = Math.min(maePointer, candle.low);
            } else {
                currentMaePointer = Math.max(maePointer, candle.high);
            }
        }
        maePointer = currentMaePointer;
        
        const mfePriceMove = Math.abs(mfePrice - tool.entryPrice);
        const mfeR = mfePriceMove / riskInPrice;

        const maePriceMove = Math.abs(maePointer - tool.entryPrice);
        const maeR = Math.min(1, maePriceMove / riskInPrice);
        
        const drawdownPriceMove = Math.abs(mfePrice - candle.close);
        const drawdownFromMfeR = drawdownPriceMove / riskInPrice;

        const isDiscretionaryClose = !!tool.discretionaryExitDate && 
            candle.date.getTime() === tool.discretionaryExitDate.getTime();

        log.push({
            TradeID: tradeID,
            Timestamp: formatDateForCsvTimestamp(candle.date),
            CandleNumber: i - entryIndex + 1,
            EntryPrice: tool.entryPrice,
            StopLossPrice: tool.stopLoss,
            CurrentPrice_Open: candle.open,
            CurrentPrice_High: candle.high,
            CurrentPrice_Low: candle.low,
            CurrentPrice_Close: candle.close,
            MFE_R: parseFloat(mfeR.toFixed(4)),
            MAE_R: parseFloat(maeR.toFixed(4)),
            DrawdownFromMFE_R: parseFloat(drawdownFromMfeR.toFixed(4)),
            'Trade Status': tradeStatus,
            DiscretionaryClose: isDiscretionaryClose,
        });

        if (tradeStatus !== 'Active') {
            break; 
        }
    }

    return log;
};


const fillGapsInData = (data: PriceData[]): PriceData[] => {
    if (data.length < 2) {
        return data;
    }

    const processedData: PriceData[] = [data[0]];
    const oneMinute = 60 * 1000;

    for (let i = 1; i < data.length; i++) {
        const prevPoint = processedData[processedData.length - 1];
        const currentPoint = data[i];

        const timeDiff = currentPoint.date.getTime() - prevPoint.date.getTime();

        if (timeDiff > oneMinute) {
            const gapsToFill = Math.floor(timeDiff / oneMinute) - 1;
            const fillPrice = prevPoint.close;

            for (let j = 1; j <= gapsToFill; j++) {
                const gapDate = new Date(prevPoint.date.getTime() + j * oneMinute);
                processedData.push({
                    date: gapDate,
                    open: fillPrice,
                    high: fillPrice,
                    low: fillPrice,
                    close: fillPrice,
                    wick: [fillPrice, fillPrice],
                });
            }
        }
        processedData.push(currentPoint);
    }
    return processedData;
};

type ToolbarPositions = {
  main: { x: number, y: number };
  secondary: { x: number, y: number };
};

// Local storage keys
const APP_SETTINGS_KEY = 'algo-insights-settings';
const SESSION_KEY_PREFIX = 'algo-insights-session-'; 
const TOOLBAR_POS_KEY = 'algo-insights-toolbar-positions';

const JOURNAL_PAIRS = ["US30", "JPN225", "HKG40", "US100"];

export function ChartContainer({ tab }: { tab: 'backtester' | 'journal' }) {
  const [priceData, setPriceData] = useState<PriceData[]>(mockPriceData);
  const [isDataImported, setIsDataImported] = useState(false);
  const [fileName, setFileName] = useState('');
  
  const [askPriceData, setAskPriceData] = useState<PriceData[]>([]);
  const [isAskDataImported, setIsAskDataImported] = useState(false);
  const [askFileName, setAskFileName] = useState('');

  const [drawingState, setDrawingState] = useState<DrawingState>({
    rrTools: [],
    priceMarkers: [],
    measurementTools: []
  });

  const [history, setHistory] = useState<DrawingState[]>([]);
  const [redoStack, setRedoStack] = useState<DrawingState[]>([]);
  
  const [toolbarPositions, setToolbarPositions] = useState<ToolbarPositions>({
    main: { x: 16, y: 16 },
    secondary: { x: 16, y: 88 }
  });
  const dragInfo = useRef<{
    target: 'main' | 'secondary' | null;
    offsetX: number;
    offsetY: number;
  }>({ target: null, offsetX: 0, offsetY: 0 });

  // Journal specific state
  const [allJournalTrades, setAllJournalTrades] = useState<JournalTrade[]>([]);
  const [journalTrades, setJournalTrades] = useState<JournalTrade[]>([]);
  const [selectedPair, setSelectedPair] = useState<string>("US30");
  const [journalFileName, setJournalFileName] = useState('');
  const [dayResults, setDayResults] = useState<Record<string, DayResult>>({});
  const journalFileInputRef = useRef<HTMLInputElement>(null);
  const [journalHeader, setJournalHeader] = useState<string[]>([]);
  const [openingRange, setOpeningRange] = useState<OpeningRange | null>(null);

  // Backtester stepping state
  const [backtestEndDate, setBacktestEndDate] = useState<Date | undefined>(undefined);

  // Selection state for discretionary exit
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [isPickingExit, setIsPickingExit] = useState(false);


  const { rrTools, priceMarkers, measurementTools } = drawingState;

  const pushToHistory = (currentState: DrawingState) => {
    setHistory(prev => [...prev, currentState]);
    setRedoStack([]); // Clear redo stack on new action
  };

  const setRrTools = (updater: (prev: RRToolType[]) => RRToolType[]) => {
    pushToHistory(drawingState);
    setDrawingState(prev => ({ ...prev, rrTools: updater(prev.rrTools) }));
  };

  const setPriceMarkers = (updater: (prev: PriceMarker[]) => PriceMarker[]) => {
    pushToHistory(drawingState);
    setDrawingState(prev => ({ ...prev, priceMarkers: updater(prev.priceMarkers) }));
  };
  
  const setMeasurementTools = (updater: (prev: MeasurementToolType[]) => MeasurementToolType[]) => {
    pushToHistory(drawingState);
    setDrawingState(prev => ({ ...prev, measurementTools: updater(prev.measurementTools) }));
  };
  
  const handleUndo = () => {
    if (history.length === 0) return;
    const lastState = history[history.length - 1];
    setRedoStack(prev => [drawingState, ...prev]);
    setHistory(prev => prev.slice(0, prev.length - 1));
    setDrawingState(lastState);
  };
  
  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const nextState = redoStack[0];
    setHistory(prev => [...prev, drawingState]);
    setRedoStack(prev => prev.slice(1));
    setDrawingState(nextState);
  };

  const [placingToolType, setPlacingToolType] = useState<'long' | 'short' | null>(null);
  const [isPlacingPriceMarker, setIsPlacingPriceMarker] = useState(false);
  const [isPlacingMeasurement, setIsPlacingMeasurement] = useState(false);
  const [measurementStartPoint, setMeasurementStartPoint] = useState<MeasurementPoint | null>(null);
  const [liveMeasurementTool, setLiveMeasurementTool] = useState<MeasurementToolType | null>(null);

  const [timeframe, setTimeframe] = useState('1m');
  const [timeZone, setTimeZone] = useState<string>('');
  const [timezones, setTimezones] = useState<{ value: string; label: string }[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [sessionStartTime, setSessionStartTime] = useState('09:30');
  const [isYAxisLocked, setIsYAxisLocked] = useState(true);
  const [pipValue, setPipValue] = useState(0.0001);
  const [emaPeriod, setEmaPeriod] = useState<number | 'none'>('none');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const askFileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [sessionToRestore, setSessionToRestore] = useState<string | null>(null);
  const [openingRangeDuration, setOpeningRangeDuration] = useState('5');
  
  const sessionKey = `${SESSION_KEY_PREFIX}${tab}`;

  useEffect(() => {
    if (!selectedDate || (!isDataImported && tab === 'backtester') || !sessionStartTime || openingRangeDuration === 'none') {
        setOpeningRange(null);
        return;
    }
  
    const dateObj = new Date(selectedDate);
    if (isNaN(dateObj.getTime())) {
        setOpeningRange(null);
        return;
    }

    const [startHour, startMinute] = sessionStartTime.split(':').map(Number);
    const durationInMinutes = parseInt(openingRangeDuration, 10);
    
    const sessionStart = new Date(dateObj);
    sessionStart.setUTCFullYear(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), dateObj.getUTCDate());
    sessionStart.setUTCHours(startHour, startMinute, 0, 0);
    
    const sessionEnd = new Date(sessionStart.getTime() + durationInMinutes * 60 * 1000);
    
    const rangeCandles = priceData.filter(p => 
        p.date.getTime() >= sessionStart.getTime() && p.date.getTime() <= sessionEnd.getTime()
    );

    if (rangeCandles.length > 0) {
        let high = -Infinity;
        let low = Infinity;
        rangeCandles.forEach(candle => {
            if (candle.high > high) high = candle.high;
            if (candle.low < low) low = candle.low;
        });
        setOpeningRange({ high, low });
    } else {
        setOpeningRange(null);
    }
  }, [selectedDate, priceData, sessionStartTime, isDataImported, tab, openingRangeDuration]);


  useEffect(() => {
    const getOffsetInMinutes = (timeZone: string): number => {
        try {
            const now = new Date();
            const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
            const tzDate = new Date(now.toLocaleString('en-US', { timeZone }));
            return (tzDate.getTime() - utcDate.getTime()) / 60000;
        } catch (e) {
            return NaN;
        }
    };

    const tzData = Intl.supportedValuesOf('timeZone')
        .map(tz => {
            const offset = getOffsetInMinutes(tz);
            if (isNaN(offset)) return null;
            const offsetHours = Math.floor(Math.abs(offset) / 60);
            const offsetMinutes = Math.abs(offset) % 60;
            const sign = offset >= 0 ? '+' : '-';
            const offsetString = `(UTC${sign}${String(offsetHours).padStart(2, '0')}:${String(offsetMinutes).padStart(2, '0')})`;
            return { value: tz, label: `${tz.replace(/_/g, ' ')} ${offsetString}`, offset };
        })
        .filter((tz): tz is { value: string; label: string; offset: number; } => tz !== null)
        .sort((a, b) => a.offset - b.offset);
    setTimezones(tzData);

    const savedSettingsRaw = localStorage.getItem(APP_SETTINGS_KEY);
    if (savedSettingsRaw) {
        try {
            const savedSettings = JSON.parse(savedSettingsRaw);
            if (savedSettings.timeZone) setTimeZone(savedSettings.timeZone);
            if (savedSettings.sessionStartTime) setSessionStartTime(savedSettings.sessionStartTime);
            if (savedSettings.pipValue) setPipValue(savedSettings.pipValue);
            if (savedSettings.openingRangeDuration) setOpeningRangeDuration(savedSettings.openingRangeDuration);
            if (savedSettings.emaPeriod) setEmaPeriod(savedSettings.emaPeriod);
        } catch (e) {
            console.error("Failed to parse app settings from localStorage", e);
            setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
        }
    } else {
        setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    }
    
    const savedSessionRaw = localStorage.getItem(sessionKey);
    if (savedSessionRaw) {
        try {
            const savedSession: SessionState = JSON.parse(savedSessionRaw);
            if (savedSession.fileName || (savedSession.journalTrades && savedSession.journalTrades.length > 0) || savedSession.askFileName) {
                setSessionToRestore(savedSession.fileName || savedSession.askFileName || savedSession.journalFileName);
                setShowRestoreDialog(true);
            }
        } catch (e) {
            console.error("Failed to parse session from localStorage", e);
            localStorage.removeItem(sessionKey);
        }
    }
    
    const savedToolbarPosRaw = localStorage.getItem(TOOLBAR_POS_KEY);
    if (savedToolbarPosRaw) {
        try {
            const savedPos: ToolbarPositions = JSON.parse(savedToolbarPosRaw);
            setToolbarPositions(savedPos);
        } catch (e) {
            console.error("Failed to parse toolbar positions from localStorage", e);
        }
    }

  }, [sessionKey]);

  useEffect(() => {
    const settings = { timeZone, sessionStartTime, pipValue, openingRangeDuration, emaPeriod };
    localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings));
  }, [timeZone, sessionStartTime, pipValue, openingRangeDuration, emaPeriod]);

  useEffect(() => {
    const shouldSave = isDataImported || isAskDataImported || allJournalTrades.length > 0 || rrTools.length > 0 || priceMarkers.length > 0 || measurementTools.length > 0;
    if (!shouldSave) {
        return;
    }
    
    const serializableDrawingState = {
        ...drawingState,
        rrTools: drawingState.rrTools.map(tool => ({
            ...tool,
            entryDate: tool.entryDate.toISOString(),
            discretionaryExitDate: tool.discretionaryExitDate?.toISOString()
        })),
    };

    const serializableJournalTrades = allJournalTrades.map(trade => ({
        ...trade,
        dateTaken: trade.dateTaken.toISOString(),
        dateClosed: trade.dateClosed.toISOString(),
    }));

    const sessionState: SessionState = {
        drawingState: serializableDrawingState as any,
        selectedDate: selectedDate ? selectedDate.toISOString() : new Date().toISOString(),
        fileName,
        askFileName,
        journalFileName,
        journalTrades: serializableJournalTrades as any,
        selectedPair,
    };
    localStorage.setItem(sessionKey, JSON.stringify(sessionState));

  }, [drawingState, selectedDate, fileName, askFileName, isDataImported, isAskDataImported, sessionKey, allJournalTrades, journalFileName, selectedPair]);
  
  useEffect(() => {
    if(tab === 'journal') {
      const filtered = allJournalTrades.filter(t => t.pair === selectedPair);
      setJournalTrades(filtered);
    }
  }, [allJournalTrades, selectedPair, tab]);


  const handleRestoreSession = () => {
    setShowRestoreDialog(false);
    const savedSessionRaw = localStorage.getItem(sessionKey);
    if (savedSessionRaw) {
        try {
            const savedSession: SessionState = JSON.parse(savedSessionRaw);

            const restoredRrTools = savedSession.drawingState.rrTools.map(tool => ({
                ...tool,
                entryDate: new Date(tool.entryDate),
                discretionaryExitDate: tool.discretionaryExitDate ? new Date(tool.discretionaryExitDate) : undefined
            }));

            const restoredDrawingState = {
                ...savedSession.drawingState,
                rrTools: restoredRrTools,
            };

            const restoredJournalTrades = (savedSession.journalTrades || []).map(trade => ({
                ...trade,
                dateTaken: new Date(trade.dateTaken),
                dateClosed: new Date(trade.dateClosed),
            }));

            setDrawingState(restoredDrawingState);
            setAllJournalTrades(restoredJournalTrades);

            if (savedSession.selectedDate) {
                const date = new Date(savedSession.selectedDate);
                if (!isNaN(date.getTime())) {
                    setSelectedDate(date);
                } else {
                    setSelectedDate(new Date());
                }
            }
            
            setFileName(savedSession.fileName);
            setAskFileName(savedSession.askFileName || '');
            setJournalFileName(savedSession.journalFileName || '');
            if (savedSession.selectedPair) setSelectedPair(savedSession.selectedPair);
            
            if (tab === 'journal' && restoredJournalTrades.length > 0) {
                const firstValidPair = restoredJournalTrades.find(t => t.pair)?.pair || JOURNAL_PAIRS[0];
                const restoredPair = savedSession.selectedPair || firstValidPair;
                const filtered = restoredJournalTrades.filter(t => t.pair === restoredPair);
                setJournalTrades(filtered);
                processJournalTrades(restoredJournalTrades);
            }
            
            setPriceData(mockPriceData);
            setIsDataImported(false);
            setAskPriceData([]);
            setIsAskDataImported(false);

            toast({
                title: "Session Restored",
                description: `Drawings and settings loaded. Please re-import necessary files to see the chart data.`,
                duration: 9000
            });
        } catch (e) {
            console.error("Failed to restore session", e);
            toast({ variant: "destructive", title: "Restore Failed", description: "Could not restore session from storage." });
            handleDeclineRestore();
        }
    }
  };

  const handleDeclineRestore = () => {
      setShowRestoreDialog(false);
      localStorage.removeItem(sessionKey);
      setDrawingState({ rrTools: [], priceMarkers: [], measurementTools: [] });
      setHistory([]);
      setRedoStack([]);
      setFileName('');
      setAskFileName('');
      setJournalFileName('');
      setAllJournalTrades([]);
      setJournalTrades([]);
      setDayResults({});
      setIsDataImported(false);
      setIsAskDataImported(false);
      setPriceData(mockPriceData);
      setAskPriceData([]);
      setBacktestEndDate(undefined);
      setSelectedToolId(null);
      setIsPickingExit(false);
  };


  const handleChartClick = (chartData: ChartClickData) => {
    if (isPickingExit && selectedToolId) {
        const activeTool = rrTools.find(t => t.id === selectedToolId);
        if (activeTool) {
            // Safety check: Exit must be at or after entry
            if (chartData.date.getTime() < activeTool.entryDate.getTime()) {
                toast({ variant: "destructive", title: "Invalid Exit", description: "Discretionary exit cannot be before the entry candle." });
                return;
            }
            
            if (activeTool.position === 'short' && !isAskDataImported) {
                toast({ variant: "default", title: "Ask Data Recommended", description: "For Shorts, Ask price is used for exit calculations. Please import Ask data for full accuracy." });
            }

            // The chart returns the start timestamp of the candle (e.g. M15 start).
            // We need to target the actual M1 close timestamp.
            let exitTimestamp = chartData.date;
            if (timeframe !== '1m') {
                const intervalMs = timeframe === '5m' ? 5 * 60000 : (timeframe === '15m' ? 15 * 60000 : 0);
                if (intervalMs > 0) {
                    exitTimestamp = new Date(chartData.date.getTime() + intervalMs - 60000);
                }
            }

            const updatedTool = { ...activeTool, discretionaryExitDate: exitTimestamp };
            handleUpdateTool(updatedTool);
            setIsPickingExit(false);
            toast({ title: "Exit Marked", description: `Discretionary close point set at ${exitTimestamp.toLocaleTimeString()}.` });
        }
        return;
    }

    if (placingToolType) {
      const entryPrice = chartData.closePrice;
      
      const visiblePriceRange = chartData.yDomain[1] - chartData.yDomain[0];
      const stopLossOffset = visiblePriceRange * 0.05; // 5% of visible height for stop
      const takeProfitOffset = visiblePriceRange * 0.10; // 10% of visible height for profit (1:2 RR)

      const stopLoss = placingToolType === 'long' ? entryPrice - stopLossOffset : entryPrice + stopLossOffset;
      const takeProfit = placingToolType === 'long' ? entryPrice + takeProfitOffset : entryPrice - takeProfitOffset;
      
      const visibleIndexRange = chartData.xDomain[1] - chartData.xDomain[0];
      const widthInPoints = Math.round(visibleIndexRange * 0.25);

      const newTool: RRToolType = {
        id: `rr-${Date.now()}`,
        entryPrice: entryPrice,
        stopLoss: stopLoss,
        takeProfit: takeProfit,
        entryDate: chartData.date,
        widthInPoints: widthInPoints,
        position: placingToolType,
      };
      
      setRrTools(prevTools => [...prevTools, newTool]);
      setPlacingToolType(null);
    } else if (isPlacingPriceMarker) {
      const newMarker: PriceMarker = {
        id: `pm-${Date.now()}`,
        price: chartData.price,
        isDeletable: true,
      };
      setPriceMarkers(prev => [...prev, newMarker]);
      setIsPlacingPriceMarker(false);
    } else if (isPlacingMeasurement) {
      const { price, dataIndex, candle } = chartData;

      // Snapping logic
      const bodyTop = Math.max(candle.open, candle.close);
      const bodyBottom = Math.min(candle.open, candle.close);
      const snappedPrice = (price >= bodyBottom && price <= bodyTop) ? candle.open : price;

      const currentPoint = {
          index: dataIndex,
          price: snappedPrice,
      };

      if (!measurementStartPoint) {
          setMeasurementStartPoint(currentPoint);
          setLiveMeasurementTool({
              id: 'live-measure',
              startPoint: currentPoint,
              endPoint: currentPoint,
          });
      } else {
          const newTool: MeasurementToolType = {
              id: `measure-${Date.now()}`,
              startPoint: measurementStartPoint,
              endPoint: currentPoint,
          };
          setMeasurementTools(prev => [...prev, newTool]);
          setMeasurementStartPoint(null);
          setIsPlacingMeasurement(false);
          setLiveMeasurementTool(null);
      }
    }
  };

    const handleChartMouseMove = (chartData: ChartClickData) => {
        if (isPlacingMeasurement && measurementStartPoint) {
            const { price, dataIndex, candle } = chartData;
            
            const bodyTop = Math.max(candle.open, candle.close);
            const bodyBottom = Math.min(candle.open, candle.close);
            const snappedPrice = (price >= bodyBottom && price <= bodyTop) ? candle.open : price;

            const currentPoint = {
                index: dataIndex,
                price: snappedPrice,
            };
            
            setLiveMeasurementTool({
                id: 'live-measure',
                startPoint: measurementStartPoint,
                endPoint: currentPoint,
            });
        }
    };
  
  const handleUpdateTool = (updatedTool: RRToolType) => {
    pushToHistory(drawingState);
    setRrTools(prevTools => prevTools.map(t => t.id === updatedTool.id ? updatedTool : t));
  };

  const handleRemoveTool = (id: string) => {
    pushToHistory(drawingState);
    setRrTools(prevTools => prevTools.filter(t => t.id !== id));
    if (selectedToolId === id) setSelectedToolId(null);
  };

  const handleRemovePriceMarker = (id: string) => {
    pushToHistory(drawingState);
    setPriceMarkers(prevMarkers => prevMarkers.filter(m => m.id !== id));
  };

  const handleRemoveMeasurementTool = (id: string) => {
    pushToHistory(drawingState);
    setMeasurementTools(prev => prev.filter(t => t.id !== id));
  };

  const handleUpdatePriceMarker = (id: string, price: number) => {
    pushToHistory(drawingState);
    setPriceMarkers(prevMarkers => 
      prevMarkers.map(m => 
        m.id === id ? { ...m, price } : m
      )
    );
  };

  const handleClearAllDrawings = () => {
    pushToHistory(drawingState);
    setDrawingState({
        rrTools: [],
        priceMarkers: [],
        measurementTools: []
    });
    setSelectedToolId(null);
    setIsPickingExit(false);
  };

  const handleImportClick = (type: 'bid' | 'ask') => {
      if (type === 'bid') {
          fileInputRef.current?.click();
      } else {
          askFileInputRef.current?.click();
      }
  };
  
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>, type: 'bid' | 'ask') => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    if (type === 'bid') {
        setFileName(file.name);
    } else {
        setAskFileName(file.name);
    }

    const reader = new FileReader();

    reader.onload = (e) => {
        try {
            const text = e.target?.result;
            if (typeof text !== 'string') throw new Error("Could not read file contents.");

            const lines = text.split('\n').filter(line => line.trim() !== '');
            if (lines.length <= 1) throw new Error("CSV is empty or has only a header.");

            const dataRows = lines.slice(1);

            const parsedData: PriceData[] = dataRows.map((row, index) => {
                const columns = row.split(',');
                if (columns.length < 5) {
                    // Skip rows that don't have enough columns, but don't throw an error for the whole file
                    console.warn(`Skipping row ${index + 2}: Not enough columns.`);
                    return null;
                }
                const [localTime, openStr, highStr, lowStr, closeStr] = columns;
                
                if (!localTime || !openStr || !highStr || !lowStr || !closeStr) {
                    console.warn(`Row ${index + 2} has missing columns. Expected at least 5.`);
                    return null;
                }

                const dateTimeString = localTime.trim().replace(' GMT', '');
                const [datePart, timePart] = dateTimeString.split(' ');
                
                if (!datePart || !timePart) {
                    console.warn(`Invalid date format on row ${index + 2}. Found '${localTime}'.`);
                    return null;
                }
                
                const [day, month, year] = datePart.split('.').map(Number);
                const [hour, minute, second] = timePart.split(':').map(Number);
                
                if (isNaN(day) || isNaN(month) || isNaN(year) || isNaN(hour) || isNaN(minute) || isNaN(second || 0)) {
                    console.warn(`Invalid date values on row ${index + 2}. Could not parse: '${localTime}'`);
                    return null;
                }
                const date = new Date(Date.UTC(year, month - 1, day, hour, minute, Math.floor(second || 0)));
                if (isNaN(date.getTime())) {
                    console.warn(`Invalid date on row ${index + 2}. Parsed to an invalid Date object from: '${localTime}'`);
                    return null;
                }

                const open = parseFloat(openStr);
                const high = parseFloat(highStr);
                const low = parseFloat(lowStr);
                const close = parseFloat(closeStr);
                
                if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) {
                    console.warn(`Invalid price data on row ${index + 2}. Check for non-numeric values.`);
                    return null;
                }

                return { date, open, high, low, close, wick: [low, high] };
            }).filter((p): p is PriceData => p !== null);

            if (parsedData.length > 0) {
                parsedData.sort((a, b) => a.date.getTime() - b.date.getTime());
                const processedData = fillGapsInData(parsedData);
                
                if (type === 'bid') {
                    setPriceData(processedData);
                    setIsDataImported(true);
                    if (!selectedDate) {
                        setSelectedDate(processedData[processedData.length - 1].date);
                    }
                } else {
                    setAskPriceData(processedData);
                    setIsAskDataImported(true);
                }
            } else {
                throw new Error("No valid data rows were parsed from the file.");
            }
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "CSV Import Failed",
                description: `Please check the file format. Error: ${error.message}`,
                duration: 9000,
            });
            if (type === 'bid') setIsDataImported(false);
            else setIsAskDataImported(false);
        }
    };

    reader.onerror = () => {
        toast({ variant: "destructive", title: "File Read Error", description: "An error occurred while reading the file." });
        if (type === 'bid') setIsDataImported(false);
        else setIsAskDataImported(false);
    };

    reader.readAsText(file);
    if(type === 'bid' && fileInputRef.current) fileInputRef.current.value = "";
    if(type === 'ask' && askFileInputRef.current) askFileInputRef.current.value = "";
  };


  const handleExportCsv = () => {
      if (rrTools.length === 0 || !isDataImported) {
          toast({ variant: "destructive", title: "Cannot Export", description: "Please import Bid data and place at least one trade tool to generate a report." });
          return;
      }
      
       const shortTradeWithoutAsk = rrTools.some(tool => tool.position === 'short') && !isAskDataImported;
      if (shortTradeWithoutAsk) {
          toast({ variant: "default", title: "Accuracy Warning", description: "Exporting Short trades without Ask data may result in inaccurate exit prices." });
      }

      const headers = ["TradeID", "EntryPrice", "StopLossPrice", "Timestamp", "CandleNumber", "CurrentPrice_Open", "CurrentPrice_High", "CurrentPrice_Low", "CurrentPrice_Close", "MFE_R", "MAE_R", "DrawdownFromMFE_R", "Trade Status", "DiscretionaryClose"].join(',');
      
      toast({ title: "Generating Report...", description: `Processing ${rrTools.length} trades. This may take a moment.` });

      setTimeout(() => {
          try {
              const allLogs = rrTools.flatMap(tool => {
                  const dataSet = tool.position === 'long' ? priceData : askPriceData;
                  // If short and no ask data, fallback to bid data for log generation, but warning was shown
                  const effectiveData = (tool.position === 'short' && !isAskDataImported) ? priceData : dataSet;
                  return generateTradeLog(tool, effectiveData, timeframe);
              });
              
              if (allLogs.length === 0) {
                  toast({ variant: "destructive", title: "Export Failed", description: "No valid trade data could be generated." });
                  return;
              }

              const rows = allLogs.map(logEntry => 
                  [
                    logEntry.TradeID, 
                    logEntry.EntryPrice, 
                    logEntry.StopLossPrice, 
                    logEntry.Timestamp, 
                    logEntry.CandleNumber, 
                    logEntry.CurrentPrice_Open,
                    logEntry.CurrentPrice_High,
                    logEntry.CurrentPrice_Low,
                    logEntry.CurrentPrice_Close, 
                    logEntry.MFE_R, 
                    logEntry.MAE_R, 
                    logEntry.DrawdownFromMFE_R, 
                    logEntry['Trade Status'],
                    logEntry.DiscretionaryClose
                  ].join(',')
              ).join('\n');

              const csvContent = `${headers}\n${rows}`;
              const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
              const link = document.createElement("a");
              const url = URL.createObjectURL(blob);
              link.setAttribute("href", url);
              link.setAttribute("download", "trade_log_report.csv");
              link.style.visibility = 'hidden';
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              toast({ variant: "default", title: "Export Complete", description: "Your detailed trade log has been downloaded." });
          } catch(error: any) {
               toast({ variant: "destructive", title: "Export Error", description: `An unexpected error occurred: ${error.message}` });
          }
      }, 50);
  };
  
    const handlePlaceLong = () => {
    setIsPlacingPriceMarker(false);
    setIsPlacingMeasurement(false);
    setMeasurementStartPoint(null);
    setLiveMeasurementTool(null);
    setPlacingToolType('long');
    setSelectedToolId(null);
  };

  const handlePlaceShort = () => {
    setIsPlacingPriceMarker(false);
    setIsPlacingMeasurement(false);
    setMeasurementStartPoint(null);
    setLiveMeasurementTool(null);
    setPlacingToolType('short');
    setSelectedToolId(null);
  };

  const handlePlaceMarker = () => {
    setPlacingToolType(null);
    setIsPlacingMeasurement(false);
    setMeasurementStartPoint(null);
    setLiveMeasurementTool(null);
    setIsPlacingPriceMarker(true);
    setSelectedToolId(null);
  };

  const handlePlaceMeasurement = () => {
    setPlacingToolType(null);
    setIsPlacingPriceMarker(false);
    setMeasurementStartPoint(null); // Will be set on first click
    setLiveMeasurementTool(null);
    setIsPlacingMeasurement(true);
    setSelectedToolId(null);
  };

  const handleMouseDownOnToolbar = (e: React.MouseEvent, target: 'main' | 'secondary') => {
    if (e.button !== 0) return;
    const targetElement = e.currentTarget as HTMLDivElement;
    const rect = targetElement.getBoundingClientRect();
    dragInfo.current = { target, offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top };
    window.addEventListener('mousemove', handleToolbarMouseMove);
    window.addEventListener('mouseup', handleToolbarMouseUp);
  };

  const handleToolbarMouseMove = (e: MouseEvent) => {
    if (!dragInfo.current.target) return;
    const { target, offsetX, offsetY } = dragInfo.current;
    setToolbarPositions(prev => ({ ...prev, [target]: { x: e.clientX - offsetX, y: e.clientY - offsetY } }));
  };

  const handleToolbarMouseUp = () => {
    if (dragInfo.current.target) localStorage.setItem(TOOLBAR_POS_KEY, JSON.stringify(toolbarPositions));
    dragInfo.current.target = null;
    window.removeEventListener('mousemove', handleToolbarMouseMove);
    window.removeEventListener('mouseup', handleToolbarMouseUp);
  };

  // --- JOURNAL FUNCTIONS ---

  const handleImportJournalClick = () => {
    journalFileInputRef.current?.click();
  };

  const parseCsvWithMultiline = (text: string): string[][] => {
      const rows: string[][] = [];
      let currentRow: string[] = [];
      let currentField = '';
      let inQuotedField = false;
      const normalizedText = text.replace(/(\r\n|\r)/g, '\n');

      for (let i = 0; i < normalizedText.length; i++) {
          const char = normalizedText[i];
          if (inQuotedField) {
              if (char === '"') {
                  if (i + 1 < normalizedText.length && normalizedText[i+1] === '"') {
                      currentField += '"';
                      i++;
                  } else {
                      inQuotedField = false;
                  }
              } else {
                  currentField += char;
              }
          } else {
              if (char === '"') {
                  inQuotedField = true;
              } else if (char === ',') {
                  currentRow.push(currentField);
                  currentField = '';
              } else if (char === '\n') {
                  currentRow.push(currentField);
                  rows.push(currentRow);
                  currentRow = [];
                  currentField = '';
              } else {
                  currentField += char;
              }
          }
      }
      if (currentField || currentRow.length > 0) {
        currentRow.push(currentField);
        rows.push(currentRow);
      }
      return rows.filter(row => row.length > 1 || (row.length === 1 && row[0].trim() !== ''));
  };
  
  const handleJournalFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setJournalFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const text = e.target?.result as string;
            const allRows = parseCsvWithMultiline(text);

            if (allRows.length <= 1) throw new Error("Journal CSV is empty or has only a header.");
            
            const headerLine = allRows[0].map(h => h.trim());
            const requiredHeaders = ["TradeID", "EntryPrice", "StopLossPrice"];
            const headerIndices: Record<string, number> = {};

            requiredHeaders.forEach(h => {
                const index = headerLine.indexOf(h);
                if (index === -1) {
                    throw new Error(`Missing required column in journal file: "${h}"`);
                }
                headerIndices[h] = index;
            });
            
            const dataRows = allRows.slice(1);
            
            // Group rows by TradeID
            const tradesMap = new Map<string, any>();
            dataRows.forEach(row => {
                const tradeId = row[headerIndices["TradeID"]];
                if (!tradesMap.has(tradeId)) {
                    tradesMap.set(tradeId, {
                        entryPrice: parseFloat(row[headerIndices["EntryPrice"]]),
                        stopLossPrice: parseFloat(row[headerIndices["StopLossPrice"]]),
                    });
                }
            });

            // Reconstruct RR Tools from the map
            const reconstructedTools: RRToolType[] = [];
            tradesMap.forEach((tradeInfo, tradeId) => {
                const entryDate = new Date(tradeId);
                if (isNaN(entryDate.getTime())) {
                    console.warn(`Skipping trade with invalid TradeID (date): ${tradeId}`);
                    return;
                }

                const { entryPrice, stopLossPrice } = tradeInfo;
                if (isNaN(entryPrice) || isNaN(stopLossPrice)) {
                    console.warn(`Skipping trade with invalid price data: ${tradeId}`);
                    return;
                }

                const position = stopLossPrice < entryPrice ? 'long' : 'short';
                const risk = Math.abs(entryPrice - stopLossPrice);
                const takeProfit = position === 'long' ? entryPrice + (risk * 2) : entryPrice - (risk * 2);

                reconstructedTools.push({
                    id: `rr-recon-${tradeId}`,
                    entryDate,
                    entryPrice,
                    stopLoss: stopLossPrice,
                    takeProfit,
                    position,
                    widthInPoints: 100, // Default width
                });
            });

            if (reconstructedTools.length === 0) {
              throw new Error(`No valid trades could be reconstructed from the file. Please check the file format and data.`);
            }
            
            // Set the new tools, clearing old drawings
            setDrawingState({
                rrTools: reconstructedTools,
                priceMarkers: [],
                measurementTools: []
            });
            setHistory([]);
            setRedoStack([]);
            setSelectedToolId(null);
            setIsPickingExit(false);

            toast({ title: "Journal Reconstructed", description: `${reconstructedTools.length} trades loaded. Please import the Bid price data to view them on the chart.` });

        } catch (error: any) {
            toast({ variant: "destructive", title: "Journal Import Failed", description: error.message, duration: 9000 });
        }
    };
    reader.readAsText(file);
    if(journalFileInputRef.current) journalFileInputRef.current.value = "";
  };

  const processJournalTrades = (trades: JournalTrade[]) => {
      const results: Record<string, DayResult> = {};
      const groupedByDay: Record<string, JournalTrade[]> = {};

      allJournalTrades.forEach(trade => {
          const dateKey = trade.dateTaken.toISOString().split('T')[0];
          if (!groupedByDay[dateKey]) {
              groupedByDay[dateKey] = [];
          }
          groupedByDay[dateKey].push(trade);
      });
      
      for (const dateKey in groupedByDay) {
          const dayTrades = groupedByDay[dateKey];
          const isModified = dayTrades.some(t => t.outcome !== t.originalOutcome);
          
          if (isModified) {
              results[dateKey] = 'modified';
              continue;
          }
      
          const hasWin = dayTrades.some(t => t.outcome === 'Win');
          results[dateKey] = hasWin ? 'win' : 'loss';
      }
      setDayResults(results);
  };
  
  useEffect(() => {
    if (allJournalTrades.length > 0 && tab === 'journal') {
        processJournalTrades(allJournalTrades);
    } else {
        setDayResults({});
    }
  }, [allJournalTrades, tab]);
  
    const handleNextDay = () => {
        if (!isDataImported || !selectedDate) {
            toast({ variant: "destructive", title: "Cannot Proceed", description: "Please import data and select a date first." });
            return;
        }

        const uniqueDates = Array.from(new Set(priceData.map(p => p.date.toISOString().split('T')[0]))).sort();
        const currentDateStr = selectedDate.toISOString().split('T')[0];
        const currentIndex = uniqueDates.indexOf(currentDateStr);

        let nextDayIndex = currentIndex + 1;
        if (nextDayIndex >= uniqueDates.length) {
            toast({ title: "End of Data", description: "Reached the end of the price data. Looping back to start." });
            nextDayIndex = 0; // Loop back to the start
        }
        
        const nextDate = new Date(uniqueDates[nextDayIndex]);
        const userTimezoneOffset = nextDate.getTimezoneOffset() * 60000;
        const adjustedDate = new Date(nextDate.getTime() + userTimezoneOffset);
        
        setSelectedDate(adjustedDate);

        const [startHour, startMinute] = sessionStartTime.split(':').map(Number);
        const sessionStart = new Date(adjustedDate);
        sessionStart.setUTCFullYear(adjustedDate.getUTCFullYear(), adjustedDate.getUTCMonth(), adjustedDate.getUTCDate());
        sessionStart.setUTCHours(startHour, startMinute, 0, 0);

        // Set the end of the visible range to be 25 minutes after session start (5 for range + 20 for context)
        const initialVisibleEndDate = new Date(sessionStart.getTime() + 25 * 60 * 1000);
        setBacktestEndDate(initialVisibleEndDate);
    };

    const handleNextCandle = () => {
        if (!backtestEndDate) {
            toast({ variant: "destructive", title: "Cannot Proceed", description: "This feature is only available after selecting a day with the 'Next Day' button." });
            return;
        }

        const nextCandleDate = new Date(backtestEndDate.getTime() + 1 * 60 * 1000);

        const lastDataPointDate = priceData[priceData.length - 1].date;
        if (nextCandleDate > lastDataPointDate) {
             toast({ title: "End of Data", description: "Reached the end of the available price data." });
             return;
        }

        setBacktestEndDate(nextCandleDate);
    }

    const handleFastForwardHour = () => {
        if (!backtestEndDate) {
            toast({ variant: "destructive", title: "Cannot Proceed", description: "This feature is only available after selecting a day with the 'Next Day' button." });
            return;
        }

        const nextHourDate = new Date(backtestEndDate.getTime() + 60 * 60 * 1000);

        const lastDataPointDate = priceData[priceData.length - 1].date;
        if (nextHourDate > lastDataPointDate) {
             toast({ title: "End of Data", description: "Reached the end of the available price data. Moving to last available candle." });
             setBacktestEndDate(lastDataPointDate);
             return;
        }

        setBacktestEndDate(nextHourDate);
    };

  // --- END JOURNAL FUNCTIONS ---

  const isPlacingAnything = !!placingToolType || isPlacingPriceMarker || isPlacingMeasurement;
  
  const chartEndDate = backtestEndDate || selectedDate;


  const journalTradesOnChart = tab === 'journal' 
    ? allJournalTrades.map((t, i) => ({
        id: `journal-${i}`,
        entryDate: t.dateTaken,
        entryPrice: 0, 
        type: t.outcome === 'Win' ? 'win' : 'loss' as 'win' | 'loss'
    })) 
    : [];

  const renderToolbar = () => (
    <>
       <div 
          className="absolute z-10 flex flex-col items-start gap-2"
          style={{ top: `${toolbarPositions.main.y}px`, left: `${toolbarPositions.main.x}px` }}
        >
            <div
                className="flex items-center gap-2 bg-card/80 backdrop-blur-sm p-2 rounded-lg shadow-lg"
            >
              <div
                  onMouseDown={(e) => handleMouseDownOnToolbar(e, 'main')}
                  className="cursor-grab active:cursor-grabbing p-1 -ml-1"
              >
                  <GripVertical className="h-5 w-5 text-muted-foreground/50" />
              </div>
                <>
                    <Select value={timeframe} onValueChange={setTimeframe}>
                        <SelectTrigger className="w-[120px]">
                            <SelectValue placeholder="Timeframe" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="1m">1 Minute</SelectItem>
                            <SelectItem value="5m">5 Minutes</SelectItem>
                            <SelectItem value="15m">15 Minutes</SelectItem>
                            <SelectItem value="30m">30 Minutes</SelectItem>
                            <SelectItem value="1H">1 Hour</SelectItem>
                            <SelectItem value="4H">4 Hours</SelectItem>
                            <SelectItem value="1D">1 Day</SelectItem>
                        </SelectContent>
                    </Select>

                    <div className="h-6 border-l border-border/50"></div>
                
                    <TooltipProvider>
                        <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" onClick={() => handleImportClick('bid')}>
                            <FileUp className={cn("h-5 w-5", isDataImported ? "text-chart-2" : "text-muted-foreground")} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent><p>{isDataImported ? `Bid: ${fileName}`: "Import Bid Data"}</p></TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                        <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" onClick={() => handleImportClick('ask')}>
                            <FileUp className={cn("h-5 w-5", isAskDataImported ? "text-chart-5" : "text-muted-foreground")} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent><p>{isAskDataImported ? `Ask: ${askFileName}` : "Import Ask Data"}</p></TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <input type="file" ref={askFileInputRef} onChange={(e) => handleFileChange(e, 'ask')} accept=".csv" className="hidden" />
                    
                    {(tab === 'backtester' || tab === 'journal') && (
                        <Button variant="ghost" onClick={handleExportCsv} className="text-foreground">
                            <Download className="mr-2 h-4 w-4" />
                            Download Report
                        </Button>
                    )}

                    {tab === 'journal' && (
                        <>
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant="ghost" size="icon" onClick={handleImportJournalClick}>
                                            <BookOpen className={cn("h-5 w-5", rrTools.length > 0 ? "text-chart-2" : "text-muted-foreground")} />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent><p>Import Trade Log for Reconstruction</p></TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                            <input type="file" ref={journalFileInputRef} onChange={handleJournalFileChange} accept=".csv" className="hidden" />
                        </>
                    )}
                    <input type="file" ref={fileInputRef} onChange={(e) => handleFileChange(e, 'bid')} accept=".csv" className="hidden" />
                </>
            </div>
            {fileName && (
                <div className="bg-card/70 backdrop-blur-sm rounded-md px-2 py-1 shadow-md ml-8">
                    <p className="text-xs text-muted-foreground/80">Bid Data: <span className="font-medium text-foreground/90">{fileName}</span></p>
                </div>
            )}
             {askFileName && (
                <div className="bg-card/70 backdrop-blur-sm rounded-md px-2 py-1 shadow-md ml-8">
                    <p className="text-xs text-muted-foreground/80">Ask Data: <span className="font-medium text-foreground/90">{askFileName}</span></p>
                </div>
            )}
            {tab === 'journal' && journalFileName && (
                 <div className="bg-card/70 backdrop-blur-sm rounded-md px-2 py-1 shadow-md ml-8">
                    <p className="text-xs text-muted-foreground/80">Reconstructing: <span className="font-medium text-foreground/90">{journalFileName}</span></p>
                </div>
            )}
            {isPickingExit && (
                 <div className="bg-primary/90 text-primary-foreground backdrop-blur-sm rounded-md px-3 py-1 shadow-lg ml-8 animate-pulse flex items-center gap-2">
                    <Target className="w-4 h-4" />
                    <span className="text-sm font-medium">Exit Picking Mode: Click a candle to mark close point</span>
                </div>
            )}
        </div>
        <div
            className="absolute z-10"
            style={{ top: `${toolbarPositions.secondary.y}px`, left: `${toolbarPositions.secondary.x}px` }}
        >
            <div className="flex items-center gap-2 bg-card/80 backdrop-blur-sm p-2 rounded-lg shadow-lg">
                <div onMouseDown={(e) => handleMouseDownOnToolbar(e, 'secondary')} className="cursor-grab active:cursor-grabbing p-1 -ml-1">
                    <GripVertical className="h-5 w-5 text-muted-foreground/50" />
                </div>
                <TooltipProvider>
                    <div className="flex justify-center gap-1">
                        {tab === 'backtester' && (
                            <>
                                <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={handlePlaceLong} disabled={isPlacingAnything || !isDataImported || isPickingExit}><ArrowUp className="w-5 h-5 text-accent"/></Button></TooltipTrigger><TooltipContent><p>Place Long Position</p></TooltipContent></Tooltip>
                                <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={handlePlaceShort} disabled={isPlacingAnything || !isDataImported || isPickingExit}><ArrowDown className="w-5 h-5 text-destructive"/></Button></TooltipTrigger><TooltipContent><p>Place Short Position</p></TooltipContent></Tooltip>
                            </>
                        )}
                        
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" onClick={handleNextDay} disabled={!isDataImported || isPickingExit}>
                                    <FastForward className="w-5 h-5 text-foreground" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Go to Next Trading Day</p></TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" onClick={handleFastForwardHour} disabled={!backtestEndDate || isPickingExit}>
                                    <ChevronsRight className="w-5 h-5 text-foreground" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Fast Forward 1 Hour</p></TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" onClick={handleNextCandle} disabled={!backtestEndDate || isPickingExit}>
                                    <Forward className="w-5 h-5 text-foreground" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Show Next Candle</p></TooltipContent>
                        </Tooltip>
                    </div>
                </TooltipProvider>
                
                <div className="h-6 border-l border-border/50"></div>

                <TooltipProvider>
                    <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={handlePlaceMarker} disabled={isPlacingAnything || !isDataImported || isPickingExit}><Target className="w-5 h-5 text-foreground"/></Button></TooltipTrigger><TooltipContent><p>Place Price Marker</p></TooltipContent></Tooltip>
                    <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={() => setIsYAxisLocked(prev => !prev)} disabled={isPickingExit}>{isYAxisLocked ? <Lock className="h-5 w-5" /> : <Unlock className="h-5 w-5" />}</Button></TooltipTrigger><TooltipContent><p>{isYAxisLocked ? "Unlock Y-Axis" : "Lock Y-Axis"}</p></TooltipContent></Tooltip>
                    <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={handlePlaceMeasurement} disabled={isPlacingAnything || !isDataImported || isPickingExit}><Ruler className="w-5 h-5 text-foreground"/></Button></TooltipTrigger><TooltipContent><p>Measure Distance</p></TooltipContent></Tooltip>
                </TooltipProvider>

                 <AlertDialog>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className={cn(((rrTools.length === 0 && priceMarkers.length === 0 && measurementTools.length === 0) || isPickingExit) && "pointer-events-none")}>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="destructive" size="icon" disabled={rrTools.length === 0 && priceMarkers.length === 0 && measurementTools.length === 0 || isPickingExit}><Trash2 className="h-5 w-5" /></Button>
                                    </AlertDialogTrigger>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent><p>Clear all drawings</p></TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                    <AlertDialogContent>
                        <AlertDialogHeader><AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle><AlertDialogDescription>This action cannot be undone. This will permanently delete all placed tools and markers from the chart.</AlertDialogDescription></AlertDialogHeader>
                        <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleClearAllDrawings}>Continue</AlertDialogAction></AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </div>
    </>
  );

  return (
    <div className="w-full h-full relative">
       <AlertDialog open={showRestoreDialog} onOpenChange={setShowRestoreDialog}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Restore Previous Session?</AlertDialogTitle>
                    <AlertDialogDescription>
                        We found a saved session for <strong>{tab}</strong>.
                        Would you like to restore your drawings and settings? You will need to re-import your data files.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={handleDeclineRestore}>Start New Session</AlertDialogCancel>
                    <AlertDialogAction onClick={handleRestoreSession}>Restore</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>

        <div className="absolute inset-0">
            <InteractiveChart
                data={priceData}
                trades={tab === 'journal' ? [] : journalTradesOnChart}
                onChartClick={handleChartClick}
                onChartMouseMove={handleChartMouseMove}
                rrTools={rrTools}
                onUpdateTool={handleUpdateTool}
                onRemoveTool={handleRemoveTool}
                isPlacingRR={!!placingToolType}
                isPlacingPriceMarker={isPlacingPriceMarker}
                priceMarkers={priceMarkers}
                onRemovePriceMarker={handleRemovePriceMarker}
                onUpdatePriceMarker={handleUpdatePriceMarker}
                measurementTools={measurementTools}
                onRemoveMeasurementTool={handleRemoveMeasurementTool}
                liveMeasurementTool={liveMeasurementTool}
                pipValue={pipValue}
                timeframe={timeframe}
                timeZone={timeZone}
                endDate={chartEndDate}
                isYAxisLocked={isYAxisLocked}
                openingRange={openingRange}
                emaPeriod={emaPeriod}
                tab={tab}
                selectedToolId={selectedToolId}
                onSelectTool={setSelectedToolId}
                isPickingExit={isPickingExit}
                onSetPickingExit={setIsPickingExit}
            />
        </div>
        <div 
          className="absolute z-20 flex items-center gap-4 top-4 right-4"
        >
            <span className="text-sm text-muted-foreground hidden sm:inline-block">{timeZone.replace(/_/g, ' ')}</span>
            <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={handleUndo} disabled={history.length === 0 || isPickingExit}>
                    <Undo className="h-5 w-5" />
                </Button>
                <Button variant="ghost" size="icon" onClick={handleRedo} disabled={redoStack.length === 0 || isPickingExit}>
                    <Redo className="h-5 w-5" />
                </Button>
            </div>
            <Popover>
                <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" disabled={isPickingExit}>
                        <CalendarIcon className="h-5 w-5" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                    <Calendar
                        mode="single"
                        selected={selectedDate}
                        onSelect={(date) => {
                            if (date) {
                                setSelectedDate(date);
                                setBacktestEndDate(undefined); // Reset stepping when a new date is picked
                            }
                        }}
                        defaultMonth={selectedDate}
                        modifiers={{ 
                            win: (date) => dayResults[date.toISOString().split('T')[0]] === 'win',
                            loss: (date) => dayResults[date.toISOString().split('T')[0]] === 'loss',
                            modified: (date) => dayResults[date.toISOString().split('T')[0]] === 'modified',
                        }}
                        modifiersClassNames={{
                            win: 'bg-green-200 text-green-900 rounded-full font-bold',
                            loss: 'bg-red-200 text-red-900 rounded-full font-bold',
                            modified: 'bg-orange-200 text-orange-900 rounded-full font-bold',
                        }}
                        disabled={(!isDataImported && rrTools.length === 0) || isPickingExit}
                    />
                </PopoverContent>
            </Popover>
            <Popover>
                <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" disabled={isPickingExit}>
                        <Settings className="h-5 w-5" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 mr-4">
                    <div className="grid gap-4">
                        <div className="space-y-2">
                            <h4 className="font-medium leading-none">Settings</h4>
                            <p className="text-sm text-muted-foreground">Adjust chart display options.</p>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="timezone">Timezone</Label>
                            <Select value={timeZone} onValueChange={setTimeZone} disabled={!timezones.length}>
                                <SelectTrigger id="timezone" className="w-full"><SelectValue placeholder="Select timezone" /></SelectTrigger>
                                <SelectContent><ScrollArea className="h-72">{timezones.map(tz => (<SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>))}</ScrollArea></SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="session-start">Session Start Time (UTC)</Label>
                            <Input id="session-start" type="time" value={sessionStartTime} onChange={(e) => setSessionStartTime(e.target.value)} />
                        </div>
                         <div className="grid gap-2">
                            <Label htmlFor="opening-range">Opening Range</Label>
                            <Select value={openingRangeDuration} onValueChange={setOpeningRangeDuration}>
                                <SelectTrigger id="opening-range" className="w-full"><SelectValue placeholder="Select Opening Range" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="5">5 Minutes</SelectItem>
                                    <SelectItem value="15">15 Minutes</SelectItem>
                                    <SelectItem value="none">None</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                         <div className="grid gap-2">
                            <Label htmlFor="ema-period">EMA Indicator</Label>
                            <Select value={emaPeriod.toString()} onValueChange={(v) => setEmaPeriod(v === 'none' ? 'none' : parseInt(v))}>
                                <SelectTrigger id="ema-period" className="w-full"><SelectValue placeholder="Select EMA Period" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="10">10 EMA</SelectItem>
                                    <SelectItem value="20">20 EMA</SelectItem>
                                    <SelectItem value="50">50 EMA</SelectItem>
                                    <SelectItem value="100">100 EMA</SelectItem>
                                    <SelectItem value="none">None</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="pip-value">Pip / Point Value</Label>
                            <Input id="pip-value" type="number" step="0.0001" value={pipValue} onChange={(e) => setPipValue(parseFloat(e.target.value) || 0)} />
                        </div>
                    </div>
                </PopoverContent>
            </Popover>
        </div>
        
        {renderToolbar()}
    </div>
  );
}
