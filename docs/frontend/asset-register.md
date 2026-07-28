# Frontend Asset Register

> **Status:** Sources and license strategy approved; production files are created
> in later implementation phases
> **Rule:** No asset enters `frontend/public` without a register row, provenance,
> optimization check, and owner.

## License policy

- Project-specific chess pieces, avatars, lesson heroes, brand marks, and sounds
  are original project-owned work commissioned/created for CluChess.
- Fonts use SIL Open Font License 1.1.
- UI icons use Lucide under the ISC License.
- No asset is copied from the supplied UI references; they inform composition
  and art direction only.
- No scraped portrait, stock image with unclear model release, or unverified
  AI-generated likeness is permitted.
- Source files and a `LICENSES.md` attribution summary are retained with the
  frontend.

## Brand

| ID               | Planned path                             | Format   | Requirement                                            | License/owner | Phase |
| ---------------- | ---------------------------------------- | -------- | ------------------------------------------------------ | ------------- | ----- |
| `brand-wordmark` | `/brand/cluchess-wordmark.svg`           | SVG      | Ink and inverse variants, text outlined only in export | Project-owned | 2     |
| `brand-mark`     | `/brand/cluchess-mark.svg`               | SVG      | Distinct knight/club mark at 16–64 px                  | Project-owned | 2     |
| `favicon`        | `/icons/favicon.svg` and generated sizes | SVG/PNG  | Maskable and normal variants                           | Project-owned | 2     |
| `og-image`       | generated route/static asset             | PNG/WebP | Warm editorial board, no personal/game data            | Project-owned | 10/13 |

## Fonts

| Family             | Source                | Files/subsets         | License     | Runtime rule                                             | Status   |
| ------------------ | --------------------- | --------------------- | ----------- | -------------------------------------------------------- | -------- |
| Cormorant Garamond | Google Fonts upstream | Latin 500/600         | SIL OFL 1.1 | Self-host via `next/font`; display only                  | Approved |
| Manrope            | Google Fonts upstream | Latin 400/500/600/700 | SIL OFL 1.1 | Self-host via `next/font`; preload critical weights only | Approved |

Font license text must ship in the source distribution and license report.

## UI icons

| Set                          | Source/license      | Use                                | Restrictions                                   |
| ---------------------------- | ------------------- | ---------------------------------- | ---------------------------------------------- |
| Lucide                       | Lucide project, ISC | Navigation and standard UI actions | Import named icons only; normalize stroke/size |
| Chess-specific status glyphs | Project-owned       | Check, legal target, board state   | Must not replace text                          |

Do not mix icon families or use an icon without a visible label/accessible name
where meaning is not universally obvious.

## Live chess pieces

One original coherent set contains:

| Color | Pieces                                  | Planned source path                      | Production delivery     |
| ----- | --------------------------------------- | ---------------------------------------- | ----------------------- |
| White | king, queen, rook, bishop, knight, pawn | `assets/source/chess-pieces/white/*.svg` | Optimized sprite/module |
| Black | king, queen, rook, bishop, knight, pawn | `assets/source/chess-pieces/black/*.svg` | Optimized sprite/module |

Requirements:

- Project-owned original vectors.
- Clear silhouettes at 32 px.
- Warm ivory/ink rather than pure white/black.
- No embedded raster image, font, script, metadata, or external reference.
- SVGO review does not remove accessibility/shape-critical identifiers.
- Pieces share viewbox/baseline and do not shift between states.
- The 12-piece optimized payload has a measured budget in Phase 2.

## Guest avatars

The backend returns these exact keys. The frontend mapping is exhaustive:

