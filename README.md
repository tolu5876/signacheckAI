# SignaCheck AI

A preliminary, AI-assisted handwritten signature comparison platform. Users upload a known genuine **reference** signature and a **questioned** signature and get an understandable assessment: *consistent with reference*, *potential mismatch (further review recommended)*, or *inconclusive*.

> SignaCheck AI can't prove identity or authenticity. It's a screening tool, not a substitute for a forensic document examiner.

## Current status

| Part | Status |
|---|---|
| Frontend: landing, verify, and privacy pages | Built (Phase 2) |
| Backend: Express API, `POST /api/v1/verify` | Not started (on hold by request) |
| AI model | Not integrated. See research notes below |

Because there's no backend yet, clicking **Analyze Signatures** shows a **"Verification service unavailable"** result. No fake or hard-coded prediction is ever shown.

## Run the frontend locally (Windows PowerShell)

Option A: open `public/index.html` directly in your browser (double-click it).

Option B (recommended): serve it locally:

```powershell
cd SIGCHECK
npx serve public
# then open http://localhost:3000
```

`npx serve` needs Node.js 18+ (https://nodejs.org). It downloads a small static file server the first time you run it.

## Project structure

```
SIGCHECK/
├── .github/workflows/deploy-pages.yml   Publishes public/ to GitHub Pages
├── public/                               Everything the browser loads
│   ├── index.html      Landing page
│   ├── verify.html     Verification workspace and results panel
│   ├── privacy.html    Privacy notice (reflects the current implementation)
│   ├── css/style.css   All styles (mobile-first, light and dark themes)
│   ├── js/app.js       Shared: mobile menu, light/dark toggle, footer year
│   ├── js/upload.js    Drag & drop, file picker, validation, previews
│   ├── js/results.js   Calls the API and renders honest results
│   └── assets/logo.svg
├── .gitignore
└── README.md
```

The backend (`src/`) will be added next to `public/` in Phase 3. It isn't created yet, to avoid empty placeholder files.

## Deploy to GitHub Pages

1. Create an empty repository on GitHub (no README, no .gitignore).
2. Push this folder to its `main` branch:
   ```powershell
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin main
   ```
3. On GitHub open **Settings → Pages** and set **Source** to **GitHub Actions**.
4. Open the **Actions** tab and wait for "Deploy to GitHub Pages" to finish (re-run it if it ran before step 3). The site appears at `https://<your-username>.github.io/<repo-name>/`.

Every later push to `main` redeploys automatically. GitHub Pages only hosts static files, so the verify page will keep showing "Verification service unavailable" until the Phase 3 API is deployed elsewhere and its URL is set in `verify.html`.

## Frontend validation (usability only, so the backend must re-check)

- Formats: JPG, PNG, WebP. The format is detected from the file's **first bytes**, not its extension.
- Max size: 5 MB per image.
- Dimensions: 100×40 to 6000×6000 px. Images under 300 px wide get a low-resolution warning.
- Explicit consent checkbox is required. **Analyze** stays disabled until both images are valid and consent is given.

## API contract the frontend expects (for Phase 3)

`POST {API_BASE}/api/v1/verify` as `multipart/form-data` with the fields `referenceSignature` and `questionedSignature`.

Set `API_BASE` in the `<meta name="signacheck-api-base">` tag in `verify.html` (leave it empty for the same origin).

Success response (HTTP 200):

```json
{
  "status": "consistent | potential_mismatch | inconclusive",
  "similarity_score": 0.0-1.0 or null,
  "message": "Plain-language explanation",
  "quality_warnings": ["optional"],
  "limitations": ["optional"]
}
```

Error response (HTTP 4xx): `{ "error": { "message": "..." } }`. HTTP 404/405/501/502/503, or a server that can't be reached, is shown as *service unavailable*. A score is displayed **only** if it's a number between 0 and 1.

## Architecture proposal

```
Browser (HTML/CSS/vanilla JS)
   │ multipart POST /api/v1/verify
   ▼
Node.js + Express (ES modules)
   ├─ helmet, cors (allow-list), express-rate-limit
   ├─ multer (memory storage, 5 MB, 2 files, no disk writes)
   ├─ sharp: verify real format, rotate by EXIF, grayscale, trim, resize
   ├─ signature-model.js: onnxruntime-node or @tensorflow/tfjs-node
   │     → feature embeddings → distance → calibrated thresholds
   └─ JSON assessment (images discarded from memory after the response)
```

- There's no database and no accounts. Images are processed in memory and never written to disk.
- Frontend and API can be hosted together on one Node host (e.g. Render or Railway), so there's no CORS to manage. Alternatively, put the frontend on Vercel and the API on a Node host.

## AI model research (summary)

**Approach:** writer-independent feature extraction with a CNN, using a Siamese-style comparison. Both signatures go through the same pretrained network, which turns each into a feature vector (an "embedding"). The distance between the two vectors is compared against thresholds calibrated on held-out signers. The result is consistent if below a lower threshold, a potential mismatch if above an upper threshold, and inconclusive in between or when image quality is poor.

**Best-known pretrained option: SigNet / SigNet-F** (Hafemann, Sabourin & Oliveira, 2017; repo `luizgh/sigver`).

- Code licence: BSD 3-Clause.
- **Pretrained weights were trained on GPDS, which the author states is restricted to non-commercial use.** They're fine for research or prototyping, but they're **not** safe for a public or commercial product without permission.
- The weights are distributed as a PyTorch `.pth` file. Running them in Node would need conversion (PyTorch → ONNX → `onnxruntime-node`). That's feasible because the architecture is a plain CNN, but it's a one-time conversion step done with Python.

**Datasets for training our own model:**

- CEDAR (55 signers, 24 genuine + 24 forged each) and BHSig260 (Bengali and Hindi, 260 signers). Both are widely used in research. Their terms of use must be confirmed with the publishers before any commercial or public use.

**Options:**

1. **Prototype:** convert SigNet to ONNX and run it with `onnxruntime-node`. Fastest path to real AI, but the weights are non-commercial only.
2. **Production:** train our own Siamese CNN on a dataset whose licence permits our use, with writer-disjoint train/validation/test splits. Report FAR and FRR. Training is far more practical in Python or Colab, with the trained model exported to ONNX or TF.js so that **inference stays 100% JavaScript**.
3. Until a model is integrated, the API returns `status: "inconclusive"` with `similarity_score: null` and a clear "model not available" message.

Pixel or template-matching similarity won't be presented as AI verification.

## Next steps

- Phase 3 (when approved): Express server, secure upload pipeline, and an honest "model unavailable" response.
- Phase 4: choose model option 1 or 2 based on licensing, then integrate and evaluate it.
