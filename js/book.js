/*
 * Booking flow: tutor -> calendar day -> open hour -> details.
 *
 * Availability comes from the server on every load, so a slot someone else
 * just took shows as unavailable. The server re-checks on submit as well, so
 * two parents clicking the same hour at once cannot double-book.
 */
(function () {
  const tutorEl = document.getElementById('tutor');
  const calArea = document.getElementById('calendar-area');
  const calEl = document.getElementById('calendar');
  const calTitle = document.getElementById('cal-title');
  const prevBtn = document.getElementById('prev');
  const nextBtn = document.getElementById('next');
  const timesTitle = document.getElementById('times-title');
  const timeListEl = document.getElementById('time-list');
  const timesHint = document.getElementById('times-hint');
  const formPane = document.getElementById('form-pane');
  const form = document.getElementById('booking-form');
  const errorsEl = document.getElementById('errors');
  const subjectEl = document.getElementById('subject');
  const gradeEl = document.getElementById('studentGrade');
  const summaryEl = document.getElementById('summary-body');
  const submitBtn = document.getElementById('submit');

  const state = { tutors: [], tutor: null, month: null, date: null, time: null, formStarted: false, confirmed: false };

  for (let g = 1; g <= 12; g++) {
    gradeEl.insertAdjacentHTML('beforeend', `<option value="${g}">Grade ${g}</option>`);
  }

  /* ------------------------------------------------------------- loading */

  function loadTutors(preselectId) {
    return API.tutors()
      .then(({ tutors }) => {
        state.tutors = tutors;
        tutorEl.innerHTML = '<option value="">Choose a tutor</option>' +
          tutors.map((t) => `<option value="${UI.esc(t.id)}">${UI.esc(t.name)} - ${UI.esc(t.subjects.join(', '))} ($${t.rate}/hr)</option>`).join('');
        if (preselectId && tutors.some((t) => t.id === preselectId)) {
          tutorEl.value = preselectId;
          selectTutor(preselectId, 'deep_link');
        }
      });
  }

  function selectTutor(id, source) {
    state.tutor = state.tutors.find((t) => t.id === id) || null;
    state.date = null;
    state.time = null;

    if (!state.tutor) {
      calArea.hidden = true;
      formPane.hidden = true;
      renderSummary();
      setStep(1);
      return;
    }

    subjectEl.innerHTML = '<option value="">Choose a subject</option>' +
      state.tutor.subjects.map((s) => `<option value="${UI.esc(s)}">${UI.esc(s)}</option>`).join('');

    // Start on the first month that actually has an open hour.
    const firstOpen = state.tutor.nextOpen || state.tutor.slots[0];
    const start = firstOpen ? UI.parseDate(firstOpen.date) : new Date();
    state.month = new Date(start.getFullYear(), start.getMonth(), 1);

    calArea.hidden = false;
    formPane.hidden = true;
    renderCalendar();
    renderTimes();
    renderSummary();
    setStep(2);

    Analytics.track('tutor_selected', {
      tutor_id: state.tutor.id,
      tutor_name: state.tutor.name,
      hourly_rate: state.tutor.rate,
      open_slots: state.tutor.openCount,
      source: source || 'dropdown'
    });

    if (state.tutor.openCount === 0) {
      Analytics.track('tutor_no_availability', { tutor_id: state.tutor.id, tutor_name: state.tutor.name });
    }
  }

  /* ------------------------------------------------------------ calendar */

  function slotsByDate() {
    const map = {};
    state.tutor.slots.forEach((slot) => {
      (map[slot.date] = map[slot.date] || []).push(slot);
    });
    return map;
  }

  function monthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function renderCalendar() {
    const byDate = slotsByDate();
    const dates = Object.keys(byDate).sort();
    const firstMonth = dates.length ? monthKey(UI.parseDate(dates[0])) : monthKey(state.month);
    const lastMonth = dates.length ? monthKey(UI.parseDate(dates[dates.length - 1])) : monthKey(state.month);

    const year = state.month.getFullYear();
    const month = state.month.getMonth();
    calTitle.textContent = state.month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    prevBtn.disabled = monthKey(state.month) <= firstMonth;
    nextBtn.disabled = monthKey(state.month) >= lastMonth;

    const cells = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      .map((d) => `<div class="cal-dow">${d}</div>`);

    const firstDay = new Date(year, month, 1).getDay();
    for (let i = 0; i < firstDay; i++) cells.push('<div class="cal-day empty"></div>');

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const slots = byDate[iso] || [];
      const open = slots.filter((s) => !s.booked).length;

      const classes = ['cal-day'];
      if (!slots.length) classes.push('none');
      else if (open > 0) classes.push('has-open');
      else classes.push('none');
      if (state.date === iso) classes.push('selected');

      const label = slots.length && open > 0 ? `${open} open` : slots.length ? 'full' : '';
      cells.push(
        `<button type="button" class="${classes.join(' ')}" data-date="${iso}" ${open ? '' : 'disabled'}
                 aria-label="${UI.formatDateLong(iso)}${open ? `, ${open} open hours` : ', no open hours'}">
          <span class="num">${day}</span><span class="open">${label}</span>
        </button>`
      );
    }

    calEl.innerHTML = cells.join('');
  }

  function renderTimes() {
    if (!state.date) {
      timesTitle.textContent = 'Pick a day to see open hours';
      timeListEl.innerHTML = '';
      timesHint.textContent = state.tutor.openCount
        ? 'Green days have open hours in the next three weeks.'
        : `${state.tutor.name} is fully booked for the next three weeks. Email us to join the waitlist.`;
      return;
    }

    const slots = state.tutor.slots.filter((s) => s.date === state.date);
    timesTitle.textContent = UI.formatDateLong(state.date);
    timeListEl.innerHTML = slots
      .map((s) => {
        const classes = ['time-btn'];
        if (s.booked) classes.push('booked');
        if (state.time === s.time) classes.push('selected');
        return `<button type="button" class="${classes.join(' ')}" data-time="${s.time}" ${s.booked ? 'disabled' : ''}>
          ${UI.formatTime(s.time)}${s.booked ? ' &middot; booked' : ''}
        </button>`;
      })
      .join('');
    timesHint.textContent = 'Each session runs one hour.';
  }

  function renderSummary() {
    if (!state.tutor) {
      summaryEl.innerHTML = '<p class="hint">Choose a tutor to get started.</p>';
      return;
    }
    const rows = [
      ['Tutor', state.tutor.name],
      ['Rate', `$${state.tutor.rate}/hour`],
      ['Date', state.date ? UI.formatDateLong(state.date) : 'Not chosen yet'],
      ['Time', state.time ? `${UI.formatTime(state.time)} (1 hour)` : 'Not chosen yet'],
      ['Subject', subjectEl.value || 'Not chosen yet']
    ];
    summaryEl.innerHTML = `
      <img src="${UI.esc(state.tutor.photo)}" alt="" width="64" height="64" style="border-radius:50%;margin-bottom:12px">
      ${rows.map(([k, v]) => `<div class="summary-row"><span>${k}</span><span>${UI.esc(v)}</span></div>`).join('')}`;
  }

  function setStep(step) {
    document.querySelectorAll('#steps .step').forEach((el) => {
      const n = Number(el.dataset.step);
      el.classList.toggle('current', n === step);
      el.classList.toggle('done', n < step);
    });
  }

  /* -------------------------------------------------------------- events */

  tutorEl.addEventListener('change', () => selectTutor(tutorEl.value));

  prevBtn.addEventListener('click', () => {
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1);
    renderCalendar();
  });
  nextBtn.addEventListener('click', () => {
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1);
    renderCalendar();
  });

  calEl.addEventListener('click', (event) => {
    const cell = event.target.closest('.cal-day[data-date]');
    if (!cell || cell.disabled) return;
    state.date = cell.dataset.date;
    state.time = null;
    renderCalendar();
    renderTimes();
    renderSummary();
    Analytics.track('date_selected', { tutor_id: state.tutor.id, session_date: state.date });
  });

  timeListEl.addEventListener('click', (event) => {
    const btn = event.target.closest('.time-btn[data-time]');
    if (!btn || btn.disabled) return;
    state.time = btn.dataset.time;
    renderTimes();
    renderSummary();
    formPane.hidden = false;
    setStep(3);
    formPane.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    Analytics.track('time_selected', {
      tutor_id: state.tutor.id,
      session_date: state.date,
      session_time: state.time,
      days_ahead: Math.round((UI.parseDate(state.date) - new Date().setHours(0, 0, 0, 0)) / 86400000)
    });
  });

  subjectEl.addEventListener('change', renderSummary);

  // Fires once, the first time a parent types anything - the denominator for
  // the "started the form but didn't finish" drop-off.
  form.addEventListener('input', () => {
    if (state.formStarted) return;
    state.formStarted = true;
    Analytics.track('booking_form_started', { tutor_id: state.tutor.id, session_date: state.date, session_time: state.time });
  });

  function showErrors(list) {
    errorsEl.hidden = false;
    errorsEl.innerHTML = `<strong>Please fix the following:</strong><ul>${list.map((e) => `<li>${UI.esc(e)}</li>`).join('')}</ul>`;
    errorsEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    errorsEl.hidden = true;

    const data = Object.fromEntries(new FormData(form).entries());
    const payload = Object.assign({}, data, {
      tutorId: state.tutor.id,
      date: state.date,
      time: state.time,
      distinctId: Analytics.distinctId(),
      source: new URLSearchParams(location.search).get('utm_source') || 'website'
    });

    Analytics.track('booking_submitted', {
      tutor_id: state.tutor.id,
      subject: payload.subject,
      student_grade: payload.studentGrade,
      session_date: state.date,
      session_time: state.time
    });

    submitBtn.disabled = true;
    submitBtn.textContent = 'Confirming...';

    API.createBooking(payload)
      .then(({ ok, body }) => {
        if (!ok) {
          Analytics.track('booking_failed', {
            tutor_id: state.tutor.id,
            reasons: body.errors,
            slot_taken: (body.errors || []).some((e) => e.includes('just took'))
          });
          showErrors(body.errors || ['Something went wrong. Please try again.']);
          submitBtn.disabled = false;
          submitBtn.textContent = 'Confirm booking';
          // The schedule moved under us; reload it so the taken hour disappears.
          loadTutors().then(() => selectTutor(state.tutor.id, 'refresh_after_conflict'));
          return;
        }

        state.confirmed = true;
        Analytics.identify(body.booking.parentEmail, {
          email: body.booking.parentEmail,
          name: body.booking.parentName,
          student_grade: body.booking.studentGrade
        });
        Analytics.track('booking_confirmed', {
          booking_id: body.booking.id,
          tutor_id: body.booking.tutorId,
          tutor_name: body.booking.tutorName,
          subject: body.booking.subject,
          student_grade: body.booking.studentGrade,
          session_date: body.booking.date,
          session_time: body.booking.time,
          booking_value: body.booking.rate
        });

        sessionStorage.setItem('abc-last-booking', JSON.stringify(body));
        location.href = '/confirmed.html';
      })
      .catch(() => {
        showErrors(['We could not reach the booking system. Please try again in a moment.']);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Confirm booking';
      });
  });

  // Where parents give up: the last step they reached before leaving.
  window.addEventListener('pagehide', () => {
    if (state.confirmed || !state.tutor) return;
    Analytics.track('booking_abandoned', {
      tutor_id: state.tutor.id,
      reached_step: state.formStarted ? 'form' : state.time ? 'time_selected' : state.date ? 'date_selected' : 'tutor_selected'
    });
  });

  /* ---------------------------------------------------------------- init */

  const preselect = new URLSearchParams(location.search).get('tutor');
  loadTutors(preselect).catch(() => {
    tutorEl.innerHTML = '<option value="">Could not load tutors - please refresh</option>';
  });
  Analytics.track('booking_page_viewed', { preselected_tutor: preselect || null });
})();
