"""Restore approved R2 images for local preview; never overwrite different local bytes."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[3]

def digest(data):
    return hashlib.sha256(data).hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Download missing images; default only checks local files')
    args = parser.parse_args()
    exported = json.loads((ROOT / 'product-images/reviewed-products-export.json').read_text())
    mapped = json.loads((ROOT / 'product-images/uploaded-assets.json').read_text())
    by_source = {a['sourceUrl']: a for a in mapped['assets']}
    allowed = [(ROOT / 'apps/shop/public/product-image-sets').resolve(),
               (ROOT / 'apps/shop/public/images/products').resolve()]
    aliases = json.loads((ROOT / 'product-images/legacy-image-aliases.json').read_text())
    assets = exported['assets'] + aliases['assets']
    if len({a['file'] for a in assets}) != len(assets):
        raise ValueError('Duplicate local image destination')
    local_by_hash = {}
    present = restored = missing = 0
    for asset in assets:
        path = (ROOT / asset['file']).resolve()
        if not any(path.is_relative_to(folder) for folder in allowed):
            raise ValueError('Asset path escapes product image directory')
        row = by_source[asset['sourceUrl']]
        url = urlparse(row['publicUrl'])
        if (not row.get('verified') or row['sha256'] != asset['sha256'] or
                row['sizeBytes'] != asset['sizeBytes'] or url.scheme != 'https' or
                url.hostname != 'pub-9ab7102e42d84ffc9dc707c9f00b46ac.r2.dev' or
                url.username or url.password or url.query or url.fragment):
            raise ValueError('Unexpected public asset mapping')
        if path.exists():
            data = path.read_bytes()
            if len(data) != asset['sizeBytes'] or digest(data) != asset['sha256']:
                raise ValueError('Existing local file differs; refusing overwrite: ' + asset['file'])
            local_by_hash[asset['sha256']] = path
            present += 1
            continue
        missing += 1
        if not args.apply:
            continue
        cached = local_by_hash.get(asset['sha256'])
        if cached is not None:
            data = cached.read_bytes()
        else:
            request = Request(row['publicUrl'], headers={
                'User-Agent': 'shopping-product-image-restore/1.0', 'Accept': 'image/*'})
            with urlopen(request, timeout=30) as response:
                data = response.read(asset['sizeBytes'] + 1)
        if len(data) != asset['sizeBytes'] or digest(data) != asset['sha256']:
            raise ValueError('Downloaded checksum mismatch')
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(path.name + '.download-' + str(os.getpid()))
        try:
            with temporary.open('xb') as output:
                output.write(data)
            # Linking fails atomically if another writer created the destination.
            os.link(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)
        local_by_hash[asset['sha256']] = path
        restored += 1
    print(json.dumps({'mode': 'restore' if args.apply else 'dry-run', 'present': present,
                      'missing': missing, 'restored': restored}))

if __name__ == '__main__':
    main()
