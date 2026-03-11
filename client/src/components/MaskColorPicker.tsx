// SIMPLE SUBJECT — MaskColorPicker Component
// Renders color swatches for the active mask key slots.
// allColors contains all 5 slots; colors is the active subset (length = maskCount).
// onChange is called with the global slot index and the new color.

import React, { useRef } from "react";
import type { RGBColor } from "@/lib/types";

interface Props {
  colors: RGBColor[];       // active colors (length = maskCount)
  allColors: RGBColor[];    // all 5 slots (for index mapping)
  onChange: (index: number, color: RGBColor) => void;
}

function rgbToHex(c: RGBColor): string {
  const r = Math.round(c.r * 255).toString(16).padStart(2, "0");
  const g = Math.round(c.g * 255).toString(16).padStart(2, "0");
  const b = Math.round(c.b * 255).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

function hexToRgb(hex: string): RGBColor {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return { r, g, b };
}

export default function MaskColorPicker({ colors, onChange }: Props) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  return (
    <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
      {colors.map((color, i) => (
        <div key={i} style={{ position: "relative" }}>
          <div
            onClick={() => inputRefs.current[i]?.click()}
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "3px",
              background: rgbToHex(color),
              border: "1px solid rgba(255,255,255,0.15)",
              cursor: "pointer",
              transition: "border-color 0.15s, box-shadow 0.15s",
              position: "relative",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLDivElement).style.borderColor = "#4ecdc4";
              (e.currentTarget as HTMLDivElement).style.boxShadow = "0 0 0 1px rgba(78,205,196,0.3)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.15)";
              (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
            }}
            title={`Key color ${i + 1}: ${rgbToHex(color)}`}
          >
            {/* Slot number label */}
            <span style={{
              position: "absolute",
              bottom: "1px",
              right: "3px",
              fontFamily: "'DM Mono', monospace",
              fontSize: "8px",
              color: "rgba(255,255,255,0.5)",
              lineHeight: 1,
              pointerEvents: "none",
              textShadow: "0 0 2px rgba(0,0,0,0.8)",
            }}>
              {i + 1}
            </span>
          </div>
          <input
            ref={el => { inputRefs.current[i] = el; }}
            type="color"
            value={rgbToHex(color)}
            onChange={e => onChange(i, hexToRgb(e.target.value))}
            style={{
              position: "absolute",
              opacity: 0,
              width: 0,
              height: 0,
              pointerEvents: "none",
            }}
          />
        </div>
      ))}
    </div>
  );
}
