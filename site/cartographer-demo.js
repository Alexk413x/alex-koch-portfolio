// Drives the Cartographer demo: the recorded run plays in the phone frame and the action list beside it
// follows the video clock, so a row lights while the driver is on that action and checks off when it completes.
// The list is derived from currentTime on every frame rather than from timers, which keeps it in step across
// seeks, tab switches and the replay.

// Times are seconds from the start of the recording, straight from the driver's timestamps
// file, so the row and the pixels come from the same clock.
const STEPS = [
  { s: 0.146,  e: 2.899,  verb: 'tap',     target: 'RPN Dominator Calculator' },
  { s: 2.904,  e: 3.128,  verb: 'tap',     target: 'Clear all' },
  { s: 3.134,  e: 4.504,  verb: 'tap',     target: 'Toggle Menu' },
  { s: 4.508,  e: 5.622,  verb: 'tap',     target: 'Settings' },
  { s: 5.635,  e: 7.032,  verb: 'tap',     target: 'Light Dark', count: 2 },
  { s: 7.046,  e: 8.599,  verb: 'tap',     target: 'Back' },
  { s: 8.700,  e: 12.270, verb: 'tap',     target: '1234567890 Enter 400 Enter 13 Add', count: 18 },
  { s: 12.283, e: 15.503, verb: 'drag',    target: '413 above 1234567890' },
  { s: 15.522, e: 16.745, verb: 'tap',     target: 'Undo Undo Undo', count: 3 },
];

const HOLD_S = 5;

const video = document.getElementById('flow');
const list = document.getElementById('run');
const status = document.getElementById('run-status');
const playBtn = document.getElementById('run-play');

// Formats seconds as mm:ss.d, the shape the driver's log uses.
function clock(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return String(m).padStart(2, '0') + ':' + s.toFixed(1).padStart(4, '0');
}

const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>';

const rows = STEPS.map((st) => {
  const li = document.createElement('li');
  li.className = 'step is-pending';
  li.tabIndex = 0;
  li.setAttribute('role', 'button');
  li.setAttribute('aria-label', 'Jump to ' + st.verb + ' ' + st.target);
  li.style.setProperty('--p', '0');
  li.addEventListener('click', () => seekTo(st.s));
  li.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); seekTo(st.s); } });
  li.innerHTML =
    '<i class="step-mark">' + CHECK + '</i>' +
    '<div class="step-body">' +
      '<span class="step-verb">' + st.verb + (st.count ? ' <b>×' + st.count + '</b>' : '') + '</span>' +
      '<span class="step-target"></span>' +
    '</div>' +
    '<span class="step-time"></span>' +
    '<i class="step-bar" aria-hidden="true"></i>';
  li.querySelector('.step-target').textContent = st.target;
  li.querySelector('.step-time').textContent = clock(st.s);
  list.appendChild(li);
  return { li, st, state: 'pending', time: li.querySelector('.step-time') };
});

const head = document.getElementById('run-head');
// Every tap counts, so a run of eighteen is eighteen actions, not one row.
head.querySelector('b').textContent = STEPS.reduce((n, st) => n + (st.count || 1), 0) + ' ACTIONS';
head.querySelector('span').textContent = Math.ceil(STEPS[STEPS.length - 1].e) + ' SEC';

let holdUntil = 0;
let holdTimer = 0;

// Jumps the run to an action's start and plays from there, cancelling a pending replay if the run had ended.
function seekTo(t) {
  clearTimeout(holdTimer);
  holdUntil = 0;
  video.currentTime = t;
  video.play().catch(() => {});
}

// Applies a state to a row only when it changes, so the check's draw-in transition fires once per completion.
function setState(row, state) {
  if (row.state === state) return;
  row.li.classList.remove('is-' + row.state);
  row.li.classList.add('is-' + state);
  row.state = state;
  if (state === 'done') row.time.textContent = (row.st.e - row.st.s).toFixed(2) + 's';
  if (state === 'pending') row.time.textContent = clock(row.st.s);
}

function render() {
  const t = video.currentTime;
  let done = 0;
  for (const row of rows) {
    const { s, e } = row.st;
    if (t >= e) { setState(row, 'done'); done++; row.li.style.setProperty('--p', '1'); }
    else if (t >= s) {
      setState(row, 'running');
      row.li.style.setProperty('--p', ((t - s) / (e - s)).toFixed(3));
      row.time.textContent = (t - s).toFixed(1) + 's';
    }
    else { setState(row, 'pending'); row.li.style.setProperty('--p', '0'); }
  }
  // Read from the element each frame rather than from play/pause events: the end of the run fires pause
  // before ended, which would flash the button over the last frame.
  playBtn.hidden = !video.paused || video.ended || holdUntil > 0;
  if (holdUntil) {
    const left = Math.max(0, Math.ceil((holdUntil - performance.now()) / 1000));
    status.textContent = 'RUN COMPLETE · ' + done + ' / ' + rows.length + ' · REPLAY IN ' + left;
  } else {
    status.textContent = done + ' / ' + rows.length + ' · ' + clock(t) + ' / ' + clock(video.duration || 16.8);
  }
  requestAnimationFrame(render);
}

// The loop is by hand rather than the loop attribute, because the run holds on its last frame for a beat
// before it starts over: a completed list needs a moment to be read as complete.
video.addEventListener('ended', () => {
  holdUntil = performance.now() + HOLD_S * 1000;
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => {
    holdUntil = 0;
    video.currentTime = 0;
    video.play().catch(() => {});
  }, HOLD_S * 1000);
});

// Autoplay is muted so it is allowed almost everywhere; where it is not, the button is the way in.
function start() { video.play().catch(() => {}); }
playBtn.addEventListener('click', start);
video.addEventListener('click', () => { if (video.paused) start(); else video.pause(); });

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { video.pause(); clearTimeout(holdTimer); holdUntil = 0; }
  else if (!video.ended) start();
  else video.dispatchEvent(new Event('ended'));
});

start();
requestAnimationFrame(render);
