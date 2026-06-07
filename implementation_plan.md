# Aether Implementation Plan

## Architecture
- Single HTML file with vanilla JS + CSS (no framework overhead, fast load)
- 5 screens via JS router: Feed, Reader, Graph, Lit Review, Monitor
- Mock data layer simulating realistic researcher scenario
- Canvas-based knowledge graph (no library dependency)

## Screens
1. Morning Feed — newspaper layout, threat/validate cards
2. Deep Reader — 3-column: paper | workspace | context
3. Knowledge Graph — canvas with time slider
4. Lit Review Workspace — cluster canvas + live draft
5. Monitor & Alerts — topic monitors with similarity scoring

## Files
- index.html — shell + router
- styles.css — design system (dark, typographic)
- app.js — main app logic
- data.js — mock paper library
- graph.js — canvas graph renderer
