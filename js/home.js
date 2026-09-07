/* Home page: three featured tutors + CTA tracking. */
(function () {
  const container = document.getElementById('featured');

  API.tutors()
    .then(({ tutors }) => {
      const featured = tutors.slice(0, 2);
      container.innerHTML = featured.map(UI.tutorCard).join('');
      Analytics.track('home_tutors_previewed', {
        tutors_shown: featured.map((t) => t.id),
        total_open_slots: tutors.reduce((sum, t) => sum + t.openCount, 0)
      });
    })
    .catch(() => {
      container.innerHTML = '<p class="loading">We could not load the tutor list. Please refresh.</p>';
    });

  // Which call-to-action actually moves parents toward booking.
  document.addEventListener('click', (event) => {
    const cta = event.target.closest('[data-cta]');
    if (cta) Analytics.track('cta_clicked', { cta: cta.dataset.cta, label: cta.textContent.trim() });

    const bookLink = event.target.closest('[data-book-tutor]');
    if (bookLink) Analytics.track('book_clicked', { tutor_id: bookLink.dataset.bookTutor, from: 'home' });
  });
})();
