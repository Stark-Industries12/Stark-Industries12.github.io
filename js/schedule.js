/*
 * Scheduling rules shared by the Node server and the static browser demo.
 *
 * Availability, validation and the notification wording all live here so the
 * two ways of running the site can never drift apart.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Schedule = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // How far ahead parents can book. The weekly pattern in tutors.json is
  // projected onto real dates across this window.
  const BOOKING_WINDOW_DAYS = 21;

  const GRADES = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function isoDate(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function slotsForTutor(tutor, bookings) {
    const taken = new Set(
      bookings
        .filter((b) => b.tutorId === tutor.id && b.status === 'confirmed')
        .map((b) => `${b.date} ${b.time}`)
    );

    const slots = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let offset = 1; offset <= BOOKING_WINDOW_DAYS; offset++) {
      const day = new Date(today);
      day.setDate(today.getDate() + offset);
      const times = tutor.availability[String(day.getDay())] || [];
      for (const time of times) {
        const date = isoDate(day);
        slots.push({ date, time, booked: taken.has(`${date} ${time}`) });
      }
    }
    return slots;
  }

  function tutorWithSlots(tutor, bookings) {
    const slots = slotsForTutor(tutor, bookings);
    return Object.assign({}, tutor, {
      photo: `/img/avatar-${tutor.id}.svg`,
      slots,
      openCount: slots.filter((s) => !s.booked).length,
      nextOpen: slots.find((s) => !s.booked) || null
    });
  }

  // Runs on the server for every real booking, and in the browser for the
  // static demo. Same messages either way.
  function validateBooking(input, tutor, bookings) {
    const errors = [];
    const str = (v) => (typeof v === 'string' ? v.trim() : '');

    const clean = {
      parentName: str(input.parentName),
      parentEmail: str(input.parentEmail),
      studentFirstName: str(input.studentFirstName),
      studentGrade: str(input.studentGrade),
      subject: str(input.subject),
      date: str(input.date),
      time: str(input.time)
    };

    if (!tutor) errors.push('That tutor is no longer listed.');
    if (clean.parentName.length < 2) errors.push('Please enter the parent or guardian name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.parentEmail)) errors.push('Please enter a valid email address.');
    if (clean.studentFirstName.length < 1) errors.push("Please enter the student's first name.");
    if (!GRADES.includes(clean.studentGrade)) errors.push('Please choose the student grade.');
    if (tutor && !tutor.subjects.includes(clean.subject)) errors.push('Please choose a subject this tutor covers.');

    if (tutor) {
      const slot = slotsForTutor(tutor, bookings).find((s) => s.date === clean.date && s.time === clean.time);
      if (!slot) errors.push('That time is not on the schedule anymore. Please pick another.');
      else if (slot.booked) errors.push('Sorry - someone just took that time. Please pick another.');
    }

    return { errors, clean };
  }

  function makeId() {
    return 'ABC-' + Math.random().toString(36).slice(2, 7).toUpperCase();
  }

  function formatWhen(date, time) {
    return new Date(`${date}T${time}:00`).toLocaleString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  }

  // The three messages that go out on every booking: Dana by email and text,
  // and the parent by email.
  function buildNotifications(booking, tutor) {
    const when = formatWhen(booking.date, booking.time);
    return [
      {
        channel: 'email',
        to: 'dana@abctutoring.example',
        subject: `New booking: ${tutor.name} - ${when}`,
        body:
          `${booking.parentName} booked a 1-hour ${booking.subject} session with ${tutor.name}.\n` +
          `Student: ${booking.studentFirstName} (grade ${booking.studentGrade})\n` +
          `When: ${when}\n` +
          `Parent contact: ${booking.parentEmail}\n` +
          `Confirmation: ${booking.id}`
      },
      {
        channel: 'sms',
        to: '+1-555-0142',
        body: `ABC Tutoring: ${booking.parentName} booked ${tutor.name} for ${booking.subject}, ${when}. Ref ${booking.id}`
      },
      {
        channel: 'email',
        to: booking.parentEmail,
        subject: `Your session with ${tutor.name} is confirmed`,
        body:
          `Hi ${booking.parentName}, ${booking.studentFirstName}'s 1-hour ${booking.subject} session ` +
          `with ${tutor.name} is confirmed for ${when}. No payment is due online - ` +
          `${tutor.name} charges $${tutor.rate}/hour, settled directly. Reply to reschedule.`
      }
    ];
  }

  return {
    BOOKING_WINDOW_DAYS, GRADES, isoDate, slotsForTutor, tutorWithSlots,
    validateBooking, makeId, buildNotifications, formatWhen
  };
});
