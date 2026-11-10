# Private book artwork

The nine book covers installed on this Mac are private local data, stored in
`local_artwork` inside the app's SQLite database. They are not source assets,
build resources, or runtime network requests. The original downloads and source
manifest are in the app-data `private-cover-sources` directory, outside this
repository. Local backups include imported artwork: keep those backups private.

Use **Choose local cover** in a book's study workspace to replace its image, or **Reset
cover** to return to the original generated placeholder. Image selection is local
only. Importing artwork does not change reading progress, notes, quiz history, or
XP.

## Sources checked on November 10, 2026

| Book | Source and edition evidence |
| --- | --- |
| Computer Systems: A Programmer's Perspective | [Author site](https://csapp.cs.cmu.edu/); its `/3e/images/csapp3e-cover.jpg` image explicitly says third edition. |
| Optimized C++ | [O'Reilly catalog](https://www.oreilly.com/library/view/optimized-c/9781491922057/), ISBN 9781491922057; catalog cover endpoint. |
| Operating Systems: Three Easy Pieces | [Author site](https://pages.cs.wisc.edu/~remzi/OSTEP/), `book-cover-two.jpg`. The comet artwork does not print a version number; it is not proof of a particular PDF version. |
| Programming Massively Parallel Processors | [Elsevier catalog](https://shop.elsevier.com/books/programming-massively-parallel-processors/hwu/978-0-443-43900-1), fifth edition, ISBN 9780443439001; publisher cover explicitly says fifth edition. |
| Computer Architecture: A Quantitative Approach | [Elsevier catalog](https://shop.elsevier.com/books/computer-architecture/hennessy/978-0-443-15406-5), seventh edition, ISBN 9780443154065; includes Christos Kozyrakis, matching ROADMAP.md. |
| Digital Design and Computer Architecture: ARM Edition | [Elsevier catalog](https://www.educate.elsevier.com/book/details/9780128000564), ISBN 9780128000564; cover explicitly says ARM Edition. |
| Parallel Programming for FPGAs | [Author site](https://kastner.ucsd.edu/hlsbook/), its `hls_book_cover.jpg` cover. Ryan Kastner, Janarbek Matai, and Stephen Neuendorffer; the book is [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). |
| The Zynq Book | [Author site](https://www.zynqbook.com/), its English `images/ZyncBook.webp` cover; local format conversion to PNG. Author page identifies 2014, ISBN 9780992978709. |
| Efficient Processing of Deep Neural Networks | [Springer catalog](https://link.springer.com/book/10.1007/978-3-031-01766-7), first edition, eBook ISBN 9783031017667. Springer reissue cover from its official media endpoint; the authors match the roadmap. |

Availability on an official site does not itself grant repository redistribution
rights. No public redistribution license was established for the eight covers
other than the HLS book. O'Reilly's [permissions page](https://www.oreilly.com/rights/)
and Elsevier's [permissions process](https://www.elsevier.com/about/policies-and-standards/copyright/permissions)
provide routes for requesting that permission. Do not add private source images
or SQLite backups to the public repository.

## Repeatable local setup

The optional example uses the same image validation and database safeguards as
the desktop importer. It accepts existing local image files and never downloads
anything. Close the app before running it.

```sh
cargo run --manifest-path src-tauri/Cargo.toml --example import_artwork -- \
  "/path/to/existing/silicon-quest.sqlite3" book csapp "/path/to/cover.jpg"
```

Additional `KIND ITEM_ID IMAGE` triples can be supplied in the same invocation.
The command requires an existing database, accepts known catalog IDs, and stores
validated PNG bytes rather than the source filename or source path.
