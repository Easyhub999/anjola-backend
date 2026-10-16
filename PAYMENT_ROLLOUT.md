# Payment integrity rollout

This change is local until the backend and frontend are deployed. It does not migrate existing orders or change production settings.

## Behavior

- Public orders are priced from MongoDB product records and the server's delivery options. Browser prices, item names, and delivery charges are not trusted. A supplied total that differs from the computed amount returns HTTP 409 before payment.
- Pack variations use their own price; the single-item sale price does not override pack pricing.
- Paystack receives the stored amount in kobo, NGN currency, stored customer email, and a server-generated reference. Existing initialization URLs are reused for that order.
- Both verification and signed webhooks validate the payment and use a MongoDB transaction for order and stock changes. Replays do not deduct stock, resend confirmation, or reset fulfillment status.
- Stock shortages and payments for cancelled orders are recorded as paid with a review reason and no inventory deduction. Review these in Admin Orders and arrange fulfillment or a refund manually. This change does not automate refunds or provide a review-resolution workflow.
- Confirmation email is attempted after commit. Email failure does not roll back payment; durable email retries remain future work.

## Deployment

1. Run `npm test` in backend and `npm run build` in frontend.
2. Test against a separate MongoDB Atlas test database and Paystack TEST credentials. The unit tests mock transaction isolation; they do not exercise an actual MongoDB replica set or Paystack.
3. Confirm transaction support on the target database (Atlas replica set/sharded deployment; a standalone local MongoDB server is insufficient).
4. Before deployment, reconcile any existing unpaid orders that already have Paystack payment attempts. Legacy totals were client-controlled, so this implementation refuses to auto-fulfill legacy unpaid orders. Do not ask a charged customer to pay again: check Paystack and reconcile manually. Unpaid customers can start a fresh checkout. Existing paid orders are not modified by this rollout.
5. Deploy backend first, then frontend. The backend accepts the current storefront's delivery labels as well as the new IDs, but older frontend carts with missing options or incorrect bundle totals will be rejected until corrected.
6. Confirm `MONGODB_URI`, `PAYSTACK_SECRET_KEY`, `FRONTEND_URL`, `RESEND_API_KEY`, and `EMAIL_FROM` on the intended Render service. Never commit their values.
7. Confirm Paystack's webhook points to `https://anjola-backend.onrender.com/api/orders/paystack-webhook` and the frontend uses that backend. For test deployments, use their corresponding URLs.

## Payment return URL hotfix

- Newly initialized Paystack transactions always use `https://anjolaaestheticsng.com/shop` as their callback. `FRONTEND_URL` no longer controls payment redirects, so stale localhost, malformed, or external values cannot send a paying customer away from the storefront. This includes test-key sessions: local return URLs are deliberately unsupported by this hotfix. The existing `/shop` verification route remains compatible with the deployed frontend.
- Correct the Render service's `FRONTEND_URL` to `https://anjolaaestheticsng.com` as well, so older backend versions cannot reintroduce the local callback during a rollback. Configure Paystack's dashboard callback to the canonical shop URL too, for transactions initialized outside this service.
- Deploy the backend to protect newly initialized transactions. Previously initialized checkout sessions, including cached authorization URLs reused for an order, retain their original Paystack callback. Redeploying cannot rewrite those sessions. Do not ask an already charged customer to pay again; verify their existing transaction reference through the storefront's `/shop?reference=...` return route or reconcile the order with Paystack and Admin Orders. Unpaid customers with an old session should start a fresh checkout after deployment.
- Callback failure does not by itself mean payment failed. Webhook delivery and confirmation email are separate operations; confirm the saved order payment status and Paystack transaction before retrying payment or arranging fulfillment.
- Regression tests inspect the outgoing HTTPS request with mocked credentials and responses. They verify callback isolation from configuration and unchanged amount, currency, metadata and reference; they do not charge a card or exercise Paystack's live redirect.

## Test-mode acceptance checks

### Customer-paid Paystack fees

