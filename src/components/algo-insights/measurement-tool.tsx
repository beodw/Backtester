
"use client";

import React from 'react';
import type { MeasurementTool as MeasurementToolType, PriceData } from '@/types';

interface MeasurementToolProps {
  tool: MeasurementToolType;
  onRemove: (id: string) => void;
  data: PriceData[];
  xScale: ((date: number) => number);
  yScale: ((price: number) => number);
  plot: { width: number; height: number; top: number; left: number };
  pipValue: number;
  isLive?: boolean;
}

export function MeasurementTool({ tool, onRemove, data, xScale, yScale, plot, pipValue, isLive = false }: MeasurementToolProps) {
  
  const startDate = data[tool.startPoint.index]?.date;
  const endDate = data[tool.endPoint.index]?.date;

  if (!startDate || !endDate) return null;

  const startX = xScale(startDate.getTime());
  const startY = yScale(tool.startPoint.price);
  const endX = xScale(endDate.getTime());
  const endY = yScale(tool.endPoint.price);
  
  if (isNaN(startX) || isNaN(startY) || isNaN(endX) || isNaN(endY)) {
      return null;
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    if (isLive) return;
    e.preventDefault();
    e.stopPropagation();
    onRemove(tool.id);
  };
  
  const priceDiff = Math.abs(tool.endPoint.price - tool.startPoint.price);
  const pips = pipValue > 0 ? (priceDiff / pipValue).toFixed(1) : '0.0';
  const barDiff = Math.abs(tool.endPoint.index - tool.startPoint.index);

  const labelText = `↕ ${pips} pips  |  ↔ ${barDiff} bars`;
  const textWidth = labelText.length * 6.5; // A reasonable estimate for width
  const midX = (startX + endX) / 2;
  const midY = (startY + endY) / 2;

  // Position the label above the line, adjusting for orientation
  const labelYOffset = -20;

  return (
    <g onContextMenu={handleContextMenu} style={{ pointerEvents: isLive ? 'none' : 'all' }}>
       {/* Invisible hitbox for easier interaction on finalized tools */}
       {!isLive && (
            <line
                x1={startX}
                y1={startY}
                x2={endX}
                y2={endY}
                stroke="transparent"
                strokeWidth={10}
                style={{ cursor: 'pointer' }}
            />
       )}

      {/* Dotted line connecting the points */}
      <line
        x1={startX}
        y1={startY}
        x2={endX}
        y2={endY}
        stroke="hsl(var(--foreground))"
        strokeWidth={1.5}
        strokeDasharray="4 4"
        style={{ pointerEvents: 'none' }}
      />
      
      {/* Start and End point markers */}
      <circle cx={startX} cy={startY} r="3" fill="hsl(var(--foreground))" style={{ pointerEvents: 'none' }} />
      {!isLive && <circle cx={endX} cy={endY} r="3" fill="hsl(var(--foreground))" style={{ pointerEvents: 'none' }} />}


      {/* Label with background */}
      <g transform={`translate(${midX}, ${midY})`}>
        <g transform={`translate(0, ${labelYOffset})`}>
            <rect 
                x={-(textWidth / 2)} 
                y="-10" 
                width={textWidth} 
                height={20} 
                fill="hsl(var(--background) / 0.8)" 
                stroke="hsl(var(--border))"
                rx="3"
            />
            <text 
                textAnchor="middle" 
                alignmentBaseline="middle"
                fill="hsl(var(--foreground))"
                fontSize="12"
                fontWeight="500"
                style={{ 
                    userSelect: 'none'
                }}
            >
                {labelText}
            </text>
        </g>
      </g>
    </g>
  );
}
