
"use client";

import React from 'react';
import type { PriceMarker as PriceMarkerType } from '@/types';

interface PriceMarkerProps {
  marker: PriceMarkerType;
  onRemove: (id: string) => void;
  onUpdate: (id: string, price: number) => void;
  yScale: ((price: number) => number) & { invert?: (y: number) => number };
  plot: { width: number; height: number; top: number; left: number };
  svgBounds: DOMRect;
}

export function PriceMarker({ marker, onRemove, onUpdate, yScale, plot, svgBounds }: PriceMarkerProps) {
  const yPosition = yScale(marker.price);

  if (isNaN(yPosition) || yPosition < plot.top || yPosition > plot.top + plot.height) {
    return null;
  }

  const isDeletable = marker.isDeletable !== false;
  const labelText = `${marker.label ? `${marker.label}: ` : ''}${marker.price.toFixed(5)}`;
  const labelWidth = labelText.length * 6.5 + 8; // A reasonable estimate for width

  const handleContextMenu = (e: React.MouseEvent) => {
    if (isDeletable) {
      e.preventDefault();
      e.stopPropagation();
      onRemove(marker.id);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || !isDeletable) return; // Only allow left-click drag on deletable markers
    e.stopPropagation();

    const handleMouseMove = (moveEvent: MouseEvent) => {
        moveEvent.preventDefault();
        if (yScale.invert) {
            const mouseYInSvg = moveEvent.clientY - svgBounds.top;
            const mouseYInPlot = mouseYInSvg - plot.top;
            
            // Clamp the drag to within the plot area
            const clampedY = Math.max(0, Math.min(mouseYInPlot, plot.height));

            const newPrice = yScale.invert(clampedY);
            if (newPrice !== undefined) {
              onUpdate(marker.id, newPrice);
            }
        }
    };

    const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <g
      onContextMenu={handleContextMenu}
      onMouseDown={handleMouseDown}
      style={{ cursor: isDeletable ? 'ns-resize' : 'default', pointerEvents: 'all' }}
    >
      <line
        x1={plot.left}
        y1={yPosition}
        x2={plot.left + plot.width}
        y2={yPosition}
        stroke="hsl(var(--primary))"
        strokeWidth={1}
        strokeDasharray="4 4"
        style={{ pointerEvents: 'none' }}
      />
      {/* Invisible hitbox for easier interaction */}
       <line
        x1={plot.left}
        y1={yPosition}
        x2={plot.left + plot.width}
        y2={yPosition}
        stroke="transparent"
        strokeWidth={10}
      />
      <g transform={`translate(${plot.left + plot.width + 4}, ${yPosition})`}>
        <rect
          x={0}
          y={-9}
          width={labelWidth}
          height={18}
          fill="hsl(var(--card))"
          stroke="hsl(var(--border))"
          rx="3"
        />
        <text
          x={4}
          y={0}
          alignmentBaseline="middle"
          fontSize="12"
          fill="hsl(var(--primary))"
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {labelText}
        </text>
      </g>
    </g>
  );
}
