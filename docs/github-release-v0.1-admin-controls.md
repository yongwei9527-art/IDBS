# Release: 实验室管理系统 v0.1 Admin Controls

**Tag:** `v0.1-admin-controls`
**Target:** `main`
**Date:** 2026-07-24

## Overview

This release improves administrator permission workflows and refines the user request handling experience in 实验室管理系统 5.0. It focuses on safer admin role operations, clearer cache refresh behavior after role changes, and better visual hierarchy for request-processing pages.

## Highlights

### Admin Role Controls

- Added a quick action in User Management to grant standard administrator access.
- Added a revoke action for standard administrator privileges.
- Protected super administrator accounts from quick revocation to avoid accidental permission handoff issues.
- Automatically refreshes related admin/user caches after role grant or revoke operations.

### User Request Page Polish

- Separated request titles from status/category/priority tags for better readability.
- Added waiting-time chips to make overdue requests easier to spot.
- Rebalanced action priority: primary confirmation action, secondary processing action, and lighter communication action.
- Improved spacing and hierarchy for dense request rows.

## Validation

- `npm --prefix web run typecheck` passed.
- `git diff --check` passed.
- Changes were pushed to `main` and tagged as `v0.1-admin-controls`.

## Upgrade Notes

No database migration is required for this release. Deploy the updated frontend/backend source from `main` or from tag `v0.1-admin-controls`.

## Recommended Post-Deploy Checks

- Open `/v5/admin/users` and confirm admin grant/revoke actions appear only for permitted accounts.
- Open `/v5/admin/requests` and verify title/tag spacing, waiting-time chips, and action button hierarchy.
- Confirm existing super administrator accounts cannot be revoked from the quick action path.
