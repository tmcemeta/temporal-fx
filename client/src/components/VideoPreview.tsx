// SIMPLE SUBJECT — VideoPreview Component
// Hosts the WebGL canvas, a 2D overlay canvas for bbox drawing,
// a single hidden video element, and playback controls.
// Runs the render loop via requestAnimationFrame.
//
// Video format: hstack-encoded (base = left half, mask = right half).
// A single <video> element decodes both halves in lockstep — no drift is possible.
//
// Bbox overlay: a transparent 2D canvas is stacked on top of the WebGL canvas.
// After each frame, the engine returns per-color BBox results which are drawn
// as labeled rectangles using each mask color.

import React, { useRef, useEffect, useCallback, useState } from "react";
import type { SubjectState, BBox, RGBColor } from "@/lib/types";
import { SubjectEngine } from "@/lib/subjectEngine";

interface Props {
  videoUrl: string | null;
  state: SubjectState;
  onDropVideo?: (file: File) => void;
}

function rgbToCss(c: RGBColor, alpha = 1): string {
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${alpha})`;
}

// Choose a contrasting label color (black or white) based on luma
function labelColor(c: RGBColor): string {
  const luma = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return luma > 0.4 ? "rgba(0,0,0,0.9)" : "rgba(255,255,255,0.9)";
}

export default function VideoPreview({ videoUrl, state, onDropVideo }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<SubjectEngine | null>(null);
  const rafRef = useRef<number>(0);
  const stateRef = useRef(state);
  const containerRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLooping, setIsLooping] = useState(true);

  const frameDimsRef = useRef({ w: 0, h: 0 });
  const prevIsHstackRef = useRef<boolean | undefined>(undefined);
  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 });

  // Keep stateRef in sync without triggering re-renders
  useEffect(() => { stateRef.current = state; }, [state]);

  // Init engine
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      engineRef.current = new SubjectEngine(canvas);
    } catch (e) {
      console.error("WebGL init failed:", e);
    }
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  // Draw bbox overlay on the 2D canvas
  const drawBboxOverlay = useCallback((
    bboxes: Array<BBox | null>,
    colors: RGBColor[],
    canvasW: number,
    canvasH: number,
  ) => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;

    // Match overlay dimensions to the WebGL canvas display size
    if (overlay.width !== canvasW || overlay.height !== canvasH) {
      overlay.width = canvasW;
      overlay.height = canvasH;
    }

    ctx.clearRect(0, 0, canvasW, canvasH);

    bboxes.forEach((bbox, i) => {
      if (!bbox) return;
      const color = colors[i];

      const x = bbox.x1 * canvasW;
      const y = (1 - bbox.y2) * canvasH; // flip Y: WebGL UV origin is bottom-left
      const w = (bbox.x2 - bbox.x1) * canvasW;
      const h = (bbox.y2 - bbox.y1) * canvasH;

      // Outer glow / shadow for visibility on any background
      ctx.shadowColor = "rgba(0,0,0,0.7)";
      ctx.shadowBlur = 4;

      // Rectangle stroke in mask color
      ctx.strokeStyle = rgbToCss(color, 0.9);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, w, h);

      ctx.shadowBlur = 0;

      // Corner accents (L-shaped ticks at each corner)
      const tick = Math.min(w, h) * 0.12;
      ctx.strokeStyle = rgbToCss(color, 1);
      ctx.lineWidth = 2;
      const corners: [number, number, number, number][] = [
        [x, y, tick, tick],
        [x + w, y, -tick, tick],
        [x, y + h, tick, -tick],
        [x + w, y + h, -tick, -tick],
      ];
      corners.forEach(([cx, cy, dx, dy]) => {
        ctx.beginPath();
        ctx.moveTo(cx + dx, cy);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx, cy + dy);
        ctx.stroke();
      });

      // Label: slot number + pixel dimensions
      const pw = Math.round(w);
      const ph = Math.round(h);
      const label = `${i + 1}  ${pw}×${ph}`;
      ctx.font = "bold 10px 'DM Mono', monospace";
      const textW = ctx.measureText(label).width;
      const labelX = x;
      const labelY = y > 16 ? y - 4 : y + h + 13;

      // Label background pill
      ctx.fillStyle = rgbToCss(color, 0.85);
      ctx.beginPath();
      ctx.roundRect(labelX - 2, labelY - 11, textW + 8, 14, 2);
      ctx.fill();

      // Label text
      ctx.fillStyle = labelColor(color);
      ctx.fillText(label, labelX + 2, labelY);
    });
  }, []);

  // Render loop
  const renderLoop = useCallback(() => {
    const engine = engineRef.current;
    const video = videoRef.current;
    if (!engine || !video || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(renderLoop);
      return;
    }

    const s = stateRef.current;
    const isHstack = s.isHstack;

    // Reset frame dimensions when isHstack changes
    if (prevIsHstackRef.current !== undefined && prevIsHstackRef.current !== isHstack) {
      frameDimsRef.current = { w: 0, h: 0 };
    }
    prevIsHstackRef.current = isHstack;

    const fw = Math.floor(isHstack ? video.videoWidth / 2 : video.videoWidth) || 320;
    const fh = video.videoHeight || 240;

    if (fw !== frameDimsRef.current.w || fh !== frameDimsRef.current.h) {
      frameDimsRef.current = { w: fw, h: fh };
      setVideoSize({ w: fw, h: fh });
      engine.resize(fw, fh);
    }

    const bboxes = engine.renderFrame(video, s);
    setCurrentTime(video.currentTime);

    // Draw bbox overlay if enabled
    const glCanvas = canvasRef.current;
    if (s.showBbox && bboxes.length > 0 && glCanvas) {
      drawBboxOverlay(
        bboxes,
        s.maskColors.slice(0, s.maskCount),
        glCanvas.clientWidth,
        glCanvas.clientHeight,
      );
    } else {
      // Clear overlay when bbox is off
      const overlay = overlayRef.current;
      if (overlay) {
        const ctx = overlay.getContext("2d");
        ctx?.clearRect(0, 0, overlay.width, overlay.height);
      }
    }

    rafRef.current = requestAnimationFrame(renderLoop);
  }, [drawBboxOverlay]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [renderLoop]);

  // Load video
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (videoUrl) {
      video.src = videoUrl;
      video.load();
      video.onloadedmetadata = () => {
        setDuration(video.duration);
        setCurrentTime(0);
      };
    } else {
      video.src = "";
      setDuration(0);
    }
    frameDimsRef.current = { w: 0, h: 0 };
  }, [videoUrl]);

  // Keyboard shortcut: spacebar = play/pause
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && e.target === document.body) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isPlaying]);

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    const video = videoRef.current;
    if (video) video.currentTime = t;
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const toggleLoop = () => {
    const video = videoRef.current;
    const newLoop = !isLooping;
    setIsLooping(newLoop);
    if (video) video.loop = newLoop;
  };

  const formatTime = (t: number) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const f = Math.floor((t % 1) * 30);
    return `${m}:${s.toString().padStart(2, "0")}.${f.toString().padStart(2, "0")}`;
  };

  const aspectRatio = videoSize.h > 0 ? videoSize.w / videoSize.h : 16 / 9;

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: "#080808",
        overflow: "hidden",
        position: "relative",
        outline: isDragOver ? "2px solid rgba(78,205,196,0.6)" : "none",
        outlineOffset: "-2px",
      }}
      onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={e => {
        e.preventDefault();
        setIsDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith("video/")) {
          onDropVideo?.(file);
        }
      }}
    >
      {/* Canvas area */}
      <div style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        position: "relative",
      }}>
        {!videoUrl && (
          <div style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "rgba(78,205,196,0.25)",
            fontFamily: "'DM Mono', monospace",
            fontSize: "13px",
            letterSpacing: "0.1em",
            textAlign: "center",
            gap: "12px",
            pointerEvents: "none",
          }}>
            <div style={{ fontSize: "32px", opacity: 0.4 }}>▶</div>
            <div>LOAD HSTACK VIDEO</div>
            <div style={{ fontSize: "10px", opacity: 0.6 }}>base | mask — side by side</div>
            <div style={{ fontSize: "10px", opacity: 0.4 }}>or drag & drop here</div>
          </div>
        )}

        {/* WebGL canvas */}
        <canvas
          ref={canvasRef}
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            aspectRatio: `${aspectRatio}`,
            display: videoUrl ? "block" : "none",
            imageRendering: "pixelated",
            position: "relative",
          }}
        />

        {/* 2D overlay canvas for bbox drawing — sits exactly on top of the WebGL canvas */}
        <canvas
          ref={overlayRef}
          style={{
            position: "absolute",
            maxWidth: "100%",
            maxHeight: "100%",
            aspectRatio: `${aspectRatio}`,
            display: videoUrl ? "block" : "none",
            pointerEvents: "none",
          }}
        />
      </div>

      {/* Playback controls */}
      <div style={{
        height: "48px",
        background: "#0a0a0a",
        borderTop: "1px solid rgba(78,205,196,0.1)",
        display: "flex",
        alignItems: "center",
        padding: "0 14px",
        gap: "12px",
        flexShrink: 0,
      }}>
        {/* Play/Pause */}
        <button
          onClick={togglePlay}
          disabled={!videoUrl}
          style={{
            background: "none",
            border: "none",
            color: videoUrl ? "#4ecdc4" : "rgba(78,205,196,0.2)",
            fontSize: "16px",
            cursor: videoUrl ? "pointer" : "default",
            padding: "0 4px",
            fontFamily: "monospace",
            lineHeight: 1,
            transition: "opacity 0.15s",
          }}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>

        {/* Scrub bar */}
        <div style={{ flex: 1, position: "relative" }}>
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={1 / 30}
            value={currentTime}
            onChange={handleScrub}
            disabled={!videoUrl}
            style={{ width: "100%" }}
          />
        </div>

        {/* Time display */}
        <span style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: "11px",
          color: "rgba(78,205,196,0.6)",
          minWidth: "90px",
          textAlign: "right",
        }}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        {/* Loop toggle */}
        <button
          onClick={toggleLoop}
          style={{
            background: isLooping ? "rgba(78,205,196,0.12)" : "none",
            border: `1px solid ${isLooping ? "rgba(78,205,196,0.4)" : "rgba(255,255,255,0.1)"}`,
            color: isLooping ? "#4ecdc4" : "rgba(232,232,232,0.3)",
            padding: "3px 7px",
            fontFamily: "'DM Mono', monospace",
            fontSize: "10px",
            cursor: "pointer",
            borderRadius: "2px",
            letterSpacing: "0.08em",
            transition: "all 0.15s",
          }}
        >
          LOOP
        </button>
      </div>

      {/* Single hidden video element */}
      <video
        ref={videoRef}
        loop={isLooping}
        muted
        playsInline
        crossOrigin="anonymous"
        style={{ display: "none" }}
        onEnded={() => setIsPlaying(false)}
      />
    </div>
  );
}
