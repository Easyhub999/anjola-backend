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

## Test-mode acceptance checks

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
