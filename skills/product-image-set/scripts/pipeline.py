#!/usr/bin/env python3
"""Plan/resume product imagery. Generation is performed by Codex's image_gen tool."""
import argparse
import hashlib
import html
import json
import re
import shutil
from pathlib import Path

SHOTS = {
    'front': ('정면', [], 'Front catalog view, entire garment centered, invisible mannequin, square canvas with garment within central 65% width and 85% height for portrait cropping.'),
    'back': ('후면', ['front'], 'Straight rear catalog view of the same garment. Preserve construction; do not invent decoration or branding.'),
    'side': ('측면', ['front'], 'True side catalog view of the same garment, showing silhouette, length and sleeve volume.'),
    'texture': ('소재 확대', ['front'], 'Macro photograph of the actual referenced fabric and one existing seam. Match weave, finish and color; do not add features.'),
    'model-front': ('모델 정면', ['front'], 'One adult model wearing the exact referenced garment, full body front view, relaxed neutral stance, garment unobstructed.'),
    'model-side': ('모델 측면', ['front', 'model-front'], 'Full body true side view. Preserve the exact model identity, hair, styling, garment and studio from the model reference.'),
    'model-back': ('모델 후면', ['front', 'back', 'model-front'], 'Full body rear view. Preserve the exact model identity, hair, styling and garment construction from the references.'),
    'editorial': ('소개용 연출', ['front', 'model-front'], 'Editorial introduction photograph of the same adult model in the same garment. Natural restrained pose, full garment readable, quiet negative space, no embedded text.'),
}


def read(path):
    return json.loads(Path(path).read_text())


def save(path, data):
    path = Path(path)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    temp.replace(path)


def slug(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', value):
        raise ValueError(f'Invalid id: {value!r}; use lowercase ASCII kebab-case')
    return value


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def valid_output(root, job):
    path = root / job.get('output', '')
    return job['status'] == 'accepted' and path.is_file() and digest(path) == job.get('sha256')


def plan(spec_path, out):
    spec = read(spec_path)
    products = spec['products']
    if not isinstance(products, list) or not products:
        raise ValueError('products must be a nonempty list')
    jobs, ids = [], set()
    for product in products:
        pid = slug(product['id'])
        if pid in ids:
            raise ValueError('Duplicate product id')
        ids.add(pid)
        for field in ['name', 'design', 'color', 'material']:
            if not isinstance(product.get(field), str) or not product[field].strip():
                raise ValueError(f'{pid}: missing {field}')
        shots = product.get('shots', list(SHOTS))
        if not shots or len(set(shots)) != len(shots) or any(s not in SHOTS for s in shots):
            raise ValueError(f'{pid}: invalid/duplicate shots')
        for shot in shots:
            if any(dep not in shots for dep in SHOTS[shot][1]):
                raise ValueError(f'{pid}/{shot}: missing dependency in shots')
        context = (f"Product: {product['name']}\nDesign invariants: {product['design']}\n"
                   f"Base color: {product['color']}\nBase material: {product['material']}\n"
                   f"Studio: {product.get('studio', 'warm light gray seamless studio, soft diffused daylight')}\n"
                   f"Adult model styling: {product.get('model', 'adult model, natural appearance, neutral styling without accessories obscuring the garment')}\n")
        def add(key, label, deps, direction, variant=None):
            jobs.append({'id': f'{pid}/{key}', 'productId': pid, 'label': label,
                         'variant': variant, 'dependencies': [f'{pid}/{d}' for d in deps],
                         'status': 'pending', 'attempts': 0,
                         'prompt': 'Use case: product-mockup\n' + context + direction +
                         '\nOne separate photorealistic image only; no collage, text, logos or watermark. '
                         'Reference images are authoritative. Preserve garment shape, seams, collar, pockets and closures unless explicitly changing that property. '
                         'For edits change only the requested angle, pose, color or material. Do not depict multiple variants together.'})
        for shot in shots:
            label, deps, direction = SHOTS[shot]
            add(shot, label, deps, direction)
        variant_ids = set()
        for variant in product.get('variants', []):
            vid = slug(variant['id'])
            if vid in variant_ids:
                raise ValueError('Duplicate variant id')
            variant_ids.add(vid)
            if variant['kind'] not in ('color', 'material') or not variant.get('value'):
                raise ValueError('Variants need kind color/material and value')
            views = variant.get('views', shots)
            if set(views) != set(shots):
                raise ValueError('Every variant must cover all selected base shots; narrow product.shots only when requested')
            if not views or len(set(views)) != len(views) or any(v not in shots for v in views):
                raise ValueError('Variant views must be unique selected base shots')
            if 'front' not in views:
                raise ValueError('Variant views must include front as variant anchor')
            for view in ['front'] + [v for v in views if v != 'front']:
                deps = [view] if view == 'front' else [view, f'variant-{vid}-front']
                add(f'variant-{vid}-{view}', f"{variant['value']} · {SHOTS[view][0]}", deps,
                    f"Match framing and pose of the first reference. Change only {variant['kind']} to {variant['value']}. "
                    'For material changes alter texture and plausible drape only; preserve tailoring. '
                    'If a second reference is present it defines the target variant appearance.', variant)
    root = Path(out).resolve()
    root.mkdir(parents=True, exist_ok=True)
    target = root / 'manifest.json'
    if target.exists():
        raise ValueError('Manifest already exists; resume it or choose a new output directory')
    save(target, {'version': 1, 'spec': spec, 'jobs': jobs})
    return {'manifest': str(target), 'products': len(products), 'images': len(jobs)}


def coverage(data, root):
    expected = []
    for product in data['spec']['products']:
        shots = product.get('shots', list(SHOTS))
        prefixes = [''] + [f"variant-{v['id']}-" for v in product.get('variants', [])]
        expected.extend(f"{product['id']}/{prefix}{shot}" for prefix in prefixes for shot in shots)
    by_id = {j['id']: j for j in data['jobs']}
    missing = [key for key in expected if key not in by_id or not valid_output(root, by_id[key])]
    return {'complete': not missing, 'required': len(expected), 'missing': missing}


def next_jobs(path, limit):
    data, root = read(path), Path(path).resolve().parent
    by_id = {j['id']: j for j in data['jobs']}
    ready = []
    for job in data['jobs']:
        if job['status'] == 'accepted' and not valid_output(root, job):
            raise ValueError(f"Missing or changed accepted asset: {job['id']}")
        if job['status'] == 'accepted' or job['attempts'] >= 2:
            continue
        if all(valid_output(root, by_id[d]) for d in job['dependencies']):
            ready.append({**job, 'referenced_image_paths': [str(root / by_id[d]['output']) for d in job['dependencies']]})
    return {**coverage(data, root), 'ready': ready[:limit], 'accepted': sum(j['status'] == 'accepted' for j in data['jobs']),
            'total': len(data['jobs']), 'exhausted': [j['id'] for j in data['jobs'] if j['status'] != 'accepted' and j['attempts'] >= 2]}


def record(args):
    data, root = read(args.manifest), Path(args.manifest).resolve().parent
    by_id = {j['id']: j for j in data['jobs']}
    job = by_id[args.job]
    if job['status'] == 'accepted':
        raise ValueError('Already accepted; create a new version rather than overwrite')
    if job['attempts'] >= 2:
        raise ValueError('Attempt limit reached; inspect the issue and create a revised plan')
    if not args.note.strip():
        raise ValueError('A visual QA note or failure reason is required')
    if not all(valid_output(root, by_id[d]) for d in job['dependencies']):
        raise ValueError('Reference dependencies must be accepted first')
    actual_prompt = Path(args.prompt_file).read_text() if getattr(args, 'prompt_file', None) else job['prompt']
    if args.image:
        source = Path(args.image).resolve()
        if not source.is_file() or source.stat().st_size == 0 or source.suffix.lower() not in ['.png', '.jpg', '.jpeg', '.webp']:
            raise ValueError('Expected a nonempty raster image file')
        dest = root / 'images' / (job['id'] + source.suffix.lower())
        if dest.exists():
            raise ValueError('Destination already exists; refusing overwrite')
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, dest)
        job.update(status='accepted', output=str(dest.relative_to(root)), sha256=digest(dest))
    else:
        job['status'] = 'failed'
    job['attempts'] += 1
    job.setdefault('history', []).append({'note': args.note, 'status': job['status'], 'prompt': actual_prompt})
    save(args.manifest, data)
    return {'id': job['id'], 'status': job['status']}


