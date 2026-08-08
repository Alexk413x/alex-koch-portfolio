# Lab Shell — the base lab

The starting point for a new lab, and a live catalogue of every control the kit offers. Not a user-facing page:
nothing links to it, and it carries `noindex`.

```
Shell.html          the reference wiring — seven numbered steps, six of them from the kit
shell-shader.js     the subject: one stroked shape, deliberately dull
shell-sidebar.js    every row kind and every formatter, annotated with why each is the kind it is
shell-presets.js    presets vs RESET, which are different promises
```

**To start a lab:** copy this folder, rename the four files, change the storage key in `Shell.html`, replace the
shader and the control table. Delete what you do not need — the preset strip and the DEBUG section are here to
demonstrate the widgets, not because every lab wants them.

Read `shell-sidebar.js` before writing your own: choosing the wrong widget for a control is the commonest mistake
in a panel, and none of them is a syntax error. [`../kit/README.md`](../kit/README.md) has the contract.
