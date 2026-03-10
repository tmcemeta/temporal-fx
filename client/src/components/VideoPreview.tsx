// TEMPORAL FX — VideoPreview Component
// Hosts the WebGL canvas, hidden video elements, and playback controls.
// Runs the render loop via requestAnimationFrame.

import React, { useRef, useEffect, useCallback, useState } from "react";
import type { FXState } from "@/lib/types";
import { TemporalFXEngine } from "@/lib/webglEngine";

interface Props {
  baseUrl: string | null;
  maskUrl: string | null;
  state: FXState;
  onBufferWarmup: (ratio: number) => void;
  onDropVideo?: (file: File) => void;
}

export default function VideoPreview({ baseUrl, maskUrl, state, onBufferWarmup, onDropVideo }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseVideoRef = useRef<HTMLVideoElement>(null);
  const maskVideoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<TemporalFXEngine | null>(null);
  const rafRef = useRef<number>(0);
  const stateRef = useRef(state);
  const containerRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLooping, setIsLooping] = useState(true);
  // Use a ref for video dimensions to avoid stale closure in the render loop
  const videoDimsRef = useRef({ w: 0, h: 0 });
  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 });  // for aspect ratio display only

  // Keep stateRef in sync without triggering re-renders
  useEffect(() => { stateRef.current = state; }, [state]);

  // Init engine
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      engineRef.current = new TemporalFXEngine(canvas);
    } catch (e) {
      console.error("WebGL init failed:", e);
    }
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  // Render loop
  const renderLoop = useCallback(() => {
    const engine = engineRef.current;
    const base = baseVideoRef.current;
    if (!engine || !base || base.readyState < 2) {
      rafRef.current = requestAnimationFrame(renderLoop);
      return;
    }

    const mask = maskVideoRef.current;

    // Resize canvas to match video dimensions
    const vw = base.videoWidth || 640;
    const vh = base.videoHeight || 360;
    // Only resize (and clear history) when dimensions actually change
    // Use a ref so this comparison is stable across RAF frames
    if (vw !== videoDimsRef.current.w || vh !== videoDimsRef.current.h) {
      videoDimsRef.current = { w: vw, h: vh };
      setVideoSize({ w: vw, h: vh }); // update display aspect ratio
      engine.resize(vw, vh);
    }

    engine.renderFrame(base, mask && mask.readyState >= 2 ? mask : null, stateRef.current);

    // Update buffer warmup
    const depth = stateRef.current.historyDepth;
    if (depth > 0) {
      const filled = engine.historyFilled;
      onBufferWarmup(Math.min(filled / depth, 1));
    } else {
      onBufferWarmup(1);
    }

    // Sync time display
    setCurrentTime(base.currentTime);

    rafRef.current = requestAnimationFrame(renderLoop);
  }, [onBufferWarmup]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [renderLoop]);

  // Load base video
  useEffect(() => {
    const video = baseVideoRef.current;
    if (!video) return;
    if (baseUrl) {
      video.src = baseUrl;
      video.load();
      video.onloadedmetadata = () => {
        setDuration(video.duration);
        setCurrentTime(0);
      };
    } else {
      video.src = "";
      setDuration(0);
    }
    // Reset dims ref so resize fires on the new video's first frame
    videoDimsRef.current = { w: 0, h: 0 };
    engineRef.current?.clearHistory();
  }, [baseUrl]);

  // Load mask video
  useEffect(() => {
    const video = maskVideoRef.current;
    if (!video) return;
    if (maskUrl) {
      video.src = maskUrl;
      video.load();
    } else {
      video.src = "";
    }
  }, [maskUrl]);

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

  // Sync mask video time with base
  useEffect(() => {
    const base = baseVideoRef.current;
    const mask = maskVideoRef.current;
    if (!base || !mask || !maskUrl) return;

    const syncMask = () => {
      if (Math.abs(mask.currentTime - base.currentTime) > 0.05) {
        mask.currentTime = base.currentTime;
      }
    };
    base.addEventListener("timeupdate", syncMask);
    base.addEventListener("seeked", () => {
      mask.currentTime = base.currentTime;
      engineRef.current?.clearHistory();
    });
    return () => base.removeEventListener("timeupdate", syncMask);
  }, [maskUrl]);

  // Clear history on scrub
  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    const base = baseVideoRef.current;
    if (base) {
      base.currentTime = t;
      engineRef.current?.clearHistory();
    }
  };

  const togglePlay = () => {
    const base = baseVideoRef.current;
    const mask = maskVideoRef.current;
    if (!base) return;
    if (base.paused) {
      base.play();
      mask?.play();
      setIsPlaying(true);
    } else {
      base.pause();
      mask?.pause();
      setIsPlaying(false);
    }
  };

  const toggleLoop = () => {
    const base = baseVideoRef.current;
    const mask = maskVideoRef.current;
    const newLoop = !isLooping;
    setIsLooping(newLoop);
    if (base) base.loop = newLoop;
    if (mask) mask.loop = newLoop;
  };

  const formatTime = (t: number) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const f = Math.floor((t % 1) * 30);
    return `${m}:${s.toString().padStart(2, "0")}.${f.toString().padStart(2, "0")}`;
  };

  // Compute display size for canvas (fit in container)
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
          // Emit a custom event to parent for handling
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
        {!baseUrl && (
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
            <div>LOAD BASE VIDEO</div>
            <div style={{ fontSize: "10px", opacity: 0.6 }}>or drag & drop a video file here</div>
          </div>
        )}
        <canvas
          ref={canvasRef}
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            display: baseUrl ? "block" : "none",
            imageRendering: "pixelated",
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
          disabled={!baseUrl}
          style={{
            background: "none",
            border: "none",
            color: baseUrl ? "#4ecdc4" : "rgba(78,205,196,0.2)",
            fontSize: "16px",
            cursor: baseUrl ? "pointer" : "default",
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
            disabled={!baseUrl}
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

      {/* Hidden video elements */}
      <video
        ref={baseVideoRef}
        loop={isLooping}
        muted
        playsInline
        crossOrigin="anonymous"
        style={{ display: "none" }}
        onEnded={() => setIsPlaying(false)}
      />
      <video
        ref={maskVideoRef}
        loop={isLooping}
        muted
        playsInline
        crossOrigin="anonymous"
        style={{ display: "none" }}
      />
    </div>
  );
}
