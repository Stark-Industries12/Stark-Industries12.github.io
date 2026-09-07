#!/usr/bin/env node
/*
 * Simulated parent traffic against the running site.
 *
 * Each simulated visitor walks the real funnel - home page, tutor list, a
 * filter or two, the booking page - and some of them book for real through
 * POST /api/bookings. Every step is sent to PostHog with its own distinct_id,
 * so the dashboards fill with something that looks like a normal week.
 *
 *   node scripts/simulate-traffic.js --visitors 60
 */

const https = require('https');
const http = require('http');

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
}

const BASE = arg('base', 'http://localhost:3000').replace(/\/$/, '');
const VISITORS = Number(arg('visitors', 40));
const POSTHOG_KEY = process.env.POSTHOG_API_KEY || '';
const POSTHOG_HOST = process.env.POSTHOG_HOST || 'https://us.i.posthog.com';

const FIRST = ['Amanda', 'Jorge', 'Nia', 'Peter', 'Rachel', 'Owen', 'Leila', 'Marcus', 'Grace', 'Hyun', 'Beth', 'Tariq'];
const LAST = ['Alvarez', 'Bennett', 'Chen', 'Dixon', 'Ellis', 'Faraj', 'Gomez', 'Hall', 'Iqbal', 'Jensen', 'Kaur', 'Lowe'];
const KIDS = ['Ava', 'Ben', 'Cora', 'Diego', 'Ella', 'Finn', 'Gia', 'Hugo', 'Ivy', 'Jonah', 'Kai', 'Lena'];
const REFERRERS = ['facebook', 'google', 'word_of_mouth', 'flyer', 'direct'];
const DEVICES = ['mobile', 'desktop', 'tablet'];

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const chance = (p) => Math.random() < p;

/* ---------------------------------------------------------------- plumbing */

