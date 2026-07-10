# OmAgents Icon Design

## Context
Create a project icon for the OmAgents OpenCode plugin.

## Chosen Concept
**Unified Bot + Violet/Gold** - a rounded-square container that IS the robot face, with LED-style eyes and a gold agent-node antenna.

## Rationale
- Unifying container and face into one shape removes the awkward nested-circle look.
- LED-style rounded-rectangle eyes read as "robot/AI" more effectively than circles.
- Indigo-to-violet gradient (analogous colors) creates a harmonious, premium feel.
- Gold accent (#FCD34D) on the antenna dot provides complementary contrast — the visual focal point.
- White face elements have high contrast against the violet gradient for readability at any size.

## Visual Spec
- **Container/Face**: Rounded square (rx=96), gradient #6366F1 -> #8B5CF6.
- **Eyes**: Two white LED-style rounded rectangles (28x56, rx=14).
- **Mouth**: White rounded rectangle (80x16, rx=8, 90% opacity).
- **Antenna**: White line from top edge, capped by gold dot.
- **Agent node**: Gold circle (#FCD34D, r=16) at antenna tip.
- **Colors**: Indigo-violet gradient + white + gold accent. Transparent background.
- **Style**: Flat, minimal, unified, modern.
- **Canvas**: viewBox="0 0 512 512", square aspect ratio.

## Output
- `assets/omagents-icon.svg` (vector source)
- `assets/omagents-icon.png` (1600x1600, transparent background)
