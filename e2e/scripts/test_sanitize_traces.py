"""Artifact regression: opaque cookies and nested token bodies must not be published."""
import base64
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

spec = importlib.util.spec_from_file_location('sanitizer', Path(__file__).with_name('sanitize-traces.py'))
sanitizer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sanitizer)


class ArtifactTest(unittest.TestCase):
    def test_zip_removes_credentials_and_preserves_images_and_transaction_evidence(self):
        opaque = 'opaque-refresh-secret-sentinel'
        def encoded(value):
            return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')

        jwt = '.'.join((encoded({'alg': 'HS256'}), encoded({'sub': 'test-only'}), 'unsigned-test'))
        event = {'headers': [{'name': 'Authorization', 'value': f'Bearer {jwt}'},
                             {'name': 'Set-Cookie', 'value': f'refresh={opaque}; HttpOnly'}],
                 'cookies': [{'name': 'refresh', 'value': opaque}],
                 'body': json.dumps({'accessToken': jwt, 'refreshToken': opaque, 'orderNumber': 'DEMO-123'}),
                 'status': 200}
        picture = b'\x89PNG\r\n\x1a\n\xff\x00binary'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'trace.zip'
            with ZipFile(archive, 'w') as target:
                target.writestr('trace.network', json.dumps(event) + '\n')
                target.writestr('resources/body', json.dumps({'refreshToken': opaque}))
                target.writestr('resources/image.png', picture)
            sanitizer.sanitize(root)
            with ZipFile(archive) as source:
                for name in ('trace.network', 'resources/body'):
                    text = source.read(name).decode()
                    self.assertNotIn(opaque, text)
                    self.assertNotIn(jwt, text)
                clean = json.loads(source.read('trace.network'))
                self.assertEqual(clean['status'], 200)
                self.assertEqual(json.loads(clean['body'])['orderNumber'], 'DEMO-123')
                self.assertEqual(source.read('resources/image.png'), picture)


if __name__ == '__main__':
    unittest.main()
