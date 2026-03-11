// SIMPLE SUBJECT — ControlPanel Component
// "Cinematic Void" design: dark panel, teal section headers, DM Mono typography.
// Contains only subject extraction controls: mask keys, edge quality, view modes.

import React from "react";
import type { SubjectState, ViewMode } from "@/lib/types";
import { DEFAULT_STATE } from "@/lib/types";
import MaskColorPicker from "./MaskColorPicker";

interface Props {
  state: SubjectState;
  onChange: (patch: Partial<SubjectState>) => void;
  onLoadVideo: () => void;
  hasVideo: boolean;
  videoFileName: string;
}

const SECTION_STYLE: React.CSSProperties = {
  padding: "12px 14px",
  borderBottom: "1px solid rgba(78,205,196,0.12)",
};

const LABEL_STYLE: React.CSSProperties = {
  fontFamily: "'DM Mono', monospace",
  fontSize: "10px",
  fontWeight: 500,
  letterSpacing: "0.12em",
  textTransform: "uppercase" as const,
  color: "rgba(78,205,196,0.75)",
  marginBottom: "10px",
  display: "block",
};

const ROW_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  marginBottom: "10px",
};

const VALUE_STYLE: React.CSSProperties = {
  fontFamily: "'DM Mono', monospace",
  fontSize: "11px",
  color: "#4ecdc4",
  minWidth: "36px",
  textAlign: "right" as const,
};

const PARAM_LABEL: React.CSSProperties = {
  fontFamily: "'DM Mono', monospace",
  fontSize: "11px",
  color: "rgba(232,232,232,0.7)",
  minWidth: "110px",
  flexShrink: 0,
};

const HINT_STYLE: React.CSSProperties = {
  fontFamily: "'DM Mono', monospace",
  fontSize: "9px",
  color: "rgba(78,205,196,0.35)",
  letterSpacing: "0.05em",
  marginTop: "3px",
};

function SliderRow({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
  display,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  display?: string;
}) {
  return (
    <div style={{ marginBottom: "12px" }}>
      <div style={ROW_STYLE}>
        <span style={PARAM_LABEL}>{label}</span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          style={{ flex: 1 }}
        />
        <span style={VALUE_STYLE}>{display ?? value}</span>
      </div>
      {hint && <div style={HINT_STYLE}>{hint}</div>}
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  active,
  onToggle,
}: {
  label: string;
  hint?: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={{ marginBottom: "10px" }}>
      <button
        onClick={onToggle}
        style={{
          width: "100%",
          background: active ? "rgba(78,205,196,0.12)" : "rgba(255,255,255,0.03)",
          border: `1px solid ${active ? "rgba(78,205,196,0.5)" : "rgba(255,255,255,0.1)"}`,
          color: active ? "#4ecdc4" : "rgba(232,232,232,0.45)",
          padding: "6px 10px",
          fontFamily: "'DM Mono', monospace",
          fontSize: "10px",
          cursor: "pointer",
          borderRadius: "2px",
          textAlign: "left" as const,
          letterSpacing: "0.08em",
          transition: "all 0.15s",
          display: "flex",
          alignItems: "center",
          gap: "7px",
        }}
      >
        <span style={{
          width: "10px",
          height: "10px",
          borderRadius: "2px",
          border: `1px solid ${active ? "#4ecdc4" : "rgba(255,255,255,0.2)"}`,
          background: active ? "#4ecdc4" : "transparent",
          display: "inline-block",
          flexShrink: 0,
          transition: "all 0.15s",
        }} />
        {label}
      </button>
      {hint && <div style={{ ...HINT_STYLE, marginTop: "4px" }}>{hint}</div>}
    </div>
  );
}

