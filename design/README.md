# design/

A workbench for the shelf. It serves the **current** section — the markup lifted from `index.html`, the rules
from `site.css`, and the real `shelf.js` — so iteration starts from what is shipped rather than from an
interpretation of it.

```
python -m http.server 8000     # then http://localhost:8000/design/preview.html
```

The pill at the bottom is the workbench's readout, not part of the shelf: section height, how many screens that
is, how wide the rack runs against how much of it you can see, and which product is open.

## The one rule

Changes move in ONE direction. They are tried here, and when one is settled the rule folds into `site.css` and
the markup into `index.html` — then `preview.html` is re-lifted from the page. Do not hand-edit this copy to
match a change made on the site, or the site to match a change made here: two hand-kept copies of one section is
the failure this repo is organised against.

`preview.html` names the lines it was lifted from and the date. `preview.css` and `preview.js` hold everything
that is NOT the shipped design, so any change reads as a diff.

## What it measures at 1440×900

| | |
| --- | --- |
| Section height | 1188px, or **1.32 screens** |
| Rack width | 3228px against 1440px of window — **55% of the products are off-screen** |
| Products | 17 spines, 17 proofs, 4 acts (4 / 5 / 4 / 4) |
| Proofs carrying a figure | **3 of 17** |

Those are the four complaints as numbers: it takes too much page, the spines are weak, the proofs are thin, and
the mechanism is an open/close panel that opens *below* what you clicked.
