# AGENTS_B.md — Document Scanner / Searchable PDF Subproject

> **Scope:** This file governs only the document-capture and searchable-PDF subproject. It is part of a larger LauzHack 2026 product that also contains work for other challenges. Keep this subproject isolated.

> **Claude Code loading note:** `AGENTS_B.md` is a custom filename, not Claude Code’s conventional automatically discovered instruction filename. Make Claude read this file explicitly at the start of the subproject session, or place/copy its contents as `AGENTS.md` in the subproject directory if automatic loading is desired. Do not put it at the repository root unless the whole repository is intended to inherit these scanner-only rules.

## 1. Mandatory scope boundaries

- Work **only** inside the directory containing this `AGENTS_B.md` and its explicitly owned subdirectories.
- Do not inspect, read, summarize, index, refactor, modify, move, rename, or delete files belonging to sibling projects or other challenge tracks (including IMC, AXA, or any other Logitech/product modules outside this subproject).
- Do not recursively read the repository or the entire parent project to “understand the codebase”. Do not run broad repository-wide scans, global searches, or commands such as `find ..`, `grep -R ..`, or whole-repository file dumps.
- Start by reading this file and only the files directly relevant to the task in this subproject. If a dependency on another module is unavoidable, inspect only its public interface, API contract, or the smallest explicitly identified file needed. Do not modify that module.
- Treat all other challenge work as owned by other contributors/agents. Never make cross-project changes without explicit user authorization.
- Keep changes minimal and local. Before editing, identify the exact target files. Before finishing, report the files changed and confirm that no files outside this subproject were touched.
- Do not change shared root configuration, global dependencies, root-level documentation, CI, or application-wide architecture unless the user explicitly authorizes it.
- If the subproject's location or ownership boundary is unclear, ask the user instead of exploring the whole repository.

## 2. Project context and goal

This is a component of the team's larger **LauzHack 2026** product. Its responsibility is to turn a physical paper document captured by the Logitech camera into a high-quality, faithful, searchable PDF.

The target result is not merely a photograph embedded in a PDF. It should:

1. Preserve the document's visual appearance as faithfully as possible.
2. Correct page perspective, rotation, crop and uneven illumination where appropriate.
3. Keep text sharp and legible without destructive image processing.
4. Add a correctly positioned, invisible OCR text layer so the PDF supports text selection, copy/paste and search.
5. Preserve the original capture and intermediate artifacts so processing can be repeated and quality can be compared.
6. Use AI selectively and economically, not as a mandatory expensive step for every page.

The intended primary output is a **searchable image-based PDF** (image layer + invisible OCR text layer), not a fully reconstructed/editable Word-like document. Do not replace the original document appearance with an AI-generated reconstruction.

## 3. Challenge context: design constraints

The wider event includes the following relevant challenges:

- **Logitech:** context-aware workflows using multimodal inputs. The official challenge page describes RGB/IR video, microphone, face/hand landmarks and metadata as possible inputs. The camera's real capabilities must be verified; do not claim unsupported capabilities.
- **AXA:** frugal multimodal AI. The challenge rewards a real working application, technical substance, relevance, efficient use of AI, team contribution and presentation. Avoid sending every raw image to a large model when local computer vision/OCR can do the job.
- **IMC:** technology for good, especially education, inclusion and community/non-profit use. Keep the scanner component general-purpose and reusable; do not invent an IMC-specific use case unless the product owner defines one.

The scanner subproject should support the larger product through a clean, narrow interface. It must not decide or implement the product's overall user journey, challenge strategy, or features owned by other tracks.

## 4. Hardware and SDK: verify before implementation

There is a potentially important naming/capability mismatch that must be resolved before coding:

- The user initially referred to a **Logitech MX Brio**.
- The Logitech LauzHack resource page documents a separate **LogiInsight hackathon webcam** and its PC Python SDK.
- Logitech's LogiInsight SDK documentation explicitly says that an ordinary MX Brio or other webcam can provide video, but does **not** provide LogiInsight's on-device AI results (face box/478-point face mesh). Those AI results are specific to the LogiInsight hackathon camera.

Therefore:

