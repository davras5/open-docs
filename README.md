<p align="center">
  <img src="assets/Preview1.jpg" alt="OpenDocs File Browser" width="720">
</p>

<h1 align="center">OpenDocs</h1>

<p align="center">
  <strong>Lightweight, open-source document management for construction and engineering teams.</strong><br>
  No build tools. No backend. Pure vanilla JavaScript.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License">
  <img src="https://img.shields.io/badge/build-none-brightgreen.svg" alt="No Build">
  <img src="https://img.shields.io/badge/vanilla-JS-F7DF1E.svg?logo=javascript&logoColor=black" alt="Vanilla JS">
  <img src="https://img.shields.io/badge/deploy-GitHub%20Pages-222.svg?logo=github" alt="GitHub Pages">
  <img src="https://img.shields.io/badge/prototype-v0.1-orange.svg" alt="Prototype">
</p>

Live Demo: https://davras5.github.io/open-docs/
---

## What is OpenDocs?

OpenDocs is a **zero-build, single-page web application** for storing, previewing, sharing, and collaborating on office and construction documents directly in the browser. Think of it as a lightweight, open-source alternative to SharePoint or Google Drive, purpose-built for **construction, architecture, and engineering workflows**.

It runs entirely as static files (HTML + CSS + JS) and can be deployed on **GitHub Pages**, any static host, or served from a local folder. Document storage uses the browser's **IndexedDB** via localForage, with files fetched from a configurable file directory.

> **Status:** This is a working prototype / proof of concept. It demonstrates the UX, document viewing capabilities, and metadata architecture. Production use would require a backend for multi-user access, authentication, and persistent storage.

<p align="center">
  <img src="assets/Preview2.jpg" alt="OpenDocs Document Viewer" width="720">
</p>

---

## Key Features

