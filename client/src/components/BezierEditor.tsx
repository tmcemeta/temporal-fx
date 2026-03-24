// TEMPORAL FX — BezierEditor Component
// "Cinematic Void" design: oscilloscope-style dark canvas, teal curve, draggable handles.
// All four control points (P0, P1, P2, P3) are draggable.

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
const ENDPOINT_RADIUS = 5;
const TEAL = "#4ecdc4";
const TEAL_DIM = "rgba(78,205,196,0.3)";
const TEAL_GLOW = "rgba(78,205,196,0.15)";
const GRID = "rgba(255,255,255,0.04)";
const BG = "#0a0a0a";

type HandleId = "p0" | "p1" | "p2" | "p3";

export default function BezierEditor({
  value,
  onChange,
  width = 260,
  height = 100,
  xLabel,
  yLabel,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef<HandleId | null>(null);
  const [hovered, setHovered] = useState<HandleId | null>(null);

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

    const p0 = toCanvas(value.p0x, value.p0y);
    const p1 = toCanvas(value.p1x, value.p1y);
    const p2 = toCanvas(value.p2x, value.p2y);
    const p3 = toCanvas(value.p3x, value.p3y);

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
      const x = value.p0x + t * (value.p3x - value.p0x);
      const y = evaluateBezier(value, x);
      const cp = toCanvas(x, y);
      if (i === 0) ctx.moveTo(cp.x, cp.y);
      else ctx.lineTo(cp.x, cp.y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Draggable handles helper
    const drawHandle = (pt: { x: number; y: number }, id: HandleId, isEndpoint: boolean) => {
      const isHovered = hovered === id;
      const isDragging = dragging.current === id;
      const radius = isEndpoint ? ENDPOINT_RADIUS : HANDLE_RADIUS;

      ctx.beginPath();
      ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);

      if (isEndpoint) {
        // Endpoints: different style (hollow when not active)
        ctx.fillStyle = isDragging ? TEAL : isHovered ? "rgba(78,205,196,0.6)" : "rgba(78,205,196,0.25)";
        ctx.fill();
        ctx.strokeStyle = isDragging || isHovered ? TEAL : "rgba(78,205,196,0.5)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        // Control points: solid style
        ctx.fillStyle = isDragging ? TEAL : isHovered ? "rgba(78,205,196,0.8)" : "rgba(78,205,196,0.4)";
        ctx.fill();
        ctx.strokeStyle = TEAL;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      if (isDragging || isHovered) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius + 3, 0, Math.PI * 2);
        ctx.strokeStyle = TEAL_GLOW;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    };

    // Draw all four handles
    drawHandle(p0, "p0", true);
    drawHandle(p1, "p1", false);
    drawHandle(p2, "p2", false);
    drawHandle(p3, "p3", true);

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

  const getHitHandle = (cx: number, cy: number): HandleId | null => {
    const p0 = toCanvas(value.p0x, value.p0y);
    const p1 = toCanvas(value.p1x, value.p1y);
    const p2 = toCanvas(value.p2x, value.p2y);
    const p3 = toCanvas(value.p3x, value.p3y);

    const dist = (a: { x: number; y: number }, bx: number, by: number) =>
      Math.sqrt((a.x - bx) ** 2 + (a.y - by) ** 2);

    // Check control points first (they have priority)
    if (dist(p1, cx, cy) <= HANDLE_RADIUS + 4) return "p1";
    if (dist(p2, cx, cy) <= HANDLE_RADIUS + 4) return "p2";
    // Then check endpoints
    if (dist(p0, cx, cy) <= ENDPOINT_RADIUS + 4) return "p0";
    if (dist(p3, cx, cy) <= ENDPOINT_RADIUS + 4) return "p3";
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
      const handle = dragging.current;

      if (handle === "p0") {
        // Constrain p0x to be less than p3x
        const constrainedX = Math.min(nx, value.p3x - 0.01);
        onChange({ ...value, p0x: constrainedX, p0y: ny });
      } else if (handle === "p1") {
        onChange({ ...value, p1x: nx, p1y: ny });
      } else if (handle === "p2") {
        onChange({ ...value, p2x: nx, p2y: ny });
      } else if (handle === "p3") {
        // Constrain p3x to be greater than p0x
        const constrainedX = Math.max(nx, value.p0x + 0.01);
        onChange({ ...value, p3x: constrainedX, p3y: ny });
      }
    } else {
      setHovered(getHitHandle(cx, cy));
    }
  };

  const onMouseUp = () => { dragging.current = null; };

  const onDoubleClick = () => {
    // Reset to linear diagonal with default endpoints
    onChange({ p0x: 0, p0y: 0, p1x: 0.33, p1y: 0.33, p2x: 0.67, p2y: 0.67, p3x: 1, p3y: 1 });
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
