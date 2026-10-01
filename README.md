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
python maproom.py data    copy the baseline and runs, trim them, and regenerate the JSON
```

- **`ui`** replaces `maproom/screens`, `css`, `js` and `vendor` with the plugin's copies, makes the viewer's
  one absolute URL relative, and writes `maproom/sources.json` with the plugin version it copied.
- **`data`** copies `baselines/baseline.db` (never `baseline.db.new`), the capture tree and every finished
  run from `C:\Android\RPNDominatorCalculator\knowledge\cartographer`. To read another folder, pass
  `--source <path>` or set `MAPROOM_SOURCE`. It drops each run's trace, replaces your home folder with `~`
  in the copied run files, and generates `index.json` and each run's `view.json` with the plugin's own
  `serve.py`, in place of its two dynamic endpoints. It then deletes every run file that neither `run.db`
  nor `view.json` names.

Both modes print the snapshot's size against GitHub's 100 MB file limit and Pages' 1 GB site limit, and exit
1 when either is exceeded. Run `ui` before `data` after a plugin update, so the JSON comes from the same
viewer version. Run only one `data` at a time: it refuses to start while `maproom/k/*.new` exists.

## Running it locally

ES modules mean `file://` will not work. Serve the repository root:

```
python -m http.server 8000
```

Then open http://localhost:8000/ and pick a page.

## License

No license granted — all rights reserved. Read it, run it, learn from it; please ask before reusing it.

Have fun.
