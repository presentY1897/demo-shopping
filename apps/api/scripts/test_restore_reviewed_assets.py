"""Offline checks for image restoration, aliases and overwrite protection."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('restore_images', Path(__file__).with_name('restore-reviewed-assets.py'))
restore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore)

class RestoreImagesTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / 'product-images').mkdir()
        self.data = b'approved image fixture'
        self.asset = {'file': 'apps/shop/public/product-image-sets/example/images/front.png',
                      'sourceUrl': 'http://localhost/example.png', 'sizeBytes': len(self.data),
                      'sha256': hashlib.sha256(self.data).hexdigest()}
        self.alias = {**self.asset, 'file': 'apps/shop/public/images/products/legacy.png'}
        self.write('reviewed-products-export.json', {'assets': [self.asset]})
        self.write('legacy-image-aliases.json', {'assets': [self.alias]})
        self.write('uploaded-assets.json', {'assets': [{**self.asset, 'verified': True,
                   'publicUrl': 'https://pub-9ab7102e42d84ffc9dc707c9f00b46ac.r2.dev/products/example.png'}]})

    def write(self, name, value):
        (self.root / 'product-images' / name).write_text(json.dumps(value))

    def run_restore(self):
        with patch.object(restore, 'ROOT', self.root), patch('sys.argv', ['restore', '--apply']), contextlib.redirect_stdout(io.StringIO()):
            restore.main()

    def test_alias_reuses_verified_bytes_without_second_download(self):
        with patch.object(restore, 'urlopen', return_value=io.BytesIO(self.data)) as request:
            self.run_restore()
        self.assertEqual(request.call_count, 1)
        self.assertEqual(request.call_args.args[0].get_header('User-agent'),
                         'shopping-product-image-restore/1.0')
        self.assertEqual((self.root / self.alias['file']).read_bytes(), self.data)
        with patch.object(restore, 'urlopen') as request:
            self.run_restore()
            request.assert_not_called()

    def test_different_local_file_is_preserved(self):
        target = self.root / self.asset['file']
        target.parent.mkdir(parents=True)
        target.write_bytes(b'user replacement')
        with self.assertRaisesRegex(ValueError, 'refusing overwrite'):
            self.run_restore()
        self.assertEqual(target.read_bytes(), b'user replacement')

    def test_alias_cannot_escape_image_directories(self):
        self.write('reviewed-products-export.json', {'assets': []})
        self.write('legacy-image-aliases.json', {'assets': [{**self.alias, 'file': '../outside.png'}]})
        with self.assertRaisesRegex(ValueError, 'escapes'):
            self.run_restore()

if __name__ == '__main__':
    unittest.main()
