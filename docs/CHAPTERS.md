# Manual chapter indexes

Each book has a private, user-entered chapter index above its PDF reader. Add
titles from your edition's contents, choose an order, record self-reported
reading status and keep chapter notes. The index works before a PDF is imported.
No table of contents is bundled, inferred from roadmap modules or extracted
automatically. Chapter reading awards no XP and changes no quiz/review mastery.

Chapters have stable IDs independent of their titles and positions. Editing a
title, reordering it or replacing the PDF preserves its status and notes. The
backend stores these records in schema 8's `book_chapters` table. Each book is
limited to 500 chapters; titles have a 200-character limit, order is a whole
number from 1 to 10000, and each note is limited to 20 KB. Equal order values
are allowed and sort by stable ID. This version supports adding and editing;
there is no chapter-deletion interface.

## Page mappings

An optional range uses the PDF reader's one-based page numbers, which may differ
from printed page labels. Enter both ends or use the current page as a starting
point. The interface checks the loaded document's page count; storage validates
integer bounds and the current opaque PDF revision when a mapping changes.
Choosing the range opens its first page in the reader.

Reimporting identical bytes preserves the document revision and mapping.
Replacing the PDF retains the old range for reference but disables its jump
link. Re-enter the range for the replacement or clear it. An unchanged old
mapping can remain attached while you edit notes or status; it never silently
rebinds to a different PDF.

## Saves and drafts

Desktop saves persist in local SQLite. Optimistic versions reject an edit made
against an older chapter snapshot, retaining the draft for review. Reloading
after an error explicitly discards the draft. Editing a chapter does not
overwrite another book's chapter identity. Save operations share the workspace
epoch and backup/restore writer protections.

Unsaved drafts are kept per book while the app remains open, including when
navigating to another page or book. They are not written to disk until saved.
Settings warns about chapter drafts before exporting or restoring a backup.
Saved indexes, notes, reading state and mappings round-trip in schema 8 backups;
restoring discards unsaved drafts and requires restart.

Browser preview uses temporary component state for saved chapters and offers
no durable storage. Saved preview chapters clear when leaving the reader;
unsaved per-book drafts remain in memory while the app stays open. This preview
boundary is distinct from desktop persistence.
Keep personal notes, PDFs and exported databases outside the source repository.

Changed reading status other than a reset to not started, and changed nonempty
notes, contribute a local activity day. Title/order/page metadata changes,
unchanged saves and clearing notes do not create study activity.

## Verification boundary

Isolated Rust tests cover fresh/legacy schemas, validation, stable identities,
version conflicts, PDF replacement, activity qualification and backup/restore.
Component/integration tests cover chapter entry before PDF import, reading/notes,
page mappings, stale mappings, retained drafts across navigation and backup
warnings. Browser visual checks inspected the reader and chapter editor; they
do not establish native dialog or durable chapter behavior. No native chapter
GUI smoke test is claimed.