- **File browser** with grid and list views, folders, breadcrumb navigation, drag-and-drop upload
- **In-browser document preview** for 9+ file formats (see [Supported Formats](#supported-formats))
- **DWG/DXF CAD viewer** with pan, zoom, and full entity rendering via LibreDWG WASM
- **IFC 3D BIM viewer** with orbit controls, element picking, and property inspection via Three.js + web-ifc
- **Confluence-style document viewer** with dark overlay, left/right navigation, and image zoom
- **Document metadata** following Dublin Core and construction standards (see [Metadata](#metadata-architecture))
- **URL routing** with shareable links for folders and documents (`/#/d/projektbeschrieb`, `/#/s/pB7xK2`)
- **Search** across file names and metadata
- **Share modal** with copy-to-clipboard short URLs and permission display
- **Dark theme** with full design token system
- **Responsive** layout for desktop, tablet, and mobile
- **Accessible** with WCAG AA focus indicators, proper ARIA, and contrast-compliant colors

---

## Architecture

OpenDocs follows a deliberately simple architecture: no frameworks, no build steps, no server dependencies.

```mermaid
graph TB
    subgraph "Browser (Client)"
        UI["index.html — SPA Shell"]
        Tokens["tokens.css — Design System"]
        Styles["style.css — Components"]
        App["app.js — Core Application"]
        DWG["dwg-viewer.js — CAD Viewer"]
        IFC["ifc-viewer.js — IFC 3D Viewer"]
    end

    subgraph "Storage Layer"
        IDB[("IndexedDB via localForage")]
        Meta["metadata.json — Document Catalog"]
        Files["demo-files/ — Static Files"]
    end

    subgraph "CDN Libraries"
        LF["localForage 1.10"]
        Mammoth["Mammoth.js 1.6"]
        SheetJS["SheetJS 0.20"]
        PDFJS["PDF.js 3.11"]
        LibreDWG["LibreDWG-Web 0.6 (WASM)"]
        Lucide["Lucide Icons 0.468"]
    end

    UI --> App
    UI --> Tokens --> Styles
    App --> IDB
    App --> Meta
    App --> Files
    App --> DWG
    App --> IFC
    App --> LF & Mammoth & SheetJS & PDFJS
    DWG --> LibreDWG
    IFC --> ThreeJS["Three.js 0.155 + web-ifc (WASM)"]
    UI --> Lucide
```

### Application Modules

```mermaid
graph LR
    subgraph "app.js Modules"
        Storage["Storage Engine\n(IndexedDB CRUD)"]
        UImod["UI Renderer\n(File list, breadcrumbs)"]
        FileOps["File Operations\n(Upload, download, delete)"]
        Viewer["Document Viewer\n(Dark overlay modal)"]
        Editor["Rich Text Editor\n(contenteditable)"]
        Router["URL Router\n(Hash-based navigation)"]
        Metadata["Metadata Loader\n(metadata.json)"]
        Search["Search\n(Debounced name matching)"]
        CtxMenu["Context Menu\n(Right-click actions)"]
        DragDrop["Drag & Drop\n(File upload)"]
    end

    Router --> UImod
    Router --> Viewer
    Router --> Metadata
    UImod --> Storage
    FileOps --> Storage
    Viewer --> Storage
    Editor --> Storage
    Search --> Storage
```

### File Structure

```
open-docs/
├── index.html              # Single-page application shell
├── css/
│   ├── tokens.css          # Design tokens (CSS custom properties)
│   └── style.css           # Component styles
├── js/
│   ├── app.js              # Core application logic
│   ├── dwg-viewer.js       # Standalone DWG/DXF CAD viewer
│   └── ifc-viewer.js       # IFC 3D BIM viewer (Three.js + web-ifc)
├── data/
│   └── metadata.json       # Document metadata database
├── demo-files/             # Static demo files (Swiss construction project)
│   ├── 01 Planung/         # .docx, .xlsx, .dwg files
│   ├── 02 Bewilligungen/   # .pdf, .docx files
│   ├── 03-08 .../          # Various office and construction files
│   └── ...
├── assets/                 # README images
└── generate_demo_v2.py     # Python script to regenerate demo files
```

### Design Principles

1. **No build step** -- open `index.html` in a browser and it works. Deploy by copying files.
2. **Read from storage** -- documents and folders are read from a configurable storage layer (currently IndexedDB, designed for file system or S3-compatible backends).
3. **Metadata-driven** -- a structured `metadata.json` defines the document catalog with Dublin Core fields, construction metadata, version history, and sharing information.
4. **Progressive enhancement** -- the app works without any specific library; CDN failures degrade gracefully.
5. **Security by default** -- all external HTML is sanitized. CDN scripts use SRI hashes where supported.

---

## Supported Formats

| Format | Library | Capabilities |
|--------|---------|-------------|
| **.docx** (Word) | [Mammoth.js](https://github.com/mwilliamson/mammoth.js) | Formatted HTML: headings, tables, lists, images |
| **.xlsx** (Excel) | [SheetJS](https://sheetjs.com/) | First sheet as HTML table with headers |
| **.pdf** | [PDF.js](https://mozilla.github.io/pdf.js/) | All pages rendered to canvas, scrollable |
| **.dwg / .dxf** (AutoCAD) | [LibreDWG-Web](https://github.com/nicholasgasior/libredwg-web) (WASM) | Full 2D rendering with 20+ entity types, pan/zoom |
| **.ifc** (BIM) | [Three.js](https://threejs.org/) + [web-ifc](https://github.com/ThatOpen/engine_web-ifc) (WASM) | 3D orbit viewer with element picking & properties |
| **.jpg .png .gif .svg .webp** | Native browser | Zoom (scroll, double-click, drag-to-pan) |
| **.md** (Markdown) | Built-in renderer | Headings, tables, lists, code blocks, bold/italic |
| **.txt .json .csv .js .html .css .xml** | Native TextDecoder | Monospace preformatted text |

### DWG/DXF Entity Support

LINE, LWPOLYLINE, POLYLINE2D/3D, CIRCLE, ARC, ELLIPSE, SPLINE, TEXT, MTEXT, ATTRIB, POINT, SOLID, 3DSOLID, TRACE, HATCH (solid fill), DIMENSION (block-based + fallback), LEADER, MLINE, 3DFACE, RAY, XLINE, INSERT (recursive block expansion with OCS extrusion and mirroring).

---

## Metadata Architecture

OpenDocs uses a structured metadata model inspired by established standards:

| Standard | Scope |
|----------|-------|
| [Dublin Core](https://www.dublincore.org/) (ISO 15836) | Title, creator, description, type, language, rights |
| [eCH-0160](https://www.ech.ch/de/der-verein/fachgruppen/records_management) | Swiss records management: classification, retention, access |
| [DCAT](https://www.w3.org/TR/vocab-dcat-3/) (W3C) | Data catalog vocabulary for document discovery |
| SIA 2051 / ISO 19650 | Construction: discipline, SIA phase, revision, status, scale |

### Per-Document Metadata

```json
{
  "id": "doc-001",
  "slug": "projektbeschrieb",
  "shareToken": "pB7xK2",
  "title": "Projektbeschrieb Ueberbauung Seefeld",
  "creator": "Arch. ETH Laura Brunner",
  "description": "Detaillierte Projektbeschreibung...",
  "type": "Bericht",
  "language": "de-CH",
  "rights": "Vertraulich",
  "discipline": "Architektur",
  "phase": "32 Bauprojekt",
  "revision": "2.0",
  "status": "Freigegeben",
  "tags": ["Planung", "Architektur"],
  "versions": [
    { "version": 1, "date": "2025-11-20", "author": "brunner@be-arch.ch", "comment": "Erstversion" }
  ]
}
```

### URL Routing

| URL Pattern | Destination |
|-------------|-------------|
| `/#/` | Root file browser |
| `/#/f/ueberbauung-seefeld/01-planung` | Folder navigation (nested slugs) |
| `/#/d/projektbeschrieb` | Document viewer (by slug) |
| `/#/s/pB7xK2` | Share link (short token) |
| `/#/settings` | Settings view |

All URLs are bookmarkable and shareable. Hash-based routing works on GitHub Pages without server configuration.

---

## Demo Data

The prototype ships with a realistic **Swiss construction project**:

**Ueberbauung Seefeld, Zurich** -- 7-storey mixed-use building, 48 apartments, CHF 62.8M, Minergie-P-ECO.

- 28 documents across 8 folders with full metadata
- Real `.docx` with formatting (python-docx), `.xlsx` with headers (openpyxl), multi-page `.pdf` (fpdf2)
- Real `.dwg` AutoCAD files, construction photos (Unsplash)
- Swiss terminology: BKP costs, SIA phases, VKF fire safety, SIBE

Regenerate: `python generate_demo_v2.py` (requires `python-docx`, `openpyxl`, `fpdf2`).

---

## Getting Started

```bash
git clone https://github.com/davras5/open-docs.git
cd open-docs

# No build -- just open it
open index.html

# Or serve locally
npx serve .
```

For **GitHub Pages**: Settings > Pages > Deploy from branch `main`, folder `/` (root).

---

## Design System

Built on a **CSS custom property token system** (`css/tokens.css`):

- Color primitives (Slate-based neutrals) mapped to semantic tokens
- Dark theme via token reassignment (single `.dark-theme` class)
- 7-step typography scale (rem-based)
- 4px-base spacing scale (12 steps)
- 5 elevation levels, 3 motion durations
- WCAG AA compliant: 40px touch targets, 4.5:1 contrast ratios

---

## API Vision

OpenDocs today runs entirely in the browser. The next step is a backend API that turns it into a real multi-user platform. Inspired by [BIMData's modular API architecture](https://developers.bimdata.io/api/introduction/overview.html) but focused on what project stakeholders actually need: **finding, viewing, and sharing documents** -- not deep BIM tooling.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {
  'primaryColor': '#4A90D9',
  'lineColor': '#888',
  'textColor': '#1a1a2e',
  'cScale0': '#3B82F6',
  'cScale1': '#8B5CF6',
  'cScale2': '#F97316',
  'cScale3': '#14B8A6',
  'cScale4': '#6366F1',
  'cScale5': '#EAB308',
  'cScale6': '#EC4899',
  'cScale7': '#06B6D4',
  'cScale8': '#EF4444',
  'cScale9': '#84CC16',
  'cScalePeer1': '#fff', 'cScalePeer2': '#fff', 'cScalePeer3': '#fff',
  'cScalePeer4': '#fff', 'cScalePeer5': '#fff', 'cScalePeer6': '#fff',
  'cScalePeer7': '#fff', 'cScalePeer8': '#fff', 'cScalePeer9': '#fff'
}}}%%
mindmap
  root((OpenDocs API))
    **Documents**
      Upload & download
      Metadata schemas per project
      Revision control & status workflow
      Naming conventions
      Comparison & diff
      Trash & retention policies
    **Intelligence**
      Auto-enrichment on upload
        Text & metadata extraction
        OCR
        Auto-tagging
      Embedding & indexing
      Question answering across documents
      Summarization
      Smart suggestions
        Related documents
        Missing metadata
        Duplicates
    **Relations**
      Document to document links
      Document to model links
        Spatial references
        Element-level bindings
      Typed links
        References / Supersedes
        Depends on / Derived from
      Auto-discovered relations
      Knowledge graph queries
    **Processing**
      Format conversion
        Office to PDF
        CAD to SVG
        IFC to glTF
      Thumbnails
      Visual diff between revisions
    **Projects**
      Hierarchy & folders
      Templates
      Multi-tenant isolation
      Phase & status tracking
    **Auth & Permissions**
      OAuth2 / OIDC
      Role-based access
      Inheritable folder & document permissions
      API keys
    **Collaboration**
      Sharing with expiry & watermarking
      Comments & threads
      Approval workflows
      Transmittals
    **Search**
      Full-text & semantic search
      Metadata & tag filters
      Spatial queries
      Faceted results
    **Events & Audit**
      Immutable event log
      Audit trail with export
      Activity feed
      Webhooks & notifications
    **Storage & Sync**
      Pluggable backends
      Desktop folder sync
      Offline-first with conflict resolution
```

### Critical Review

Two expert perspectives on what matters most and what's missing.

**Senior Backend Developer** -- *"What do I build first, and what will break if I get it wrong?"*

> **The 5 most important API functions**, in build order:
>
> 1. **`POST /documents` (upload with async processing)** -- This is the entry point for everything. Upload must accept the file, return immediately with a document ID, and kick off a processing pipeline (thumbnail, text extraction, format conversion) via the job queue. If this endpoint is slow or unreliable, nothing else matters. Get multipart upload with resumability right from day one -- large files over flaky connections are the norm, not the edge case.
>
> 2. **`GET /documents/:id/content` (signed URL download)** -- Don't stream files through the API server. Generate a time-limited signed URL to the storage backend and redirect. This keeps the API server stateless and lets the CDN/storage handle bandwidth. The Processing API feeds into this: when a client requests a PDF view of a .docx, the API checks if a processed version exists, returns it, or triggers conversion and returns a 202 with a polling URL.
>
> 3. **`POST /indexing/enrich` (on-upload enrichment pipeline)** -- This fires automatically after upload. Extract text, run OCR if needed, pull metadata from file properties, generate embeddings, auto-suggest tags. The critical design decision: this must be **idempotent and retriable**. Files will fail to parse, OCR will timeout, LLM calls will 429. Every step must be independently retriable without re-running the whole pipeline. Use a state machine per document (uploaded -> extracting -> embedding -> enriched -> failed), not a single "processing" flag.
>
> 4. **`GET /search` (unified search)** -- One endpoint that searches full-text content, metadata fields, tags, and semantic embeddings in a single query. Don't make the frontend call three different search backends. Internally, fan out to Elasticsearch/Meilisearch for text and Postgres for metadata, merge and rank results. Faceted filtering (by project, phase, document type, date range) is not optional -- it's how people actually narrow down results.
>
> 5. **`POST /relations` (create typed link)** -- This is what makes OpenDocs more than a file server. Simple to implement (it's essentially an edge table), but the data model matters: `{source_id, target_id, type, metadata, created_by, auto_discovered}`. The `auto_discovered` flag distinguishes human-created links from ML-suggested ones. Bi-directional queries (`GET /documents/:id/relations`) must be fast -- this will be called on every document open.
>
> **What's missing from the mind map:**
>
> - **Events API.** The audit trail is buried inside Collaboration, but it's foundational infrastructure. Every state change (upload, view, download, share, approve, delete) should emit an immutable event to a log. The activity feed, audit trail, webhooks, and indexing triggers all consume from this same event stream. Without it, you'll have audit logic scattered across every module. Make it a first-class API: `GET /events?document_id=X&type=viewed&since=2026-01-01`.
>
> - **Health / Jobs API.** The Processing and Indexing pipelines are async. Clients need `GET /jobs/:id` to poll status, and admins need `GET /jobs?status=failed` to monitor the queue. Without this, failed conversions become silent black holes -- a document shows "processing" forever and nobody knows why.
>
> - **Trash / Soft delete.** The Documents API says "CRUD" but doesn't call out soft delete. In document management, hard delete is almost never what you want. Documents should move to trash, stay recoverable for a configurable period, then get purged. This interacts with retention policies -- some documents legally *cannot* be deleted even if a user tries.
>
> **Architecture warning:** The mind map has 11 modules. Don't build 11 services. Start with 3 deployable units: **(1)** Core API (Documents, Projects, Auth, Collaboration, Relations, Search -- all backed by one Postgres database), **(2)** Processing Worker (job queue consumer for file conversion, thumbnail generation), **(3)** Indexing Worker (text extraction, embedding generation, enrichment). Split further only when you have real scaling bottlenecks.

**Document Management / CDE Expert** -- *"What will an enterprise buyer or compliance auditor ask for?"*

> **The 5 most important capabilities**, ranked by deal-breaker risk:
>
> 1. **Configurable metadata schemas with validation.** Every organization has different required fields. The API needs `GET/PUT /projects/:id/schema` to define which metadata fields are required, optional, or auto-filled for each document type within a project. Without this, the system is either too rigid (hardcoded fields nobody uses) or too loose (everything is optional, nothing is findable). The Indexing API's auto-enrichment is powerful, but it must respect the schema -- suggested values should pre-fill the required fields, and validation should block uploads with missing mandatory metadata.
>
> 2. **Formal revision control with status workflow.** The Documents API says "version history" but doesn't distinguish between a minor save (version) and a formal issue (revision). The API needs: `POST /documents/:id/revisions` to create a formal revision (Rev. A, B, C), separate from the automatic version history on every save. Each revision needs a status field with configurable transitions: Draft -> For Review -> Approved -> Superseded. The approval workflow in Collaboration should drive these transitions. This is the core of any CDE -- without it, you're just a file share with extra steps.
>
> 3. **Complete audit trail with export.** Not just "who changed what" but "who viewed what, when, from which IP, and what did they do with it." Compliance auditors need `GET /audit?document_id=X&format=csv` to pull a complete access history. Every document download, view, share, metadata change, and permission change must be logged immutably. This cannot be an afterthought bolted onto the Collaboration API -- it needs to be a cross-cutting concern captured at the API gateway level.
>
> 4. **Granular, inheritable permissions.** The Auth API lists "project roles, folder permissions, document-level ACL" but doesn't mention inheritance. In practice: a project has a default permission set, folders inherit from the project but can override, documents inherit from their folder but can override. The API needs `GET /documents/:id/effective-permissions` that resolves the full inheritance chain. Without inheritance, admins spend all day setting permissions manually. Without overrides, you can't restrict sensitive documents within an otherwise open folder.
>
> 5. **Controlled external sharing with expiry and watermarking.** Share links are listed, but enterprise use requires: expiry dates, view-only (no download) mode, dynamic watermarking on PDFs (viewer's email stamped on every page), download logging, and the ability to revoke a link instantly. `POST /shares` with `{document_id, expires_at, allow_download: false, watermark: true}`. This is often the single feature that determines whether legal/compliance approves the platform.
>
> **What's missing from the mind map:**
>
> - **Templates & naming conventions.** In regulated environments, documents must follow naming rules (e.g., `[ProjectCode]-[Phase]-[Discipline]-[Type]-[Rev]`). The API should enforce this: `PUT /projects/:id/naming-rules` with pattern validation on upload. Auto-enrichment can suggest the name; validation can reject non-compliant uploads. Without this, the folder structure degrades into chaos within weeks.
>
> - **Distribution / transmittal management.** When a set of documents is formally sent to an external party (contractor, authority, client), that act needs to be recorded as a transmittal: which documents, which revision, to whom, when, with acknowledgment tracking. This is a first-class workflow in construction and engineering, not just "sharing." `POST /transmittals` with `{documents: [...], recipients: [...], due_date, cover_note}`.
>
> - **Document comparison / diff.** The Documents API lists "version history & diff" but this deserves emphasis. The ability to compare two revisions of a PDF or Word document visually (redline view) is a daily workflow. The Processing API should support `GET /documents/:id/compare?rev_a=A&rev_b=B` returning a visual diff. This is hard to build but extremely high-value.
>
> **Overall assessment:** The mind map covers the right territory. The biggest structural gap is that **Events/Audit** should be a top-level module, not a line item under Collaboration. The second gap is that **revision control with status workflow** is the most important single feature for CDE buyers and it's currently implicit rather than explicit in the Documents API. Make those two changes and the architecture is solid.

---

## Roadmap

### Currently Missing

- **Document versioning & backup** -- metadata schema supports it; needs backend storage for binary diffs
- **IAM (Identity & Access Management)** -- no authentication; hardcoded mock user
- **Multi-user collaboration** -- single-browser only; no real-time sync

### Feature Considerations

| Feature | Complexity | Notes |
|---------|-----------|-------|
| Document versioning & history | Medium | Version metadata exists; needs diff storage backend |
| Comments & annotations | Medium | Per-document threads, PDF annotation layers |
| IAM & role management | High | Per-folder/document permissions, audit trail |
| Third-party IAM (OAuth2/OIDC) | High | Azure AD, Keycloak, Auth0 |
| i18n / multi-language | Medium | Externalize UI strings, language switcher |
| Improved search & indexing | High | Full-text index (Meilisearch), faceted filters, tag search |
| REST / GraphQL API | High | Document CRUD, metadata management, file upload |
| Storage backends (S3, WebDAV) | Medium | Replace IndexedDB with server-side storage |
| Multi-tenant / project management | High | Tenant isolation, project-level access |
| Backend automation | Medium | Webhooks, approval workflows |
| Automatic metadata extraction | Medium | Parse Office metadata, classify by content |
| RAG (Retrieval-Augmented Generation) | High | Vector embeddings of documents for LLM-powered Q&A |
| Live collaborative editing | Very High | CRDT (Yjs) or OT; requires WebSocket server |
| IFC viewer (BIM models) | ~~High~~ Done | Client-side via Three.js + web-ifc; server-side conversion needed for large files |
| Point cloud viewer (.las/.laz) | High | Potree; needs backend tiling for large scans |
| 360-degree photo viewer | Medium | Pannellum; feasible client-side |
| Office tool plugins | Medium | Microsoft 365 / Google Workspace add-ins |
| Windows folder sync plugin | Medium | Desktop tray app or shell extension to sync a local folder with OpenDocs |
| Wiki & project management | Very High | Kanban, backlog, issues, markdown wiki |
| PDF annotation & markup | Medium | Draw, highlight, comment as separate layer |
| Offline-first with sync | High | Service Worker + CRDTs for eventual consistency |
| Audit trail & compliance | Medium | eCH-0160 / ISO 15489 access logging |

---

## Security

- **HTML sanitization** -- external HTML from document renderers is sanitized (strips scripts, iframes, event handlers)
- **SRI hashes** -- CDN scripts pinned with Subresource Integrity where supported
- **XSS escaping** -- user-facing strings use `textContent` assignment or `_esc()` helpers
- **Client-side only** -- no server attack surface, but also no authentication

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI | Vanilla HTML5, CSS3, JavaScript (ES2017+) |
| Icons | [Lucide](https://lucide.dev/) 0.468.0 |
| Storage | [localForage](https://localforage.github.io/localForage/) 1.10.0 (IndexedDB) |
| Word preview | [Mammoth.js](https://github.com/mwilliamson/mammoth.js) 1.6.0 |
| Excel preview | [SheetJS](https://sheetjs.com/) 0.20.1 |
| PDF preview | [PDF.js](https://mozilla.github.io/pdf.js/) 3.11.174 |
| CAD preview | [LibreDWG-Web](https://github.com/nicholasgasior/libredwg-web) 0.6.6 (WASM) |
| BIM preview | [Three.js](https://threejs.org/) 0.155 + [web-ifc](https://github.com/ThatOpen/engine_web-ifc) 0.0.66 (WASM) |
| Design system | CSS custom properties (tokens.css) |
| Deployment | GitHub Pages (static files) |

---

## License

[MIT](LICENSE)

---

<p align="center">
  <sub>Built with vanilla JS and open-source libraries. No frameworks were harmed.</sub>
</p>
