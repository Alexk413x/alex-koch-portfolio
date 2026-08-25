/* crt-surge.js — a mains fault, as how hard each channel is spent.
 *
 * THE TIMELINE IS NOT REIMPLEMENTED. crt-flicker owns it — seven phases over 4.6s, deterministic — because it
 * already owns the two things a supply failure moves together: the bulbs' output and their colour temperature.
 * This fires it and decides what each channel does with the sample.
 *
 * The fixture and the tube are handed the SAME sample. A fault is upstream of both, so the room dimming while
 * the screen holds steady would be the giveaway that they are two effects rather than one event.
 *
 * Sampled at a SCALED time, so RATE stretches the whole event without the flicker module needing to know.
 */

/* A factory over one flicker instance, because it holds the run's clock and its grain seed. `at` is pure given
 * the seed, so a fault plays the same way from any sampled time — which is what lets it be measured. */
export function createSurge(flicker) {
  let t0 = null, seed = 0;

  /* Deterministic given the seed. New press, new seed, new grain. */
  const noise = (n) => {
    const v = Math.sin(n * 12.9898 + seed * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };

  return {
    get t0() { return t0; },

    /* THE SHAPE IS FIXED AND THE GRAIN IS NOT, which is the opposite of what crt-flicker does and deliberately so.
       The ORDER of the levels is authored and a timeline that reshuffles itself cannot be tuned. Where the
       guttering chops, and how many failed restrikes happen in the dark, carry no authored meaning — and being
       identical every press is exactly what stops the fourth press being alarming. */
    trigger(now) {
      t0 = (now == null ? performance.now() : now);
      seed = Math.random() * 4096;
      flicker.triggerSurge(t0);
    },

    // Null when nothing is running. `bite` is how far from normal the fault has pushed the supply.
    at(now, s) {
      if (t0 == null) return null;
      const dt = now - t0;
      const sg = flicker.surgeAt(t0 + dt * Math.max(0.05, s.surgeRate));
      if (!sg) { if (dt > 0) t0 = null; return null; }

      // The gains scale the DEPARTURE from normal, so 0 removes the channel and 1 is the reference's own fault.
      const g = (v, gain) => 1 + (v - 1) * gain;
      let screen = Math.max(0, g(sg.screen, s.surgeScreen));
      let lamp   = Math.max(0, g(sg.lamp,   s.surgeLamp));
      const bite = Math.min(1, Math.abs(1 - sg.screen));

      /* THE CHOP — hard-edged steps, not a dip. A smooth sin() dip is the right model for a phosphor wandering on
         a healthy supply and the wrong one for an arc losing its strike: that is a switch and it reads as one.
         The lamps take a shallower share: a fluorescent has a metre of ionised gas with thermal inertia in it,
         and a phosphor dot has none. */
      let chop = 1;
      if (s.surgeChaos > 0.001 && s.surgeStr > 0.001) {
        const step  = Math.floor(dt / (1000 / Math.max(0.5, s.surgeHz)));
        const h     = noise(step);
        const pDrop = (0.05 + 0.55 * bite) * s.surgeChaos;
        if (h < pDrop) chop = 1 - s.surgeStr * (0.35 + 0.65 * (1 - h / Math.max(1e-6, pDrop)));
      }
      screen *= chop;
      lamp   *= 1 - (1 - chop) * 0.55;

      /* THE FAILED RESTRIKES, and this is the suspense. The dark phase is 900ms of authored nothing, which works
         once. A tripped breaker does not sit politely dark — the arc attempts to restrike, gets a fraction of a
         second of light and loses it. Only where the timeline is AT ZERO, so this can never brighten a phase that
         is already lit. 0.20 rather than 0.13 is measured: at the lower rate two presses in four produced no
         attempt at all, and a suspense device that is absent half the time is not one. */
      if (s.surgeChaos > 0.001 && sg.screen < 0.03) {
        const sh = noise(Math.floor(dt / 80) + 977);
        if (sh < 0.20 * s.surgeChaos) {
          const strike = 0.10 + sh * 2.6;
          screen = Math.max(screen, strike);
          lamp   = Math.max(lamp,   strike * 0.75);
        }
      }

      return {
        screen, lamp, bite,
        warm: sg.warm,
        /* HEALTH, NOT JUST BRIGHTNESS. A fluorescent does not starve uniformly: the arc collapses toward the
           cathodes, so the ends stay lit and orange while the middle dies. Floored at 0.22 because below that
           the ends go too, and the ends are the point. */
        health: 1 - (1 - Math.max(0.22, Math.min(1, sg.lamp))) * s.surgeHealth,
      };
    },
  };
}
