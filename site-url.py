"""site-url.py -- moves the site to a different address.

The page's own links and assets are all relative, so the site renders at any base. Six things are not relative
and cannot be: a canonical URL, an Open Graph URL, the card image a scraper fetches without a page to resolve
against, a sitemap's <loc>, a robots.txt Sitemap line, and the string the QR encoder is handed. Those are the
address written down, and this moves all of them at once.

    python site-url.py                              report the current base and every place it is written
    python site-url.py https://www.alexk413x.com/    move to that base

There is no build step here and this is not one: it edits the source in place and the result IS what ships.
test/suite_seo.py fails when the files disagree, so a half-finished move cannot pass unnoticed.
"""
import io
import os
import re
import sys

# Every file that writes the address down. A file added here without a matching check in suite_seo can drift.
FILES = [
    'README.md',
    'index.html',
    'robots.txt',
    'sitemap.xml',
    'site/share.js',
    'labs/crt/CRT Lab.html',
    'labs/reactor/Reactor.html',
    'labs/wormhole/Wormhole.html',
]

CANON = re.compile(r'<link rel="canonical" href="([^"]+)">')


def current_base():
    """The base the site currently claims, read from the home page's canonical URL."""
    m = CANON.search(io.open('index.html', encoding='utf-8').read())
    if not m:
        sys.exit('index.html has no canonical URL to read the current base from')
    return m.group(1)


def forms(base):
    """A base as it is written in the four shapes the source uses."""
    slashed = base if base.endswith('/') else base + '/'
    bare = slashed[:-1]
    return slashed, bare, re.sub(r'^https?://', '', bare), re.sub(r'^https?://', '', slashed)


def report(base):
    print('current base: %s\n' % base)
    _, bare, shown, _ = forms(base)
    total = 0
    for path in FILES:
        text = io.open(path, encoding='utf-8').read()
        n = text.count(bare) + len(re.findall(r'(?<![/\w.])' + re.escape(shown), text))
        total += n
        print('  %-28s %d' % (path, n))
    print('\n%d in all. Pass a new base to move them.' % total)


def move(old, new):
    old_slashed, old_bare, old_shown, old_shown_slashed = forms(old)
    new_slashed, new_bare, new_shown, new_shown_slashed = forms(new)
    if old_bare == new_bare:
        sys.exit('already at %s' % new_bare)

    changed = 0
    for path in FILES:
        text = before = io.open(path, encoding='utf-8').read()
        # Longest form first: replacing the bare host first would leave the trailing slash orphaned.
        text = text.replace(old_slashed, new_slashed).replace(old_bare, new_bare)
        # The address as the contact card PRINTS it, scheme dropped. Guarded so it cannot fire inside a URL
        # that the two passes above have already rewritten.
        text = re.sub(r'(?<![/\w.])' + re.escape(old_shown_slashed), new_shown_slashed, text)
        text = re.sub(r'(?<![/\w.])' + re.escape(old_shown) + r'(?![/\w])', new_shown, text)
        if text != before:
            io.open(path, 'w', encoding='utf-8', newline='').write(text)
            changed += 1
            print('  rewrote %s' % path)
    print('\n%s -> %s in %d files. Run `python test/run.py --only seo` to confirm.' % (old_bare, new_bare, changed))


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    if len(sys.argv) == 1:
        report(current_base())
    elif len(sys.argv) == 2 and re.match(r'^https?://', sys.argv[1]):
        move(current_base(), sys.argv[1])
    else:
        sys.exit(__doc__)
