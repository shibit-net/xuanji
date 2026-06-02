# Edge Cases

## Truncated `get_design_context` Responses

When `get_design_context` returns truncated output for a node:

1. Call `get_metadata` on that node to see its children (1 MCP call).
2. Call `get_design_context` for each meaningful child in parallel.
3. Implement children first, then compose the parent.

## Designs with 20+ Components

1. Group related components into batches of 3–5.
2. Call `get_design_context` for each batch in parallel.
3. Implement and run the correction loop for the batch.
4. Validate the batch before moving to the next.

This keeps context manageable and errors catchable.

## Responsive / Multi-Viewport Designs

When the Figma file contains multiple viewport sizes (mobile, tablet, desktop):

1. Identify all viewport variants from the metadata.
2. Implement mobile-first (smallest viewport).
3. For each additional breakpoint, call `get_screenshot` only (1 MCP call per
   breakpoint) — do NOT re-fetch `get_design_context` if the component structure
   is the same.
4. Add responsive styles based on position/size differences visible in the
   screenshots.
5. Run the correction loop at each breakpoint.

## Error Recovery

When an MCP call fails mid-workflow:

1. Retry once after a brief pause.
2. If it fails again, fall back gracefully:
   - `get_design_context` fails → use `get_metadata` + `get_screenshot` for that
     node and implement from visual reference + metadata structure.
   - `get_screenshot` fails → proceed with value-based correction only.
   - `get_metadata` fails → try `get_design_context` on children directly
     (guess child IDs from URL pattern or ask user).
   - `get_variable_defs` fails → use raw color/spacing values from
     `get_design_context` responses instead of tokens.
3. Log the failure in the final report (Step 6) so the user knows which
   components had degraded data.

## Component Variant Sets

When a Figma node is a component set with multiple variants (size, state, type):

1. Call `get_design_context` on the **parent component set** (1 MCP call).
2. The response includes all variant definitions and property mappings.
3. Implement the **base/default variant** first.
4. Add variant props (size, state, etc.) using the variant data from the
   same response — do NOT fetch each variant separately.
5. Run the correction loop on the base variant, then spot-check 1–2 other
   variants visually.

## Dark Mode / Theme Variants

When `get_variable_defs` returns multiple token modes (e.g., light/dark):

1. Record both token sets from the single `get_variable_defs` call.
2. Implement the primary mode (usually light) first.
3. Map tokens to CSS variables or the project's theme system so switching
   is automatic — do NOT hardcode one mode's values.
4. If the project has no theme system, use CSS custom properties with a
   `[data-theme]` attribute pattern.
5. Run the correction loop in the primary mode. Spot-check the secondary
   mode with one `browser_take_screenshot` round.

## Absolute Positioning

When Figma uses absolute positioning (common in hero sections, illustrations,
overlapping card layouts):

1. Determine if the overlap is **intentional** (badges, avatars on cards,
   decorative elements) or **a Figma layout artifact** (designer didn't use
   Auto Layout).
2. For intentional overlap → use `position: absolute/relative` with proper
   stacking context.
3. For layout artifacts → reproduce the visual result with CSS Grid or Flexbox.
   Do NOT replicate pixel coordinates from Figma.
4. When in doubt, check the screenshot — if elements overlap visually, treat
   as intentional.

## Code Connect Post-Implementation

After implementing new components, offer to create Code Connect mappings:

1. Only available on Organization and Enterprise plans — check with `whoami()`.
2. Call `add_code_connect_map(fileKey, nodeId, componentName, source, label)`.
   - `source`: relative path to the component file (e.g., `src/components/Button.tsx`)
   - `label`: framework label — `React`, `Vue`, `Svelte`, `SwiftUI`, `Compose`, `Flutter`, etc.
3. This allows future implementations of the same Figma component to skip the
   implement step entirely (classified as "code-connected" in Step 3).
4. Always ask user before creating — do NOT auto-run.

## Rate Limit Management

Use `whoami()` at the start to detect the user's plan tier:
- **Starter / View / Collab seats:** 6 tool calls/month — ultra-conservative mode.
- **Dev / Full seat on Professional+:** per-minute limits (Tier 1 REST API).

**Ultra-conservative mode (Starter/View/Collab):**
- Skip `get_metadata`, `get_variable_defs`, `get_screenshot` — go straight to
  `get_design_context` on the most critical nodes only.
- Skip `get_code_connect_map` pre-check.
- Maximum 1 screenshot round for validation.
- Inform user of remaining calls after each MCP operation.

**Standard strategies when close to limits:**
- Prioritize `get_design_context` calls (most valuable per call).
- Combine sibling fetches into parallel batches (parallel calls still count
  individually but execute faster).
- Use `get_metadata` (lightweight) instead of `get_design_context` when only
  structure is needed.
- Use Code Connect components to skip MCP calls entirely for mapped components.
- For "reuse" components, skip MCP entirely.
- If nearing limits, inform the user and prioritize the most complex or
  visually critical components.

## Browser Validation Not Working

**Frontend not rendering:**
- Ensure the dev server is running (`npm run dev` / `pnpm dev`)
- Check the correct port — the dev server URL may differ from the CDP port
- Hot reload should pick up code changes automatically; if not, refresh the tab

**Extension not connecting:**
- Run `npx figma-to-code-skill doctor` to diagnose setup issues
- Run `npx figma-to-code-skill setup-browser` to auto-detect and configure your browser
- Verify the Playwright MCP Bridge extension is installed and enabled in your browser
- Non-Chrome/Edge browsers (Brave, Arc, Vivaldi, Opera) require `--executable-path` —
  the setup command handles this automatically
- Only one CDP client can connect at a time — close DevTools if open
- Restart Claude Code after changing the MCP config
