// TEMPORAL FX — Main Page
// "Cinematic Void" design: full-height two-column layout.
// Left: VideoPreview (WebGL canvas + playback controls)
// Right: ControlPanel (all FX parameters)
//
// Video format: a single hstack-encoded file produced by:
//   ffmpeg -y -i "$BASE_VIDEO" -i "$MASK_VIDEO" -filter_complex hstack "$OUTPUT_VIDEO"
// The left half of the video is the base; the right half is the mask.
// A single decoder guarantees lockstep playback — no drift correction needed.

import React, { useState, useCallback, useRef } from "react";
import type { FXState } from "@/lib/types";
import { DEFAULT_STATE } from "@/lib/types";
import VideoPreview from "@/components/VideoPreview";
import ControlPanel from "@/components/ControlPanel";

export default function Home() {
  const [state, setState] = useState<FXState>(DEFAULT_STATE);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoFileName, setVideoFileName] = useState("");
  const [bufferWarmup, setBufferWarmup] = useState(1);

  const videoInputRef = useRef<HTMLInputElement>(null);

const handleStateChange = useCallback((patch: Partial<FXState>) => {
    setState(prev => {
      const next = { ...prev, ...patch };
      // Migration guard: ensure postFX exists with defaults
      if (!next.postFX) {
        next.postFX = DEFAULT_STATE.postFX;
      }
      // Migration guard: ensure halation exists with defaults (for old JSON files)
      if (!next.postFX.halation) {
        next.postFX = {
          ...next.postFX,
          halation: DEFAULT_STATE.postFX.halation,
        };
      }
      // Migration guard: ensure bezier curves have all 4 control points (for old JSON files)
      if (next.historyCurve && next.historyCurve.p0x === undefined) {
        next.historyCurve = {
          p0x: 0, p0y: 0,
          p1x: next.historyCurve.p1x, p1y: next.historyCurve.p1y,
          p2x: next.historyCurve.p2x, p2y: next.historyCurve.p2y,
          p3x: 1, p3y: 1,
        };
      }
      if (next.pixelWeightCurve && next.pixelWeightCurve.p0x === undefined) {
        next.pixelWeightCurve = {
          p0x: 0, p0y: 0,
          p1x: next.pixelWeightCurve.p1x, p1y: next.pixelWeightCurve.p1y,
          p2x: next.pixelWeightCurve.p2x, p2y: next.pixelWeightCurve.p2y,
          p3x: 1, p3y: 1,
        };
      }
      return next;
    });
  }, []);

  const handleLoadVideo = () => videoInputRef.current?.click();

  const handleVideoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setVideoFileName(file.name);
    e.target.value = "";
  };

  const handleDropVideo = (file: File) => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setVideoFileName(file.name);
  };

  return (
    <div style={{
      width: "100vw",
      height: "100vh",
      display: "flex",
      flexDirection: "row",
      background: "#080808",
      overflow: "hidden",
    }}>
      {/* Preview area */}
      <VideoPreview
        videoUrl={videoUrl}
        state={state}
        onBufferWarmup={setBufferWarmup}
        onDropVideo={handleDropVideo}
      />

      {/* Controls panel */}
      <ControlPanel
        state={state}
        onChange={handleStateChange}
        onLoadVideo={handleLoadVideo}
        hasVideo={!!videoUrl}
        videoFileName={videoFileName}
        bufferWarmup={bufferWarmup}
      />

      {/* Hidden file input */}
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        style={{ display: "none" }}
        onChange={handleVideoFile}
      />
    </div>
  );
}
