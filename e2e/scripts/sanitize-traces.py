"""Remove authentication material from Playwright artifacts before upload."""
import json
import re
import sys
from pathlib import Path
from zipfile import ZipFile

SENSITIVE = {'authorization', 'cookie', 'set-cookie', 'accesstoken', 'refreshtoken', 'access_token', 'refresh_token', 'id_token', 'password', 'jwt_secret'}
JWT = re.compile(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+')
MASK = '[REDACTED]'


def clean(value):
    if isinstance(value, dict):
        if str(value.get('name', '')).lower() in SENSITIVE and 'value' in value:
            return {key: MASK if key == 'value' else clean(item) for key, item in value.items()}
        return {key: MASK if key.lower() in SENSITIVE else [] if key.lower() == 'cookies' else clean(item)
                for key, item in value.items()}
    if isinstance(value, list):
        return [clean(item) for item in value]
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (ValueError, TypeError):
            return JWT.sub(MASK, value)
        if isinstance(parsed, (dict, list)):
            return json.dumps(clean(parsed), ensure_ascii=False)
        return JWT.sub(MASK, value)
    return value


def clean_bytes(data):
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError:
        return data
    try:
        return json.dumps(clean(json.loads(text)), ensure_ascii=False).encode()
    except ValueError:
        result = []
        for line in text.splitlines(keepends=True):
            try:
                result.append(json.dumps(clean(json.loads(line)), ensure_ascii=False) + '\n')
            except ValueError:
                result.append(JWT.sub(MASK, line))
        return ''.join(result).encode()


def sanitize(root):
    if not root.exists():
        return
    for path in root.rglob('*'):
        if path.suffix == '.zip':
            temp = path.with_suffix('.clean.zip')
            with ZipFile(path) as source, ZipFile(temp, 'w') as target:
                for entry in source.infolist():
                    target.writestr(entry, clean_bytes(source.read(entry)))
            temp.replace(path)
        elif path.suffix in {'.json', '.trace', '.network'}:
            path.write_bytes(clean_bytes(path.read_bytes()))


if __name__ == '__main__':
    for argument in sys.argv[1:]:
        sanitize(Path(argument))
