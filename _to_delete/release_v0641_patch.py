import json

# ── README.md ────────────────────────────────────────────────────────────────
p = 'README.md'
s = open(p, encoding='utf-8').read()

old_ver = '> Current version: **v0.64** — see [Releases](#releases) below for changelog.'
new_ver = '> Current version: **v0.64.1** — see [Releases](#releases) below for changelog.'
assert s.count(old_ver) == 1, f'version line: {s.count(old_ver)}'
s = s.replace(old_ver, new_ver)

block = open('_to_delete/readme_v0641.md', encoding='utf-8').read().rstrip() + '\n\n'
marker = '## Releases\n\n'
i = s.index(marker) + len(marker)
s = s[:i] + block + s[i:]
open(p, 'w', encoding='utf-8').write(s)
print('README.md ok')

# ── src/lib/releases.js ──────────────────────────────────────────────────────
p = 'src/lib/releases.js'
s = open(p, encoding='utf-8').read()

assert s.count("export const CURRENT_VERSION = 'v0.64';") == 1
s = s.replace("export const CURRENT_VERSION = 'v0.64';", "export const CURRENT_VERSION = 'v0.64.1';")

entry = open('_to_delete/releases_entry_v0641.js', encoding='utf-8').read().strip()
assert entry.startswith('{') and entry.endswith('},')
inner = entry[1:-2].strip('\n')

old_open = "export const RELEASES = [{\n    version: 'v0.64',"
assert s.count(old_open) == 1, f'RELEASES head: {s.count(old_open)}'
s = s.replace(old_open, "export const RELEASES = [{\n" + inner + "\n  }, {\n    version: 'v0.64',")
open(p, 'w', encoding='utf-8').write(s)
print('src/lib/releases.js ok')

# ── public/app-version.json ──────────────────────────────────────────────────
# vite.config.js asserts this matches releases.js CURRENT_VERSION and fails the
# build otherwise — a stale value here silently disables the stale-client check
# in PWAUpdatePrompt.
p = 'public/app-version.json'
d = json.load(open(p, encoding='utf-8'))
assert d.get('version') == '0.64', d
d['version'] = '0.64.1'
with open(p, 'w', encoding='utf-8') as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
    f.write('\n')
print('public/app-version.json ok ->', d)
