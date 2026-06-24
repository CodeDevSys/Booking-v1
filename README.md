# Booking MVP

Salon appointment booking — customer booking flow and manager admin.

## Live links

- **Booking:** https://booking-mvp.onrender.com  
- **Admin:** https://booking-mvp.onrender.com/admin.html  

Admin password default: `123456`

## Local

```bash
npm install
npm run dev
```

## Automated waitlist demo

This branch is prepared as a product demo for salons, not as a production SaaS architecture.

The admin area can add waitlist customers. When a booking is cancelled in the admin demo, the server matches active waitlist entries by service duration, staff preference, and customer availability, then creates WhatsApp-like mock notifications with one-click actions.

No external notification provider is required:

- no SMS API
- no WhatsApp API
- no database
- JSON/mock data only

Configuration:

- `WAITLIST_STRATEGY=first-come` (default): shows the top 3-5 matches in the demo inbox at once.
- `WAITLIST_STRATEGY=cascade`: shows one offer at a time and advances after `WAITLIST_CASCADE_MINUTES` (default: 15) when API activity occurs.
- `WAITLIST_BATCH_SIZE=4`: first-come batch size, clamped to 3-5.
- `WAITLIST_PUBLIC_BASE_URL`: optional public base URL for one-click demo links.
- `BUSINESS_TIMEZONE=Europe/Berlin`: timezone used for waitlist matching and notification labels.

Use **Demo zurücksetzen** in the admin area to reload presentation bookings and waitlist customers.

## Deploy

See [DEPLOYMENT.md](./DEPLOYMENT.md).

## NEXORA landing page

Marketing site is separate (branch `nexora-landing`).
