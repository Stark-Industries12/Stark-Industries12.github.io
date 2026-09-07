# ABC Tutoring - website prototype

A working prototype of the ABC Tutoring site: parents browse tutors, pick an
open hour on a calendar, and book a one-hour session. Booked hours disappear
immediately, Dana gets an email and a text, and everything a parent does is
tracked in PostHog.

**Live demo:** https://stark-industries12.github.io

No dependencies to install - it runs on plain Node (18+).

## Two ways it runs

The same HTML, CSS and JavaScript work in both places. `js/api.js` checks once
on load whether a backend is there and picks a mode.

| | Live demo (GitHub Pages) | Node server (`npm start`) |
| --- | --- | --- |
| Availability & booking | Held in the visitor's own browser | Shared by everyone, stored on the server |
| Double-booking prevention | Yes, within that browser | Yes, re-checked on the server at submit |
| Notifications | Shown on the confirmation page | Also written to `data/notifications.log` |
| PostHog | Yes | Yes, plus server-side `booking_confirmed` |

The Pages demo is for clicking through the experience. The Node server is the
real prototype - it is the one where two different parents can't take the same
hour, which is the behaviour Dana asked for.

## Run the full prototype

```bash
npm start
```

Then open http://localhost:3000.

The PostHog key lives in `.env` (gitignored - copy `.env.example` to start).
Node loads it automatically, so there is nothing to paste into the pages.

## Simulated traffic

Fills the site with realistic activity - visitors who browse and leave,
visitors who filter by subject, and visitors who book for real:

```bash
npm run simulate -- --visitors 60
```

Each simulated parent gets their own PostHog identity and walks the real
funnel, spread over the past two weeks so trends have a shape. Bookings it
makes are genuine - they take hours off the calendar. Every event it sends
carries `simulated: true`, so real traffic can be separated from it in
PostHog later. `npm run reset` clears all bookings and the notification log.

## The four pages

| Page | What it does |
| --- | --- |
| `index.html` | What the service is, how booking works, two featured tutors |
| `tutors.html` | All tutors, filterable by subject and grade |
| `book.html` | Tutor -> calendar -> open hour -> parent/student details |
| `confirmed.html` | Confirmation number and the notifications that went out |

Tutor cards show photo, subjects, grade levels, hourly rate and weekly
availability. The booking form collects the parent's name and email, the
student's first name and grade, and the subject. No online payment.

## How scheduling works

Each tutor has a weekly availability pattern in `data/tutors.json`:

```json
"availability": { "1": ["15:00", "16:00", "17:00"], "3": ["15:00", "16:00"] }
```

Keys are weekdays (0 = Sunday), values are one-hour session start times. That
pattern is projected onto the next 21 days, minus anything already booked, so:

- a booked hour is struck through and cannot be selected;
- the server re-checks availability on submit, so two parents clicking the same
  hour at the same moment cannot double-book - the second gets "someone just
  took that time";
- adding a tutor or changing hours means editing `data/tutors.json`. That file
  is the thing to replace with a small admin screen later.

The rules live in `js/schedule.js`, which both the server and the browser load,
so the two modes cannot drift apart.

## Notifications

Every booking produces three messages: an email to Dana, a text to Dana's
phone, and a confirmation email to the parent. The bodies are the real ones -
only the delivery is stubbed. Running the server also appends them to
`data/notifications.log`. Going live means replacing `sendNotifications()` in
`server.js` with a call to, for example, SendGrid and Twilio.

## What PostHog tracks

Autocapture and pageviews are on. On top of that:

| Event | Answers |
| --- | --- |
| `$pageview`, `$pageleave` | Who visits, from where, on what device |
| `home_tutors_previewed`, `cta_clicked` | Which home page button actually starts a booking |
| `tutor_list_viewed`, `tutor_list_filtered` | Which subjects and grades parents search for |
| `tutor_search_empty` | Demand with nobody to meet it - where to hire next |
| `book_clicked`, `tutor_selected` | Which tutors get requested most |
| `tutor_no_availability` | A tutor parents want but can't book |
| `date_selected`, `time_selected` | Which days and hours parents actually want |
| `booking_form_started`, `booking_submitted` | Form drop-off |
| `booking_confirmed` | Completed bookings, with tutor, subject, grade and value |
| `booking_failed` | Validation problems and slot conflicts |
| `booking_abandoned` | The exact step where a parent gave up |
| `confirmation_viewed` | Confirmation reached |

Every event carries `site_mode` (`server` or `static`). When the Node server is
running, `booking_confirmed` is sent from the server as well as the browser, so
bookings still register if a parent has an ad blocker or closes the tab.
Parents are identified by email at the moment they book, which links their
whole visit history to the booking.

### Suggested PostHog insights

1. **Funnel** - `$pageview` -> `tutor_list_viewed` -> `tutor_selected` ->
   `time_selected` -> `booking_confirmed`. Where parents fall out.
2. **Bookings by tutor** - `booking_confirmed` broken down by `tutor_name`.
3. **Demand by subject** - `tutor_list_filtered` by `subject`, next to
   `booking_confirmed` by `subject`.
4. **Best hours** - `time_selected` broken down by `session_time`, to decide
   which hours to add.
5. **Unmet demand** - `tutor_search_empty` and `tutor_no_availability` over time.
6. **Abandonment** - `booking_abandoned` broken down by `reached_step`.

## Files

```
index.html tutors.html book.html confirmed.html   The four pages
css/styles.css                                    All styling
js/schedule.js       Availability, validation and notification wording (shared)
js/api.js            Picks the server or in-browser data layer
js/analytics.js      PostHog setup and the track() helper
js/config.js         PostHog key for the static demo
js/ui.js js/home.js js/tutors.js js/book.js       Page behaviour
img/                 Generated placeholder tutor photos
data/tutors.json     Tutors and their weekly availability
data/bookings.json   Confirmed bookings (server mode)
server.js            API, static files, notifications
scripts/simulate-traffic.js                       Simulated parents
```

A note on `js/config.js`: a PostHog project key is a publishable, write-only
key, designed to sit in client-side code - it cannot read any data back out.
The server overrides it from the environment.

## Known limits of the prototype

- No admin screen yet: tutors and hours are edited in JSON.
- No login, no payment (as agreed), no rescheduling or cancellation flow -
  parents reply to the confirmation email.
- Times have no timezone handling; everything is local time.
- Tutor photos are generated placeholders until real ones are supplied.
- Bookings are stored in a JSON file. A real launch wants a database.
