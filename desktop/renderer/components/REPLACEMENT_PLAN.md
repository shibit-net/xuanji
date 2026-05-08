# Xuanji Desktop - Hand-written Component Replacement Plan

Generated: 2026-05-02

## Overview

This document catalogs all hand-written TailwindCSS components in `renderer/components/` that can be
replaced with shadcn/ui equivalents (Radix UI + CVA + TailwindCSS). Each entry includes the
component's purpose, current file path, import count, shadcn replacement target, difficulty
assessment, and priority ranking.

---

## Priority Ranking (by impact + dependency chain)

### P0 - HIGHEST (Blockers / High Impact / Simple Swap)

| # | Component | Reason |
|---|-----------|--------|
| 1 | **Toast.tsx** | 5 direct consumers + App.tsx root provider; shadcn hook already exists at hooks/use-toast.ts |
| 2 | **InputArea.tsx** (native textarea) | Uses hand-written textarea that can use shadcn Textarea |
| 3 | **Sidebar.tsx** (dropdown menu) | Hand-rolled user menu can use shadcn DropdownMenu |
| 4 | **Dialog components** (×5) | All 5 share the same `fixed inset-0 bg-black/50 flex items-center justify-center z-50` pattern |
| 5 | **Tabs in ContextPanel/RightPanel/SettingsPage** | Hand-written tab buttons match shadcn Tabs API |

### P1 - MEDIUM (Important but more refactoring needed)

| # | Component | Reason |
|---|-----------|--------|
| 6 | **Button patterns across all files** | ~40+ raw `<button>` elements with `hover:bg-bg-tertiary rounded transition-colors` |
| 7 | **Badge patterns (StatusBar, etc.)** | `px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400` style spans |
| 8 | **Card patterns (AgentWorkCard, permissions)** | Various `border border-bg-tertiary rounded-lg` divs |
| 9 | **StatusBar.tsx** (badge usage) | Has hand-written PLAN MODE badge |
| 10 | **TitleBar.tsx** (button patterns) | Window control buttons |

### P2 - LOWER (Large components, complex refactors)

| # | Component | Reason |
|---|-----------|--------|
| 11 | **AgentEditor.tsx** (1471 lines) | Heavy form with many hand-written inputs/selects |
| 12 | **AgentManager.tsx** (617 lines) | Uses AgentDetail, AgentEditor, Toast |
| 13 | **ExecutionPanel.tsx** (671 lines) | Custom tab buttons, tool cards |
| 14 | **SystemPromptManager.tsx** (1011 lines) | Complex tab UI, many custom buttons |
| 15 | **SettingsPage.tsx** (600 lines) | Inline tab system, form elements |
| 16 | **PermissionsPage.tsx** (581 lines) | Inline tab system, card patterns |

---

## Detailed Component Map

### 1. Toast.tsx -- REPLACEMENT: P0 (HIGH)

**Path:** `renderer/components/Toast.tsx`
**Purpose:** Custom toast notification system with context provider + 4 variants (success, error,
warning, info). Has `useToast()` hook, `ToastProvider`, and inline JSX rendering.
**Imports (5 consumers + 1 root):**
  - `App.tsx` - imports `ToastProvider`
  - `InputArea.tsx` - imports `useToast`
  - `ChatArea.tsx` - imports `useToast`
  - `AgentEditor.tsx` - imports `useToast`
  - `AgentManager.tsx` - imports `useToast`
  - `SystemPromptManager.tsx` - imports `useToast`
**Shadcn replacement:** `renderer/components/ui/toast.tsx` + `renderer/hooks/use-toast.ts`
**Notes:** The shadcn toast component is already set up. Need to:
  1. Update `App.tsx` to use `<Toaster>` from shadcn instead of `<ToastProvider>`
  2. Update all 5 consumers to use `import { toast } from '@/hooks/use-toast'` (shadcn API is `toast()` vs current `toast.success()` etc.)
  3. Can phase out old Toast.tsx entirely
**Difficulty:** MEDIUM -- API difference requires adapting call sites
  - Old: `toast.success('msg')`, `toast.error('msg')`
  - New: `toast({ title: 'msg', variant: 'success' })`

