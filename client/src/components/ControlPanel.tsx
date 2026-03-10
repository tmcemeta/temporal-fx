// TEMPORAL FX — ControlPanel Component
// "Cinematic Void" design: dark panel, teal section headers, DM Mono typography.
// Contains all 8 FX parameters + mask colors + presets + save/load state.

import React, { useRef } from "react";
import type { FXState, BlendMode, PixelWeightMode } from "@/lib/types";
import { DEFAULT_STATE, PRESETS } from "@/lib/types";
import BezierEditor from "./BezierEditor";
import MaskColorPicker from "./MaskColorPicker";

interface Props {
  state: FXState;
  onChange: (patch: Partial<FXState>) => void;
  onLoadBase: () => void;
  onLoadMask: () => void;
  hasBase: boolean;
  hasMask: boolean;
  baseFileName: string;
  maskFileName: string;
  bufferWarmup: number; // 0..1, how full the history buffer is
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
  minWidth: "32px",
  textAlign: "right" as const,
};

const PARAM_LABEL: React.CSSProperties = {
  fontFamily: "'DM Mono', monospace",
  fontSize: "11px",
  color: "rgba(232,232,232,0.7)",
  minWidth: "90px",
  flexShrink: 0,
};

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  display?: string;
}) {
  return (
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
  );
}