- Do not assume the physical device is LogiInsight just because the team has access to the LogiInsight SDK.
- First verify the exact camera model available to the team, the actual SDK package installed, and a real captured frame.
- If the device is an MX Brio, use a supported RGB capture path (e.g. OpenCV/UVC or the verified SDK path) and do not expect LogiInsight-specific face/mesh/IR/microphone features.
- If the device is the LogiInsight hackathon webcam, follow the official SDK and its documented connection/capture process. Keep credentials in environment variables; never commit kit credentials or paste them into source files.
- Do not build features based on assumed 4K capture. Query and record the actual supported frame sizes, formats, focus/exposure behaviour and delivered resolution on the target machine.
- Camera capture should be behind a small adapter/interface so the rest of the scanner pipeline does not depend on a particular webcam SDK.

Official references:
- https://logitech.github.io/hackathons/
- https://logitech.github.io/hackathons/logiinsight/
- SDK version documented on the page at the time of writing: 1.5.2; Windows, macOS and Linux; Python 3.9+.

## 5. Proposed technical approach

Use the simplest reliable local-first pipeline. Confirm dependencies and compatibility with the existing subproject before adding packages.

### Capture

- Camera SDK / OpenCV capture adapter, selected only after verifying the actual hardware.
- Save the original frame losslessly where practical (e.g. PNG) and retain capture metadata: timestamp, camera identifier, frame dimensions, pixel format and relevant capture settings.
- Avoid modifying or overwriting the original capture.

### Image preparation

- OpenCV for page-boundary detection, perspective correction, rotation, cropping, illumination/shadow handling, denoising and contrast enhancement.
- Keep transformations conservative and configurable. Do not apply aggressive thresholding or sharpening that destroys faint text, stamps, signatures, handwriting or fine lines.
- Preserve a colour/grayscale option. Produce a clean page image while retaining the untouched original.
- If automatic page detection is uncertain, provide a fallback/manual crop path rather than silently generating a bad page.

### OCR and searchable PDF

- Evaluate Tesseract as a local OCR engine first; use appropriate installed language packs (at least Spanish, Catalan and English if required by the product).
- Evaluate OCRmyPDF for adding a positioned invisible text layer to a scanned PDF. Check its requirements and whether the incoming PDF/image format and preprocessing strategy fit the pipeline.
- PaddleOCR may be evaluated as an alternative or fallback if test documents show materially better results, especially on layout-heavy or difficult pages. Do not add both engines to production by default without measured benefit.
- Preserve page geometry and align OCR text coordinates with the final rendered page. Verify selection/copy/search in a real PDF viewer.
- The visual page remains the authoritative source. OCR mistakes must not alter the visible document.

### OpenRouter / multimodal AI

- OpenRouter is an optional enhancement, not the core OCR engine and not a hard dependency for producing a PDF.
- Use it selectively for tasks that benefit from semantic vision/language understanding: ambiguous OCR review, document type classification, structured field extraction, or quality diagnostics.
- Do not ask a vision LLM to recreate the page or use its generated text as a replacement for OCR positioning.
- Use a vision-capable model only after checking its current model capabilities, accepted image input format, limits and pricing.
- Prefer sending only uncertain crops or compact OCR context rather than every full-resolution original image.
- Treat model output as untrusted and fallible. Validate extracted values and never silently “correct” the visible source document.
- The AXA challenge describes a team OpenRouter inference-key budget; verify the actual key, budget, model access and current pricing rather than assuming unlimited/free inference.
- Never hardcode API keys. Read them from environment variables (e.g. `OPENROUTER_API_KEY`) and ensure `.env` is excluded from version control. Never log secrets.

### PDF generation and validation

- Use a PDF library appropriate to the existing project. ReportLab can create the initial image-based PDF; OCRmyPDF can then add the text layer. Avoid introducing multiple overlapping PDF-generation libraries without a reason.
- Generate PDFs with correct page dimensions/aspect ratio and sensible margins. Avoid stretching the page image.
- Validate output by checking: page count, page dimensions, visual fidelity, OCR text extraction, text selection, search, copy/paste, and opening in a standard PDF reader.
- Retain clear intermediate outputs during development (original capture, corrected page image, base PDF, OCR result, final PDF); temporary files can be cleaned up through an explicit, safe lifecycle.

## 6. Quality and testing requirements

Create a small representative test set with permission to use the documents. Include, where available:

- clean printed text;
- small fonts and dense paragraphs;
- Spanish/Catalan accents and punctuation;
- tables, columns and boxes;
- skewed pages and perspective distortion;
- uneven lighting, shadows and mild glare;
- faint text, stamps and signatures;
- handwritten content if handwriting is in scope.

Compare OCR engines using measured results, not intuition. Track character/word errors or at least a manually reviewed set of exact expected text. Test visual readability separately from OCR accuracy.

A change is not complete merely because a PDF file was produced. It must pass the relevant checks for both visual fidelity and searchable text. Include representative automated tests for image geometry, OCR/PDF generation and failure handling where practical.

## 7. Privacy, security and robustness

- Prefer local processing for capture, image correction and baseline OCR.
- Do not upload documents to OpenRouter unless the product owner has approved that data flow and the document is appropriate to send to the selected provider.
- Keep camera credentials and API keys out of source control, logs, screenshots and generated reports.
- Handle missing camera, unavailable SDK, unreadable image, failed page detection, OCR failure, network failure, rate limits and invalid model output gracefully.
- A failure in OpenRouter must not prevent creation of a basic searchable PDF if local OCR is available.
- Do not delete the original capture until the final PDF has been successfully validated and the retention policy is explicit.

## 8. Development workflow for Claude Code

For every task in this subproject:

1. Read this file first.
2. Inspect only the files in this subproject that are directly relevant to the requested change.
3. Identify the narrowest implementation path and state which files will be touched.
4. Reuse existing project conventions and existing dependencies where possible; do not reformat or refactor unrelated files.
5. Implement and test only this subproject's functionality.
6. Do not modify parent/sibling projects or shared application code. If an integration change outside this directory is required, stop and explain the exact interface change needed; wait for authorization.
7. Summarize what changed, tests run and results, limitations, and confirm the scope boundary was respected.

Do not perform broad “cleanup”, architecture redesign, dependency upgrades or repository-wide formatting as part of a scanner task.

## 9. Integration contract

Keep this component independently testable and expose a small, documented interface to the larger product. The precise function names and data contract must follow the existing parent product's agreed interface; do not invent or modify that interface without approval.

At minimum, the conceptual input/output should be:

- **Input:** captured image (or image path/bytes) plus optional capture metadata and processing options.
- **Output:** final searchable PDF path/bytes plus a structured processing result (success/failure, page count, OCR language, warnings, confidence/quality indicators where available, and intermediate artifact references if enabled).

Avoid importing broad parent-application internals. Prefer dependency injection or a thin adapter at the integration boundary.

## 10. Open questions — do not guess

Resolve these with the user/team before making assumptions that affect architecture:

1. Exact physical camera: MX Brio or LogiInsight hackathon webcam?
2. Exact directory that owns this subproject and the agreed integration boundary.
3. Target operating system and Python version used at the hackathon.
4. Whether documents are single-page only or multi-page capture is required.
5. Whether the camera is fixed above the page or handheld, and whether automatic edge detection is mandatory.
6. Required languages (Spanish, Catalan, English, others) and whether handwriting must be supported.
7. Whether OpenRouter may receive document images, considering privacy and challenge budget.
8. Whether the final PDF should preserve colour or prefer grayscale/black-and-white where legibility benefits.

Do not block a safe local proof of concept on optional AI decisions. Do not make irreversible architecture choices while these questions remain unresolved.

## 11. Reference material and repository caveat

Challenge and SDK sources:

- LauzHack 2026 challenges: https://app.lauzhack.com/Challenges
- Logitech hackathon resources: https://logitech.github.io/hackathons/
- LogiInsight PC Python SDK: https://logitech.github.io/hackathons/logiinsight/

The user also supplied this repository URL:

- https://github.com/IsaacIbanez/hackathon

At the time this instruction file was prepared, the supplied GitHub URL could not be retrieved (the web request returned 404). Do not infer its structure, contents, branch names or current status. If it is private, moved or temporarily unavailable, ask the user to provide access or the relevant subproject files. Do not compensate by scanning another repository or unrelated project.

---

**Primary rule:** this agent owns the scanner/searchable-PDF subproject only. Be a careful component developer, not a maintainer of the entire LauzHack product.