export default function ControlPanel({
  state,
  onChange,
  onLoadVideo,
  hasVideo,
  videoFileName,
}: Props) {
  const VIEW_LABELS: { label: string; mode: ViewMode }[] = [
    { label: "Normal", mode: 0 },
    { label: "Subject", mode: 1 },
    { label: "Background", mode: 2 },
    { label: "Raw Input", mode: 3 },
  ];

  return (
    <div style={{
      width: "320px",
      minWidth: "320px",
      height: "100%",
      overflowY: "auto",
      background: "#0f0f0f",
      borderLeft: "1px solid rgba(78,205,196,0.12)",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        padding: "14px",
        borderBottom: "1px solid rgba(78,205,196,0.2)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <span style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: "13px",
          fontWeight: 500,
          color: "#e8e8e8",
          letterSpacing: "0.05em",
        }}>SIMPLE SUBJECT</span>
        <span style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: "9px",
          color: "rgba(78,205,196,0.5)",
          letterSpacing: "0.1em",
        }}>v1.0</span>
      </div>

      {/* Media Load */}
      <div style={SECTION_STYLE}>
        <span style={LABEL_STYLE}>Media</span>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <button
            onClick={onLoadVideo}
            style={{
              background: hasVideo ? "rgba(78,205,196,0.08)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${hasVideo ? "rgba(78,205,196,0.4)" : "rgba(255,255,255,0.1)"}`,
              color: hasVideo ? "#4ecdc4" : "rgba(232,232,232,0.5)",
              padding: "7px 10px",
              fontFamily: "'DM Mono', monospace",
              fontSize: "11px",
              cursor: "pointer",
              borderRadius: "2px",
              textAlign: "left",
              transition: "all 0.15s",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {hasVideo ? `✓ ${videoFileName}` : "Load Video"}
          </button>

          <ToggleRow
            label="Side-by-Side Input (base | mask)"
            hint={state.isHstack ? "left half = base, right half = mask" : undefined}
            active={state.isHstack}
            onToggle={() => onChange({ isHstack: !state.isHstack })}
          />
        </div>
      </div>

      {/* View Mode */}
      <div style={SECTION_STYLE}>
        <span style={LABEL_STYLE}>View</span>
        <div style={{ display: "flex", gap: "5px", marginBottom: "8px" }}>
          {VIEW_LABELS.map(({ label, mode }) => {
            const active = state.viewMode === mode;
            return (
              <button
                key={mode}
                onClick={() => onChange({ viewMode: mode })}
                style={{
                  flex: 1,
                  background: active ? "rgba(78,205,196,0.14)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${active ? "rgba(78,205,196,0.5)" : "rgba(255,255,255,0.1)"}`,
                  color: active ? "#4ecdc4" : "rgba(232,232,232,0.45)",
                  padding: "5px 2px",
                  fontFamily: "'DM Mono', monospace",
                  fontSize: "9px",
                  cursor: "pointer",
                  borderRadius: "2px",
                  letterSpacing: "0.05em",
                  transition: "all 0.15s",
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Raw Input half selector */}
        {state.viewMode === 3 && (
          <div style={{ display: "flex", gap: "5px" }}>
            {[{ label: "Base", val: true }, { label: "Mask", val: false }].map(({ label, val }) => {
              const active = state.rawInputShowBase === val;
              return (
                <button
                  key={label}
                  onClick={() => onChange({ rawInputShowBase: val })}
                  style={{
                    flex: 1,
                    background: active ? "rgba(78,205,196,0.1)" : "rgba(255,255,255,0.02)",
                    border: `1px solid ${active ? "rgba(78,205,196,0.4)" : "rgba(255,255,255,0.08)"}`,
                    color: active ? "#4ecdc4" : "rgba(232,232,232,0.35)",
                    padding: "4px",
                    fontFamily: "'DM Mono', monospace",
                    fontSize: "9px",
                    cursor: "pointer",
                    borderRadius: "2px",
                    letterSpacing: "0.05em",
                    transition: "all 0.15s",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Mask Keys */}
      <div style={SECTION_STYLE}>
        <span style={LABEL_STYLE}>Mask Keys</span>

        <div style={{ ...ROW_STYLE, marginBottom: "12px" }}>
          <span style={PARAM_LABEL}>Active Colors</span>
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={state.maskCount}
            onChange={e => onChange({ maskCount: parseInt(e.target.value) })}
            style={{ flex: 1 }}
          />
          <span style={VALUE_STYLE}>{state.maskCount}</span>
        </div>

        <MaskColorPicker
          colors={state.maskColors.slice(0, state.maskCount)}
          allColors={state.maskColors}
          onChange={(i, color) => {
            const newColors = [...state.maskColors];
            newColors[i] = color;
            onChange({ maskColors: newColors });
          }}
        />

        <div style={{ ...HINT_STYLE, marginTop: "8px" }}>
          click a swatch to change the key color
        </div>
      </div>

      {/* Keying Quality */}
      <div style={SECTION_STYLE}>
        <span style={LABEL_STYLE}>Keying Quality</span>

        <SliderRow
          label="Edge Softness"
          hint="color-distance tolerance — lower = harder edge"
          value={state.edgeSoftness}
          min={0.05}
          max={2.0}
          step={0.05}
          onChange={v => onChange({ edgeSoftness: v })}
          display={state.edgeSoftness.toFixed(2)}
        />

        <SliderRow
          label="Min Luma"
          hint="ignore mask pixels darker than this — prevents shadow bleed"
          value={state.minLuma}
          min={0}
          max={0.5}
          step={0.01}
          onChange={v => onChange({ minLuma: v })}
          display={state.minLuma.toFixed(2)}
        />

        <ToggleRow
          label="Spill Suppression"
          hint="desaturates key-color fringing on subject edges"
          active={state.spillSuppression}
          onToggle={() => onChange({ spillSuppression: !state.spillSuppression })}
        />

        {state.spillSuppression && (
          <SliderRow
            label="Spill Strength"
            value={state.spillStrength}
            min={0}
            max={1}
            step={0.05}
            onChange={v => onChange({ spillStrength: v })}
            display={state.spillStrength.toFixed(2)}
          />
        )}
      </div>

      {/* Bounding Box */}
      <div style={SECTION_STYLE}>
        <span style={LABEL_STYLE}>Bounding Box</span>

        <ToggleRow
          label="Show BBox Overlay"
          hint="draws a labeled rectangle per active mask color"
          active={state.showBbox}
          onToggle={() => onChange({ showBbox: !state.showBbox })}
        />

        {state.showBbox && (
          <SliderRow
            label="BBox Samples"
            hint={`${(state.bboxSamples + 1) ** 2} total samples per color`}
            value={state.bboxSamples}
            min={10}
            max={100}
            step={5}
            onChange={v => onChange({ bboxSamples: v })}
            display={`${state.bboxSamples}`}
          />
        )}
      </div>

      {/* Keyboard shortcuts */}
      <div style={{ padding: "8px 14px", borderBottom: "1px solid rgba(78,205,196,0.06)" }}>
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
          {[["space", "play/pause"]].map(([key, desc]) => (
            <div key={key} style={{ display: "flex", gap: "5px", alignItems: "center" }}>
              <span style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: "9px",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
                padding: "1px 5px",
                borderRadius: "2px",
                color: "rgba(232,232,232,0.5)",
              }}>{key}</span>
              <span style={{ fontSize: "9px", color: "rgba(160,160,160,0.4)", fontFamily: "'DM Mono', monospace" }}>{desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Reset */}
      <div style={{ padding: "12px 14px", marginTop: "auto" }}>
        <button
          onClick={() => onChange(DEFAULT_STATE)}
          style={{
            width: "100%",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "rgba(160,160,160,0.5)",
            padding: "7px",
            fontFamily: "'DM Mono', monospace",
            fontSize: "11px",
            cursor: "pointer",
            borderRadius: "2px",
            transition: "all 0.15s",
            letterSpacing: "0.06em",
          }}
        >
          Reset to Defaults
        </button>
      </div>
    </div>
  );
}