export default function ControlPanel({
  state,
  onChange,
  onLoadBase,
  onLoadMask,
  hasBase,
  hasMask,
  baseFileName,
  maskFileName,
  bufferWarmup,
}: Props) {
  const saveRef = useRef<HTMLAnchorElement>(null);
  const loadRef = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    const json = JSON.stringify(state, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = saveRef.current!;
    a.href = url;
    a.download = "temporal-fx-state.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const loaded = JSON.parse(ev.target?.result as string) as FXState;
        onChange(loaded);
      } catch {
        alert("Invalid state file.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const applyPreset = (name: string) => {
    const preset = PRESETS[name];
    if (preset) onChange(preset);
  };

  const blendModes: BlendMode[] = ["screen", "add", "multiply", "overlay", "difference", "average"];
  const weightModes: PixelWeightMode[] = ["uniform", "luminance", "darkness", "motion"];

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
        }}>TEMPORAL FX</span>
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
            onClick={onLoadBase}
            style={{
              background: hasBase ? "rgba(78,205,196,0.08)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${hasBase ? "rgba(78,205,196,0.4)" : "rgba(255,255,255,0.1)"}`,
              color: hasBase ? "#4ecdc4" : "rgba(232,232,232,0.5)",
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
            {hasBase ? `✓ ${baseFileName}` : "Load Base Video"}
          </button>
          <button
            onClick={onLoadMask}
            style={{
              background: hasMask ? "rgba(78,205,196,0.08)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${hasMask ? "rgba(78,205,196,0.4)" : "rgba(255,255,255,0.1)"}`,
              color: hasMask ? "#4ecdc4" : "rgba(232,232,232,0.5)",
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
            {hasMask ? `✓ ${maskFileName}` : "Load Mask Video (optional)"}
          </button>
          {hasMask && (
            <div style={{ marginTop: "6px" }}>
              <button
                onClick={() => onChange({ excludeMaskFromEffect: !state.excludeMaskFromEffect })}
                style={{
                  width: "100%",
                  background: state.excludeMaskFromEffect
                    ? "rgba(78,205,196,0.12)"
                    : "rgba(255,255,255,0.03)",
                  border: `1px solid ${
                    state.excludeMaskFromEffect
                      ? "rgba(78,205,196,0.5)"
                      : "rgba(255,255,255,0.1)"
                  }`,
                  color: state.excludeMaskFromEffect
                    ? "#4ecdc4"
                    : "rgba(232,232,232,0.45)",
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
                  marginBottom: "6px",
                }}
              >
                <span style={{
                  width: "10px",
                  height: "10px",
                  borderRadius: "2px",
                  border: `1px solid ${
                    state.excludeMaskFromEffect
                      ? "#4ecdc4"
                      : "rgba(255,255,255,0.2)"
                  }`,
                  background: state.excludeMaskFromEffect
                    ? "#4ecdc4"
                    : "transparent",
                  display: "inline-block",
                  flexShrink: 0,
                  transition: "all 0.15s",
                }} />
                Exclude Mask from Effect
              </button>
              <MaskColorPicker
                colors={state.maskColors}
                onChange={(i, color) => {
                  const newColors = [...state.maskColors];
                  newColors[i] = color;
                  onChange({ maskColors: newColors });
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Presets */}
      <div style={SECTION_STYLE}>
        <span style={LABEL_STYLE}>Presets</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
          {Object.keys(PRESETS).map(name => (
            <button
              key={name}
              onClick={() => applyPreset(name)}
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "rgba(232,232,232,0.65)",
                padding: "4px 8px",
                fontFamily: "'DM Mono', monospace",
                fontSize: "10px",
                cursor: "pointer",
                borderRadius: "2px",
                transition: "all 0.15s",
                letterSpacing: "0.05em",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "#4ecdc4";
                (e.currentTarget as HTMLButtonElement).style.color = "#4ecdc4";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.1)";
                (e.currentTarget as HTMLButtonElement).style.color = "rgba(232,232,232,0.65)";
              }}
            >
              {name}
            </button>
          ))}
          <button
            onClick={() => onChange(DEFAULT_STATE)}
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
              color: "rgba(160,160,160,0.5)",
              padding: "4px 8px",
              fontFamily: "'DM Mono', monospace",
              fontSize: "10px",
              cursor: "pointer",
              borderRadius: "2px",
              transition: "all 0.15s",
            }}
          >
            Reset
          </button>
        </div>
      </div>

      {/* Temporal */}
      <div style={SECTION_STYLE}>
        <span style={LABEL_STYLE}>Temporal</span>

        <SliderRow
          label="History Depth"
          value={state.historyDepth}
          min={0}
          max={60}
          step={1}
          onChange={v => onChange({ historyDepth: v })}
          display={`${state.historyDepth}f`}
        />

        <SliderRow
          label="Feedback Mix"
          value={state.feedbackMix}
          min={0}
          max={1}
          step={0.01}
          onChange={v => onChange({ feedbackMix: v })}
          display={state.feedbackMix.toFixed(2)}
        />

        <div style={{ marginBottom: "4px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
            <span style={{ ...PARAM_LABEL, fontSize: "10px" }}>History Curve</span>
            <span style={{ fontSize: "9px", color: "rgba(78,205,196,0.4)" }}>dbl-click to reset</span>
          </div>
          <BezierEditor
            value={state.historyCurve}
            onChange={c => onChange({ historyCurve: c })}
            width={292}
            height={90}
            xLabel="recent → old"
            yLabel="weight"
          />
        </div>
      </div>

      {/* Pixel Weight */}
      <div style={SECTION_STYLE}>
        <span style={LABEL_STYLE}>Pixel Weight</span>

        <div style={ROW_STYLE}>
          <span style={PARAM_LABEL}>Mode</span>
          <select
            value={state.pixelWeightMode}
            onChange={e => onChange({ pixelWeightMode: e.target.value as PixelWeightMode })}
            style={{ flex: 1 }}
          >
            {weightModes.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        {state.pixelWeightMode !== "uniform" && (
          <div style={{ marginBottom: "4px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
              <span style={{ ...PARAM_LABEL, fontSize: "10px" }}>Weight Curve</span>
              <span style={{ fontSize: "9px", color: "rgba(78,205,196,0.4)" }}>dbl-click to reset</span>
            </div>
            <BezierEditor
              value={state.pixelWeightCurve}
              onChange={c => onChange({ pixelWeightCurve: c })}
              width={292}
              height={90}
              xLabel="value →"
              yLabel="contrib"
            />
          </div>
        )}
      </div>

      {/* Blend */}
      <div style={SECTION_STYLE}>
        <span style={LABEL_STYLE}>Blend</span>

        <div style={ROW_STYLE}>
          <span style={PARAM_LABEL}>Mode</span>
          <select
            value={state.blendMode}
            onChange={e => onChange({ blendMode: e.target.value as BlendMode })}
            style={{ flex: 1 }}
          >
            {blendModes.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        <SliderRow
          label="Strength"
          value={state.blendStrength}
          min={0}
          max={1}
          step={0.01}
          onChange={v => onChange({ blendStrength: v })}
          display={state.blendStrength.toFixed(2)}
        />

        <SliderRow
          label="Chroma Spread"
          value={state.chromaticSpread}
          min={0}
          max={10}
          step={0.5}
          onChange={v => onChange({ chromaticSpread: v })}
          display={state.chromaticSpread === 0 ? "off" : `${state.chromaticSpread}f`}
        />
      </div>

      {/* Buffer warmup indicator */}
      {bufferWarmup < 1 && state.historyDepth > 0 && (
        <div style={{ padding: "8px 14px", borderBottom: "1px solid rgba(78,205,196,0.08)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
            <span style={{ fontSize: "9px", color: "rgba(78,205,196,0.5)", fontFamily: "'DM Mono', monospace" }}>
              BUFFER WARMING
            </span>
            <span style={{ fontSize: "9px", color: "rgba(78,205,196,0.5)", fontFamily: "'DM Mono', monospace" }}>
              {Math.round(bufferWarmup * 100)}%
            </span>
          </div>
          <div style={{ height: "2px", background: "rgba(255,255,255,0.06)", borderRadius: "1px" }}>
            <div style={{
              height: "100%",
              width: `${bufferWarmup * 100}%`,
              background: "#4ecdc4",
              borderRadius: "1px",
              transition: "width 0.1s linear",
              boxShadow: "0 0 6px rgba(78,205,196,0.6)",
            }} />
          </div>
        </div>
      )}

      {/* Keyboard shortcuts hint */}
      <div style={{ padding: "8px 14px", borderTop: "1px solid rgba(78,205,196,0.06)", borderBottom: "1px solid rgba(78,205,196,0.06)" }}>
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
          {[["space", "play/pause"], ["dbl-click", "reset curve"]].map(([key, desc]) => (
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

      {/* Save / Load */}
      <div style={{ padding: "12px 14px", marginTop: "auto" }}>
        <span style={LABEL_STYLE}>State</span>
        <div style={{ display: "flex", gap: "6px" }}>
          <button
            onClick={handleSave}
            style={{
              flex: 1,
              background: "rgba(78,205,196,0.08)",
              border: "1px solid rgba(78,205,196,0.3)",
              color: "#4ecdc4",
              padding: "7px",
              fontFamily: "'DM Mono', monospace",
              fontSize: "11px",
              cursor: "pointer",
              borderRadius: "2px",
              transition: "all 0.15s",
            }}
          >
            Save JSON
          </button>
          <button
            onClick={() => loadRef.current?.click()}
            style={{
              flex: 1,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "rgba(232,232,232,0.6)",
              padding: "7px",
              fontFamily: "'DM Mono', monospace",
              fontSize: "11px",
              cursor: "pointer",
              borderRadius: "2px",
              transition: "all 0.15s",
            }}
          >
            Load JSON
          </button>
        </div>
        <a ref={saveRef} style={{ display: "none" }} />
        <input
          ref={loadRef}
          type="file"
          accept=".json"
          style={{ display: "none" }}
          onChange={handleLoad}
        />
      </div>
    </div>
  );
}
