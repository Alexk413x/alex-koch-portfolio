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
the RPN Dominator Calculator baseline and its runs. The Cartographer demo page links to it. Do not edit it by
hand: `maproom.py` writes all of it, in two modes.

```
python maproom.py ui      copy the viewer from the newest installed cartographer plugin
python maproom.py ui --checkout <repo>
                          copy it from a cartographer repository at its current commit instead
python maproom.py data    copy the baseline and runs, trim them, and regenerate the JSON
python maproom.py data --baseline <file>
                          use a baseline database from another path
python maproom.py data --checkout <repo>
                          generate the JSON with that checkout's serve.py
```

- **`ui`** replaces `maproom/screens`, `css`, `js` and `vendor` with the plugin's copies, makes the viewer's
  one absolute URL relative, and writes `maproom/sources.json` with the plugin version it copied. Use
  `ui --checkout <repo>` to copy from a Cartographer checkout instead of the installed plugin.
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

## License

No license granted — all rights reserved. Read it, run it, learn from it; please ask before reusing it.

Have fun.
