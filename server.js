'use strict';

/*
 * ABC Tutoring - prototype server.
 *
 * Serves the site and the booking API. The same HTML/CSS/JS in this folder
 * also runs as a static demo on GitHub Pages; js/api.js decides at load time
 * whether this API is present. Scheduling rules are shared with the browser
 * through js/schedule.js so the two modes cannot drift apart.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const Schedule = require('./js/schedule.js');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const BOOKINGS_FILE = path.join(DATA_DIR, 'bookings.json');
const NOTIFICATIONS_FILE = path.join(DATA_DIR, 'notifications.log');

const PORT = Number(process.env.PORT || 3000);
const POSTHOG_KEY = process.env.POSTHOG_API_KEY || '';
const POSTHOG_HOST = process.env.POSTHOG_HOST || 'https://us.i.posthog.com';

const TUTORS = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'tutors.json'), 'utf8'));

// Everything else in the repo root is public, but these must never be served.
const BLOCKED = new Set(['.env', '.env.example', 'server.js', 'package.json', 'package-lock.json']);

/* ---------------------------------------------------------------- storage */

function readBookings() {
  try {
    return JSON.parse(fs.readFileSync(BOOKINGS_FILE, 'utf8'));
  } catch (err) {
    return [];
  }
}

function writeBookings(bookings) {
  fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(bookings, null, 2));
}

/* ---------------------------------------------------------- notifications */

// Stand-in for a real email/SMS provider: the message bodies are the real
// ones, only the delivery is stubbed. Swap this for SendGrid/Twilio.
function sendNotifications(booking, tutor) {
  const messages = Schedule.buildNotifications(booking, tutor);
  const stamp = new Date().toISOString();
  const lines = messages
    .map((m) => `[${stamp}] ${m.channel.toUpperCase()} to ${m.to}${m.subject ? ` | ${m.subject}` : ''}\n${m.body}\n`)
    .join('\n');
  fs.appendFileSync(NOTIFICATIONS_FILE, lines + '\n');
  return messages;
}

/* -------------------------------------------------------- posthog (server) */

// Bookings are the event Dana actually cares about, so they are captured from
// the server too - that survives ad blockers and closed tabs.
function captureServerSide(event, distinctId, properties) {
  if (!POSTHOG_KEY) return;
  const payload = JSON.stringify({
    api_key: POSTHOG_KEY,
    event,
    distinct_id: distinctId,
    properties: Object.assign({}, properties, { $lib: 'abc-tutoring-server' }),
    timestamp: new Date().toISOString()
  });

  const url = new URL('/i/v0/e/', POSTHOG_HOST);
  const transport = url.protocol === 'http:' ? http : require('https');
  const req = transport.request(
    {
      method: 'POST',
      hostname: url.hostname,
      port: url.port || undefined,
      path: url.pathname,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    },
    (res) => res.resume()
  );
  req.on('error', (err) => console.warn('posthog capture failed:', err.message));
  req.write(payload);
  req.end();
}

/* ------------------------------------------------------------- http utils */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8'
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) reject(new Error('payload too large'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const filePath = path.join(ROOT, rel);
  const withExt = path.extname(filePath) ? filePath : `${filePath}.html`;
  const name = path.basename(withExt);

  // Stay inside the repo, and never hand out the server's own files or secrets.
  if (!withExt.startsWith(ROOT + path.sep) || BLOCKED.has(name) || name.startsWith('.') || rel.startsWith('scripts/')) {
    res.writeHead(403, { 'Content-Type': MIME['.html'] });
    res.end('<h1>403</h1>');
    return;
  }

  fs.readFile(withExt, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': MIME['.html'] });
      res.end('<h1>404</h1><p><a href="/">Back to ABC Tutoring</a></p>');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(withExt)] || 'application/octet-stream' });
    res.end(data);
  });
}

/* ---------------------------------------------------------------- routes */

async function handleApi(req, res, url) {
  const { pathname } = url;

  if (req.method === 'GET' && pathname === '/api/config') {
    return sendJson(res, 200, { posthogKey: POSTHOG_KEY, posthogHost: POSTHOG_HOST, mode: 'server' });
  }

  if (req.method === 'GET' && pathname === '/api/tutors') {
    const bookings = readBookings();
    let list = TUTORS.map((t) => Schedule.tutorWithSlots(t, bookings));

    const subject = url.searchParams.get('subject');
    const grade = url.searchParams.get('grade');
    if (subject) list = list.filter((t) => t.subjects.includes(subject));
    if (grade) {
      const g = grade === 'K' ? 0 : Number(grade);
      list = list.filter((t) => g >= t.gradeMin && g <= t.gradeMax);
    }
    return sendJson(res, 200, { tutors: list });
  }

  const tutorMatch = pathname.match(/^\/api\/tutors\/([\w-]+)$/);
  if (req.method === 'GET' && tutorMatch) {
    const tutor = TUTORS.find((t) => t.id === tutorMatch[1]);
    if (!tutor) return sendJson(res, 404, { error: 'Tutor not found' });
    return sendJson(res, 200, { tutor: Schedule.tutorWithSlots(tutor, readBookings()) });
  }

  if (req.method === 'GET' && pathname === '/api/bookings') {
    return sendJson(res, 200, { bookings: readBookings() });
  }

  if (req.method === 'POST' && pathname === '/api/bookings') {
    let input;
    try {
      input = await readBody(req);
    } catch (err) {
      return sendJson(res, 400, { errors: [err.message] });
    }

    // Re-checked here on every submit, so two parents clicking the same hour
    // at the same moment cannot both get it.
    const bookings = readBookings();
    const tutor = TUTORS.find((t) => t.id === input.tutorId);
    const { errors, clean } = Schedule.validateBooking(input, tutor, bookings);
    if (errors.length) return sendJson(res, 400, { errors });

    const booking = Object.assign(
      { id: Schedule.makeId(), tutorId: tutor.id, tutorName: tutor.name, rate: tutor.rate },
      clean,
      { status: 'confirmed', createdAt: new Date().toISOString() }
    );

    bookings.push(booking);
    writeBookings(bookings);
    const notifications = sendNotifications(booking, tutor);

    captureServerSide('booking_confirmed', input.distinctId || booking.parentEmail, {
      booking_id: booking.id,
      tutor_id: tutor.id,
      tutor_name: tutor.name,
      subject: booking.subject,
      student_grade: booking.studentGrade,
      session_date: booking.date,
      session_time: booking.time,
      hourly_rate: tutor.rate,
      booking_value: tutor.rate,
      source: input.source || 'website'
    });

    return sendJson(res, 201, { booking, notifications });
  }

  if (req.method === 'GET' && pathname === '/api/notifications') {
    let log = '';
    try {
      log = fs.readFileSync(NOTIFICATIONS_FILE, 'utf8');
    } catch (err) {
      log = '';
    }
    return sendJson(res, 200, { log });
  }

  return sendJson(res, 404, { error: 'Unknown endpoint' });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((err) => {
      console.error(err);
      sendJson(res, 500, { errors: ['Something went wrong on our end.'] });
    });
    return;
  }

  serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`ABC Tutoring running at http://localhost:${PORT}`);
  console.log(POSTHOG_KEY ? 'PostHog: enabled' : 'PostHog: no POSTHOG_API_KEY set (events log to the browser console only)');
});
