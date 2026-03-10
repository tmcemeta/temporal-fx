// TEMPORAL FX — MaskColorPicker Component
// 5 color swatches that the user can click to edit.
// Each swatch maps to a maskColor slot used by the subject extraction shader.

import React, { useRef } from "react";
import type { RGBColor } from "@/lib/types";

interface Props {
  colors: RGBColor[];
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
    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
      {colors.map((color, i) => (
        <div key={i} style={{ position: "relative" }}>
          <div
            onClick={() => inputRefs.current[i]?.click()}
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "3px",
              background: rgbToHex(color),
              border: "1px solid rgba(255,255,255,0.15)",
              cursor: "pointer",
              transition: "border-color 0.15s",
              boxShadow: `0 0 0 0 transparent`,
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLDivElement).style.borderColor = "#4ecdc4";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.15)";
            }}
            title={`Mask color ${i + 1}: ${rgbToHex(color)}`}
          />
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
      <span style={{ fontSize: "10px", color: "rgba(78,205,196,0.5)", marginLeft: "4px" }}>
        mask keys
      </span>
    </div>
  );
}
