# test/run.py -- runs every suite against the real served site in one browser.
#
#   python test/run.py                 everything, headless
#   python test/run.py --only rpn qr   just those suites
#   python test/run.py --show          a visible window, for watching a failure happen
#   python test/run.py --perf          also report frame cost, which is advisory and never fails the run
#
# ONE browser and ONE server for the whole run. Launching Chrome per file is what made these slow enough to
# stop being run, and a suite that is not run is not a test.
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import harness            # noqa: E402
import suite_catalogue    # noqa: E402
import suite_hero         # noqa: E402
import suite_labs         # noqa: E402
import suite_layout       # noqa: E402
import suite_morph        # noqa: E402
import suite_qr           # noqa: E402
import suite_rpn          # noqa: E402
import suite_seo          # noqa: E402

# suite_catalogue LAST: it emulates prefers-reduced-motion, and a suite that crashed mid-emulation would hand
# the setting to whatever ran after it.
SUITES = [suite_rpn, suite_morph, suite_qr, suite_hero, suite_layout, suite_seo, suite_labs, suite_catalogue]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', nargs='*', default=None, help='suite names to run')
    ap.add_argument('--show', action='store_true', help='visible browser window')
    ap.add_argument('--perf', action='store_true', help='also report frame cost (advisory)')
    ap.add_argument('--port', type=int, default=8129)
    a = ap.parse_args()

    chosen = [s for s in SUITES if not a.only or s.NAME in a.only]
    if not chosen:
        sys.exit('no suite matched %s; have: %s' % (a.only, ', '.join(s.NAME for s in SUITES)))

    started = time.time()
    results = []
    with harness.Session(port=a.port, headless=not a.show) as page:
        for suite in chosen:
            r = harness.Result(suite.NAME)
            print('  %-10s ...' % suite.NAME, end='', flush=True)
            try:
                suite.run(page, r)
            except Exception as exc:                      # a crashed suite is a failure, not a stack trace
                r.failures.append('suite raised: %s: %s' % (type(exc).__name__, exc))
            results.append(r)
            print('\r  %-10s %d passed%s%s' % (
                suite.NAME, r.passed,
                ', %d FAILED' % len(r.failures) if r.failures else '',
                ', %d skipped' % len(r.skipped) if r.skipped else ''))

        if a.perf:
            # Reported against the hero scrub measured in the SAME run: an absolute frame time here is a mood,
            # a comparison against the page's simplest scene is a number.
            page.goto('index.html')
            morph = page.frame_cost('app-scroll', 'app-stage')
            hero = page.frame_cost('scroll', 'stage')
            print('\n  frame cost   morph %(a)sms mean / %(b)sms worst   hero %(c)sms / %(d)sms  (advisory)'
                  % {'a': morph['mean'], 'b': morph['worst'], 'c': hero['mean'], 'd': hero['worst']})

    failed = [r for r in results if r.failures]
    total = sum(r.passed for r in results)
    skipped = sum(len(r.skipped) for r in results)

    for r in results:
        for line in r.skipped:
            print('  SKIP  [%s] %s' % (r.name, line))
    for r in failed:
        for line in r.failures:
            print('  FAIL  [%s] %s' % (r.name, line))

    print('\n%d passed, %d failed%s, in %.1fs'
          % (total, sum(len(r.failures) for r in failed),
             ', %d skipped' % skipped if skipped else '', time.time() - started))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
