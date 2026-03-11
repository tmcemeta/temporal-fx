// TEMPORAL FX — VideoPreview Component
// Hosts the WebGL canvas, a single hidden video element, and playback controls.
// Runs the render loop via requestAnimationFrame.
//
// Video format: hstack-encoded (base = left half, mask = right half).
// A single <video> element decodes both halves in lockstep — no drift is possible.
// The engine receives the video element and the logical frame width (videoWidth / 2);
// it uses UNPACK_ROW_LENGTH / UNPACK_SKIP_PIXELS to upload each half independently.

import React, { useRef, useEffect, useCallback, useState } from "react";
import type { FXState } from "@/lib/types";
import { TemporalFXEngine } from "@/lib/webglEngine";

interface Props {
  videoUrl: string | null;
  state: FXState;
  onBufferWarmup: (ratio: number) => void;
  onDropVideo?: (file: File) => void;
}

export default function VideoPreview({ videoUrl, state, onBufferWarmup, onDropVideo }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<TemporalFXEngine | null>(null);
  const rafRef = useRef<number>(0);
  const stateRef = useRef(state);
  const containerRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLooping, setIsLooping] = useState(true);

  // Use a ref for logical frame dimensions to avoid stale closures in the render loop.
  // For an hstack video, logicalWidth = videoWidth / 2, logicalHeight = videoHeight.
  const frameDimsRef = useRef({ w: 0, h: 0 });
  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 }); // for aspect ratio display only

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
    const video = videoRef.current;
    if (!engine || !video || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(renderLoop);
      return;
    }

    // Logical frame size: each half of the hstack video
    const fw = Math.floor(video.videoWidth / 2) || 320;
    const fh = video.videoHeight || 240;

    // Resize (and clear history) only when logical dimensions change
    if (fw !== frameDimsRef.current.w || fh !== frameDimsRef.current.h) {
      frameDimsRef.current = { w: fw, h: fh };
      setVideoSize({ w: fw, h: fh });
      engine.resize(fw, fh);
    }

    engine.renderFrame(video, stateRef.current);

    // Update buffer warmup indicator
    const depth = stateRef.current.historyDepth;
    if (depth > 0) {
      onBufferWarmup(Math.min(engine.historyFilled / depth, 1));
    } else {
      onBufferWarmup(1);
    }

    setCurrentTime(video.currentTime);

    rafRef.current = requestAnimationFrame(renderLoop);
  }, [onBufferWarmup]);

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
    // Reset dims ref so resize fires on the new video's first frame
    frameDimsRef.current = { w: 0, h: 0 };
    engineRef.current?.clearHistory();
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

  // Clear history on seek — temporal continuity is broken by any time jump
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    const onSeeked = () => {
      engineRef.current?.clearHistory();
    };
    video.addEventListener("seeked", onSeeked);
    return () => video.removeEventListener("seeked", onSeeked);
  }, [videoUrl]);

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    const video = videoRef.current;
    if (video) {
      video.currentTime = t;
      engineRef.current?.clearHistory();
    }
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

  // Compute display aspect ratio from logical (single-half) dimensions
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
        <canvas
          ref={canvasRef}
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            display: videoUrl ? "block" : "none",
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

      {/* Single hidden video element — decodes the full hstack stream */}
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