def preview(path):
    data, root = read(path), Path(path).resolve().parent
    esc = html.escape
    sections = []
    for product in data['spec']['products']:
        cards = []
        for job in data['jobs']:
            if job['productId'] != product['id']:
                continue
            media = (f'<img src="{esc(job["output"])}" alt="{esc(job["label"])}" loading="lazy">'
                     if valid_output(root, job) else '<div class="pending">생성 대기</div>')
            cards.append(f'<figure>{media}<figcaption>{esc(job["label"])}</figcaption></figure>')
        bullets = ''.join(f'<li>{esc(s)}</li>' for s in product.get('highlights', []))
        sections.append(f'<section><h2>{esc(product["name"])}</h2><p>{esc(product["color"])} · {esc(product["material"])}</p><ul>{bullets}</ul><div class="grid">{"".join(cards)}</div></section>')
    body = '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>상품 소개 이미지</title><style>body{font:16px/1.6 system-ui;margin:0;background:#faf9f7;color:#222}main{max-width:1200px;margin:auto;padding:32px 20px}section{margin:48px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:24px}figure{margin:0}img,.pending{width:100%;aspect-ratio:1;object-fit:contain;background:#eee;border-radius:8px}.pending{display:grid;place-items:center;color:#777}figcaption{padding:8px 0}</style><main><h1>상품 소개</h1><p>AI 생성 이미지 · 검토용</p>' + ''.join(sections) + '</main></html>'
    (root / 'index.html').write_text(body)
    return {'preview': str(root / 'index.html')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('plan'); p.add_argument('spec'); p.add_argument('out')
    p = sub.add_parser('next'); p.add_argument('manifest'); p.add_argument('--limit', type=int, default=1)
    p = sub.add_parser('record'); p.add_argument('manifest'); p.add_argument('job'); p.add_argument('--image'); p.add_argument('--note', required=True); p.add_argument('--prompt-file')
    p = sub.add_parser('preview'); p.add_argument('manifest')
    p = sub.add_parser('check'); p.add_argument('manifest')
    args = parser.parse_args()
    try:
        if args.command == 'plan': result = plan(args.spec, args.out)
        elif args.command == 'next': result = next_jobs(args.manifest, max(1, args.limit))
        elif args.command == 'record': result = record(args)
        elif args.command == 'check':
            result = coverage(read(args.manifest), Path(args.manifest).resolve().parent)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            if not result['complete']: parser.exit(1)
            return
        else: result = preview(args.manifest)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (ValueError, KeyError, OSError, TypeError) as error:
        parser.exit(1, f'Error: {error}\n')


if __name__ == '__main__':
    main()
