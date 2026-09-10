# Product spec and execution

The helper uses Python's standard library. Paths below are relative to the working project, while `PIPELINE` means the absolute path to this skill's `scripts/pipeline.py`.

```json
{
  "products": [{
    "id": "camel-wool-coat",
    "name": "오버핏 울 발마칸 코트",
    "design": "Long oversized balmacaan coat, raglan sleeves, convertible collar, concealed button placket, one visible dark top button, two welt pockets",
    "color": "camel brown",
    "material": "brushed wool blend",
    "studio": "warm light gray seamless background, soft diffused daylight",
    "model": "Adult model, short dark hair, neutral trousers and minimal shoes; same identity and styling in all model images",
    "highlights": ["여유 있는 실루엣", "래글런 소매"],
    "variants": [
      {"id": "navy", "kind": "color", "value": "navy blue"},
      {"id": "cotton", "kind": "material", "value": "matte cotton twill"}
    ]
  }]
}
```

Variants above demonstrate syntax; include them only when actually requested or in catalog data. Without variants the default is eight jobs per product. Optional `shots` can select a subset but must include its dependencies (defined in SHOTS in the helper). `variants[].views` defaults to the complete selected base `shots`. If supplied, it must contain exactly the same shot set. Every variant needs its front anchor. Reduce product `shots` only for an explicitly requested smaller set; it applies equally to every variant. IDs are ASCII kebab-case. The spec and full prompts are embedded in the manifest.

```sh
python3 "$PIPELINE" plan product-spec.json output/product-images/v1
python3 "$PIPELINE" next output/product-images/v1/manifest.json
# Codex generates and visually reviews the returned job using image_gen.
python3 "$PIPELINE" record output/product-images/v1/manifest.json camel-wool-coat/front --image /absolute/generated/front.png --note 'Reviewed silhouette, collar, pockets and safe crop.'
python3 "$PIPELINE" next output/product-images/v1/manifest.json
python3 "$PIPELINE" check output/product-images/v1/manifest.json
python3 "$PIPELINE" preview output/product-images/v1/manifest.json
python3 -m http.server 3016 --directory output/product-images/v1 --bind 0.0.0.0
```

`next --limit 8` lists independent ready jobs without running them. `record --prompt-file actual-prompt.txt` preserves an augmented or revised prompt in the attempt history; otherwise the planned prompt is recorded. `record` without `--image` records a failure/rejection. Authentication failures should stop execution rather than consume retries on every job. Retry the same manifest after recovery. `preview` can run on a partial set and labels absent images as pending; inspect manifest for failure reasons. Keep each manifest under its output directory when moving outputs because asset paths are relative.

A product introduction should use its name, provided highlights and material/color data alongside the editorial, model, texture and gallery images. Preserve empty/unknown facts instead of making up size charts, wash instructions, percentages or benefits.

`check` exits nonzero until every required base and variant cut has an accepted, checksum-valid file. `next` also reports `complete`, `required`, and `missing`; zero ready jobs alone is never evidence of completion.

## Multiple model profiles

Optional `models: [{"id":"male","description":"Adult male, short dark hair, navy trousers"},{"id":"female","description":"Adult female, shoulder-length dark hair, navy trousers"}]` expands model-front/side/back/editorial per profile. Do not also supply a conflicting singular `model`. Four garment shots stay shared; two profiles yield 12 cuts per color/material. Keys are `model-male-front`, `model-male-side`, `model-male-back`, `model-male-editorial`, and corresponding female keys. Each profile references its own model-front. The default without `models` stays at eight shots.
