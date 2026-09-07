/*
 * Data layer for the pages.
 *
 * Two modes, decided once at load time:
 *   server - the Node prototype is running; bookings are shared by everyone
 *            and notifications are written server-side.
 *   static - the site is on GitHub Pages with no backend; bookings are held
 *            in this browser's localStorage so the demo still works end to
 *            end. Availability is per-visitor in this mode.
 *
 * Both paths run the same rules from js/schedule.js, so what a parent sees is
 * identical either way.
 */
window.API = (function () {
  const STORAGE_KEY = 'abc-bookings';
  let mode = null;
  let tutorSeed = null;

  function localBookings() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch (err) {
      return [];
    }
  }

  function saveLocalBookings(bookings) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bookings));
    } catch (err) {
      // Private browsing with storage blocked: the booking still confirms for
      // this page view, it just will not persist.
      console.warn('[api] could not persist booking locally:', err.message);
    }
  }

  function loadSeed() {
    if (tutorSeed) return Promise.resolve(tutorSeed);
    return fetch('data/tutors.json')
      .then((r) => r.json())
      .then((tutors) => {
        tutorSeed = tutors;
        return tutors;
      });
  }

  // One probe on load decides the mode for the whole page.
  const ready = fetch('/api/config')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('no api'))))
    .then((cfg) => {
      mode = 'server';
      return { mode, posthogKey: cfg.posthogKey, posthogHost: cfg.posthogHost };
    })
    .catch(() => {
      mode = 'static';
      const cfg = window.ABC_CONFIG || {};
      return { mode, posthogKey: cfg.posthogKey || '', posthogHost: cfg.posthogHost || 'https://us.i.posthog.com' };
    });

  function tutors() {
    return ready.then(() => {
      if (mode === 'server') return fetch('/api/tutors').then((r) => r.json());
      return loadSeed().then((seed) => {
        const bookings = localBookings();
        return { tutors: seed.map((t) => Schedule.tutorWithSlots(t, bookings)) };
      });
    });
  }

  function tutor(id) {
    return ready.then(() => {
      if (mode === 'server') return fetch(`/api/tutors/${encodeURIComponent(id)}`).then((r) => r.json());
      return loadSeed().then((seed) => {
        const found = seed.find((t) => t.id === id);
        if (!found) return { tutor: null };
        return { tutor: Schedule.tutorWithSlots(found, localBookings()) };
      });
    });
  }

  function createBooking(payload) {
    return ready.then(() => {
      if (mode === 'server') {
        return fetch('/api/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then((res) => res.json().then((body) => ({ ok: res.ok, body })));
      }

      return loadSeed().then((seed) => {
        const bookings = localBookings();
        const found = seed.find((t) => t.id === payload.tutorId);
        const { errors, clean } = Schedule.validateBooking(payload, found, bookings);
        if (errors.length) return { ok: false, body: { errors } };

        const booking = Object.assign(
          { id: Schedule.makeId(), tutorId: found.id, tutorName: found.name, rate: found.rate },
          clean,
          { status: 'confirmed', createdAt: new Date().toISOString() }
        );
        bookings.push(booking);
        saveLocalBookings(bookings);

        return { ok: true, body: { booking, notifications: Schedule.buildNotifications(booking, found) } };
      });
    });
  }

  return { ready, tutors, tutor, createBooking, mode: () => mode };
})();
