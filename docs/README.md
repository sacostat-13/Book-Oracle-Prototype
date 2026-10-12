# Docs

| Folder | What lives there | Start with |
|---|---|---|
| [`reference/`](reference/) | How the code works today — kept current, changed in the same commit as the code | [ARCHITECTURE.md](reference/ARCHITECTURE.md), [MATH.md](reference/MATH.md) |
| [`specs/`](specs/) | Feature specs written before building: the intent and the decisions | the spec for the feature you're touching |
| [`sql/`](sql/) | Hand-run diagnostic and one-off fix queries. **Not migrations** — schema changes go in `supabase/migrations/` | read the header comment before running |
| [`audits/`](audits/) | Point-in-time audits and evaluations; dated, not kept current | — |
| [`archive/`](archive/) | Superseded notes kept for history | — |
| [`brand/`](brand/) | Logo, icons, social images and the script that builds them | [brand/README.md](brand/README.md) |

Other docs that live next to what they describe: [`src/styles/README.md`](../src/styles/README.md) (styling conventions), [`supabase/SETUP.md`](../supabase/SETUP.md) (migrations), [`batch-scripts/README.md`](../batch-scripts/README.md) (catalog scripts), [`CHANGELOG.md`](../CHANGELOG.md) (release history).

## reference/

| Doc | Read it when |
|---|---|
| [ARCHITECTURE.md](reference/ARCHITECTURE.md) | you're new, or changing how data flows (providers, data model, lookup chain, guest mode) |
| [MATH.md](reference/MATH.md) | you're changing any ranking, weight, threshold, match %, shuffle or key |
| [KEY_ROTATION.md](reference/KEY_ROTATION.md) | rotating Supabase keys |

## specs/

| Spec | Feature |
|---|---|
| [audiobook-progress-v1-spec.md](specs/audiobook-progress-v1-spec.md) | Audiobook progress (minutes vs pages) |
| [CURATED_LISTS_SPEC.md](specs/CURATED_LISTS_SPEC.md) | Curated Lists |
| [feature-discovery-v1-spec.md](specs/feature-discovery-v1-spec.md) | Feature discovery, public changelog |
| [oracle-provenance-v1-spec.md](specs/oracle-provenance-v1-spec.md) | Oracle provenance (logging recommendations) |
| [pro-tier-v1-spec.md](specs/pro-tier-v1-spec.md) | Pro tier — "Unlimited" rethink |
| [reader-editions-v1-spec.md](specs/reader-editions-v1-spec.md) | Reader editions (language, format) |
| [reading-accomplishments-v1-spec.md](specs/reading-accomplishments-v1-spec.md) | Reading accomplishments |
| [reading-memory-v1-spec.md](specs/reading-memory-v1-spec.md) | Reading memory |
| [shelf-filters-v1-spec.md](specs/shelf-filters-v1-spec.md) | Advanced shelf filters |

## sql/

Read-only unless marked **writes**.

| Query | Answers |
|---|---|
| [cleat-cute-diagnostic.sql](sql/cleat-cute-diagnostic.sql) | Why does one book show no genres? |
| [duplicate-books-diagnostic.sql](sql/duplicate-books-diagnostic.sql) | Which catalog rows are duplicates of one work? |
| [duplicate-read-books-diagnostic.sql](sql/duplicate-read-books-diagnostic.sql) | Why did an old read date come back after a correction? |
| [fix-sapphic-gothic-links.sql](sql/fix-sapphic-gothic-links.sql) | **writes** — surgical genre-link fix (alternative to `regenreCatalog --apply --replace`) |
| [generic-subjects-analysis.sql](sql/generic-subjects-analysis.sql) | Should generic subjects like "Fiction" become genres? |
| [placeholder-author-cleanup.sql](sql/placeholder-author-cleanup.sql) | **writes** — clean up placeholder authors |
| [stacks-genre-coverage.sql](sql/stacks-genre-coverage.sql) | How many books would show in The Stacks, per genre? |
| [subject-coverage.sql](sql/subject-coverage.sql) | How much evidence does the genre rule table have? |
| [unaddressable-book.sql](sql/unaddressable-book.sql) | Which book can't resolve through its own share key? |
| [ungenred-books-triage.sql](sql/ungenred-books-triage.sql) | Why are books still missing a genre? |
| [wrong-genre-audit.sql](sql/wrong-genre-audit.sql) | How far did the broad sapphic/lesbian-fiction rule reach? |

## audits/ and archive/

| Doc | |
|---|---|
| [DEAD_CLASS_AUDIT_v0.62.3.md](audits/DEAD_CLASS_AUDIT_v0.62.3.md) | Unstyled/unused CSS classes, and how to re-run the check |
| [SECURITY_AUDIT_v0.39.md](audits/SECURITY_AUDIT_v0.39.md) | Security audit (v0.39) |
| [isbndb-evaluation.md](audits/isbndb-evaluation.md) | ISBNdb evaluated for the metadata chain |
| [archive/UPDATE_V5.md](archive/UPDATE_V5.md) | v0.4 → v0.5 upgrade notes |

## Adding a doc

- New feature spec → `specs/<feature>-v1-spec.md`.
- New diagnostic → `sql/<question>.sql`, with a header comment saying what it answers and whether it writes.
- Changed a formula or the architecture → update `reference/` in the same commit.
