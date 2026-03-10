// TEMPORAL FX — Main Page
// "Cinematic Void" design: full-height two-column layout.
// Left: VideoPreview (WebGL canvas + playback controls)
// Right: ControlPanel (all FX parameters)

import React, { useState, useCallback, useRef } from "react";
import type { FXState } from "@/lib/types";
import { DEFAULT_STATE } from "@/lib/types";
import VideoPreview from "@/components/VideoPreview";
import ControlPanel from "@/components/ControlPanel";

export default function Home() {
  const [state, setState] = useState<FXState>(DEFAULT_STATE);
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [maskUrl, setMaskUrl] = useState<string | null>(null);
  const [baseFileName, setBaseFileName] = useState("");
  const [maskFileName, setMaskFileName] = useState("");
  const [bufferWarmup, setBufferWarmup] = useState(1);

  const baseInputRef = useRef<HTMLInputElement>(null);
  const maskInputRef = useRef<HTMLInputElement>(null);

  const handleStateChange = useCallback((patch: Partial<FXState>) => {
    setState(prev => ({ ...prev, ...patch }));
  }, []);

  const handleLoadBase = () => baseInputRef.current?.click();
  const handleLoadMask = () => maskInputRef.current?.click();

  const handleBaseFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (baseUrl) URL.revokeObjectURL(baseUrl);
    const url = URL.createObjectURL(file);
    setBaseUrl(url);
    setBaseFileName(file.name);
    e.target.value = "";
  };

  const handleMaskFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (maskUrl) URL.revokeObjectURL(maskUrl);
    const url = URL.createObjectURL(file);
    setMaskUrl(url);
    setMaskFileName(file.name);
    e.target.value = "";
  };

  const handleDropVideo = (file: File) => {
    if (baseUrl) URL.revokeObjectURL(baseUrl);
    const url = URL.createObjectURL(file);
    setBaseUrl(url);
    setBaseFileName(file.name);
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
        baseUrl={baseUrl}
        maskUrl={maskUrl}
        state={state}
        onBufferWarmup={setBufferWarmup}
        onDropVideo={handleDropVideo}
      />

      {/* Controls panel */}
      <ControlPanel
        state={state}
        onChange={handleStateChange}
        onLoadBase={handleLoadBase}
        onLoadMask={handleLoadMask}
        hasBase={!!baseUrl}
        hasMask={!!maskUrl}
        baseFileName={baseFileName}
        maskFileName={maskFileName}
        bufferWarmup={bufferWarmup}
      />

      {/* Hidden file inputs */}
      <input
        ref={baseInputRef}
        type="file"
        accept="video/*"
        style={{ display: "none" }}
        onChange={handleBaseFile}
      />
      <input
        ref={maskInputRef}
        type="file"
        accept="video/*"
        style={{ display: "none" }}
        onChange={handleMaskFile}
      />
    </div>
  );
}
