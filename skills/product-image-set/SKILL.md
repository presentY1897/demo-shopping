---
name: product-image-set
description: Generate consistent ecommerce product image sets from product specs or existing reference images, including catalog angles, model views, color/material variants and an introduction page. Use for repeatable single-product or multi-product image production and resuming partial batches.
---

# Product image set

Turn a product specification into separate, consistent raster assets and a reviewable introduction page. Run generation with the built-in image_gen tool via the available imagegen skill; no separate OPENAI_API_KEY is needed. The Python helper plans and records work; it does not call an image API. This is an agent-driven workflow during a Codex session, not an unattended background service.

## Plan

Read [references/spec.md](references/spec.md) for input and commands. Extract facts from the selected project's actual products if available. Use supplied images as design authority. A previously accepted image is the front anchor; reuse it instead of generating it again.

Create a spec and run `plan`. Default coverage is eight images: front, back, side, texture, model-front, model-side, model-back, editorial. Every color/material variant inherits the same complete shot set as the base product. Do not reduce variant views to comparison samples. Honor a narrower set only when the user requests it, applying that set to the base and every variant. The planner rejects unequal variant coverage. Additional color/material options must be supplied by the user or product data; do not invent sellable variants or generate the color × material Cartesian product. Announce product and image counts before starting a batch. User authorization to generate a batch covers routine dependent cuts without per-cut confirmation.

Treat all generated unseen views as synthesized, not evidence of real construction. For real merchandise, preserve supplied construction references and avoid presenting invented seams or composition claims as factual. Material names come from the spec; inferred percentage, performance, certification or fit claims do not belong in copy.

## Generate and resume

1. Run `next` to obtain a ready job, prompt and ordered `referenced_image_paths`. If none are ready, inspect accepted, exhausted and dependency status; do not call completion while blocked jobs remain.
2. For each local reference, inspect it with `view_image` before first use. Label references by dependency role in the generation prompt, especially garment versus model identity versus target variant. Use every returned dependency in its listed order. A variant must inherit its own front anchor to keep its target color/material consistent across views.
3. Generate exactly one image per job with the built-in image_gen tool. For a new front with no reference omit reference arguments; otherwise use local `referenced_image_paths`. Never generate a multi-panel contact sheet and split it into deliverables. Preserve model identity from model-front, as well as the garment. Preserve lighting/camera for color comparisons. Reference conditioning improves consistency but does not guarantee it.
4. Visually inspect the output: collar, seams, closures, pocket count, length, fabric, target angle, variant color and model identity; check visible hands and that crops fit the consuming component. Reject mismatches. If the prompt is augmented or revised, save the exact sent prompt to a file and pass `--prompt-file` when recording. Record accepted files with `record --image ... --note 'specific QA observations'`. Record failed generation or rejected output with `record --note 'reason'` and leave out `--image`. The manifest supports at most two attempts per job; stop and report persistent problems rather than looping. Authentication/usage failures stop the batch immediately, retaining progress; retry when the user reports recovery. Never silently switch to an API/CLI generation path.
5. The helper copies accepted images to the project output directory and records checksums. Continue `next` until done. Already accepted jobs are never overwritten. For revised specs create a new version directory; do not mutate dependencies underneath accepted descendants.

When reusing an existing anchor, inspect it then record it with a note identifying it as user-accepted reuse. A manifest QA note is a human/agent review record, not an automated visual-quality guarantee.

## Deliver

Run `check` before reporting completion or replacing a storefront gallery. It must report complete: true; missing jobs, pending jobs, failed jobs or missing/changed files mean the set is incomplete. Count required cuts per variant, not just accepted jobs in a partial manifest. For an older partial batch, create a new full-coverage spec/version and reuse inspected accepted files with their original prompts, then generate only missing cuts.

Run `preview` to create a responsive HTML introduction/contact sheet with accepted images, factual product text and clearly marked pending slots. Keep Korean copy in HTML/React, not baked into raster images. For a finished storefront introduction, adapt that content into the existing page components and styles when requested; a generated HTML contact sheet alone is a review deliverable, not a production PDP.

When page integration is requested, map only accepted assets to product.images in stable order, group variants separately, and use project-relative persistent paths. Do not put alternate colors/materials into a gallery as if they were the selected variant. Respect the project's URL/storage contract; a directory of images is not proof the database or storefront is connected. Keep generated-image disclosure. Verify image loading and layout in the actual page, and model-view identity through visual inspection.

Report accepted/total counts, failures, review page location, saved assets and prompt manifest. Do not claim the remaining batch was generated after only testing an anchor. For multiple products, use one spec with a products array; each product has independent anchor/model references. Default to sequential tool calls; dependencies must be accepted before descendants.
