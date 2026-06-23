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

## Automated waitlist

The admin area can add waitlist customers. When a booking is deleted, the server matches active waitlist entries by service duration, staff preference, and customer availability, then creates one-click booking links.

Configuration:

- `WAITLIST_STRATEGY=first-come` (default): sends the top 3-5 matches at once.
- `WAITLIST_STRATEGY=cascade`: sends one offer at a time and advances after `WAITLIST_CASCADE_MINUTES` (default: 15) when API activity occurs.
- `WAITLIST_BATCH_SIZE=4`: first-come batch size, clamped to 3-5.
- `WAITLIST_SMS_WEBHOOK_URL`: optional webhook receiving `{ to, body, entry, offer }`; without it, messages are logged to the waitlist outbox.
- `WAITLIST_PUBLIC_BASE_URL`: optional public base URL for SMS links.
- `BUSINESS_TIMEZONE=Europe/Berlin`: timezone used for waitlist matching and SMS labels.

## Deploy

See [DEPLOYMENT.md](./DEPLOYMENT.md).

## NEXORA landing page

Marketing site is separate (branch `nexora-landing`).
