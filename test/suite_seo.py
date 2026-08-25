# The machine-readable layer, checked against the page it claims to describe.
#
# WHY THIS SUITE EXISTS. Structured data restates what the markup already says, which makes it a second copy of
# the truth -- the one failure mode this repository is organised against. The answer is not to go without it, but
# to make the two disagree loudly: every product name, employer, skill and claim in the JSON-LD is asserted here
# against the page's own text. A claim that survives in the graph after its visible counterpart is deleted is
# hidden text, and Google's spam policies name that as grounds for removal from the index.
import json
import re
import urllib.request

NAME = 'seo'

CANON = 'https://www.alexk413x.com/'

LABS = [
    ('labs/crt/CRT Lab.html', 'labs/crt/CRT%20Lab.html'),
    ('labs/reactor/Reactor.html', 'labs/reactor/Reactor.html'),
    ('labs/wormhole/Wormhole.html', 'labs/wormhole/Wormhole.html'),
]

# The named things a sentence leans on: capitalised runs and acronyms. A sentence's FIRST word is dropped before
# matching, because "Records one app flow" and "It turns a description" are grammar rather than names -- reading
# them as claims is what made this suite demand the page contain the word "Records".
TERM = re.compile(r'[A-Z][\w’\']*(?:[ -][A-Z0-9][\w’\']*)*(?:\.\d+)?')
SENTENCE = re.compile(r'(?<=[.!?])\s+')

# schema.org's own vocabulary. These are addresses in a controlled list, not assertions about Alex.
ENUMS = ('@id', '@type', '@context', 'url', 'image', 'email', 'sameAs', 'codeRepository', 'primaryImageOfPage',
         'itemListOrder', 'applicationCategory', 'applicationSubCategory', 'credentialCategory',
         'educationalLevel', 'occupationalCategory', 'programmingLanguage', 'runtimePlatform', 'inLanguage')


def named_in(prose):
    """The proper nouns a passage asserts, with each sentence's opening word discounted.

    A LABEL IS NOT A SENTENCE. "EAA conformance" has no grammar to discount, and dropping its first word would
    let the graph name a standard the page never does -- so short unpunctuated phrases are matched whole.
    """
    if '.' not in prose and len(prose.split()) < 6:
        for hit in TERM.findall(prose):
            if len(hit) > 2:
                yield hit
        return
    for sentence in SENTENCE.split(prose):
        words = sentence.split(' ', 1)
        if len(words) < 2:
            continue
        for hit in TERM.findall(words[1]):
            if len(hit) > 2:
                yield hit.rstrip('.')


def norm(s):
    """Whitespace-flattened and case-folded, so a claim matches however the page happens to set it."""
    return re.sub(r'\s+', ' ', (s or '')).strip().casefold()


def fetch(page, path):
    url = 'http://127.0.0.1:%d/%s' % (page.port, path)
    try:
        res = urllib.request.urlopen(url, timeout=5)
        return res.getcode(), res.read().decode('utf-8', 'replace')
    except Exception as exc:
        return getattr(exc, 'code', 0), ''


def index_by_id(node, out):
    """Every node carrying an @id, at any depth. The seventeen products live nested inside their ListItems."""
    if isinstance(node, dict):
        if '@id' in node and '@type' in node:
            out[node['@id']] = node
        for v in node.values():
            index_by_id(v, out)
    elif isinstance(node, list):
        for v in node:
            index_by_id(v, out)
    return out


def graph_of(page, r, label):
    """The page's single JSON-LD block, as {@id: node} plus the raw list."""
    blocks = page.json("JSON.stringify([...document.querySelectorAll('script[type=\"application/ld+json\"]')]"
                       '.map(s=>s.textContent))')
    if not r.check('%s carries exactly one JSON-LD block' % label, len(blocks), 1):
        return None, None
    try:
        doc = json.loads(blocks[0])
    except ValueError as exc:
        r.ok('%s JSON-LD parses' % label, False, str(exc))
        return None, None
    r.ok('%s JSON-LD parses' % label, True)
    return doc, index_by_id(doc, {})


def strings_in(node):
    """Every asserted string under a node, so a claim cannot hide inside a nested object."""
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for k, v in node.items():
            if k not in ENUMS:
                for s in strings_in(v):
                    yield s
    elif isinstance(node, list):
        for v in node:
            for s in strings_in(v):
                yield s


