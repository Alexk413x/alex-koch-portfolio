"""comment-check.py -- proves a comment pass changed nothing but comments.

Strips comments and blank lines from the committed version of each file and from the working-tree version,
then compares. Any difference is code that moved, which a comment edit must never do. Run from the repo root:

    python .claude/comment-check.py [path ...]      # default: every changed file in the working tree
"""
import io
import re
import subprocess
import sys

BLOCK = re.compile(r'/\*.*?\*/', re.S)
LINE_SLASH = re.compile(r'(^|[^:"\'/])//[^\n]*')


def strip(text, path):
    """Removes comments and whitespace so two versions can be compared on code alone."""
    if path.endswith('.py'):
        out = []
        for ln in text.split('\n'):
            s = ln.strip()
            if s.startswith('#'):
                continue
            out.append(ln)
        text = '\n'.join(out)
    else:
        text = BLOCK.sub(' ', text)
        if not path.endswith('.css'):
            # A // inside a string or a URL is not a comment; the guard in LINE_SLASH covers the common cases.
            text = LINE_SLASH.sub(lambda m: m.group(1), text)
        text = re.sub(r'<!--.*?-->', ' ', text, flags=re.S)
    return '\n'.join(ln.strip() for ln in text.split('\n') if ln.strip())


def changed_files():
    out = subprocess.run(['git', 'diff', '--name-only', 'HEAD'], capture_output=True, check=True)
    return [p for p in out.stdout.decode('utf-8').split('\n') if p.strip()]


def main(paths):
    paths = paths or changed_files()
    bad, ok = [], 0
    for p in paths:
        if not p.endswith(('.js', '.css', '.html', '.py')):
            continue
        try:
            before = subprocess.run(['git', 'show', 'HEAD:' + p], capture_output=True, check=True).stdout.decode('utf-8')
        except subprocess.CalledProcessError:
            print('  NEW FILE (skipped): %s' % p)
            continue
        after = io.open(p, encoding='utf-8').read()
        a, b = strip(before, p), strip(after, p)
        if a == b:
            ok += 1
        else:
            bad.append(p)
            al, bl = a.split('\n'), b.split('\n')
            print('  CODE CHANGED: %s  (%d -> %d code lines)' % (p, len(al), len(bl)))
            for i in range(min(len(al), len(bl))):
                if al[i] != bl[i]:
                    print('     first diff at code line %d' % (i + 1))
                    print('     was: %s' % al[i][:110])
                    print('     now: %s' % bl[i][:110])
                    break
    print('\n%d file(s) comment-only, %d with code changes' % (ok, len(bad)))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
