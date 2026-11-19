# Mini Drifters v0.6.0

The three circuits now have distinct, functional environments. Original becomes a club-racing circuit with paddock, garages, race control and grandstands. Switchback runs through a wooded hillside of pines, boulders, retaining walls and guardrails. Dockyard's containers and concrete barriers are solid, and its concrete apron drives like asphalt while staying off-course for drift scoring. Warehouses are solid but outside normal reachable play. Flat environmental details, loading markings and Dockyard corner boards remain decorative.

Significant scenery collisions report **HIT AN OBSTACLE**; perimeter walls and wall-like barriers keep **HIT THE WALL**. Collision response, thresholds and tuning are unchanged from the accepted R2 prototype.

Original and Switchback retain their established loose-surface behavior beyond the curbs. All three track layouts, Classic and Power handling, scoring formulas and scoring version stay unchanged. Gymkhana and Practice Pad retain their existing behavior.

## Records and media

Existing track, handling and scoring record identities are retained, including Dockyard. Older bests remain until surpassed through normal comparison and saving. No browser storage is cleared, and no environment-specific record partition or legacy display is added.

The README uses the owner's replacement PNG without visual modification. The owner explicitly accepted its different hash and dimensions on November 18, 2026: **2530 × 1266**, SHA-256 **38029503e4fdb19067e49b8c5d6a73f40b9ea4c571bf0857f1bf062728b48f67**. Its small v0.5.0 label is accepted. This is README artwork; the in-game title artwork is unchanged. The existing gameplay GIF is retained.

## Acceptance and known limits

The owner accepted R1/R2 environmental gameplay and scenery and authorized integration and release after qualification. Automated browser evidence uses headless Chromium and Firefox; controller checks use mocked devices and do not establish additional physical-device coverage.

**Dockyard's chicane shortcut remains unresolved by owner choice.** It can save approximately 1.6–1.8 seconds across the concrete. Its known regression is explicitly TODO, not passing. No chicane obstacles, checkpoint changes or track changes are included.

Switchback's gravel shoulders and bare earth retain grass-surface physics; tree canopies can overlap the car visually. Switchback is the most expensive circuit to draw in headless browsers. The historical [R1](ENVIRONMENT-R1.md) and [R2](ENVIRONMENT-R2.md) reports retain prototype measurements and limitations; their earlier open approval gates were superseded by the owner's release brief.
