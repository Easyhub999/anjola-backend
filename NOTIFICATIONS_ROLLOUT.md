# Order notification delivery

Order creation, payment recording, and fulfilment transitions now persist an email task inside the order document. A worker in the backend process sends those tasks. A failed email no longer depends on repeating a payment webhook or changing an order's status.

## Production setup

1. Deploy the backend before the frontend. Keep the backend service running continuously: a sleeping Render instance cannot run scheduled retries until it wakes. Multiple backend instances are safe because each email task has an atomic lease. Existing MongoDB transaction support is still required for payment, stock, and fulfilment updates.
2. Use the production Render service whose public URL is `https://anjola-backend-1.onrender.com`. Confirm `RESEND_API_KEY` has permission to send from the verified domain used by `EMAIL_FROM`. Configure the actual sender on that service, for example `Anjola Aesthetics <orders@anjolaaestheticsng.com>` only if that domain/address is permitted in the Resend account. Verify domain authentication and account sending capacity in Resend. Do not commit keys or their values.
3. In Resend, register this HTTPS webhook endpoint:

   `https://anjola-backend-1.onrender.com/api/email-webhooks/resend`

   Subscribe to `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.failed`, `email.bounced`, `email.suppressed`, and `email.complained`.
4. Put that endpoint's signing secret in the Render environment as `RESEND_WEBHOOK_SECRET`, then restart/redeploy the backend. This is a webhook signing secret, not the API key. The route verifies the signature and timestamp over the original body before any database update. Database failures return a retryable HTTP error.
5. Open Admin Orders. Configuration warnings should disappear after the required settings are present. These checks verify presence only; the controlled delivery check below confirms that the values and provider configuration work.

Official references: [Resend webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests), [delivery events](https://resend.com/docs/webhooks/event-types), [idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys), [correlation tags](https://resend.com/docs/dashboard/emails/tags).

## Delivery check

Use an explicitly approved test recipient and a test environment/order. Do not change a real customer's payment, stock, or fulfilment to test emails.

- Verify order confirmation, paid receipt, shipping with tracking, delivery confirmation, and cancellation. Also exercise a paid order requiring review; it must acknowledge receipt of payment without promising fulfilment.
- Observe `Queued → Sending → Sent → Delivered` in the admin email history. `Sent` means provider acceptance; `Delivered` means acceptance by the recipient's mail server, not proof of inbox placement or reading.
- In a test environment, simulate a temporary rejection. Confirm a scheduled retry uses the same stored request and provider key, then delivers once. Restart during a send and verify lease recovery does not duplicate it.
- Verify invalid webhook signatures cannot change history. Replay a valid event and deliver events out of order; terminal delivery/failure evidence must remain intact.
- Confirm the public `GET /api/contact/test` endpoint no longer exists. It previously sent real mail through the shared account.

## Recovery and monitoring

- The worker checks every 15 seconds, claims at most 10 jobs per batch, and renews a 90-second lease while sending. Provider requests have a 15-second timeout. Automatic retry delays are 1 minute, 5 minutes, 15 minutes, 1 hour, 3 hours, 6 hours, and 9 hours, subject to provider `Retry-After` and the retry deadline.
- Each job stores the rendered request before sending. Automatic retries preserve both body and idempotency key across restarts and deployments. Ambiguous acceptance stops before the 24-hour provider deduplication window expires; it becomes `Needs review` rather than risking a duplicate.
- Admin **Retry email** is available only for a definite failure or an eligible skipped message. It does not rerun payment or inventory operations. This deliberate retry uses a new key and freshly rendered request so corrected sender configuration can take effect. Accepted, bounced, suppressed, complained, ambiguous, and obsolete messages cannot be blindly resent.
- Existing orders have no reliable historical delivery evidence. The admin can explicitly send a missing email appropriate to the current order status, after confirming the customer has not already received it. There is no bulk resend or automatic historical backfill.
- Manual orders retain their existing email preference. New manual orders default to updates enabled when an address is supplied. The admin can change the preference for future events and deliberately recover eligible skipped messages; enabling it never mass-sends old emails.
- Newer payment/fulfilment events suppress obsolete unsent confirmations or shipping notices. In-flight or ambiguous attempts keep their evidence for reconciliation.
- Inspect the admin email-attention filter and structured backend events `order_notification_needs_attention`, `order_notification_delivery_issue`, `order_notification_worker_error`, `order_notification_configuration_missing`, and `order_notification_delivery_tracking_not_configured`. Connect these log events to the deployment's normal alerting channel; the application also shows failures in Admin Orders.
- The admin also flags a missing delivery confirmation after 30 minutes, and queued/sending work more than five minutes overdue. A scheduled retry is flagged only when its next attempt is more than five minutes overdue. These warnings do not manufacture a new send.
- For `Needs review`, inspect Resend activity using the order number/customer address and timestamp. Do not reset its key or mark it failed merely to force another send. Provider delivery events can still reconcile it.

## Compatibility and rollback

The schema changes are additive. No historical emails are generated at deployment. Backend responses expose email metadata only to admins; raw rendered messages, provider keys, and leases stay server-side. Deploying an older backend would restore unreliable direct sending and stop the worker; queued tasks remain stored. Avoid rolling back across active sends without checking pending tasks and provider activity first.

## Local validation

Run `npm test` in `backend`. Run the focused notification/admin/manual-order tests and `npm run build` in `frontend`. Tests use in-memory transactional stores, production Mongoose casting, mocked provider requests, and real signature verification; they do not send customer emails or connect to production MongoDB. Production provider configuration and delivery must still be checked using the approved recipient above.
