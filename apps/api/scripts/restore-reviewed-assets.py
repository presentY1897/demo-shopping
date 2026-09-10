"""Restore approved R2 images for local preview; never overwrite different local bytes."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import urlopen

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
    allowed = (ROOT / 'apps/shop/public/product-image-sets').resolve()
    present = restored = missing = 0
    for asset in exported['assets']:
        path = (ROOT / asset['file']).resolve()
        if not path.is_relative_to(allowed):
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
            present += 1
            continue
        missing += 1
        if not args.apply:
            continue
        with urlopen(row['publicUrl'], timeout=30) as response:
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
        restored += 1
    print(json.dumps({'mode': 'restore' if args.apply else 'dry-run', 'present': present,
                      'missing': missing, 'restored': restored}))

if __name__ == '__main__':
    main()
