import argparse
import copy
import json
import tempfile
import unittest
from pathlib import Path

import pipeline


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.spec = {'products': [{'id': 'coat', 'name': 'Coat <sample>', 'design': 'Raglan, two pockets', 'color': 'camel', 'material': 'wool'}]}
        # Tiny PNG fixture; no image generation is exercised by these state tests.
        import base64
        self.image = self.root / 'source.png'
        self.image.write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII='))

    def plan(self):
        spec = self.root / 'spec.json'
        spec.write_text(json.dumps(self.spec))
        return Path(pipeline.plan(spec, self.root / 'out')['manifest'])

    def record(self, manifest, job, image=True):
        return pipeline.record(argparse.Namespace(manifest=str(manifest), job=job, image=str(self.image) if image else None, note='Fixture review'))

    def test_dependency_order_and_resume(self):
        manifest = self.plan()
        self.assertEqual([j['id'] for j in pipeline.next_jobs(manifest, 20)['ready']], ['coat/front'])
        self.record(manifest, 'coat/front')
        ready = [j['id'] for j in pipeline.next_jobs(manifest, 20)['ready']]
        self.assertIn('coat/model-front', ready)
        self.assertNotIn('coat/model-back', ready)
        with self.assertRaises(ValueError):
            self.record(manifest, 'coat/model-back')
        self.record(manifest, 'coat/model-front')
        self.record(manifest, 'coat/back')
        ready = pipeline.next_jobs(manifest, 20)['ready']
        back = next(j for j in ready if j['id'] == 'coat/model-back')
        self.assertEqual(len(back['referenced_image_paths']), 3)
        self.assertNotIn('coat/front', [j['id'] for j in ready])

    def test_batch_and_variant_dependencies(self):
        self.spec['products'][0]['variants'] = [{'id': 'navy', 'kind': 'color', 'value': 'navy'}]
        second = copy.deepcopy(self.spec['products'][0])
        second['id'] = 'jacket'
        second['variants'] = []
        self.spec['products'].append(second)
        manifest = self.plan()
        self.assertEqual(len(pipeline.read(manifest)['jobs']), 24)
        self.assertEqual(len(pipeline.next_jobs(manifest, 20)['ready']), 2)
        self.record(manifest, 'coat/front')
        self.record(manifest, 'coat/model-front')
        self.assertNotIn('coat/variant-navy-model-front', [j['id'] for j in pipeline.next_jobs(manifest, 20)['ready']])
        self.record(manifest, 'coat/variant-navy-front')
        job = next(j for j in pipeline.next_jobs(manifest, 20)['ready'] if j['id'] == 'coat/variant-navy-model-front')
        self.assertTrue(job['referenced_image_paths'][1].endswith('variant-navy-front.png'))

    def test_rejects_incomplete_variant_views(self):
        self.spec['products'][0]['variants'] = [{'id': 'navy', 'kind': 'color', 'value': 'navy', 'views': ['front']}]
        with self.assertRaises(ValueError):
            self.plan()

    def test_complete_requires_every_variant_file(self):
        self.spec['products'][0]['shots'] = ['front', 'back']
        self.spec['products'][0]['variants'] = [{'id': 'navy', 'kind': 'color', 'value': 'navy'}]
        manifest = self.plan()
        self.assertEqual(len(pipeline.read(manifest)['jobs']), 4)
        self.assertFalse(pipeline.next_jobs(manifest, 20)['complete'])
        for job in ['coat/front', 'coat/back', 'coat/variant-navy-front', 'coat/variant-navy-back']:
            self.record(manifest, job)
        self.assertTrue(pipeline.next_jobs(manifest, 20)['complete'])
        data = pipeline.read(manifest)
        data['jobs'] = [j for j in data['jobs'] if j['id'] != 'coat/variant-navy-back']
        pipeline.save(manifest, data)
        state = pipeline.next_jobs(manifest, 20)
        self.assertEqual(state['ready'], [])
        self.assertFalse(state['complete'])
        self.assertEqual(state['missing'], ['coat/variant-navy-back'])

    def test_retry_cap_and_no_overwrite(self):
        manifest = self.plan()
        self.record(manifest, 'coat/front', False)
        self.assertEqual(len(pipeline.next_jobs(manifest, 1)['ready']), 1)
        self.record(manifest, 'coat/front', False)
        self.assertEqual(pipeline.next_jobs(manifest, 1)['exhausted'], ['coat/front'])
        with self.assertRaises(ValueError):
            self.record(manifest, 'coat/front')
        with self.assertRaises(ValueError):
            pipeline.plan(self.root / 'spec.json', self.root / 'out')

    def test_checksum_and_preview(self):
        manifest = self.plan()
        self.record(manifest, 'coat/front')
        with self.assertRaises(ValueError):
            self.record(manifest, 'coat/front')
        preview = Path(pipeline.preview(manifest)['preview']).read_text()
        self.assertIn('Coat &lt;sample&gt;', preview)
        self.assertIn('images/coat/front.png', preview)
        self.assertIn('생성 대기', preview)
        (manifest.parent / 'images/coat/front.png').write_bytes(b'changed')
        with self.assertRaises(ValueError):
            pipeline.next_jobs(manifest, 1)

    def test_invalid_dependency_and_path(self):
        self.spec['products'][0]['shots'] = ['model-side']
        with self.assertRaises(ValueError):
            self.plan()
        self.spec['products'][0]['id'] = '../escape'
        with self.assertRaises(ValueError):
            self.plan()


if __name__ == '__main__':
    unittest.main()
