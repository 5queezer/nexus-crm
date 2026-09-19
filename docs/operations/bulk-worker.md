# Bulk command worker

Bulk previews, approvals, item checkpoints, and control requests are stored in PostgreSQL. Execution is performed by `scripts/bulk-worker.ts`; one or more workers may run because command leases prevent concurrent processing.

The production container bundles the worker and starts it beside the Next.js standalone server through `scripts/start-services.mjs`. If either process stops unexpectedly, the container exits so the deployment restart policy can recover it. Expired leases are reclaimable after 60 seconds.

For local development, run the web app and worker in separate terminals:

```bash
npm run dev
npm run bulk:worker
```

Apply Prisma migrations before starting the worker. The worker requires the same `DATABASE_URL` as the web process. It does not need provider credentials for the current CRM-only follow-up/archive/restore actions.
