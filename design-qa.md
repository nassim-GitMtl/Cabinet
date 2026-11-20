# Design QA — Human Practice redesign

## Evidence

- Source visual truth: `/Users/nams/.codex/generated_images/01a1eaca-ed4a-7093-add5-7dc38cb0e6a0/exec-5f87962f-2a18-45d1-b5b1-f11f02d9f0d6.png`
- Browser-rendered implementation: `design-qa-implementation-crop.jpg`
- Combined comparison input: `design-qa-comparison.jpg`
- Source pixels: 1487 × 1058 at generated-image density.
- Implementation pixels: 1080 × 1964 captured from the Codex in-app browser at its current narrow responsive width (approximately 540 CSS px at 2× display density).
- Comparison pixels: 2093 × 1058. The implementation was proportionally normalized to 582 × 1058 beside the unchanged source with a 24 px separator.
- State: authenticated French patient workspace, `?tab=documents`, light theme, fictitious demo patient.
- Viewport note: the selected concept is a desktop composition while the user-selected in-app browser was narrow. The comparison therefore evaluates art direction, component language, hierarchy, and responsive translation; it does not claim pixel parity of desktop region proportions.

## Full-view comparison evidence

The final combined image shows the selected warm-ivory canvas, deep forest-teal primary actions, sage active states, restrained warm borders, softer natural elevation, editorial Latin headings, compact line icons, a strong patient command header, and a structured document-upload surface. The narrow implementation correctly transforms the concept's desktop sidebar into the existing mobile top and bottom navigation while preserving the same visual language.

## Focused-region evidence

The patient identity header, module ribbon, and first document-upload section are legible at the captured density and are the important fidelity regions. They were reviewed directly in `design-qa-comparison.jpg`; separate crops were unnecessary because the combined input preserves readable control labels, spacing, icons, borders, and state colors.

## Required fidelity surfaces

- Fonts and typography: Latin `h1`/`h2` headings use the system editorial stack (Georgia/Cambria) with compact tracking; interface copy stays in bundled Inter and Arabic stays in the bundled IBM Plex Arabic face. This preserves offline operation while matching the concept's editorial hierarchy.
- Spacing and layout rhythm: 16–24 px content rhythm, generous command-header padding, 10–16 px radii, low elevation, and clear section gaps match the source direction. The mobile action group is intentionally denser because the production app exposes more real actions than the concept.
- Colors and visual tokens: warm ivory, forest teal, sage, charcoal, clay warning, and warm neutral borders are mapped into the shared semantic tokens and apply product-wide.
- Image quality and asset fidelity: the concept contains no photography, illustration, product imagery, or non-standard raster assets. Existing vector iconography remains sharp and consistent at responsive sizes.
- Copy and content: production FR copy and real permission-gated capabilities are retained. No concept-only fake records, totals, or actions were added.

## Findings

- No actionable P0, P1, or P2 findings remain.
- P3: the production mobile command header is taller than the concept because it exposes billing, editing, sterilization, and archive actions omitted from the concept. This is an intentional functional difference rather than design drift.
- P3: the display face is a web-safe system serif rather than the concept's exact unidentified font. This avoids an internet font dependency on the clinic's offline server.

## Comparison history

1. Initial pass — P2: the active “Images et documents” module could be outside the visible portion of the horizontally scrollable mobile ribbon, weakening location context.
2. Fix — extracted the ribbon into `PatientTabs`, retained permission-aware states, and scrolls the active tab to the inline center after navigation.
3. Post-fix pass — `design-qa-comparison.png` visibly shows “Images et documents” centered in its sage active state. No P0/P1/P2 issue remains.

## Interactions and route checks

- Patient documents loaded with the correct active module centered after refresh.
- Dashboard, agenda, inventory, and patient documents were opened in the in-app browser and retained readable responsive layouts.
- Primary navigation, patient action links, upload selector, camera action, category selector, and mobile bottom navigation remained present and accessible in the browser accessibility tree.
- No visible application runtime error or broken state appeared during the checked routes.

## Follow-up polish

- At a later desktop-specific review, tune sidebar section grouping if additional translated navigation group labels are introduced.

final result: passed