function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;

    const req = transport.request(
      {
        method,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: parsed.pathname + parsed.search,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {}
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let parsedBody = null;
          try { parsedBody = data ? JSON.parse(data) : null; } catch (err) { parsedBody = data; }
          resolve({ status: res.statusCode, body: parsedBody });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let sent = 0;
let dropped = 0;

function capture(distinctId, event, properties, timestamp) {
  if (!POSTHOG_KEY) { dropped++; return Promise.resolve(); }
  return request('POST', new URL('/i/v0/e/', POSTHOG_HOST).toString(), {
    api_key: POSTHOG_KEY,
    event,
    distinct_id: distinctId,
    timestamp: timestamp.toISOString(),
    properties: Object.assign({ $lib: 'abc-tutoring-simulator', simulated: true }, properties)
  })
    .then(() => { sent++; })
    .catch(() => { dropped++; });
}

/* ------------------------------------------------------------------ visit */

// Spread visitors over the past two weeks so trends have a shape.
function visitStart(index) {
  const daysAgo = Math.floor((index / VISITORS) * 14);
  const when = new Date();
  when.setDate(when.getDate() - (14 - daysAgo));
  when.setHours(8 + Math.floor(Math.random() * 13), Math.floor(Math.random() * 60), 0, 0);
  return when;
}

async function simulateVisitor(index, tutors) {
  const distinctId = `sim_${Date.now().toString(36)}_${index}`;
  const clock = visitStart(index);
  const step = () => new Date(clock.setSeconds(clock.getSeconds() + 20 + Math.floor(Math.random() * 90)));

  const common = {
    referrer_source: pick(REFERRERS),
    device_type: pick(DEVICES)
  };

  await capture(distinctId, '$pageview', Object.assign({ $current_url: `${BASE}/`, page: '/' }, common), step());

  // Most, but not all, visitors go on to look at tutors.
  if (!chance(0.72)) {
    await capture(distinctId, 'booking_abandoned', Object.assign({ reached_step: 'home' }, common), step());
    return { booked: false };
  }

  await capture(distinctId, '$pageview', Object.assign({ $current_url: `${BASE}/tutors.html`, page: '/tutors.html' }, common), step());
  await capture(distinctId, 'tutor_list_viewed', Object.assign({ tutors_listed: tutors.length }, common), step());

  // Roughly half of parents filter, usually by subject.
  let candidates = tutors;
  if (chance(0.55)) {
    const subject = pick([...new Set(tutors.flatMap((t) => t.subjects))]);
    const grade = chance(0.5) ? String(1 + Math.floor(Math.random() * 12)) : null;
    candidates = tutors.filter((t) => t.subjects.includes(subject) &&
      (!grade || (Number(grade) >= t.gradeMin && Number(grade) <= t.gradeMax)));
    await capture(distinctId, 'tutor_list_filtered',
      Object.assign({ subject, grade, results: candidates.length }, common), step());
    if (!candidates.length) {
      await capture(distinctId, 'tutor_search_empty', Object.assign({ subject, grade }, common), step());
      candidates = tutors;
    }
  }

  const bookable = candidates.filter((t) => t.openCount > 0);
  if (!bookable.length) return { booked: false };
  const tutor = pick(bookable);

  await capture(distinctId, 'book_clicked', Object.assign({ tutor_id: tutor.id, from: 'tutor_list' }, common), step());
  await capture(distinctId, '$pageview', Object.assign({ $current_url: `${BASE}/book.html`, page: '/book.html' }, common), step());
  await capture(distinctId, 'tutor_selected',
    Object.assign({ tutor_id: tutor.id, tutor_name: tutor.name, hourly_rate: tutor.rate, open_slots: tutor.openCount }, common), step());

  if (!chance(0.62)) {
    await capture(distinctId, 'booking_abandoned', Object.assign({ tutor_id: tutor.id, reached_step: 'tutor_selected' }, common), step());
    return { booked: false };
  }

  // Re-fetch so we pick from what is genuinely still open right now.
  const fresh = (await request('GET', `${BASE}/api/tutors/${tutor.id}`)).body.tutor;
  const open = fresh.slots.filter((s) => !s.booked);
  if (!open.length) return { booked: false };
  const slot = pick(open.slice(0, 12));

  await capture(distinctId, 'date_selected', Object.assign({ tutor_id: tutor.id, session_date: slot.date }, common), step());
  await capture(distinctId, 'time_selected',
    Object.assign({ tutor_id: tutor.id, session_date: slot.date, session_time: slot.time }, common), step());
  await capture(distinctId, 'booking_form_started', Object.assign({ tutor_id: tutor.id }, common), step());

  // A quarter of parents stall on the form itself.
  if (!chance(0.58)) {
    await capture(distinctId, 'booking_abandoned', Object.assign({ tutor_id: tutor.id, reached_step: 'form' }, common), step());
    return { booked: false };
  }

  const parentName = `${pick(FIRST)} ${pick(LAST)}`;
  const parentEmail = `${parentName.toLowerCase().replace(/[^a-z]/g, '.')}${index}@example.com`;
  const grade = String(Math.max(fresh.gradeMin, Math.min(fresh.gradeMax,
    fresh.gradeMin + Math.floor(Math.random() * (fresh.gradeMax - fresh.gradeMin + 1))))) || '1';

  const payload = {
    tutorId: fresh.id,
    parentName,
    parentEmail,
    studentFirstName: pick(KIDS),
    studentGrade: grade === '0' ? 'K' : grade,
    subject: pick(fresh.subjects),
    date: slot.date,
    time: slot.time,
    distinctId,
    source: common.referrer_source
  };

  await capture(distinctId, 'booking_submitted',
    Object.assign({ tutor_id: fresh.id, subject: payload.subject, session_date: slot.date, session_time: slot.time }, common), step());

  const res = await request('POST', `${BASE}/api/bookings`, payload);
  if (res.status !== 201) {
    // Usually means another simulated parent grabbed the same hour first -
    // exactly the race the server is there to prevent.
    await capture(distinctId, 'booking_failed',
      Object.assign({ tutor_id: fresh.id, reasons: res.body && res.body.errors }, common), step());
    return { booked: false, conflict: true };
  }

  await capture(distinctId, 'booking_confirmed',
    Object.assign({
      booking_id: res.body.booking.id,
      tutor_id: fresh.id,
      tutor_name: fresh.name,
      subject: payload.subject,
      student_grade: payload.studentGrade,
      session_date: slot.date,
      session_time: slot.time,
      booking_value: fresh.rate
    }, common), step());
  await capture(distinctId, '$pageview', Object.assign({ $current_url: `${BASE}/confirmed.html`, page: '/confirmed.html' }, common), step());

  return { booked: true, tutor: fresh.name, when: `${slot.date} ${slot.time}`, parentName };
}

/* ------------------------------------------------------------------- main */

(async function main() {
  console.log(`Simulating ${VISITORS} visitors against ${BASE}`);
  console.log(POSTHOG_KEY ? `PostHog: sending to ${POSTHOG_HOST}` : 'PostHog: POSTHOG_API_KEY not set - bookings still run, events are skipped');

  let tutors;
  try {
    tutors = (await request('GET', `${BASE}/api/tutors`)).body.tutors;
  } catch (err) {
    console.error(`Could not reach ${BASE}. Start the server first: npm start`);
    process.exit(1);
  }

  const results = [];
  for (let i = 0; i < VISITORS; i++) {
    try {
      results.push(await simulateVisitor(i, tutors));
    } catch (err) {
      console.warn(`visitor ${i} failed: ${err.message}`);
      results.push({ booked: false });
    }
  }

  const booked = results.filter((r) => r.booked);
  const conflicts = results.filter((r) => r.conflict).length;

  console.log('\n--- Simulation summary ---');
  console.log(`Visitors:        ${VISITORS}`);
  console.log(`Bookings made:   ${booked.length}`);
  console.log(`Conversion rate: ${((booked.length / VISITORS) * 100).toFixed(1)}%`);
  console.log(`Slot conflicts:  ${conflicts} (blocked by the server, as intended)`);
  console.log(`Events sent:     ${sent}${dropped ? ` (${dropped} skipped)` : ''}`);
  if (booked.length) {
    console.log('\nA few of the bookings that landed:');
    booked.slice(0, 5).forEach((b) => console.log(`  ${b.parentName} -> ${b.tutor} on ${b.when}`));
  }
})();
