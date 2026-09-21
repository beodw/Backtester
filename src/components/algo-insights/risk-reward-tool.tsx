
"use client";

import React, { useState, useEffect } from 'react';
import type { RiskRewardTool as RRToolType, PriceData } from '@/types';
import { findClosestIndex } from '@/lib/chart-utils';
import { Target, X } from 'lucide-react';

interface RiskRewardToolProps {
  tool: RRToolType;
  onUpdateTool: (tool: RRToolType) => void;
  onRemove: (id: string) => void;
  data: PriceData[];
  xScale: ((date: number) => number) & { invert?: (x: number) => number };
  yScale: ((price: number) => number) & { invert?: (y: number) => number };
  plot: { width: number; height: number; top: number; left: number };
  svgBounds: DOMRect;
  isSelected: boolean;
  onSelect: () => void;
  onSetPickingExit: (picking: boolean) => void;
}

export function RiskRewardTool({ tool, onUpdateTool, onRemove, data, xScale, yScale, plot, svgBounds, isSelected, onSelect, onSetPickingExit }: RiskRewardToolProps) {
  const [isDragging, setIsDragging] = useState<null | 'entry' | 'stop' | 'profit' | 'width'>(null);
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [editedTool, setEditedTool] = useState<RRToolType>(tool);

  useEffect(() => {
    // Keep internal state in sync with external prop changes, but only if not editing.
    if (!isPopupOpen) {
      setEditedTool(tool);
    }
  }, [tool, isPopupOpen]);

  const handleMouseDown = (e: React.MouseEvent, part: 'entry' | 'stop' | 'profit' | 'width') => {
    // Prevent dragging when the popup is open
    if (isPopupOpen) return;

    e.preventDefault();
    e.stopPropagation();
    onSelect();
    setIsDragging(part);

    const startToolState = { ...tool };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault();

      if (!yScale.invert || !xScale.invert) return;

      let newTool = { ...tool };
      const mouseYInSvg = moveEvent.clientY - svgBounds.top;
      const mouseXInSvg = moveEvent.clientX - svgBounds.left;
      
      if (part === 'entry') {
        const mouseXInPlot = mouseXInSvg - plot.left;
        const newEntryPrice = yScale.invert(mouseYInSvg);
        const newTimestamp = xScale.invert(mouseXInPlot);
        
        if (newEntryPrice === undefined || newTimestamp === undefined) return;

        const stopOffset = startToolState.entryPrice - startToolState.stopLoss;
        const profitOffset = startToolState.takeProfit - startToolState.entryPrice;
        
        newTool.entryPrice = newEntryPrice;
        newTool.stopLoss = newEntryPrice - stopOffset;
        newTool.takeProfit = newEntryPrice + profitOffset;
        
        const newCandle = data.find(d => d.date.getTime() >= newTimestamp);
        if (newCandle) {
          newTool.entryDate = newCandle.date;
        }

      } else if (part === 'stop') {
        const newPrice = yScale.invert(mouseYInSvg);
        if (newPrice !== undefined) newTool.stopLoss = newPrice;
      
      } else if (part === 'profit') {
        const newPrice = yScale.invert(mouseYInSvg);
        if (newPrice !== undefined) newTool.takeProfit = newPrice;
      
      } else if (part === 'width') {
        const mouseXInPlot = mouseXInSvg - plot.left;
        const newTimestamp = xScale.invert(mouseXInPlot);
        
        if (newTimestamp !== undefined) {
          const entryTimestamp = tool.entryDate.getTime();
          if (entryTimestamp) {
              const candleInterval = data.length > 1 ? data[1].date.getTime() - data[0].date.getTime() : 60000;
              const newWidthInPoints = Math.round((newTimestamp - entryTimestamp) / candleInterval);

              if (newWidthInPoints >= 5) {
                newTool.widthInPoints = newWidthInPoints;
              }
          }
        }
      }
      
      onUpdateTool(newTool);
    };

    const handleMouseUp = () => {
      setIsDragging(null);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const entryTimestamp = tool.entryDate.getTime();

  if (!entryTimestamp || !data || data.length === 0) {
    return null;
  }
  
  const interval = data.length > 1 ? data[1].date.getTime() - data[0].date.getTime() : 60000;
  const endDate = entryTimestamp + tool.widthInPoints * interval;


  const leftX = xScale(entryTimestamp);
  const rightX = xScale(endDate);
  const width = rightX - leftX;

  const entryY = yScale(tool.entryPrice);
  const profitY = yScale(tool.takeProfit);
  const stopY = yScale(tool.stopLoss);
  
  if (isNaN(leftX) || isNaN(rightX) || isNaN(entryY) || isNaN(profitY) || isNaN(stopY)) {
      return null;
  }

  const profitZoneY = tool.position === 'long' ? profitY : entryY;
  const profitZoneHeight = Math.abs(entryY - profitY);
  const lossZoneY = tool.position === 'long' ? entryY : stopY;
  const lossZoneHeight = Math.abs(stopY - entryY);
  
  const rrRatio = tool.entryPrice - tool.stopLoss !== 0 ? Math.abs((tool.takeProfit - tool.entryPrice) / (tool.entryPrice - tool.stopLoss)) : Infinity;

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onRemove(tool.id);
  };

  const handleClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect();
  }

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
    setEditedTool(tool); // Reset to current tool state on open
    setIsPopupOpen(true);
  };

  const handleApply = (e: React.MouseEvent) => {
    e.stopPropagation();
    onUpdateTool(editedTool);
    setIsPopupOpen(false);
  };

  const handleClosePopup = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsPopupOpen(false);
  };

  const handleSetExit = (e: React.MouseEvent) => {
      e.stopPropagation();
      onSetPickingExit(true);
      setIsPopupOpen(false);
  }

  const handleRemoveExit = (e: React.MouseEvent) => {
      e.stopPropagation();
      onUpdateTool({ ...tool, discretionaryExitDate: undefined });
      setIsPopupOpen(false);
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setEditedTool(prev => ({ ...prev, [name]: parseFloat(value) || 0 }));
  };

  // Popup positioning
  const popupWidth = 200;
  const popupHeight = 220;
  let popupX = leftX + width / 2 - popupWidth / 2;
  let popupY = entryY - popupHeight / 2;

  // Ensure popup stays within plot bounds
  if (popupX < plot.left) popupX = plot.left;
  if (popupX + popupWidth > plot.left + plot.width) popupX = plot.left + plot.width - popupWidth;
  if (popupY < plot.top) popupY = plot.top;
  if (popupY + popupHeight > plot.top + plot.height) popupY = plot.top + plot.height - popupHeight;


  return (
    <g style={{ pointerEvents: 'all' }} onClick={handleClick} onDoubleClick={handleDoubleClick}>
      {/* Profit Zone */}
      <rect
        x={leftX}
        y={profitZoneY}
        width={width}
        height={profitZoneHeight}
        fill={isSelected ? "hsla(120, 100%, 50%, 0.25)" : "hsla(120, 100%, 50%, 0.15)"}
        stroke={isSelected ? "white" : "hsla(120, 100%, 50%, 0.7)"}
        strokeWidth={isSelected ? 1.5 : 1}
        strokeDasharray={isSelected ? undefined : "3 3"}
        style={{ pointerEvents: 'none' }}
      />
      {/* Loss Zone */}
      <rect
        x={leftX}
        y={lossZoneY}
        width={width}
        height={lossZoneHeight}
        fill={isSelected ? "hsla(0, 84.2%, 60.2%, 0.25)" : "hsla(0, 84.2%, 60.2%, 0.15)"}
        stroke={isSelected ? "white" : "hsla(0, 84.2%, 60.2%, 0.7)"}
        strokeWidth={isSelected ? 1.5 : 1}
        strokeDasharray={isSelected ? undefined : "3 3"}
        style={{ pointerEvents: 'none' }}
      />
      
      {/* Label Group */}
      <g transform={`translate(${leftX + width / 2}, ${entryY})`} style={{ userSelect: 'none' }}>
          <rect x={-40} y={-15} width={80} height={30} fill="hsla(0, 0%, 10%, 0.6)" rx="3" />
          <text textAnchor="middle" x="0" y="-3" fill="white" fontSize="10">RR: {isFinite(rrRatio) ? rrRatio.toFixed(2) : '∞'}</text>
          <text textAnchor="middle" x="0" y="10" fill="white" fontSize="10" style={{textTransform: 'capitalize'}}>{tool.position}</text>
      </g>
      
      {/* Interactive Hitboxes */}
      {/* Entry Drag Hitbox */}
      <rect
          x={leftX}
          y={entryY - 5}
          width={width}
          height={10}
          fill="transparent"
          style={{ cursor: 'move' }}
          onMouseDown={(e) => handleMouseDown(e, 'entry')}
      />
      {/* Stop Drag Hitbox */}
      <rect
          x={leftX}
          y={stopY - 5}
          width={width}
          height={10}
          fill="transparent"
          style={{ cursor: 'ns-resize' }}
          onMouseDown={(e) => handleMouseDown(e, 'stop')}
      />
      {/* Profit Drag Hitbox */}
      <rect
          x={leftX}
          y={profitY - 5}
          width={width}
          height={10}
          fill="transparent"
          style={{ cursor: 'ns-resize' }}
          onMouseDown={(e) => handleMouseDown(e, 'profit')}
      />
      {/* Width Drag Hitbox */}
       <rect
          x={rightX - 5}
          y={Math.min(profitY, stopY)}
          width={10}
          height={Math.abs(profitY - stopY)}
          fill="transparent"
          style={{ cursor: 'ew-resize' }}
          onMouseDown={(e) => handleMouseDown(e, 'width')}
      />


      {/* Delete Button */}
      {isSelected && (
          <g 
              transform={`translate(${leftX + width / 2}, ${entryY - 25})`}
              onMouseDown={handleDelete}
              style={{ cursor: 'pointer' }}
          >
            <circle r={8} fill="hsl(var(--card))" stroke="hsl(var(--border))" />
            <line x1={-3} y1={-3} x2={3} y2={3} stroke="hsl(var(--muted-foreground))" strokeWidth="1.5"/>
            <line x1={-3} y1={3} x2={3} y2={-3} stroke="hsl(var(--muted-foreground))" strokeWidth="1.5"/>
          </g>
      )}
      
      {/* Edit Popup */}
      {isPopupOpen && (
        <foreignObject x={popupX} y={popupY} width={popupWidth} height={popupHeight}>
            <div 
              xmlns="http://www.w3.org/1999/xhtml"
              style={{
                background: 'hsl(var(--popover))',
                color: 'hsl(var(--popover-foreground))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 'var(--radius)',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                fontFamily: 'sans-serif',
                fontSize: '12px',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
                userSelect: 'none'
              }}
              onMouseDown={(e) => e.stopPropagation()} // Prevent chart drag when interacting with popup
            >
                <div style={{fontWeight: 'bold', borderBottom: '1px solid hsl(var(--border))', paddingBottom: '4px', marginBottom: '4px'}}>Edit Trade</div>
                <div style={{display: 'grid', gridTemplateColumns: '70px 1fr', alignItems: 'center'}}>
                    <label htmlFor="entryPrice">Entry</label>
                    <input type="number" name="entryPrice" value={editedTool.entryPrice} onChange={handleInputChange} style={{width: '100%', background: 'hsl(var(--input))', border: '1px solid hsl(var(--border))', borderRadius: '3px', padding: '2px 4px', color: 'hsl(var(--foreground))'}} />
                </div>
                <div style={{display: 'grid', gridTemplateColumns: '70px 1fr', alignItems: 'center'}}>
                    <label htmlFor="takeProfit">Take Profit</label>
                    <input type="number" name="takeProfit" value={editedTool.takeProfit} onChange={handleInputChange} style={{width: '100%', background: 'hsl(var(--input))', border: '1px solid hsl(var(--border))', borderRadius: '3px', padding: '2px 4px', color: 'hsl(var(--foreground))'}} />
                </div>
                <div style={{display: 'grid', gridTemplateColumns: '70px 1fr', alignItems: 'center'}}>
                    <label htmlFor="stopLoss">Stop Loss</label>
                    <input type="number" name="stopLoss" value={editedTool.stopLoss} onChange={handleInputChange} style={{width: '100%', background: 'hsl(var(--input))', border: '1px solid hsl(var(--border))', borderRadius: '3px', padding: '2px 4px', color: 'hsl(var(--foreground))'}} />
                </div>
                
                <div style={{marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '4px'}}>
                    <button onClick={handleSetExit} style={{width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))', border: 'none', padding: '6px', borderRadius: '4px', cursor: 'pointer', fontWeight: '500'}}>
                        <Target style={{width: '12px', height: '12px'}} /> {tool.discretionaryExitDate ? 'Change Exit' : 'Set Discretionary Exit'}
                    </button>
                    {tool.discretionaryExitDate && (
                        <button onClick={handleRemoveExit} style={{width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', background: 'hsl(var(--destructive))', color: 'hsl(var(--destructive-foreground))', border: 'none', padding: '6px', borderRadius: '4px', cursor: 'pointer', fontWeight: '500'}}>
                            <X style={{width: '12px', height: '12px'}} /> Remove Exit Point
                        </button>
                    )}
                </div>

                <div style={{display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px'}}>
                    <button onClick={handleClosePopup} style={{background: 'hsl(var(--secondary))', color: 'hsl(var(--secondary-foreground))', border: 'none', padding: '4px 8px', borderRadius: '3px', cursor: 'pointer'}}>Cancel</button>
                    <button onClick={handleApply} style={{background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))', border: 'none', padding: '4px 8px', borderRadius: '3px', cursor: 'pointer'}}>Apply</button>
                </div>
            </div>
        </foreignObject>
      )}
    </g>
  );
}