def run(page, r):
    page.goto('index.html')
    doc, by_id = graph_of(page, r, 'index.html')
    if not doc:
        return
    nodes = doc['@graph']
    typed = {}
    for n in nodes:
        typed.setdefault(n['@type'], []).append(n)

    # THE PAGE'S OWN WORDS. textContent and not innerText: the record bay is a closed accordion until a box is
    # opened, and Google is explicit that accordion content is not hidden text. innerText would measure it as
    # missing and fail every product's tagline.
    # The title and the description join the body because both are shown -- the tab, and the search result --
    # and because the hero sets the name as one word, so "Alex Koch" spaced appears nowhere else.
    text = norm(page.js("(()=>{const d=document.body.cloneNode(true);"
                        "d.querySelectorAll('script,style,noscript').forEach(n=>n.remove());"
                        "return [document.title,"
                        "document.querySelector('meta[name=description]')?.content||'',"
                        "d.textContent].join(' ')})()"))

    # --- the graph hangs together --------------------------------------------------------------------
    for n in nodes:
        for ref in re.findall(r'"@id":\s*"([^"]+)"', json.dumps(n)):
            if ref != n.get('@id'):
                r.ok('reference resolves: %s' % ref, ref in by_id, 'no node carries that @id')

    for want in ('Person', 'ProfilePage', 'WebSite', 'ItemList', 'FAQPage'):
        r.ok('the graph has a %s' % want, want in typed)

    # QAAI and QACartographer are two products and must stay two nodes: they are separate codebases, and one
    # SoftwareApplication carrying both names is the collapse this is here to catch.
    apps = {n['name'] for n in by_id.values() if n.get('@type') == 'SoftwareApplication'}
    r.ok('QACartographer is its own node', 'QACartographer' in apps)
    r.ok('QAAI is its own node', 'QAAI' in apps, sorted(apps)[:4])

    # --- the seventeen records say what the shelf says ------------------------------------------------
    shelf = page.json("JSON.stringify([...document.querySelectorAll('#shelf .spine-face')].map(f=>({"
                      "name:f.querySelector('.p-name').textContent.trim(),"
                      "tag:f.querySelector('.p-tag').textContent.trim(),"
                      "firm:(document.getElementById(f.getAttribute('aria-controls'))"
                      "?.querySelector('h4')?.textContent||'').trim()})))")
    lst = typed['ItemList'][0]
    items = [e['item'] for e in lst['itemListElement']]
    r.check('the catalogue counts what the shelf holds', lst['numberOfItems'], len(shelf))
    r.check('the list is as long as it says', len(items), lst['numberOfItems'])
    for i, (rec, item) in enumerate(zip(shelf, items)):
        r.check('product %d is the shelf\'s' % (i + 1), item['name'], rec['name'])
        r.check('product %d keeps its tagline' % (i + 1), item['abstract'], rec['tag'])
        pub = by_id.get(item['publisher']['@id'], {})
        r.check('product %d credits its employer' % (i + 1), pub.get('name'), rec['firm'])

    # --- nothing is claimed that the page does not say ------------------------------------------------
    person = typed['Person'][0]
    for field in ('jobTitle', 'knowsAbout'):
        for term in person[field]:
            r.ok('the page says %r' % term, norm(term) in text, 'in Person.%s only' % field)

    for org in typed.get('Organization', []):
        r.ok('the page names %s' % org['name'], norm(org['name']) in text)

    faq = typed['FAQPage'][0]
    r.ok('the FAQ asks something', len(faq['mainEntity']) >= 3, len(faq['mainEntity']))
    for q in faq['mainEntity']:
        answer = q['acceptedAnswer']['text']
        r.ok('%r is answered' % q['name'][:40], len(answer) > 40)
        for term in named_in(answer):
            r.ok('the page backs %r' % term, norm(term) in text, 'asserted in the FAQ only')

    cart = next(n for n in by_id.values() if n.get('name') == 'QACartographer')
    for claim in strings_in(cart):
        for term in named_in(claim):
            r.ok('the page backs %r' % term, norm(term) in text, 'asserted for QACartographer only')

    # --- one address for the page --------------------------------------------------------------------
    head = page.json("JSON.stringify({canon:document.querySelector('link[rel=canonical]')?.href,"
                     "og:document.querySelector('meta[property=\"og:url\"]')?.content,"
                     "img:document.querySelector('meta[property=\"og:image\"]')?.content,"
                     "desc:document.querySelector('meta[name=description]')?.content})")
    r.check('canonical is the live address', head['canon'], CANON)
    r.check('og:url agrees with canonical', head['og'], head['canon'])
    r.check('the profile page agrees too', typed['ProfilePage'][0]['url'], CANON)
    r.ok('the description is a description', 50 <= len(head['desc'] or '') <= 160, len(head['desc'] or ''))
    r.check('the card image is served', fetch(page, head['img'].split(CANON)[-1])[0], 200)

    # --- robots and the sitemap ----------------------------------------------------------------------
    code, robots = fetch(page, 'robots.txt')
    r.check('robots.txt is served', code, 200)
    r.ok('robots.txt points at the sitemap', CANON + 'sitemap.xml' in robots)
    r.ok('robots.txt lets the site be read', re.search(r'(?m)^Allow:\s*/\s*$', robots) is not None)

    code, xml = fetch(page, 'sitemap.xml')
    r.check('sitemap.xml is served', code, 200)
    locs = re.findall(r'<loc>([^<]+)</loc>', xml)
    r.ok('the sitemap lists the home page', CANON in locs, locs)
    for loc in locs:
        r.ok('the sitemap URL is absolute: %s' % loc, loc.startswith(CANON))
        r.check('the sitemap URL resolves: %s' % loc, fetch(page, loc[len(CANON):])[0], 200)
    r.check('every lab is listed', len([l for l in locs if '/labs/' in l]), len(LABS))

    # --- the labs describe themselves ----------------------------------------------------------------
    for path, url_path in LABS:
        page.goto(url_path)
        d, ids = graph_of(page, r, path)
        meta = page.json("JSON.stringify({canon:document.querySelector('link[rel=canonical]')?.href,"
                         "desc:document.querySelector('meta[name=description]')?.content,"
                         "lang:document.documentElement.lang,"
                         "og:document.querySelector('meta[property=\"og:url\"]')?.content})")
        r.check('%s is canonical at its own URL' % path, meta['canon'], CANON + url_path)
        r.check('%s og:url agrees' % path, meta['og'], meta['canon'])
        r.check('%s declares its language' % path, meta['lang'], 'en')
        r.ok('%s has a description' % path, 50 <= len(meta['desc'] or '') <= 320, len(meta['desc'] or ''))
        if d:
            r.check('%s credits its author' % path, d['author']['@id'], CANON + '#alex')
            r.check('%s is source code' % path, d['@type'], 'SoftwareSourceCode')

    # The base lab is not for readers, and says so rather than relying on not being linked.
    page.goto('labs/shell/Shell.html')
    r.ok('the base lab stays out of the index',
         'noindex' in (page.js("document.querySelector('meta[name=robots]')?.content||''")))