| Backend key          | Planned path                       | Art direction                   | Alt strategy                                        | License       |
| -------------------- | ---------------------------------- | ------------------------------- | --------------------------------------------------- | ------------- |
| `knight_amber_01`    | `/avatars/knight-amber-01.webp`    | Amber horse/knight medallion    | Guest name labels identity; image can be decorative | Project-owned |
| `knight_bay_02`      | `/avatars/knight-bay-02.webp`      | Bay horse/knight medallion v2   | Same                                                | Project-owned |
| `knight_bay_03`      | `/avatars/knight-bay-03.webp`      | Bay horse/knight medallion v3   | Same                                                | Project-owned |
| `knight_black_01`    | `/avatars/knight-black-01.webp`    | Black horse/knight medallion    | Same                                                | Project-owned |
| `knight_chestnut_01` | `/avatars/knight-chestnut-01.webp` | Chestnut horse/knight medallion | Same                                                | Project-owned |
| `knight_gray_02`     | `/avatars/knight-gray-02.webp`     | Gray horse/knight medallion     | Same                                                | Project-owned |
| `knight_palomino_01` | `/avatars/knight-palomino-01.webp` | Palomino horse/knight medallion | Same                                                | Project-owned |
| `knight_white_02`    | `/avatars/knight-white-02.webp`    | White horse/knight medallion    | Same                                                | Project-owned |
| unknown fallback     | `/avatars/knight-fallback.svg`     | Neutral ink knight              | Same                                                | Project-owned |

Production variants:

- 64 × 64 and 128 × 128 WebP/AVIF where useful;
- SVG fallback;
- visible ring/connected state is UI, not baked into the image.

Unknown keys render the fallback and create a nonfatal contract telemetry event.

## Lesson hero art

| Piece  | Planned path              | Source master                | Delivery             | Status  |
| ------ | ------------------------- | ---------------------------- | -------------------- | ------- |
| King   | `/lesson-art/king.avif`   | Layered project-owned source | AVIF + WebP fallback | Planned |
| Queen  | `/lesson-art/queen.avif`  | Same                         | Same                 | Planned |
| Rook   | `/lesson-art/rook.avif`   | Same                         | Same                 | Planned |
| Bishop | `/lesson-art/bishop.avif` | Same                         | Same                 | Planned |
| Knight | `/lesson-art/knight.avif` | Same                         | Same                 | Planned |
| Pawn   | `/lesson-art/pawn.avif`   | Same                         | Same                 | Planned |

Art direction:

- tactile carved piece on parchment/charcoal;
- no cyan/neon/glow;
- room for text at responsive crops;
- no essential rule encoded only in the hero;
- explicit width/height and responsive `sizes`;
- decorative alt when adjacent heading identifies the piece.

## Sound

Sound is feature-flagged and off until user-enabled.

| Cue               | Planned file                    | Requirement                    | License                 |
| ----------------- | ------------------------------- | ------------------------------ | ----------------------- |
| Move confirmed    | `/sounds/move-confirmed.ogg`    | Short, soft wood placement     | Project-owned recording |
| Capture confirmed | `/sounds/capture-confirmed.ogg` | Distinct but not alarming      | Project-owned recording |
| Match found       | `/sounds/match-found.ogg`       | Single restrained cue          | Project-owned recording |
| Clock threshold   | `/sounds/clock-warning.ogg`     | Optional; not repeated rapidly | Project-owned recording |
| Game ended        | `/sounds/game-ended.ogg`        | Neutral outcome cue            | Project-owned recording |

No sound conveys unique information. Preload only after the user enables sound.

## Asset pipeline requirements

- Source masters live outside `public/`; optimized outputs are generated.
- Raster metadata is stripped.
- SVG is sanitized and optimized.
- Intrinsic dimensions are recorded.
- Visual regression covers transparent background, crop, and forced background.
- CI fails on unregistered production asset extensions/paths.
- Asset budget and duplicate detection run in Phase 2/11.
- `LICENSES.md` includes font/icon licenses and project-owned declaration.

## Phase 0 acceptance

- [x] Every backend avatar key has a planned frontend asset and fallback.
- [x] Live pieces use an original project-owned vector strategy.
- [x] Lesson heroes use original project-owned art, not copied references.
- [x] Font and icon licenses are named and compatible.
- [x] Sound is optional, original, and not the sole cue.
- [x] Optimization, provenance, and CI requirements are explicit.
