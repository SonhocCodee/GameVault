# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

GameVault players managing a personal game library on Windows, and public visitors discovering games and other players' shared experiences. The user confirmed public access from the first community release.

## Product Purpose

Connect personal game tracking, selected screenshots, reviews, and voluntary hardware/performance sharing to a public game community. Help visitors choose what to play and understand actual reported conditions.

## Operating Context

Electron/React/TypeScript desktop application, local SQLite, Cloudflare Workers/D1, Google OAuth, and private Google Drive backups. Public browser routes supplement the desktop app.

## Capabilities and Constraints

Existing library, tracker/AMD import/watchdog, FPS capture, media, save vault, reviews, monthly picks, and cloud covers are preserved. New public data requires explicit sharing. Game resolution must not be inferred from monitor resolution. Automatic configuration export has explicit supported adapters and a manual fallback.

## Brand Commitments

GameVault name and existing Vietnamese user-facing voice. Inherit the established application interface. Implementation documents are English; Vietnamese idea documents are write-only user deliverables during this task.

## Evidence on Hand

Current source under `src/`, `worker/`, and `admin-web/`; actual library and PresentMon measurements when present. No fabricated public users, reviews, playtime, or benchmarks.

## Product Principles

- Public sharing is intentional and independent of private synchronization.
- Unknown data remains unknown.
- A game hub connects social content to practical discovery.
- Measurements retain their source and graphics/hardware context.
- Existing private save and media workflows remain functional.
