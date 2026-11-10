import { invoke, isTauri } from "@tauri-apps/api/core";
export type Status = "not_started" | "reading" | "read";
export type TopicProgress = {
  topicId: string;
  status: Status;
  mastery: "untested" | "needs_review" | "passed";
  bestScore: number | null;
  lastStudiedAt: string | null;
};
export type Attempt = {
  attemptId: string;
  topicId: string;
  score: number;
  total: number;
  passed: boolean;
  xpAwarded: number;
  createdAt: string;
};
export type Dashboard = {
  topics: TopicProgress[];
  totalXp: number;
  level: number;
  achievements: { id: string; title: string; earnedAt: string }[];
  attempts: Attempt[];
  notes: { topicId: string; body: string; updatedAt: string }[];
  streakDays: number;
};
export type Quiz = {
  topicId: string;
  questions: { id: string; prompt: string; options: string[] }[];
};
export type QuizResult = {
  attempt: Attempt;
  feedback: {
    questionId: string;
    correct: boolean;
    correctIndex: number;
    explanation: string;
  }[];
  dashboard: Dashboard;
};
export const native = isTauri();
export const emptyDashboard: Dashboard = {
  topics: [],
  totalXp: 0,
  level: 1,
  achievements: [],
  attempts: [],
  notes: [],
  streakDays: 0,
};
export const api = {
  dashboard: () => invoke<Dashboard>("get_dashboard"),
  status: (topicId: string, status: Status) =>
    invoke<Dashboard>("set_topic_status", { topicId, status }),
  note: (topicId: string, body: string) =>
    invoke<Dashboard>("save_note", { topicId, body }),
  quiz: (topicId: string) => invoke<Quiz>("get_quiz", { topicId }),
  submit: (topicId: string, answers: number[], attemptId: string) =>
    invoke<QuizResult>("submit_quiz", { topicId, answers, attemptId }),
};

export function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error)
    return String(error.message);
  return String(error);
}
