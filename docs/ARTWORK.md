# Private artwork

The desktop app supports one private image for each of the nine books and four
course plans. Book images appear in the overview, library and study workspace;
course images appear in the plan list and selected tracker. Open a book's study
workspace or a course tracker to choose, replace or reset its image. Resetting
removes only the local override and restores the neutral fallback.

The native picker accepts local PNG or JPEG files up to 10 MiB. Rust checks the
actual format and decodes at most 4096 × 4096 pixels with a bounded allocation.
It preserves aspect ratio while fitting the image within 1600 × 1600, then
stores a normalized PNG no larger than 10 MiB. Re-encoding removes source
metadata. The database retains no source filename, path or remote URL.

Images belong to the known book/course ID, so filtering or changing the visible
list order does not move covers between books. Cancelling the chooser or
rejecting an invalid image preserves the previous image. Imports and resets
change no reading, notes, quizzes, XP, mastery, projects, credentials or activity.
The interface uses local blob URLs and has no remote image host allowance in its
content security policy. Browser preview displays the neutral fallback and
disables local import.

Schema 9 stores normalized image bytes, dimensions and update timestamps in
`local_artwork`. The same workspace epoch and writer/restore gates used for
learning records protect image changes. Backups include images and validate
their known identities and decodable normalized content before restoration.
Keep backups private; they can contain licensed artwork as well as books.

Official book and course/provider images installed privately on the user's Mac
are not repository files, fixtures or release resources. The checked-in app
contains neutral fallbacks and the import feature. No general redistribution
permission is claimed. See [book sources](BOOK_ARTWORK.md) and
[course sources](COURSE_ARTWORK.md) for provenance and specific limitations.
Course illustrations and provider graphics do not establish an earned award.

The optional `src-tauri/examples/import_artwork.rs` helper accepts an existing
database and local files through the same Store validation API. It makes no
network requests and does not alter the curriculum. Use the desktop picker for
normal replacement; the helper exists for an explicit one-time local setup.
