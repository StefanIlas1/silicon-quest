/** Source-grounded, provisional topic groupings. See source-roadmap.md. */
import seed from './public-data.json';
export const { roadmapMeta, books, phases, projects, credentials, modules, measurementRules } = seed;
// Correct answers are deliberately not exported to application UI code.
// The backend grades attempts using the authoritative JSON seed.
export const quizQuestions = seed.quizQuestions;
export const curriculum = { roadmapMeta, books, phases, projects, credentials, modules, quizQuestions, measurementRules };
export type Book = typeof books[number];
export type Phase = typeof phases[number];
export type Project = typeof projects[number];
export type Credential = typeof credentials[number];
export type Module = typeof modules[number];
export type QuizQuestion = typeof quizQuestions[number];
export default curriculum;
