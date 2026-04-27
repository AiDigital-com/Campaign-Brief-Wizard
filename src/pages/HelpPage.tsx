import { useEffect } from 'react';
import { HelpPage, applyTheme, resolveTheme } from '@AiDigital-com/design-system';
import '@AiDigital-com/design-system/style.css';

const GUIDE = `# Campaign Brief Wizard — User Guide

**Tool:** [Campaign Brief Wizard](https://briefwizard.apps.aidigitallabs.com)

Iterative AI co-author for AI Digital's standard 13-section media brief.
Drop in source material — RFPs, follow-up email threads, recap decks,
audience research, brand guidelines — and chat with the strategist as
the brief artifact builds itself in the right pane.

---

## Getting Started

### 1. Sign In
Open the app and sign in with your AIDigital Labs account.

### 2. Drop in Source Materials
The top-center "Source materials" pane accepts up to 10 files per session:
PDF, DOCX, PPTX, plain text, markdown, CSV, and images. Each file is
extracted in the background — once a file shows ready, its content has
been parsed and a partial brief skeleton has been generated from it.

### 3. Chat with the Strategist
Tell the strategist what you're working on — a campaign goal, a client
name, an audience problem. They'll read the extracted skeletons from your
uploads and ask focused follow-up questions to fill the gaps.

### 4. Watch the Brief Build
The right pane is the live deliverable: AI Digital's standard 13-section
media brief. Each strategist turn patches the artifact with whatever new
evidence you've shared — the version pill (v0.{n}) bumps with each pass.
Toggle "Updated" to highlight the sections changed in the latest pass.

### 5. Add More Sources Anytime
Drop another deck, paste another email — the strategist re-reads as soon
as ingestion completes and folds new evidence into the next turn.

### 6. Export
Once the brief is coherent, hit ↓ MD or ↓ PDF in the artifact footer.
The exported file is exactly what you see in the Rendered tab.

---

## The 13 Sections

| # | Section |
|---|---|
| 01 | Submission (client, vertical, POCs, due date, priority) |
| 02 | Business & marketing background |
| 03 | Goals & objectives (Awareness / Conversion split) |
| 04 | Success metrics & benchmarks (KPIs) |
| 05 | Audience & personas |
| 06 | Competitive set |
| 07 | Geo & markets |
| 08 | Budget & flighting |
| 09 | Channels & tactics |
| 10 | Creative & messaging |
| 11 | Measurement & ops |
| 12 | Deliverables |
| 13 | Open questions |

A section stays empty until the strategist has explicit evidence — never
fabricated copy. Empty fields surface as gaps the strategist will ask
about.

---

## Tips
- **Use dark mode** — toggle in the top-right corner.
- **Past briefs persist** — the sessions sidebar shows every brief you've
  worked on. Click any to reload its full state (chat + artifact +
  uploaded sources).
- **Version history** — click the version pill (v0.{n}) in the artifact
  header to see every pass the strategist has made on this brief.
- **Tabs** — \`Rendered\` is the visual brief, \`Markdown\` is the same
  content as plain text (copy-paste-ready), \`Sources\` lists which brief
  sections each upload contributed to.
`;

export default function AppHelpPage() {
  useEffect(() => { applyTheme(resolveTheme()); }, []);
  return <HelpPage markdown={GUIDE} />;
}
