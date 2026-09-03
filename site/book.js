/* book.js — the booking dialog: Cal.com's inline booker inside the site's own panel.
 *
 * The dialog is a `.book-dialog` in index.html naming its provider, and the PROVIDERS entry says how to load
 * it, mount it and know when it has drawn; consent, focus, the ring and the scroll lock are the dialog's own.
 * Cal.com replaced Calendly on 2026-09-03: Calendly's embed takes three colors and keeps its form fields
 * white, where Cal.com's takes the theme as CSS variables, so the booker is painted in the site's tokens.
 *
 * The provider's script is NOT in the page until a visitor asks for it: a third-party script has no business
 * on a page whose visitor has not asked for the calendar. No consent gate: Cal.com's booker keeps its session
 * on its own domain inside the frame, and this site sets no cookies of its own.
 *
 * Inline, not the provider's popup widget: that draws its own overlay, close control and backdrop, and every
 * one of them would need overriding to sit on this page. The inline widget is just an iframe in a parent we
 * own, so the overlay, panel and close control are the share dialog's, in the same palette.
 */
(function () {
  'use strict';

  // One fetch per script, however many times a dialog opens; the promise is the lock.
  const loads = {};
  function loadScript(src, css) {
    if (loads[src]) return loads[src];
    loads[src] = new Promise((resolve, reject) => {
      if (css) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = css;
        document.head.appendChild(link);
      }
      const js = document.createElement('script');
      js.src = src;
      js.async = true;
      js.onload = resolve;
      js.onerror = () => { loads[src] = null; reject(new Error(src + ' failed to load')); };
      document.head.appendChild(js);
    });
    return loads[src];
  }

  const PROVIDERS = {
    /* Cal.com. Its embed takes the theme as CSS variables, so the booker is painted in the site's own tokens
       rather than the nearest three colors: the panel, the accent and its hover, the text tiers and the
       hairline are all transcribed from site.css. The booker resizes its own iframe to its content. */
    cal: {
      calLink: 'alexk413x/connect',
      load() {
        if (window.Cal && window.Cal.loaded) return Promise.resolve();
        // Cal.com's own loader, unrolled: embed.js does not define window.Cal, it drains the queue this shim
        // keeps, so the shim has to exist before the script lands. Its script append is replaced by
        // loadScript() for the promise.
        const C = window;
        const p = (a, ar) => { a.q.push(ar); };
        C.Cal = C.Cal || function () {
          const cal = C.Cal, ar = arguments;
          if (!cal.loaded) { cal.ns = {}; cal.q = cal.q || []; cal.loaded = true; }
          if (ar[0] === 'init') {
            const api = function () { p(api, arguments); };
            const ns = ar[1];
            api.q = api.q || [];
            if (typeof ns === 'string') { cal.ns[ns] = cal.ns[ns] || api; p(cal.ns[ns], ar); p(cal, ['initNamespace', ns]); }
            else p(cal, ar);
            return;
          }
          p(cal, ar);
        };
        // Queued before the script, as the snippet does: embed.js takes over the queue when it lands, and a
        // queue that is empty then is never read again.
        C.Cal('init', { origin: 'https://app.cal.com' });
        return loadScript('https://app.cal.com/embed/embed.js');
      },
      mount(frame, api) {
        const Cal = window.Cal;
        Cal('ui', {
          theme: 'dark',
          hideEventTypeDetails: false,
          layout: 'month_view',
          cssVarsPerTheme: {
            dark: {
              'cal-bg': '#100b08',
              'cal-bg-subtle': '#1a120c',
              'cal-bg-emphasis': '#2a1a10',
              'cal-bg-muted': '#140e0a',
              'cal-brand': '#dd6a20',
              'cal-brand-emphasis': '#f0894f',
              'cal-brand-text': '#180a03',
              'cal-brand-subtle': '#6e3413',
              'cal-text': '#c3c5cb',
              'cal-text-emphasis': '#ffffff',
              'cal-text-subtle': '#9a9ca3',
              'cal-text-muted': '#7a7c83',
              'cal-border': '#2a1f18',
              'cal-border-subtle': '#1c2128',
              'cal-border-emphasis': '#6e3413',
              'cal-border-booker': 'transparent',
              'cal-border-booker-width': '0px',
              'radius': '12px',
            },
          },
        });
        // The booker grows its iframe to its content and says when it is drawn; the iframe's height then sets
        // the scroller. Not earlier: the iframe stands at a 300px placeholder before the booker is in it.
        Cal('on', { action: 'linkReady', callback: () => setTimeout(() => {
          const iframe = frame.querySelector('iframe');
          if (iframe) api.fit(iframe.getBoundingClientRect().height);
          api.drawn();
        }, 400) });
        Cal('inline', { elementOrSelector: frame, calLink: this.calLink, config: { layout: 'month_view', theme: 'dark' } });
      },
    },
  };

  function dialog(dlg, provider) {
    const panel = dlg.querySelector('.book-panel');
    const scroll = dlg.querySelector('.book-scroll');
    const frame = dlg.querySelector('.book-frame');
    const closeBtn = dlg.querySelector('.book-close');
    const openBtns = document.querySelectorAll('[data-open="' + dlg.id + '"]');

    let lastFocus = null;
    let mounted = false;

    const api = {
      // The first screen sets the scroller's height, so it shows whole with nothing to scroll and the box
      // holds that size when a longer screen arrives.
      fit(h) { if (!scroll.style.height) scroll.style.height = Math.ceil(h) + 'px'; },
      // Removed once faded, as labReady() does: a ring left at opacity 0 is a sheet over the scheduler.
      drawn() {
        dlg.classList.remove('is-loading');
        const ring = frame.querySelector('.kit-load');
        if (!ring || ring.classList.contains('done')) return;
        ring.classList.add('done');
        const drop = () => ring.remove();
        ring.addEventListener('transitionend', drop, { once: true });
        setTimeout(drop, 900);
      },
    };

    // The scheduler is mounted once and kept: an iframe restarts its flow from the top if it is remade, so
    // closing and reopening the dialog keeps a half-picked time rather than losing it.
    function mount() {
      if (mounted) return;
      mounted = true;
      dlg.classList.add('is-loading');
      provider.load().then(() => {
        provider.mount(frame, api);
        // A guard for a scheduler that renders without ever saying so: the ring lifts anyway after a moment.
        setTimeout(api.drawn, 8000);
      }, () => {
        mounted = false;
        dlg.classList.remove('is-loading');
        dlg.classList.add('is-failed');
      });
    }

    function open() {
      lastFocus = document.activeElement;
      dlg.hidden = false;
      document.documentElement.classList.add('dialog-open');
      mount();
      document.addEventListener('keydown', onKey);
      panel.focus();
    }

    function close() {
      dlg.hidden = true;
      document.documentElement.classList.remove('dialog-open');
      document.removeEventListener('keydown', onKey);
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    /* Escape closes. Tab cycles inside the panel: the close mark and the booker's iframe, whose own focus
       order the browser handles once focus is inside it. */
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      const stops = Array.prototype.filter.call(
        panel.querySelectorAll('button, a[href], iframe'),
        (el) => !el.hidden && el.offsetParent !== null);
      if (!stops.length) { e.preventDefault(); return; }
      const first = stops[0], last = stops[stops.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    // The page's scroll rig listens for wheel and touch on the window and glides to a beat after them, which
    // html.dialog-open's overflow lock does not stop, since a glide is a programmatic scroll. Held here so they
    // never reach it; not prevented, so the scroller inside still scrolls natively.
    ['wheel', 'touchstart', 'touchmove'].forEach((ev) =>
      dlg.addEventListener(ev, (e) => e.stopPropagation(), { passive: true }));

    openBtns.forEach((btn) => btn.addEventListener('click', open));
    closeBtn.addEventListener('click', close);
    // The backdrop closes; the panel does not, since the scheduler inside it is what a click there is for.
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  }

  document.querySelectorAll('.book-dialog[data-provider]').forEach((dlg) => {
    const provider = PROVIDERS[dlg.getAttribute('data-provider')];
    if (provider) dialog(dlg, provider);
  });
})();
