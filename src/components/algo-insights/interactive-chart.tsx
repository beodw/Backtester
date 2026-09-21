
"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  ReferenceDot,
  ReferenceLine,
  Bar,
  Line,
  Customized,
  Tooltip,
  Cross,
} from "recharts";
import type { PriceData, Trade, RiskRewardTool as RRToolType, PriceMarker as PriceMarkerType, MeasurementTool as MeasurementToolType, OpeningRange } from "@/types";
import { RiskRewardTool } from "./risk-reward-tool";
import { PriceMarker } from "./price-marker";
import { MeasurementTool } from "./measurement-tool";
import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { findClosestIndex, calculateEMA } from "@/lib/chart-utils";
import { ArrowDown, ArrowUp } from "lucide-react";

export type ChartClickData = {
    price: number;
    date: Date;
    dataIndex: number;
    closePrice: number;
    yDomain: [number, number];
    xDomain: [number, number];
    candle: PriceData;
};

interface InteractiveChartProps {
  data: PriceData[];
  trades: Trade[];
  onChartClick: (data: ChartClickData) => void;
  onChartMouseMove: (data: ChartClickData) => void;
  rrTools: RRToolType[];
  onUpdateTool: (tool: RRToolType) => void;
  onRemoveTool: (id: string) => void;
  isPlacingRR: boolean;
  isPlacingPriceMarker: boolean;
  priceMarkers: PriceMarkerType[];
  onRemovePriceMarker: (id: string) => void;
  onUpdatePriceMarker: (id: string, price: number) => void;
  measurementTools: MeasurementToolType[];
  onRemoveMeasurementTool: (id: string) => void;
  liveMeasurementTool: MeasurementToolType | null;
  pipValue: number;
  timeframe: string;
  timeZone: string;
  endDate?: Date;
  isYAxisLocked: boolean;
  openingRange: OpeningRange | null;
  emaPeriod: number | 'none';
  tab: 'backtester' | 'journal';
  selectedToolId: string | null;
  onSelectTool: (id: string | null) => void;
  isPickingExit: boolean;
  onSetPickingExit: (picking: boolean) => void;
}

const Candlestick = (props: any) => {
    const { x, y, width, height, payload } = props;
    if (x === undefined || y === undefined || !payload || height <= 0) return null;

    const { open, high, low, close } = payload;
    const isGrowing = close > open;
    const color = isGrowing ? 'hsl(var(--accent))' : 'hsl(var(--destructive))';
    
    const pixelsPerPrice = high !== low ? height / (high - low) : 0;

    const bodyTopPrice = Math.max(open, close);
    const bodyTopY = y + (high - bodyTopPrice) * pixelsPerPrice;
    
    const bodyHeight = Math.abs(open - close) * pixelsPerPrice;

    return (
        <g>
            <path d={`M ${x + width / 2},${y} L ${x + width / 2},${y + height}`} stroke={color} strokeWidth={1} />
            <rect x={x} y={bodyTopY} width={width} height={Math.max(1, bodyHeight)} fill={color} />
        </g>
    );
};

