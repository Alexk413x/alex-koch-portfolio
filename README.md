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

## Running it locally

ES modules mean `file://` will not work. Serve the repository root:

```
python -m http.server 8000
```

Then open http://localhost:8000/ and pick a page.

## License

No license granted — all rights reserved. Read it, run it, learn from it; please ask before reusing it.

Have fun.
