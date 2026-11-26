# Community UI Extension Brief

## Confirmed scope

Public community from launch: posts, selected images, likes, comments, reviews, profiles with sharing controls, game rankings, reports/blocking/moderation, and notifications. Discover includes official Steam requirements and completed-player performance reports with hardware, game resolution, preset and FPS provenance. Local game details expose future-session context and conservative settings ZIP export.

## Direction

Visitor mode: Operate. Extend the current GameVault interface, retaining its dark background (#0e1015), surface (#161821), border (#2a2e3d), system UI font and sky community accent. Keep application navigation and personal library/save workflows intact. Community text uses a brighter muted color (#adb4c4) for contrast.

## First viewport and interaction

The first community viewport identifies the product, offers Feed/Discover/Profile navigation, and shows actual content or an actionable empty state. Discover puts game search before rankings. A selected game puts the official requirements above a comparable table of real shared performance conditions. Spoilers are revealed deliberately. Public links work without authentication; mutations request sign-in.

## Required states

Anonymous, authenticated, empty, loading, failed upstream, no benchmark, incomplete legacy snapshot, spoiler, validation, upload failure, and restricted user states. No fabricated production benchmarks or implicit public library sharing. Local preview data is visibly labelled synthetic and never uses production data.

## Verification scope

Inspect desktop (1440px), mobile (390px), and relevant forms. Verify game search navigation, conditional public profiles, comments and likes, filter behavior, and sign-in fallback. Local IPC and configuration export require source/type/integration verification; a web screenshot is not proof of native FPS collection.
