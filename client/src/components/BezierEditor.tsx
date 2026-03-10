// TEMPORAL FX — BezierEditor Component
// "Cinematic Void" design: oscilloscope-style dark canvas, teal curve, draggable handles.
// P0=(0,0) and P3=(1,1) are fixed. User drags P1 and P2.

import React, { useRef, useEffect, useCallback, useState } from "react";
import type { BezierCurve } from "@/lib/types";
import { evaluateBezier } from "@/lib/bezier";

interface Props {
  value: BezierCurve;
  onChange: (curve: BezierCurve) => void;
  width?: number;
  height?: number;
  xLabel?: string;
  yLabel?: string;
}

const HANDLE_RADIUS = 6;
const TEAL = "#4ecdc4";
const TEAL_DIM = "rgba(78,205,196,0.3)";
const TEAL_GLOW = "rgba(78,205,196,0.15)";
const GRID = "rgba(255,255,255,0.04)";
const BG = "#0a0a0a";

export default function BezierEditor({
  value,
  onChange,
  width = 260,
  height = 100,
  xLabel,
  yLabel,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef<"p1" | "p2" | null>(null);
  const [hovered, setHovered] = useState<"p1" | "p2" | null>(null);

  const pad = 12;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const toCanvas = (nx: number, ny: number) => ({
    x: pad + nx * innerW,
    y: pad + (1 - ny) * innerH, // flip Y: 0=bottom, 1=top
  });

  const toNorm = (cx: number, cy: number) => ({
    nx: Math.max(0, Math.min(1, (cx - pad) / innerW)),
    ny: Math.max(0, Math.min(1, 1 - (cy - pad) / innerH)),
  });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, width, height);

    // Grid lines
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const x = pad + (i / 4) * innerW;
      const y = pad + (i / 4) * innerH;
      ctx.beginPath(); ctx.moveTo(x, pad); ctx.lineTo(x, pad + innerH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(pad + innerW, y); ctx.stroke();
    }

    // Border
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.strokeRect(pad, pad, innerW, innerH);

    const p0 = toCanvas(0, 0);
    const p1 = toCanvas(value.p1x, value.p1y);
    const p2 = toCanvas(value.p2x, value.p2y);
    const p3 = toCanvas(1, 1);

    // Control lines
    ctx.strokeStyle = TEAL_DIM;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p3.x, p3.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    ctx.setLineDash([]);

    // Bezier curve — sample 80 points
    ctx.strokeStyle = TEAL;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = TEAL;
    ctx.shadowBlur = 4;
    ctx.beginPath();
    for (let i = 0; i <= 80; i++) {
      const t = i / 80;
      const y = evaluateBezier(value, t);
      const cp = toCanvas(t, y);
      if (i === 0) ctx.moveTo(cp.x, cp.y);
      else ctx.lineTo(cp.x, cp.y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Fixed endpoints
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.beginPath(); ctx.arc(p0.x, p0.y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(p3.x, p3.y, 3, 0, Math.PI * 2); ctx.fill();

    // Draggable handles
    const drawHandle = (pt: { x: number; y: number }, isHovered: boolean, isDragging: boolean) => {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = isDragging ? TEAL : isHovered ? "rgba(78,205,196,0.8)" : "rgba(78,205,196,0.4)";
      ctx.fill();
      ctx.strokeStyle = TEAL;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (isDragging || isHovered) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, HANDLE_RADIUS + 3, 0, Math.PI * 2);
        ctx.strokeStyle = TEAL_GLOW;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    };

    drawHandle(p1, hovered === "p1", dragging.current === "p1");
    drawHandle(p2, hovered === "p2", dragging.current === "p2");

    // Labels
    if (xLabel || yLabel) {
      ctx.fillStyle = "rgba(78,205,196,0.4)";
      ctx.font = "9px 'DM Mono', monospace";
      if (xLabel) ctx.fillText(xLabel, pad + 2, height - 2);
      if (yLabel) {
        ctx.save();
        ctx.translate(8, pad + innerH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(yLabel, -20, 0);
        ctx.restore();
      }
    }
  }, [value, hovered, width, height, innerW, innerH, pad]);

  useEffect(() => { draw(); }, [draw]);

  const getHitHandle = (cx: number, cy: number): "p1" | "p2" | null => {
    const p1 = toCanvas(value.p1x, value.p1y);
    const p2 = toCanvas(value.p2x, value.p2y);
    const dist = (a: { x: number; y: number }, bx: number, by: number) =>
      Math.sqrt((a.x - bx) ** 2 + (a.y - by) ** 2);
    if (dist(p1, cx, cy) <= HANDLE_RADIUS + 4) return "p1";
    if (dist(p2, cx, cy) <= HANDLE_RADIUS + 4) return "p2";
    return null;
  };

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      return {
        cx: (e.touches[0].clientX - rect.left) * scaleX,
        cy: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      cx: (e.clientX - rect.left) * scaleX,
      cy: (e.clientY - rect.top) * scaleY,
    };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    const { cx, cy } = getPos(e);
    const hit = getHitHandle(cx, cy);
    if (hit) {
      dragging.current = hit;
      e.preventDefault();
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const { cx, cy } = getPos(e);
    if (dragging.current) {
      const { nx, ny } = toNorm(cx, cy);
      if (dragging.current === "p1") {
        onChange({ ...value, p1x: nx, p1y: ny });
      } else {
        onChange({ ...value, p2x: nx, p2y: ny });
      }
    } else {
      setHovered(getHitHandle(cx, cy));
    }
  };

  const onMouseUp = () => { dragging.current = null; };

  const onDoubleClick = () => {
    // Reset to linear diagonal
    onChange({ p1x: 0.33, p1y: 0.33, p2x: 0.67, p2y: 0.67 });
  };

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ width: "100%", height: `${height}px`, display: "block", cursor: hovered || dragging.current ? "grab" : "default" }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onDoubleClick={onDoubleClick}
      title="Drag handles to adjust curve. Double-click to reset."
    />
  );
}
