# Temporal FX — Design Brainstorm

## Context
A cinematic pixel propagation webtool for shortform content creators. Dark UI, professional grade, tool-first aesthetic. The interface should feel like a precision instrument — not a consumer app.

---

<response>
<probability>0.07</probability>
<text>

## Idea A — "Darkroom Brutalism"

**Design Movement:** Industrial Brutalism meets analog darkroom aesthetics

**Core Principles:**
1. Raw utility — no decorative chrome, every element earns its place
2. High contrast monochrome base with a single warm amber accent (like a safelight)
3. Typography as structure — labels are architectural, not decorative
4. Controls feel physical — sliders have weight, bezier curves feel like film splices

**Color Philosophy:**
- Background: near-black `#0a0a0a`
- Panel: `#111111` with `1px` borders in `#2a2a2a`
- Accent: amber `#d4820a` — the color of a darkroom safelight, warm and purposeful
- Text: `#c8c8c8` body, `#ffffff` labels, `#666` muted

**Layout Paradigm:**
- Full-height two-column: preview fills left 65%, controls panel right 35%
- Controls panel has no padding — sections are separated by full-width 1px dividers
- No rounded corners anywhere — everything is sharp-edged

**Signature Elements:**
1. Bezier curve editors styled as oscilloscope displays — dark green grid, amber curve line
2. Section headers in ALL CAPS spaced-out monospace (like film leader text)
3. Sliders with tick marks, like a mixing board fader

**Interaction Philosophy:**
- Hover states are subtle brightness shifts, no color changes
- Active controls glow amber
- No animations except for the video preview itself

**Typography System:**
- Display/Labels: `Space Mono` — monospace, technical, film-adjacent
- Body: `Inter` at 12px — utilitarian readability
</text>
</response>

<response>
<probability>0.06</probability>
<text>

## Idea B — "Cinematic Void" (CHOSEN)

**Design Movement:** High-end post-production software meets Japanese minimalism

**Core Principles:**
1. The video is the hero — the UI recedes into darkness around it
2. Controls are revealed through proximity, not always visible
3. Precision over decoration — every pixel of UI is functional
4. Subtle depth through layered darkness, not color

**Color Philosophy:**
- Background: `#080808` — not pure black, has warmth
- Panel: `#0f0f0f` with `#1e1e1e` borders
- Accent: cool teal `#4ecdc4` — the color of a monitor in a dark edit suite
- Secondary accent: muted rose `#c4756a` for destructive/warning states
- Text hierarchy: `#e8e8e8` / `#a0a0a0` / `#505050`

**Layout Paradigm:**
- Preview area is asymmetric — slightly left of center, giving the right panel visual breathing room
- Right panel is fixed-width 320px, scrollable
- Playback controls float below the preview as a minimal bar
- File load area is a subtle dashed drop zone integrated into the preview

**Signature Elements:**
1. Bezier curve editors: dark background, teal curve, subtle grid, draggable handles as small circles
2. Section dividers are thin teal lines with section labels left-aligned in small caps
3. Preset chips are pill-shaped, low-contrast until hovered

**Interaction Philosophy:**
- Smooth 150ms transitions on all interactive states
- Bezier handles have a satisfying magnetic snap to extremes
- Buffer warm-up indicator is a thin teal progress bar at the bottom of the preview

**Animation:**
- Controls panel sections have a 200ms slide-in on first load
- Parameter changes cause a brief teal flash on the affected control label
- Playback scrubber thumb has a subtle glow

**Typography System:**
- Labels/Headers: `DM Mono` — technical but elegant, not harsh
- Body/Values: `Inter` 12–13px
- Section headers: `DM Mono` small-caps, letter-spacing 0.12em
</text>
</response>

<response>
<probability>0.05</probability>
<text>

## Idea C — "Analog Signal"

**Design Movement:** Vintage broadcast equipment + Bauhaus functionalism

**Core Principles:**
1. Everything looks like it could be a physical hardware unit
2. Color coding by function — temporal controls are one hue, blend controls another
3. Dense but organized — like a synthesizer patch panel
4. Knobs instead of sliders where possible

**Color Philosophy:**
- Background: deep navy `#0d1117`
- Panel sections color-coded: temporal = deep indigo, weight = forest green, blend = burgundy
- Accent: phosphor green `#39ff14` for active states
- Text: off-white `#f0ead6` — like aged paper

**Layout Paradigm:**
- Horizontal strip layout — controls run along the bottom like a hardware rack
- Preview takes the full top 70% of the screen
- Control sections are visually distinct "modules" with colored top borders

**Signature Elements:**
1. Circular knob controls for continuous values
2. LED-style indicators showing current blend mode
3. VU meter-style history depth visualization

**Interaction Philosophy:**
- Knobs respond to vertical drag (like a real knob)
- Satisfying click sounds on mode changes (subtle)
- Sections can be "patched" together with visible connection lines

**Typography System:**
- All text: `Share Tech Mono` — pure broadcast/technical aesthetic
- Values displayed in 7-segment display style
</text>
</response>

---

## Decision: **Idea B — "Cinematic Void"**

Clean, dark, professional. The teal accent reads as "monitor glow in a dark edit suite" which is exactly right for this tool's context. The layout keeps the preview dominant while the right panel stays out of the way. The bezier curve editors will be the signature visual element.
