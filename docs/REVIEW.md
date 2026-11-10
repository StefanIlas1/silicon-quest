# Scheduled review

The review queue schedules follow-up practice for topics with curated knowledge checks. It uses real backend grades, not reading status or elapsed study time. A quiz result, a review schedule and a portfolio milestone describe different evidence.

## Evidence and intervals

A passing first graded check counts as one qualifying success and schedules practice one day later. After any schedule exists, a pass qualifies only when its review is due. The second qualifying success schedules the next review three days later. The third qualifying success earns the schedule's **mastered** stage and schedules practice seven days later. Further due passes use 14-day and then 30-day intervals, with a 30-day cap. Days mean 24-hour periods measured from the qualifying attempt's UTC timestamp.

An early passed check is recorded as practice. It does not increase the qualifying-success streak, promote mastery or postpone the due date. An overdue pass schedules the next interval from the actual attempt time; it does not allow several immediate catch-up promotions.

A failed check resets the qualifying-success streak to zero and sets the review stage to `needs_review`. It schedules practice within one day. An earlier future due time is retained, so repeated failures cannot keep pushing that review farther away. After a failure, qualifying evidence must be built again. A due date alone does not erase a successful check or automatically become a failure.

These intervals are a transparent scheduling rule for this companion, not a measured prediction of memory retention. The mastered stage means repeated success on the available curated check; it does not mark a project complete or establish broad engineering competence.

## Current results and earned history

A topic's latest-check result is separate from repeated-review mastery. A later failure changes the current check result to `needs_review`; historical best score, original attempts and previously earned rewards remain. The first-pass reward is still awarded once per topic. Replaying the same attempt cannot award XP again, advance the schedule twice or create duplicate review evidence. A new qualifying due attempt advances evidence without another first-pass reward.

Schedule updates occur in the same SQLite transaction as the authoritative quiz attempt. There is no separate “mark reviewed” action. Due and upcoming entries come from persisted schedules. Topics without curated questions have no invented review schedule; topics with a check but no graded attempt remain not yet checked.

Migration 4 reconstructs schedules from all existing attempts in chronological order, including attempts beyond the most recent 100. It preserves the original quiz records and XP ledger. The old first-pass achievement keeps its earned date and is labeled “First Check Passed”; repeated review has its own evidence and achievement.

## Local data and verification

Review schedules and events stay in the local application database. Summary totals cover all scheduled topics, while displayed event history is limited to the most recent 100 events. Storage and due comparisons use UTC timestamps; the interface formats review dates in the learner’s local time. Backend grading returns both the attempt's scheduling event and the current authoritative summary; the interface protects newer results from stale summary requests.

Automated checks should cover first/early/due passes, exact due boundaries, failures and rebuilding evidence, maximum intervals, replay-safe grading, transaction rollback, migration chronology and unchanged repeat XP. UI checks should verify due/upcoming/not-yet-checked states, qualified versus early-practice feedback, latest-check versus repeated-mastery labels and stale-request protection.

No native scheduled-review UI smoke test is claimed. The historical reader smoke record describes its own earlier scope.

Before publication, independent local checks passed TypeScript, 32 frontend tests, the production UI build, 36 headless Rust tests, Rust formatting and curriculum integrity validation. The backend implementer also ran the desktop-feature tests. Tests cover queue refresh races, locked retry payloads, first/due/early practice feedback, chronological migration and phase-ordered reading recommendations.
