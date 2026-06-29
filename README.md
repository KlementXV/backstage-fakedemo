# Hybrid Demand Cloud — Backstage-inspired internal developer portal mockup

Fully static demo mockup (HTML / CSS / JavaScript) recreating the UI/UX of
[Backstage](https://backstage.io), the open source developer portal initiated by
Spotify, under a custom "Hybrid Demand Cloud" visual identity.

> This is a **fake implementation for demo purposes**: there is no backend and no
> real call to Rancher, Harbor, VMware, PostgreSQL or MongoDB. All data is
> simulated locally in JavaScript and persisted in `localStorage`.
> Spotify/Backstage logos and trademarks are not used.

## Run

Open `index.html` directly in a browser. There is no server, dependency or build
step.

The **"Reset demo"** button in the top bar clears local state and returns the
demo to its starting point.

## What The Demo Shows

The screen is split into two panes visible at the same time:

- **Left — user interface**: Software Catalog with filters, entity table and
  detail pages, Software Templates, a six-step creation wizard (information,
  environment, resources, sizing with monthly cost estimate and VM lease
  timeout, summary and submission), and request tracking.
- **Right — admin interface**: approval queue with filters, request detail,
  approve/reject flow with comments, simulated step-by-step provisioning
  (stepper, progress bar and execution log), and activity log.

### Presentation Scenario

1. The user browses the catalog and opens **Create...**
2. They choose the **Bundle** template
3. They complete the multi-step form and submit the request
4. The request immediately appears in the admin pane
5. The admin opens it, comments on it and **approves** it
6. Provisioning runs automatically (Rancher → Harbor → VM → databases → access → finalization)
7. VM requests can include a time-limited lease: the requester defines the
   duration, Hybrid Demand Cloud schedules auto-delete, and reminders are planned at D-45,
   D-30, D-15 and D-1
8. Data services, Redis, RabbitMQ and **Push to diode network** requests are
   auto-approved by policy and start provisioning without an admin decision
9. New resources appear in the user catalog with the **New** badge and the request moves to **Available**

## Code Structure

| File         | Role                                                            |
|--------------|-----------------------------------------------------------------|
| `index.html` | Page shell: demo bar, two panes, sidebars                       |
| `styles.css` | Backstage-style design system (variables at the top)            |
| `script.js`  | Simulated data, state, view rendering and provisioning workflow  |

The most useful extension points are at the top of `script.js`: teams (`TEAMS`),
environments (`ENVIRONMENTS`), sizes and costs (`SIZES`, `RESOURCE_DEFS`),
templates (`TEMPLATES`) and provisioning steps (`PROV_STEPS`).
