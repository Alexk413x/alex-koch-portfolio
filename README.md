# Alex Koch — Portfolio & Labs

A portfolio site and a set of instruments: single-purpose tools built to make something physical measurable
rather than merely to look like it. The largest of them simulates an amber CRT.

**Live:** https://alexk413x.com/

Everything here is hand-authored. There is no build step, no bundler and no framework. Every page is plain
HTML plus ES modules, and the only thing any page loads from the network is the fonts.

## The labs

- **[CRT Lab](labs/crt/CRT%20Lab.html)** — an amber CRT solved per pixel in a WebGL2 fragment shader: the face's
  curvature, the shadow mask, the beam, the phosphor's persistence, and a ray-traced light fitting reflected in
  the glass.
- **[Reactor Lab](labs/reactor/Reactor.html)** — a containment core, sphere-traced. A goo core with sub-cores
  torn out of it by a pulse, nine alloy ring fragments, and a shield that fails on a schedule.
- **[Wormhole Lab](labs/wormhole/Wormhole.html)** — a tunnel solved in closed form rather than marched, ending at
  a Schwarzschild black hole whose light is traced along real null geodesics.
- **Lab Shell** (`labs/shell/Shell.html`) — the base lab, and a live catalog of every control the kit offers.
  Start there when writing a new one.

[`labs/kit/`](labs/kit/README.md) holds everything a lab needs that is not about the lab: the panel, the shader
host, the page shell, persistence, the frame loop and the units.

## The Cartographer map

[`maproom/`](maproom/screens/index.html) is a static snapshot of cartographer's maproom viewer, loaded with
the RPN Dominator Calculator baseline and its runs. The Cartographer demo page links to the map.
The viewer's Runs navigation opens the recorded run player. Do not edit the snapshot by
hand: `maproom.py` writes all of it, in two modes.

```
python maproom.py ui      copy the viewer from the newest installed cartographer plugin
python maproom.py ui --checkout <repo>
                          copy it from a cartographer repository at its current commit instead
python maproom.py ui --checkout <repo> --run-details
                          copy PR #94's run player, details and required shared assets
python maproom.py data    copy the baseline and runs, trim them, and regenerate the JSON
python maproom.py data --baseline <file>
                          use a baseline database from another path
python maproom.py data --checkout <repo>
                          generate the JSON with that checkout's serve.py
```

- **`ui`** replaces `maproom/screens`, `css`, `js` and `vendor` with the plugin's copies, makes the viewer's
  one absolute URL relative, and writes `maproom/sources.json` with the plugin version it copied. Use
  `ui --checkout <repo>` to copy from a Cartographer checkout instead of the installed plugin.
  For the run surface only, pass `--run-details`. This reads committed files from Cartographer
  PR #94's merge, `ac0e99a28dcc5f413a42af11e6a6522428977a1f`, regardless of the checkout's
  current branch. It copies the run model and view, capture-inspector helper, shared stylesheet,
  picker and press helpers, and playback icons and font. It keeps the survey pages and all
  published data unchanged. `sources.json` records the focused refresh under `run_details`,
  separate from the viewer provenance used for data exports. A full `ui` refresh replaces
  that marker and the focused files with the selected viewer.
- **`data`** copies `baselines/baseline.db` (never `baseline.db.new`), the capture tree and every finished
  run from `C:\Android\RPNDominatorCalculator\knowledge\cartographer`. To read another folder, pass
  `--source <path>` or set `MAPROOM_SOURCE`. Pass `--baseline <file>` to use a baseline database outside
  that folder. It drops each run's trace, replaces your home folder with `~`
  in the copied run files, and generates `index.json` and each run's `view.json` with Cartographer's own
  `serve.py`, in place of its two dynamic endpoints. Use `data --checkout <repo>` with the same checkout
  passed to `ui --checkout` so the generated JSON matches that viewer. The trim keeps the small suite,
  case and accessibility-report JSON used by run-health summaries, plus files referenced by `run.db` and
  `view.json`; it removes other run files.

The data refresh requires Cartographer's `maproom/public_export.py` in the selected plugin or checkout.
That module owns the public-export policy. The generator sanitizes the copied databases and evidence
before generating the viewer JSON, sanitizes the generated files, and validates the snapshot before
replacing the published folder. It removes internal implementation notes and raw execution diagnostics,
not recorded action identifiers, parameters, screenshots, or test outcomes. The source stays unchanged.
Raw logs become explicit omission notices. Sanitized database hashes differ from the source; generated
run comparisons reference the published database hash.
The public snapshot is a static report, not a connection to a running Librarian.
The run player reads the published MP4 files and their timing rows in `run.db`. It supports
play/pause, seeking across kept segments, step selection, rotation, mute and fullscreen.
The focused refresh does not publish additional recordings or change the sanitization policy.
Intermediate copies and swap backups stay under `.claude/maproom-staging/`, which the Pages workflow
excludes from deployment.

Both modes print the snapshot's size against GitHub's 100 MB file limit and Pages' 1 GB site limit, and exit
1 when either is exceeded. After a plugin update, run `ui` before `data`. With a repository checkout, pass
the same checkout to both commands. Run only one `data` at a time: it refuses to start while
`.claude/maproom-staging/*.new` exists.

## Running it locally

ES modules mean `file://` will not work. Serve the repository root:

```
python -m http.server 8000
```

Then open http://localhost:8000/ and pick a page.

For Maproom video seeking, use `python maproom.py serve` and open
http://127.0.0.1:8742/screens/index.html. This loopback-only preview serves files inside the
published `maproom/` snapshot, refuses directory listings and paths outside it, and supports
MP4 byte-range requests. It does not read the original knowledge folder or run Cartographer
services. The standard Python server above can play video but does not support byte-range
seeking. GitHub Pages serves the static video files without a Python service.

## License

No license granted — all rights reserved. Read it, run it, learn from it; please ask before reusing it.

Have fun.
