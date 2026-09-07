/* Small shared helpers: formatting plus the tutor card used on two pages. */
window.UI = (function () {
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // "2026-09-14" -> Date, built locally so it doesn't shift a day in UTC.
  function parseDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function formatTime(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const suffix = h >= 12 ? 'pm' : 'am';
    const hour = h % 12 === 0 ? 12 : h % 12;
    return m ? `${hour}:${String(m).padStart(2, '0')}${suffix}` : `${hour}${suffix}`;
  }

  function formatDate(iso) {
    return parseDate(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function formatDateLong(iso) {
    return parseDate(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }

  // Turns the stored weekly pattern into the plain-English line on a tutor card.
  function availabilitySummary(tutor) {
    return Object.keys(tutor.availability)
      .sort()
      .map((day) => {
        const times = tutor.availability[day];
        return `${DAY_NAMES[Number(day)].slice(0, 3)} ${formatTime(times[0])}-${formatTime(
          String(Number(times[times.length - 1].slice(0, 2)) + 1).padStart(2, '0') + ':00'
        )}`;
      })
      .join(' &middot; ');
  }

  function tutorCard(tutor) {
    const next = tutor.nextOpen
      ? `<p class="next-open">Next open: ${formatDate(tutor.nextOpen.date)} at ${formatTime(tutor.nextOpen.time)}</p>`
      : '<p class="no-open">Fully booked for the next three weeks - email us to join the waitlist.</p>';

    return `
      <article class="tutor-card">
        <img src="${esc(tutor.photo)}" alt="${esc(tutor.name)}" width="96" height="96" loading="lazy">
        <div>
          <h3>${esc(tutor.name)}</h3>
          <p class="tutor-role">${esc(tutor.title)}</p>
          <div class="tags">${tutor.subjects.map((s) => `<span class="tag">${esc(s)}</span>`).join('')}</div>
          <p class="tutor-bio">${esc(tutor.bio)}</p>
          <div class="tutor-meta">
            <span><strong>${esc(tutor.gradeLabel)}</strong></span>
            <span><strong>$${tutor.rate}</strong>/hour</span>
            <span>${tutor.openCount} open ${tutor.openCount === 1 ? 'time' : 'times'}</span>
          </div>
          <p class="tutor-meta" style="margin-bottom:12px">${availabilitySummary(tutor)}</p>
          ${next}
          <p style="margin:12px 0 0">
            <a class="btn ${tutor.nextOpen ? 'btn-primary' : 'btn-ghost'}"
               href="/book.html?tutor=${encodeURIComponent(tutor.id)}"
               data-book-tutor="${esc(tutor.id)}">
              ${tutor.nextOpen ? 'Book with ' + esc(tutor.name.split(' ')[0]) : 'View schedule'}
            </a>
          </p>
        </div>
      </article>`;
  }

  return { esc, parseDate, formatTime, formatDate, formatDateLong, availabilitySummary, tutorCard, DAY_NAMES };
})();
