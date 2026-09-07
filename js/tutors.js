/* Tutor listings: filter by subject/grade, and report what parents search for. */
(function () {
  const listEl = document.getElementById('list');
  const countEl = document.getElementById('count');
  const subjectEl = document.getElementById('subject');
  const gradeEl = document.getElementById('grade');
  const clearEl = document.getElementById('clear');

  let allTutors = [];

  for (let g = 1; g <= 12; g++) {
    gradeEl.insertAdjacentHTML('beforeend', `<option value="${g}">Grade ${g}</option>`);
  }

  function render(tutors) {
    if (!tutors.length) {
      // A search with no results is a demand signal Dana can act on - it may
      // mean she needs another tutor for that subject or grade.
      listEl.innerHTML = `<p class="loading">No tutors match that yet. Email hello@abctutoring.example and we'll look for one.</p>`;
      Analytics.track('tutor_search_empty', { subject: subjectEl.value || null, grade: gradeEl.value || null });
    } else {
      listEl.innerHTML = tutors.map(UI.tutorCard).join('');
    }
    countEl.textContent = `${tutors.length} of ${allTutors.length} tutors`;
  }

  function applyFilters(isInitial) {
    const subject = subjectEl.value;
    const grade = gradeEl.value;

    const filtered = allTutors.filter((t) => {
      if (subject && !t.subjects.includes(subject)) return false;
      if (grade) {
        const g = grade === 'K' ? 0 : Number(grade);
        if (g < t.gradeMin || g > t.gradeMax) return false;
      }
      return true;
    });

    render(filtered);
    if (!isInitial) {
      Analytics.track('tutor_list_filtered', {
        subject: subject || null,
        grade: grade || null,
        results: filtered.length
      });
    }
  }

  API.tutors()
    .then(({ tutors }) => {
      allTutors = tutors;

      const subjects = [...new Set(tutors.flatMap((t) => t.subjects))].sort();
      subjects.forEach((s) => subjectEl.insertAdjacentHTML('beforeend', `<option value="${UI.esc(s)}">${UI.esc(s)}</option>`));

      // Let the home page (or an email) deep-link into a filtered view.
      const params = new URLSearchParams(location.search);
      if (params.get('subject')) subjectEl.value = params.get('subject');
      if (params.get('grade')) gradeEl.value = params.get('grade');

      applyFilters(true);
      Analytics.track('tutor_list_viewed', {
        tutors_listed: tutors.length,
        tutors_with_availability: tutors.filter((t) => t.openCount > 0).length
      });
    })
    .catch(() => {
      listEl.innerHTML = '<p class="loading">We could not load the tutor list. Please refresh.</p>';
    });

  subjectEl.addEventListener('change', () => applyFilters(false));
  gradeEl.addEventListener('change', () => applyFilters(false));
  clearEl.addEventListener('click', () => {
    subjectEl.value = '';
    gradeEl.value = '';
    applyFilters(false);
  });

  listEl.addEventListener('click', (event) => {
    const link = event.target.closest('[data-book-tutor]');
    if (link) {
      Analytics.track('book_clicked', {
        tutor_id: link.dataset.bookTutor,
        from: 'tutor_list',
        subject_filter: subjectEl.value || null,
        grade_filter: gradeEl.value || null
      });
    }
  });
})();
