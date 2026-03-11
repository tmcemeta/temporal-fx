// SIMPLE SUBJECT — Main Page
// "Cinematic Void" design: full-height two-column layout.
// Left: VideoPreview (WebGL canvas + playback controls)
// Right: ControlPanel (subject extraction controls only)
//
// Video format: a single hstack-encoded file produced by:
//   ffmpeg -y -i "$BASE_VIDEO" -i "$MASK_VIDEO" -filter_complex hstack "$OUTPUT_VIDEO"
// The left half of the video is the base; the right half is the mask.
// A single decoder guarantees lockstep playback — no drift correction needed.

import React, { useState, useCallback, useRef } from "react";
import type { SubjectState } from "@/lib/types";
import { DEFAULT_STATE } from "@/lib/types";
import VideoPreview from "@/components/VideoPreview";
import ControlPanel from "@/components/ControlPanel";

export default function Home() {
  const [state, setState] = useState<SubjectState>(DEFAULT_STATE);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoFileName, setVideoFileName] = useState("");

  const videoInputRef = useRef<HTMLInputElement>(null);

  const handleStateChange = useCallback((patch: Partial<SubjectState>) => {
    setState(prev => ({ ...prev, ...patch }));
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
        onDropVideo={handleDropVideo}
      />

      {/* Controls panel */}
      <ControlPanel
        state={state}
        onChange={handleStateChange}
        onLoadVideo={handleLoadVideo}
        hasVideo={!!videoUrl}
        videoFileName={videoFileName}
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