export function InteractiveChart({ 
    data, 
    trades, 
    onChartClick, 
    onChartMouseMove,
    rrTools, 
    onUpdateTool, 
    onRemoveTool, 
    isPlacingRR, 
    isPlacingPriceMarker, 
    priceMarkers, 
    onRemovePriceMarker,
    onUpdatePriceMarker,
    measurementTools,
    onRemoveMeasurementTool,
    liveMeasurementTool,
    pipValue,
    timeframe, 
    timeZone, 
    endDate,
    isYAxisLocked,
    openingRange,
    emaPeriod,
    tab,
    selectedToolId,
    onSelectTool,
    isPickingExit,
    onSetPickingExit,
}: InteractiveChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartScalesRef = useRef<{x: any, y: any, plot: any} | null>(null);
  
  const aggregatedData = useMemo(() => {
    if (!data || data.length === 0) {
      return [];
    }
    
    let filteredByDate = data;
    if (endDate) {
        if (tab === 'journal') {
            const adjustedEndDate = new Date(endDate);
            adjustedEndDate.setUTCHours(23, 59, 59, 999); // Set to end of the selected day for journal view
            filteredByDate = data.filter(point => point.date <= adjustedEndDate);
        } else {
             // For backtester, respect the exact time for stepping
            filteredByDate = data.filter(point => point.date <= endDate);
        }
    }
    
    if (timeframe === '1m') {
      return filteredByDate;
    }
  
    const getIntervalMinutes = (tf: string): number => {
      switch (tf) {
        case '5m': return 5;
        case '15m': return 15;
        case '30m': return 30;
        case '1H': return 60;
        case '4H': return 240;
        case '1D': return 1440; // 24 * 60
        default: return 1;
      }
    };
  
    const interval = getIntervalMinutes(timeframe) * 60 * 1000;
    if (interval <= 60000) return filteredByDate;
  
    const result: PriceData[] = [];
    let currentCandle: PriceData | null = null;
    
    for (const point of filteredByDate) {
      const pointTime = point.date.getTime();
      const bucketTimestamp = Math.floor(pointTime / interval) * interval;
      
      if (!currentCandle || currentCandle.date.getTime() !== bucketTimestamp) {
        if (currentCandle) {
          result.push(currentCandle);
        }
        currentCandle = {
          date: new Date(bucketTimestamp),
          open: point.open,
          high: point.high,
          low: point.low,
          close: point.close,
          wick: [point.low, point.high],
        };
      } else {
        currentCandle.high = Math.max(currentCandle.high, point.high);
        currentCandle.low = Math.min(currentCandle.low, point.low);
        currentCandle.close = point.close;
        currentCandle.wick = [currentCandle.low, currentCandle.high];
      }
    }
    if (currentCandle) {
      result.push(currentCandle);
    }
    
    return result;
  }, [data, timeframe, endDate, tab]);

  const chartData = useMemo(() => {
    if (emaPeriod === 'none' || aggregatedData.length === 0) {
      return aggregatedData;
    }
    const emaValues = calculateEMA(aggregatedData, emaPeriod);
    return aggregatedData.map((point, index) => ({
      ...point,
      ema: emaValues[index]
    }));
  }, [aggregatedData, emaPeriod]);
  
  const [xDomain, setXDomain] = useState<[number, number]>([0, 100]);
  const [yDomain, setYDomain] = useState<[number, number]>([0, 100]);
  const [isDragging, setIsDragging] = useState(false);
  const [isYAxisDragging, setIsYAxisDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number, y: number, xDomain: [number, number], yDomain: [number, number] } | null>(null);


  const windowedData = useMemo(() => {
    if (!chartData.length) return [];
    const [start, end] = xDomain;
    const buffer = 100;
    const startIndex = Math.max(0, Math.floor(start) - buffer);
    const endIndex = Math.min(chartData.length, Math.ceil(end) + buffer);
    
    return chartData.slice(startIndex, endIndex);
  }, [xDomain, chartData]);

  useEffect(() => {
    if (chartData.length === 0) return;

    const panToEnd = () => {
        const domainWidth = 100;
        const targetIndex = chartData.length - 1;
        // Position the end of the data near the right edge of the viewport, but with a small buffer
        const newEnd = targetIndex + (domainWidth * 0.1); 
        const newStart = newEnd - domainWidth;
        return [newStart > 0 ? newStart : 0, newEnd];
    };

    setXDomain(prev => {
        const isInitialLoad = (prev[0] === 0 && prev[1] === 100);

        // If a date is selected, the data is filtered. We should always pan to the end of this new dataset.
        if (endDate) {
            return panToEnd();
        }
        
        // If no date is selected, only pan to the end on the initial load.
        // User-initiated pans/zooms shouldn't be overridden.
        if (isInitialLoad) {
            return panToEnd();
        }

        // For all other cases (like user panning/zooming), don't change the domain.
        return prev;
    });
  }, [endDate, chartData]);


  useEffect(() => {
    if (!isYAxisLocked) return;

    let min = Infinity;
    let max = -Infinity;

    if (windowedData.length > 0) {
      for (const d of windowedData) {
        if (d.low < min) min = d.low;
        if (d.high > max) max = d.high;
        if (d.ema && typeof d.ema === 'number') {
          min = Math.min(min, d.ema);
          max = Math.max(max, d.ema);
        }
      }
    }
    
    for (const marker of priceMarkers) {
      min = Math.min(min, marker.price);
      max = Math.max(max, marker.price);
    }

    if (openingRange) {
        min = Math.min(min, openingRange.low);
        max = Math.max(max, openingRange.high);
    }
    
    if (min === Infinity || max === -Infinity) {
       if (priceMarkers.length > 0) {
         for (const marker of priceMarkers) {
            min = Math.min(min, marker.price);
            max = Math.max(max, marker.price);
         }
       } else {
         return; // No data, do not update domain.
       }
    }

    const padding = (max - min) * 0.1 || 10;
    const newYDomain: [number, number] = [min - padding, max + padding];
    
    // Only update if the domain has meaningfully changed, to prevent loops
    if (newYDomain[0] !== yDomain[0] || newYDomain[1] !== yDomain[1]) {
        setYDomain(newYDomain);
    }
  }, [windowedData, priceMarkers, yDomain, isYAxisLocked, openingRange]);

  const xDataDomain = useMemo(() => {
    if (!chartData.length) return [0, 0];
    return [
      chartData[0].date.getTime(),
      chartData[chartData.length - 1].date.getTime()
    ];
  }, [chartData]);

  const xTimeDomain = useMemo(() => {
    if (!chartData || chartData.length === 0) return [0, 0];
    
    const [start, end] = xDomain;
    
    const firstPointTime = chartData[0].date.getTime();
    
    const interval = chartData.length > 1 
      ? chartData[1].date.getTime() - firstPointTime
      : 60000; 

    const startTime = firstPointTime + start * interval;
    const endTime = firstPointTime + end * interval;

    return [startTime, endTime];

  }, [chartData, xDomain]);

    const getChartCoordinates = (e: any): ChartClickData | null => {
        if (!e || !chartScalesRef.current) return null;
        
        const { x: xScale, y: yScale, plot } = chartScalesRef.current;
        
        const mouseXInPlot = e.chartX - plot.left;
        const mouseYInPlot = e.chartY - plot.top;
        
        if (mouseXInPlot < 0 || mouseXInPlot > plot.width || mouseYInPlot < 0 || mouseYInPlot > plot.height) {
            return null;
        }

        const price = yScale.invert(mouseYInPlot);
        const timestamp = xScale.invert(mouseXInPlot);
        const dataIndex = findClosestIndex(chartData, timestamp);
        const candle = chartData[dataIndex];
        
        if (price !== undefined && candle) {
            return { price, date: candle.date, dataIndex, closePrice: candle.close, yDomain, xDomain, candle };
        }
        return null;
    }


  const handleClick = (e: any) => {
    const coords = getChartCoordinates(e);
    if (coords) {
        onChartClick(coords);
    }
  };

    const handleMouseMoveRecharts = (e: any) => {
        if (isDragging || isYAxisDragging) {
            return;
        }

        const coords = getChartCoordinates(e);

        if (coords) {
            onChartMouseMove(coords); // For live measurement tool
        }
    };

    const handleMouseLeaveChart = () => {
        // Placeholder for any future leave logic
    }

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!chartContainerRef.current) return;
  
    const { left, width } = chartContainerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - left;
    const chartX = mouseX - 60;
    const plotWidth = width - 80;
    
    if (chartX < 0 || chartX > plotWidth) return;
  
    setXDomain(prevDomain => {
        const [domainStart, domainEnd] = prevDomain;
        const domainWidth = domainEnd - domainStart;
        const mouseIndex = domainStart + (chartX / plotWidth) * domainWidth;
        
        const zoomFactor = 1.1;
        // scroll up (e.deltaY < 0) zooms in, scroll down zooms out.
        let newDomainWidth = e.deltaY < 0 ? domainWidth / zoomFactor : domainWidth * zoomFactor;
      
        if (newDomainWidth < 10) {
          newDomainWidth = 10;
        }
        
        let newStart = mouseIndex - (mouseIndex - domainStart) * (newDomainWidth / domainWidth);

        if (newStart < 0) {
          newStart = 0;
        }
        
        let newEnd = newStart + newDomainWidth;
      
        return [newStart, newEnd];
    });
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isPlacingRR || isPlacingPriceMarker || isPickingExit || !chartContainerRef.current) return;
    e.preventDefault();
    
    const dragStartPayload = {
        x: e.clientX,
        y: e.clientY,
        xDomain: xDomain,
        yDomain: yDomain,
    };

    const { right } = chartContainerRef.current.getBoundingClientRect();
    const yAxisAreaStart = right - 80; // approximate axis width

    if (e.clientX > yAxisAreaStart && !isYAxisLocked) {
        setIsYAxisDragging(true);
        setDragStart(dragStartPayload);
    } else {
        setIsDragging(true);
        setDragStart(dragStartPayload);
        chartContainerRef.current.style.cursor = 'grabbing';
    }
  };
  
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!chartContainerRef.current) return;

    if (dragStart) {
        e.preventDefault();
        const { width, height } = chartContainerRef.current.getBoundingClientRect();

        if (isYAxisDragging && !isYAxisLocked) {
            chartContainerRef.current.style.cursor = 'ns-resize';
            const plotHeight = height - 20;
            if (plotHeight <= 0) return;
            const dy = e.clientY - dragStart.y;
            const scaleFactor = 1 - (dy / plotHeight) * 2; // Sensitivity factor

            if (scaleFactor <= 0.01) return; // Prevent inverting or collapsing

            const [yStart, yEnd] = dragStart.yDomain;
            const originalWidth = yEnd - yStart;
            const centerPrice = (yStart + yEnd) / 2;
            const newWidth = originalWidth / scaleFactor;

            const newYStart = centerPrice - newWidth / 2;
            const newYEnd = centerPrice + newWidth / 2;

            if (newYEnd > newYStart) {
                setYDomain([newYStart, newYEnd]);
            }
        } else if (isDragging) {
            chartContainerRef.current.style.cursor = 'grabbing';
            const plotWidth = width - 80;
            const plotHeight = height - 20; 
            
            if (plotWidth > 0) {
                const dx = e.clientX - dragStart.x;
                const [xStart, xEnd] = dragStart.xDomain;
                const xDomainWidth = xEnd - xStart;
                const indexPerPixel = xDomainWidth / plotWidth;
                const deltaIndex = dx * indexPerPixel;
                let newXStart = xStart - deltaIndex;
                if (newXStart < 0) {
                  newXStart = 0;
                }
                let newXEnd = newXStart + xDomainWidth;
                setXDomain([newXStart, newXEnd]);
            }
        
            if (!isYAxisLocked && plotHeight > 0) {
              const dy = e.clientY - dragStart.y;
              const [yStart, yEnd] = dragStart.yDomain;
              const yDomainWidth = yEnd - yStart;
              const pricePerPixel = yDomainWidth / plotHeight;
              const deltaPrice = dy * pricePerPixel; 
              
              const newYStart = yStart + deltaPrice;
              const newYEnd = newYStart + yDomainWidth;
              setYDomain([newYStart, newYEnd]);
            }
        }
    } else if (!isPlacingRR && !isPlacingPriceMarker && !isPickingExit) {
        const { right } = chartContainerRef.current.getBoundingClientRect();
        const yAxisAreaStart = right - 80; // approximate axis width
        if (e.clientX > yAxisAreaStart && !isYAxisLocked) {
            chartContainerRef.current.style.cursor = 'ns-resize';
        } else {
             chartContainerRef.current.style.cursor = 'crosshair';
        }
    } else {
        chartContainerRef.current.style.cursor = 'crosshair';
    }
  };
  
  const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(false);
    setIsYAxisDragging(false);
    setDragStart(null);
    if (chartContainerRef.current) {
        if (!isPlacingRR && !isPlacingPriceMarker && !isPickingExit) {
            chartContainerRef.current.style.cursor = 'crosshair';
        }
    }
  };
  
  const handleMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDragging || isYAxisDragging) {
        handleMouseUp(e);
    }
    if (chartContainerRef.current) {
      chartContainerRef.current.style.cursor = 'default';
    }
    handleMouseLeaveChart();
  };

  const formatXAxis = useCallback((tickItem: any) => {
    const date = new Date(tickItem);
    if (isNaN(date.getTime())) return '';
    
    const [start, end] = xDomain;
    const timePerIndex = chartData.length > 1 
      ? chartData[1].date.getTime() - chartData[0].date.getTime() 
      : 60000;
    
    const visibleRangeInMs = (end - start) * timePerIndex;
    const visibleRangeInMinutes = visibleRangeInMs / 60000;

    if (visibleRangeInMinutes > 3 * 24 * 60) {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric', timeZone });
    }
    if (visibleRangeInMinutes > 24 * 60) {
      return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone });
    }
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone });
  }, [xDomain, chartData, timeZone]);

  return (
    <div 
      ref={chartContainerRef} 
      className="w-full h-full relative"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      style={{ cursor: isPlacingRR || isPlacingPriceMarker || isPickingExit ? 'crosshair' : (isDragging ? 'grabbing' : 'crosshair')}}
    >
      {!chartData || chartData.length === 0 ? (
        <div className="flex items-center justify-center w-full h-full text-muted-foreground">
          No data available for the selected time range.
        </div>
      ) : (
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart 
            data={windowedData} 
            onClick={handleClick}
            onMouseMove={handleMouseMoveRecharts} 
            onMouseLeave={handleMouseLeaveChart}
            margin={{ top: 10, right: 30, left: 0, bottom: 10 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
          <XAxis
            dataKey="date"
            tickFormatter={formatXAxis}
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={80}
            xAxisId="main"
            domain={xTimeDomain}
            type="number"
            allowDataOverflow={true}
          />
          <YAxis
            orientation="right"
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => typeof value === 'number' ? value.toFixed(5) : ''}
            domain={yDomain}
            allowDataOverflow={true}
            yAxisId="main"
          />
          
           <Tooltip 
                content={() => null} // Render no content for the tooltip box
                cursor={{ stroke: 'hsl(var(--foreground))', strokeWidth: 1, strokeDasharray: '3 3' }}
                isAnimationActive={false}
            />

          <Bar dataKey="wick" shape={<Candlestick />} isAnimationActive={false} xAxisId="main" yAxisId="main"/>
          
          {emaPeriod !== 'none' && (
            <Line
              dataKey="ema"
              stroke="white"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              connectNulls={true}
              xAxisId="main"
              yAxisId="main"
            />
          )}

          {trades.map((trade) => (
            <ReferenceDot
              key={trade.id}
              x={trade.entryDate.getTime()}
              y={trade.entryPrice}
              r={5}
              ifOverflow="extendDomain"
              fill={trade.type === 'win' ? 'hsl(var(--accent))' : 'hsl(var(--destructive))'}
              stroke="hsl(var(--card))"
              xAxisId="main" 
              yAxisId="main"
            />
          ))}

          <Customized
            component={(props: any) => {
              const { xAxisMap, yAxisMap, width, height, ...rest } = props;
              const mainXAxis = xAxisMap?.['main'];
              const mainYAxis = yAxisMap?.['main'];
              const svgNode = chartContainerRef.current?.querySelector('svg');
              const svgBounds = svgNode?.getBoundingClientRect();

              if (!mainXAxis || !mainYAxis || !svgBounds) return null;
              
              const plot = {
                width: mainXAxis.width,
                height: mainYAxis.height,
                top: mainYAxis.y,
                left: mainXAxis.x
              };

              // Store scales in ref for the main onClick handler
              chartScalesRef.current = {
                x: mainXAxis.scale,
                y: mainYAxis.scale,
                plot: plot
              };

              const allMeasurementTools = liveMeasurementTool 
                ? [...measurementTools, liveMeasurementTool] 
                : measurementTools;
              
              const renderOpeningRange = () => {
                if (!openingRange) return null;

                const yHigh = mainYAxis.scale(openingRange.high);
                const yLow = mainYAxis.scale(openingRange.low);

                if (isNaN(yHigh) || isNaN(yLow)) return null;
                
                return (
                  <>
                    <line
                      x1={plot.left}
                      y1={yHigh}
                      x2={plot.left + plot.width}
                      y2={yHigh}
                      stroke="hsl(var(--primary))"
                      strokeWidth={1}
                      strokeDasharray="4 4"
                    />
                     <line
                      x1={plot.left}
                      y1={yLow}
                      x2={plot.left + plot.width}
                      y2={yLow}
                      stroke="hsl(var(--primary))"
                      strokeWidth={1}
                      strokeDasharray="4 4"
                    />
                  </>
                )
              }


              return (
                <g>
                  {renderOpeningRange()}
                  {priceMarkers.map(marker => (
                    <PriceMarker
                      key={marker.id}
                      marker={marker}
                      onRemove={onRemovePriceMarker}
                      onUpdate={onUpdatePriceMarker}
                      yScale={mainYAxis.scale}
                      plot={plot}
                      svgBounds={svgBounds}
                    />
                  ))}
                  {rrTools.map(tool => (
                    <RiskRewardTool
                      key={tool.id}
                      tool={tool}
                      onUpdateTool={onUpdateTool}
                      onRemove={onRemoveTool}
                      data={chartData}
                      xScale={mainXAxis.scale}
                      yScale={mainYAxis.scale}
                      plot={plot}
                      svgBounds={svgBounds}
                      isSelected={selectedToolId === tool.id}
                      onSelect={() => onSelectTool(tool.id)}
                      onSetPickingExit={onSetPickingExit}
                    />
                  ))}
                  {allMeasurementTools.map(tool => (
                    <MeasurementTool
                        key={tool.id}
                        tool={tool}
                        onRemove={onRemoveMeasurementTool}
                        data={chartData}
                        xScale={mainXAxis.scale}
                        yScale={mainYAxis.scale}
                        plot={plot}
                        pipValue={pipValue}
                        isLive={tool.id === 'live-measure'}
                    />
                  ))}
                  {/* Render Discretionary Exit Marker for Selected Tool */}
                  {selectedToolId && rrTools.find(t => t.id === selectedToolId)?.discretionaryExitDate && (() => {
                      const tool = rrTools.find(t => t.id === selectedToolId)!;
                      const date = tool.discretionaryExitDate!;
                      // For display on M15/M5 charts, we need the start of the aggregate candle
                      const candleIndex = chartData.findIndex(d => 
                         date.getTime() >= d.date.getTime() && 
                         date.getTime() < d.date.getTime() + (timeframe === '5m' ? 5*60000 : (timeframe === '15m' ? 15*60000 : 60000))
                      );
                      const candle = chartData[candleIndex];
                      if (!candle) return null;

                      const x = mainXAxis.scale(candle.date.getTime());
                      const y = mainYAxis.scale(candle.close);
                      
                      if (isNaN(x) || isNaN(y)) return null;

                      return (
                        <g transform={`translate(${x}, ${y})`}>
                            {tool.position === 'long' ? (
                                <g transform="translate(0, -15)">
                                    <path d="M0 0 L-5 -10 L5 -10 Z" fill="hsl(var(--accent))" stroke="white" strokeWidth="1" />
                                    <text y="-15" textAnchor="middle" fontSize="10" fill="white" fontWeight="bold">EXIT</text>
                                </g>
                            ) : (
                                <g transform="translate(0, 15)">
                                    <path d="M0 0 L-5 10 L5 10 Z" fill="hsl(var(--destructive))" stroke="white" strokeWidth="1" />
                                    <text y="25" textAnchor="middle" fontSize="10" fill="white" fontWeight="bold">EXIT</text>
                                </g>
                            )}
                        </g>
                      );
                  })()}
                </g>
              );
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
      )}
    </div>
  );

}