### 2. Dialog Components (×5) -- REPLACEMENT: P0 (HIGH)

All 5 dialog components use the same raw pattern:
```jsx
<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
  <div className="bg-bg-secondary...">
```

| File | Purpose | Props |
|------|---------|-------|
| `AskUserDialog.tsx` | User question prompt with options (single/multi select) | request, onClose |
| `DiagnosticsDialog.tsx` | System diagnostics report | onClose |
| `IntentDialog.tsx` | Intent selection dialog | pendingMessage, analysisResult, onSelect, onCancel |
| `PermissionDialog.tsx` | Permission confirmation (allow/deny/always/never) | request, onClose |
| `PlanReviewDialog.tsx` | Plan review (approve/reject/supplement) | request, onClose |
| `StatsDialog.tsx` | Usage statistics | onClose |

**Imports:** All imported from `layouts/MainLayout.tsx` (1 consumer each)
**Shadcn replacement:** `renderer/components/ui/dialog.tsx` (Radix-based, full API)
**Difficulty:** EASY per dialog -- wrapping existing content in `<Dialog>`, `<DialogContent>`, `<DialogTitle>`, `<DialogDescription>`
**Notes:** Each dialog is self-contained with its own backdrop. Refactoring to use shadcn Dialog
will standardize animations, keyboard handling, and focus management.

### 3. Sidebar.tsx Dropdown Menu -- REPLACEMENT: P0 (HIGH)

**Path:** `renderer/components/Sidebar.tsx`
**Purpose:** Left sidebar with navigation buttons + user menu dropdown (hand-rolled with
`useState(showUserMenu)` + click-outside detection).
**Imports:** `layouts/MainLayout.tsx` (1 consumer)
**Shadcn replacement:** `renderer/components/ui/dropdown-menu.tsx`
**Difficulty:** EASY -- the user avatar dropdown is a straightforward DropdownMenu replacement.
**Notes:** Also has navigation button group that could use shadcn Button.

### 4. InputArea.tsx (textarea) -- REPLACEMENT: P0 (HIGH)

**Path:** `renderer/components/InputArea.tsx`
**Purpose:** Chat input with auto-resizing textarea. Uses hand-written styles for the textarea.
**Imports:** `pages/MainPage.tsx` (1 consumer)
**Shadcn replacement:** `renderer/components/ui/textarea.tsx` for the textarea element
**Difficulty:** EASY -- mostly replacing the raw textarea styling with shadcn Textarea component.
The auto-resize and composition handling stays the same.
**Notes:** The send/stop buttons can also use shadcn Button.

### 5. Tab Patterns -- REPLACEMENT: P1 (MEDIUM)

Hand-written tab patterns appear in:
- `ContextPanel.tsx` -- files/activity tabs
- `RightPanel.tsx` -- workspace/tools/logs tabs
- `SettingsPage.tsx` -- tools/ui/embedding tabs
- `PermissionsPage.tsx` -- decisions/denied/config/audit tabs
- `ExecutionPanel.tsx` -- agents/tools/todos/permissions/system tabs
- `SystemPromptManager.tsx` -- complexity/prompts/projects tabs

**Current pattern:** Buttons with conditional class logic like:
```tsx
activeTab === tab.id
  ? 'bg-bg-primary text-primary border-b-2 border-primary'
  : 'text-text-secondary hover:bg-bg-tertiary'
```

**Shadcn replacement:** `renderer/components/ui/tabs.tsx` (Radix-based Tabs with TabsList, TabsTrigger, TabsContent)
**Difficulty:** MEDIUM -- requires converting state logic to Radix `value`/`onValueChange` pattern
**Priority:** P1 -- nice consistency win but each has different content rendering

### 6. Button Patterns (widespread) -- REPLACEMENT: P1 (MEDIUM)

~40+ raw `<button>` elements across all components with patterns like:
```tsx
<button className="p-1.5 hover:bg-bg-tertiary rounded transition-colors" ...>
```

**Shadcn replacement:** `renderer/components/ui/button.tsx`
**Difficulty:** MEDIUM -- many buttons, mechanical but tedious
**Priority:** P1 -- high visibility, low risk

### 7. Badge Patterns -- REPLACEMENT: P1 (MEDIUM)