- Paystack's dashboard preference to pass transaction fees to customers can make the collected `amount` larger than the order's saved `expectedAmount`. A live affected reference returned HTTP 409 from the former exact-amount check despite the customer's successful Paystack receipt.
- Exact payments remain supported. A larger collected amount is accepted only when the trusted provider's `requested_amount` exactly matches the saved order amount and its positive integer `fees` accounts for the increase, with at most one additional kobo for gross-up rounding. Underpayments, unexplained excess, and mismatched currency, reference, order or customer remain rejected. Order pricing is unchanged.
- Signed webhook payloads missing `requested_amount` are verified with Paystack before processing. An unavailable or mismatched verification does not acknowledge the webhook as successful.
- Customer and webhook responses are sent after the database transaction commits and before waiting for the best-effort receipt email. Email delivery remains non-durable; this change does not add retries or guarantee receipt delivery.
- After the backend deploys, retry an affected customer's original reference. This processes the existing charge, not a new payment. Replays retain the shared transaction guard against duplicate stock deductions and receipts.
- Official references: [Paystack transaction pricing](https://support.paystack.com/en/articles/2130306) and [verification response fields](https://paystack.com/docs/payments/verify-payments/).

### Checkout and inventory

- Buy a regular item, a sale item, a color/size item, and a pack variation; match the displayed total to the Paystack charge and order record.
- Replay the same verification request and webhook; payment and stock must be applied once.
- Exercise two simultaneous payments against limited stock; one may need manual review, but stock must not become negative.
- Simulate a transaction failure; retry without partial stock changes.
- Exercise a late successful payment for a cancelled order; it must remain cancelled and require review.
- Confirm confirmation-email success/failure and the review notice in Admin Orders.

## Remaining inventory work

Inventory counts individual pieces. Newly created orders store a server-calculated stockQuantity per line (pack count multiplied by pieces per pack). Payment and cancellation use that snapshot. Older orders without it retain their original quantity-based deductions and restorations; no historical stock is rewritten. Existing unpaid orders without the snapshot also retain their original convention and need review during rollout. Existing pricing, tax and delivery-zone eligibility policies are not redesigned here; the server preserves the storefront's delivery prices.

## Customer accounts, gifts and tracking

- New checkouts with a valid login attach the verified account to the order. Guest checkout remains available without credentials. Invalid or expired credentials return 401 instead of silently creating a guest order; the storefront prompts the customer to sign in again and preserves the cart.
- Historical guest orders are not assigned to accounts by matching email addresses. Previously missing account links or gift instructions are not backfilled.
- Gift selection and a message of up to 500 characters are stored with the order and displayed in Admin Orders. Deselecting the gift option clears the submitted message.
- Admins can enter an optional tracking number when shipping and correct it while the order is shipped. Customer order history displays the saved number; shipping emails receive it. A changed tracking number triggers an updated shipment notification, while an identical repeat does not. Email delivery remains best effort.
- Customer and admin order lists distinguish request failures from successful empty results and offer recovery controls.
- Before deployment, test signed-in and guest checkout, expired-session recovery, gift instructions, tracking updates and shipment emails using test accounts. Confirm failed history requests show an error and Retry recovers.
- Local validation before inventory changes: 39 backend tests, 12 targeted frontend tests, and the frontend production build passed. These checks do not replace the Atlas/Paystack test-mode checks above or a full frontend test-suite run.

## Cart and cancellation follow-up

- Cart add/change/remove operations use product ID, size, color and pack size together. Existing saved lines are normalized without discarding their variant selections. Previously merged colors cannot be reconstructed; customers should remove and re-add any incorrect old lines.
- Opening a related product resets its image and option selections. Successful payment clears the active cart as well as persisted storage.
- Cancellation and stock restoration now share a transaction. Only orders explicitly marked `stockDeducted: true` restore stock, and that marker is cleared on commit. Repeated cancellations do not restore inventory or resend cancellation email.
- Legacy paid orders without the marker are cancelled with an inventory review notice. No automatic restoration is attempted, since earlier code could skip, partially apply, or repeat deductions. Already-cancelled legacy orders also require manual reconciliation; this rollout does not repair historical counts.
- Missing products or removed colors make restoration fail without partial changes; reconcile inventory before retrying the cancellation.
- New paid manual orders deduct stock and create their order in one transaction, with the marker recorded. New manual orders validate size, color and pack against current products and use the same piece-count snapshot as checkout. Manual shipping charges remain explicitly set by the admin; product prices come from the server.
- Products hidden by the updated inventory code may be shown again on restocking. Intentionally hidden products stay hidden. Explicit admin visibility edits clear automatic-hiding ownership.
- Fulfillment proceeds pending → processing → shipped → delivered. Cancellation is permitted before delivery and is terminal. Payment-review orders must be reconciled before advancing fulfillment. Refunds remain a separate manual operation; cancellation emails no longer promise an automatic refund.
- Test-mode acceptance should also cover simultaneous cancellation requests, cancellation racing a payment notification, restoration rollback, colored stock, and intentionally hidden products. Backend unit tests simulate transaction isolation; verify this on the test Atlas deployment before production rollout.

## Piece inventory and admin edits

- One three-piece pack deducts three pieces; two deduct six. Pack pricing is unchanged. Color stock and total stock use the same piece count. Repeated payment or cancellation requests remain idempotent.
- Manual order lines have independent size, color and pack selectors, allowing several variants of the same product. Required customer details and current product prices are validated before creating the order. Manual orders are not attached to the administering employee's customer account.
- Full inventory edits require the product's saved updatedAt value. The database update matches that value atomically, so a payment, cancellation or intervening product edit causes a conflict instead of overwriting newer stock. On conflict, reload products and reapply the intended edit. Products lacking historical timestamps need a reload after a metadata update before inventory editing.
- Visibility and reorder actions send only their intended fields. Inventory counts must be safe non-negative integers; pack sizes must be unique positive integers; object-based color totals must match total stock.
- Before production, verify a concurrent purchase versus an open stock form on the test Atlas database, a three-piece manual order with a selected color, and payment/cancellation restoration for both new and historical orders. Audit historical pack inventory separately; this change does not correct earlier under-deductions.

Validation for the inventory batch: 45 backend tests and 13 targeted frontend tests passed; the production frontend build succeeded. Database concurrency is simulated in unit tests and still requires the test Atlas acceptance check.

## Gift packaging charge (October 2026)

- New gift orders add a fixed ₦2,000 once per order, including manually created gift orders. It is independent of line count, quantity, pack size and shipping.
- The backend derives `customerInfo.giftPackagingFee` from the boolean `isGift` selection. Submitted fee values are ignored. The saved total and Paystack `expectedAmount` include the charge.
- Checkout discloses the fee before selection, shows it as a separate line and removes it when the option is deselected. Admin details, customer history and email summaries read the saved fee.
- No migration or backfill is needed. The schema has no default fee, so existing orders retain their original amounts; a missing historical fee is shown as “Not recorded”. Existing payment sessions retain their saved amounts.
- Deploy backend and frontend together, backend first. During a mixed-version rollout, gift checkouts with mismatched totals fail with a refresh message rather than silently charging a different amount. Non-gift checkout is unaffected.
- Regression checks cover fixed per-order pricing, tampered charges, stale totals, saved and historical fees, manual gift orders, payment initialization/verification, and mocked receipt emails. Tests do not create live orders or charge real payments.

## Outside orders and product editor

- Admins can create WhatsApp, Instagram, phone, in-person and other orders. Email is optional only for manual orders; website checkout still requires it. Internal notes stay in admin order records.
- New manual orders store the actual payment method and optional reference. Unpaid orders do not reserve or deduct stock. Paid orders deduct stock in the existing transaction and default to processing.
- The admin-only `POST /api/orders/:id/record-payment` endpoint records payment and deducts stock atomically. Repeated requests leave paid orders unchanged. Website orders, cancellations and legacy unpaid records with ambiguous stock history cannot use it.
- Manual customer emails are opt-in. Provider failures do not roll back saved orders. Email delivery remains best effort.
- Product creation now persists sale price, badge and search keywords, matching updates. The new product editor preserves unsaved values after server errors and includes the original updatedAt value when editing inventory. Legacy string-only colors require explicit stock counts before saving.
- Deploy backend before frontend. No historical order migration is required. Unit tests cover rollback, duplicate payment requests, optional email, source metadata, and pricing; they do not replace an integration test on a separate Atlas database.
