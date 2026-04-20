MCE2_ARCHITECTURAL_MANIFEST.md
1. Core Premises
End Product: Every output is a standard Moqui App (Mapp).

Center Pane Canvas: Reserved for the Mapp display (Production) or specialized Tool Editors (Design).

AI Chat Control Plane: A persistent, universal input buffer. Its output is fluid—scrolling in the sidebar for conversation or taking over the center pane for complex visual tasks.

Unified UI: Production and Design modes share an identical look. The "Design" entry point is an inconspicuous, permission-gated toggle (e.g., a "Blue Square" or right-click context menu).

2. Pluggable Layer Architecture
MCE2 is a Host for Layers, not a monolithic app.

Layer Registry: Layers "check-in" to the MoquiAiLayer entity, declaring their layerType (GIS, Drawing, UDM) and supported MCP Capabilities.

Asset Isolation: No logic is placed in the global webroot. Assets are isolated within the screen/mce/assets/ directory using Moqui’s .qvt.js (Vue Template JS) format. This prevents MCE2 from interfering with standard Moqui app stability.

Multi-Dimensional Canvas: Multiple layers can be active simultaneously (e.g., a GIS map overlaying a UDM-driven form).

3. Communication & Discovery Protocol
MCP as the Nervous System: The AI Chat interacts with layers exclusively through Model Context Protocol (MCP) artifacts.

Self-Discovery: The AI Chat queries the MoquiAiLayer registry via MCP to "discover" what the current center pane is capable of (e.g., "Can I draw a polygon here?").

Auto-Entity Pattern: Tool inputs/outputs use "auto-entity" patterns. The AI follows Mantle UDM domain rules (like HIPAA/PHI encryption) by default, not by exception.

Instructional Hand-off: If an AI output contains a targetLayer instruction, the Shell routes the result to the center pane; otherwise, it defaults to standard text in the chat.

4. Learning & Confidence Factors
Knowledge Tracks: * Intent Path (Chat History): Captures the "Why" and user preference patterns.

Semantic Index (Layer State): Each layer provides a "Resource" of its current artifacts (What is on the map? What is in the form?).

Confidence Scoring: Every AI response includes a Signal Quality indicator:

High: Deterministic results from parameterized "Auto-Entity" services.

Medium: Heuristic matches from layer-specific knowledge tools.

Low: Generative "Best Guess" based on chat history fallback.

5. Directory Structure (Agent OS Standard)
6. Technical Grounding
Framework: Moqui 4.0 (Upgrade Branch).

Frontend: Vue 3 / Quasar 2 (Single App Instance).

Declarative First: Prioritize XML configuration over imperative code.

Security: HIPAA Enforcement is hardcoded—any PHI entity extension MUST have encrypt="true" and enable-audit-log="true".