Patterns like `StatusBar.tsx` PLAN MODE badge:
```tsx
<span className="px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 font-semibold">
```

**Shadcn replacement:** `renderer/components/ui/badge.tsx` (already has `success`/`warning` variants)
**Difficulty:** EASY -- direct replacement

### 8. Card Patterns (widespread) -- REPLACEMENT: P2 (LOWER)

Many components use raw divs as card containers:
- `AgentWorkCard.tsx` -- agent status cards with `border-* border-* rounded-lg`
- `PermissionsPage.tsx` -- permission decision cards
- `ToolsPage.tsx` -- tool cards
- `LoginPage.tsx` -- login card
- Various others

**Shadcn replacement:** `renderer/components/ui/card.tsx` (Card, CardHeader, CardTitle, CardContent, CardFooter)
**Difficulty:** MEDIUM -- each card has unique content, but wrapping is mechanical
**Priority:** P2 -- cosmetic improvement, less functional impact

### 9. Form Elements (widespread) -- REPLACEMENT: P2 (LOWER)

Hand-written `<input>`, `<select>`, `<textarea>`, `<label>` elements appear in:
- `AgentEditor.tsx` -- extensive form with model select, capabilities, etc.
- `SettingsPage.tsx` -- API key inputs, theme toggles
- `SystemPromptManager.tsx` -- filter/search inputs
- `LoginPage.tsx` -- email/password inputs
- `AgentManager.tsx` -- search input

**Shadcn replacements available:**
- `renderer/components/ui/input.tsx`
- `renderer/components/ui/textarea.tsx`
- `renderer/components/ui/select.tsx`
- `renderer/components/ui/label.tsx`
- `renderer/components/ui/switch.tsx`
- `renderer/components/ui/checkbox.tsx`

**Difficulty:** HARD for editor pages (complex form logic), EASY for simple inputs
**Priority:** P2 -- many files, but lower impact than toast/dialog

---

## Components NOT needing replacement (keep as-is)

These are hand-written but don't map to shadcn/ui components:

| Component | Reason |
|-----------|--------|
| `ChatArea.tsx` | Virtualized message list (@tanstack/react-virtual), unique UX |
| `MessageBubble.tsx` | Complex message rendering with markdown, streaming stats |
| `MilkdownEditor.tsx` | Custom markdown editor (@milkdown) |
| `CodeEditor.tsx` | CodeMirror 6 wrapper |
| `ResizeHandle.tsx` | Custom drag-to-resize logic |
| `DownloadQueue.tsx` | Download progress management |
| `ExecutionFlow.tsx` | React Flow graph visualization |
| `WorkspaceMonitor/` | Canvas-based visualization (AnimationEngine, CanvasRenderer) |
| `TodoPanel.tsx` | Custom execution store integration |
| `ToolSection.tsx` | Custom tool execution cards |
| `FloatingTodoPanel.tsx` | Custom floating panel |
| `ExecutionPanel.tsx` | Complex execution visualization |
| `ExecutionWorkspace.tsx` | Agent monitor visualization |
| `ActiveAgentView.tsx` | Active agent dashboard |
| `AgentStatusList.tsx` | Custom agent status table |
| `AgentWorkCard.tsx` | Custom agent card with framer-motion |

---

## Summary of Effort

| Priority | Comp Count | Est. Files Touched | Effort |
|----------|-----------|-------------------|--------|
| P0 (HIGH) | 7 | 12-15 files | 2-3 hours |
| P1 (MEDIUM) | 4 patterns | 15-20 files | 3-4 hours |
| P2 (LOWER) | 5+ patterns | 10-15 files | 4-6 hours |
| **Total** | **16+** | **~25-30 files** | **~10-12 hours** |

### Recommended Order:
1. **Toast system** (App.tsx + 5 consumers) -- unblocks other UX improvements
2. **Dialog components** (MainLayout.tsx + 5 files) -- standardize modals
3. **Sidebar dropdown** -- quick win
4. **InputArea textarea** + button patterns
5. **Tab components** -- consistent navigation
6. **Badge + Card patterns** -- visual polish
7. **Form elements** -- final pass for accessibility
