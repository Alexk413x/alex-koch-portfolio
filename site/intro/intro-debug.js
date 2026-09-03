/* intro-debug.js — the director's HUD, behind ?intro&hud.
 *
 * What beat is playing, how far in, which scenes are ready, and keys to hold, slow or push it: Space pauses the
 * director's clock, minus and equals halve and double its speed, N ends the current beat, R reloads, Escape
 * skips. Nothing here is loaded without the flag.
 */
export function mountHud(root, act) {
  const box = document.createElement('pre');
  box.id = 'intro-hud';
  box.style.cssText = 'position:absolute;left:10px;top:10px;z-index:6;margin:0;padding:8px 10px;' +
    'font:11px/1.5 ui-monospace,Consolas,monospace;color:#0f0;background:rgba(0,0,0,.72);pointer-events:none;' +
    'white-space:pre';
  root.appendChild(box);
  let frames = 0, fpsT = performance.now(), fps = 0;
  const keys = { ' ': act.pause, '-': () => act.speed(0.5), '=': () => act.speed(2), '+': () => act.speed(2),
                 n: act.next, N: act.next, r: act.restart, R: act.restart };
  return {
    key(k) { if (keys[k]) keys[k](); },
    update(s) {
      frames++;
      const now = performance.now();
      if (now - fpsT >= 500) { fps = Math.round(frames * 1000 / (now - fpsT)); frames = 0; fpsT = now; }
      box.textContent = [
        'beat  ' + s.beat + '  (' + (s.idx + 1) + '/' + s.n + ')   t ' + s.t.toFixed(2) + 's',
        'clock ' + (s.paused ? 'PAUSED' : 'x' + s.speed) + '   director ' + fps + ' fps',
        'ready crt ' + (s.crt ? 'Y' : '-') + '  worm ' + (s.worm ? 'Y' : '-') + '  ring ' + (s.full ? 'Y' : '-'),
        'keys  space pause  -/= speed  n next  r reload  esc skip',
      ].join(String.fromCharCode(10));
    },
    stop() { box.remove(); },
  };
}
