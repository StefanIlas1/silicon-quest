import { lazy, Suspense, useEffect, useState } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  BookOpen,
  Bookmark,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Code2,
  Cpu,
  Flame,
  FolderGit2,
  GraduationCap,
  LayoutDashboard,
  Map,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  X,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  books,
  phases,
  projects,
  credentials,
  modules,
  measurementRules,
  quizQuestions,
} from "../curriculum/data";
import { api, emptyDashboard, native, errorMessage } from "./backend";
import type { Dashboard, Quiz, QuizResult, Status } from "./backend";
const Reader = lazy(() => import("./Reader"));
type Page =
  | "dashboard"
  | "library"
  | "roadmap"
  | "projects"
  | "achievements"
  | "settings"
  | "reader";
type Module = (typeof modules)[number];
const nav: { id: Page; label: string; icon: LucideIcon }[] = [
  { id: "dashboard", label: "Overview", icon: LayoutDashboard },
  { id: "library", label: "Book library", icon: BookOpen },
  { id: "roadmap", label: "Learning path", icon: Map },
  { id: "projects", label: "Projects", icon: FolderGit2 },
  { id: "achievements", label: "Achievements", icon: Trophy },
];
const quizModuleIds = new Set(quizQuestions.map((q) => q.moduleId));
const trackClass = (track: string) =>
  track.toLowerCase().includes("fpga")
    ? "purple"
    : track.toLowerCase().includes("cuda") ||
        track.toLowerCase().includes("gpu")
      ? "green"
      : "cyan";
export default function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [dashboard, setDashboard] = useState<Dashboard>(emptyDashboard);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(native);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [bookId, setBookId] = useState(books[0]?.id ?? "csapp");
  const [topicId, setTopicId] = useState(modules[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [track, setTrack] = useState("all");
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [quizResult, setQuizResult] = useState<QuizResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [attemptId, setAttemptId] = useState("");
  const book = books.find((b) => b.id === bookId) ?? books[0];
  const topic = modules.find((m) => m.id === topicId) ?? modules[0];
  const currentProgress = dashboard.topics.find((p) => p.topicId === topicId);
  const done = dashboard.topics.filter((p) => p.mastery === "passed").length;
  const reading = dashboard.topics.filter(
    (p) => p.status === "reading" || p.status === "read",
  ).length;
  const nextTopic =
    modules.find(
      (m) =>
        dashboard.topics.find((p) => p.topicId === m.id)?.status !== "read",
    ) ?? modules[0];
  useEffect(() => {
    if (native)
      api
        .dashboard()
        .then((d) => {
          setDashboard(d);
          setConnected(true);
        })
        .catch((e) => setError(errorMessage(e)))
        .finally(() => setLoading(false));
  }, []);
  const savedNote =
    dashboard.notes.find((n) => n.topicId === topicId)?.body ?? "";
  const note = noteDrafts[topicId] ?? savedNote;
  function setNote(value: string) {
    setNoteDrafts((previous) => ({ ...previous, [topicId]: value }));
  }
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  const writable = native && connected;
  const hasQuiz = quizModuleIds.has(topicId);
  const topicHasBook = !!topic.bookId;
  function openTopic(m: Module) {
    setTopicId(m.id);
    if (m.bookId) setBookId(m.bookId);
    setPage("reader");
  }
  function openBook(id: string) {
    setBookId(id);
    const m = modules.find((m) => m.bookId === id);
    if (m) setTopicId(m.id);
    setPage("reader");
  }
  async function changeStatus(status: Status) {
    if (!writable) return;
    setBusy(true);
    try {
      setDashboard(await api.status(topicId, status));
      setNotice(
        status === "read"
          ? "Reading recorded. Test your understanding when you are ready."
          : "Reading status saved.",
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function saveNote() {
    if (!writable) return;
    setBusy(true);
    try {
      setDashboard(await api.note(topicId, note));
      setNotice("Note saved on this device.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function startQuiz(m: Module) {
    if (!writable) {
      setError(
        "Knowledge checks require the desktop app and its local database. Run npm run tauri dev.",
      );
      return;
    }
    setBusy(true);
    try {
      const q = await api.quiz(m.id);
      setTopicId(m.id);
      setQuiz(q);
      setQuizResult(null);
      setAnswers(q.questions.map(() => -1));
      setAttemptId(crypto.randomUUID());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function submitQuiz() {
    if (!quiz || answers.some((a) => a < 0)) return;
    setBusy(true);
    try {
      const result = await api.submit(quiz.topicId, answers, attemptId);
      setQuizResult(result);
      setDashboard(result.dashboard);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setPage("dashboard")}>
          <span className="brand-mark">
            <Cpu size={24} />
          </span>
          <span>
            silicon<span className="brand-light">quest</span>
            <small>THE PERFORMANCE PATH</small>
          </span>
        </button>
        <div className="workspace-label">
          YOUR WORKSPACE <span>LOCAL</span>
        </div>
        <nav aria-label="Main navigation">
          {nav.map((n) => (
            <button
              key={n.id}
              className={page === n.id ? "active" : ""}
              onClick={() => setPage(n.id)}
            >
              <n.icon size={18} />
              {n.label}
              {n.id === "library" && <small>{books.length}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" />
        <div className="workspace-label">CURRENT CHAPTER</div>
        <button className="current-phase" onClick={() => setPage("roadmap")}>
          <span className="phase-symbol">01</span>
          <span>
            Build your foundations<small>C++ · Systems · Digital logic</small>
          </span>
          <ChevronRight size={15} />
        </button>
        <div className="sidebar-bottom">
          <div className="local-note">
            <ShieldCheck size={15} />
            <span>
              Private by design<small>Your learning stays on your Mac.</small>
            </span>
          </div>
          <button
            className={page === "settings" ? "profile active" : "profile"}
            onClick={() => setPage("settings")}
          >
            <span className="avatar">S</span>
            <span>
              Systems explorer
              <small>
                Level {dashboard.level} · {dashboard.totalXp} XP
              </small>
            </span>
            <Settings2 size={17} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <span className="topbar-workspace">Workspace</span>
            <ChevronRight size={14} />
            <span>
              {page === "reader"
                ? "Book reader"
                : (nav.find((n) => n.id === page)?.label ?? "Settings")}
            </span>
          </div>
          <div className="topbar-right">
            <span className="local-pill">
              <i />
              {writable
                ? "Local database connected"
                : loading
                  ? "Connecting…"
                  : "Browser preview"}
            </span>
            <span className="topbar-date">NOV 2026 · YOUR OWN PACE</span>
          </div>
        </header>
        {!native && (
          <div className="preview-banner">
            <ShieldCheck size={15} />
            <span>
              Browser preview. Durable progress, notes, and graded quizzes are
              available in the desktop app.
            </span>
            <code>npm run tauri dev</code>
          </div>
        )}
        {native && !connected && !loading && (
          <div className="preview-banner warning">
            The local database is unavailable. Progress controls are disabled.{" "}
            {error}
          </div>
        )}
        <main
          className={
            page === "reader" ? "main-content reader-content" : "main-content"
          }
        >
          {page === "dashboard" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    <span className="tiny-line" />
                    BUILD. MEASURE. UNDERSTAND.
                  </div>
                  <h1>
                    Your next level starts here<span>.</span>
                  </h1>
                  <p>
                    One concept, one experiment, one step closer to the
                    hardware.
                  </p>
                </div>
                <div className="chapter-pill">
                  <span className="pulse-dot" />
                  PHASE 01 <span>/ 07</span>
                </div>
              </div>
              <div className="stats-grid">
                <Stat
                  icon={Zap}
                  label="TOTAL EXPERIENCE"
                  value={String(dashboard.totalXp)}
                  suffix="XP"
                  detail="Reading & knowledge check rewards"
                  color="cyan"
                />
                <Stat
                  icon={Target}
                  label="TOPICS MASTERED"
                  value={String(done)}
                  suffix={`/ ${quizModuleIds.size}`}
                  detail="Passed checks, not just pages read"
                  color="purple"
                />
                <Stat
                  icon={Flame}
                  label="LEARNING STREAK"
                  value={String(dashboard.streakDays)}
                  suffix={dashboard.streakDays === 1 ? "day" : "days"}
                  detail="A little progress compounds"
                  color="orange"
                />
              </div>
              <div className="dashboard-grid">
                <section className="continue-card">
                  <div className="continue-copy">
                    <div className="eyebrow cyan-text">
                      <BookOpen size={14} />{" "}
                      {reading ? "CONTINUE YOUR JOURNEY" : "YOUR FIRST STEP"}
                    </div>
                    <h2>{nextTopic.title}</h2>
                    <p>{nextTopic.summary}</p>
                    <div className="meta-row">
                      <span>PHASE 01</span>
                      <i /> <span>FOUNDATIONS</span>
                      <i />
                      <span>GUIDED STUDY</span>
                    </div>
                    <button
                      className="primary-button"
                      onClick={() => openTopic(nextTopic)}
                    >
                      {reading ? "Continue learning" : "Start learning"}
                      <ArrowRight size={17} />
                    </button>
                  </div>
                  <div className="chip-art" aria-hidden="true">
                    <div className="chip-orbit orbit-1" />
                    <div className="chip-orbit orbit-2" />
                    <div className="circuit-line c1" />
                    <div className="circuit-line c2" />
                    <div className="circuit-line c3" />
                    <div className="chip-core">
                      <Cpu size={66} strokeWidth={1} />
                      <span>FOUNDATION</span>
                    </div>
                    <span className="chip-coordinate">0x0000 → ∞</span>
                  </div>
                </section>
                <section className="level-card">
                  <div className="card-topline">
                    <span className="eyebrow">EXPLORER PROFILE</span>
                    <Sparkles size={16} />
                  </div>
                  <div className="level-badge">
                    <Cpu size={31} />
                  </div>
                  <h3>Level {dashboard.level}</h3>
                  <p>Systems explorer</p>
                  <div className="level-progress">
                    <span>Progress to next level</span>
                    <strong>{dashboard.totalXp % 250} / 250 XP</strong>
                  </div>
                  <div className="progress-bar">
                    <span
                      style={{
                        width: `${((dashboard.totalXp % 250) / 250) * 100}%`,
                      }}
                    />
                  </div>
                  <small>Understanding is the real upgrade.</small>
                </section>
              </div>
              <div className="section-heading">
                <div>
                  <h2>Your learning tracks</h2>
                  <p>Three disciplines. One systems mindset.</p>
                </div>
                <button
                  className="text-button"
                  onClick={() => setPage("roadmap")}
                >
                  Explore the roadmap
                  <ArrowRight size={15} />
                </button>
              </div>
              <div className="tracks-grid">
                {[
                  {
                    title: "C++ & CPU systems",
                    tag: "THE FOUNDATION",
                    tone: "cyan",
                    icon: Code2,
                    desc: "Go from code to caches. Build correct, measurable low-latency systems.",
                    count: "Months 1–4",
                    filter: "C++",
                  },
                  {
                    title: "CUDA & GPU performance",
                    tag: "THE PARALLEL PATH",
                    tone: "green",
                    icon: Zap,
                    desc: "Think in warps, move less data, and build kernels that earn their speed.",
                    count: "Months 5–9",
                    filter: "CUDA",
                  },
                  {
                    title: "FPGA & digital design",
                    tag: "THE HARDWARE LAYER",
                    tone: "purple",
                    icon: Cpu,
                    desc: "Design the datapath. From your first RTL testbench to an AI accelerator.",
                    count: "Parallel from month 1",
                    filter: "FPGA",
                  },
                ].map((t) => (
                  <button
                    className={`track-card ${t.tone}`}
                    key={t.title}
                    onClick={() => {
                      setTrack(t.filter);
                      setPage("roadmap");
                    }}
                  >
                    <div className="track-card-top">
                      <span className="track-icon">
                        <t.icon size={21} />
                      </span>
                      <ArrowDownLeft size={17} />
                    </div>
                    <span className="eyebrow">{t.tag}</span>
                    <h3>{t.title}</h3>
                    <p>{t.desc}</p>
                    <div className="track-footer">
                      <span>{t.count}</span>
                      <ChevronRight size={17} />
                    </div>
                  </button>
                ))}
              </div>
              <div className="bottom-grid">
                <section className="panel">
                  <div className="section-heading compact">
                    <h2>On your bookshelf</h2>
                    <button
                      className="text-button"
                      onClick={() => setPage("library")}
                    >
                      View library
                      <ArrowRight size={14} />
                    </button>
                  </div>
                  {books.slice(0, 2).map((b, i) => (
                    <button
                      className="book-list-row"
                      onClick={() => openBook(b.id)}
                      key={b.id}
                    >
                      <BookCover title={b.title} index={i} mini />
                      <span>
                        <strong>{b.title}</strong>
                        <small>{b.authors}</small>
                        <em>
                          {dashboard.topics.some(
                            (t) =>
                              modules.find((m) => m.id === t.topicId)
                                ?.bookId === b.id && t.status !== "not_started",
                          )
                            ? "In progress"
                            : "Ready when you are"}
                        </em>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                </section>
                <section className="principle-card">
                  <span className="eyebrow">
                    <ShieldCheck size={14} /> THE ENGINEER’S RULE
                  </span>
                  <h3>
                    Evidence before
                    <br />
                    optimization.
                  </h3>
                  <p>
                    Correctness first. Establish a baseline. Change one thing.
                    Keep the measurements.
                  </p>
                  <button
                    className="text-button"
                    onClick={() => setPage("projects")}
                  >
                    Build something measurable
                    <ArrowRight size={15} />
                  </button>
                </section>
              </div>
            </>
          )}
          {page === "library" && (
            <>
              <PageHeading
                eyebrow="THE KNOWLEDGE LAYER"
                title="Your technical bookshelf."
                description="Selective reading, connected to the work. Bring your own PDFs; keep them local."
              />
              <div className="filter-bar">
                <label className="search-field">
                  <Search size={17} />
                  <input
                    placeholder="Find a book, author, or topic…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <span>{books.length} curated resources</span>
              </div>
              <div className="library-grid">
                {books
                  .filter((b) =>
                    `${b.title} ${b.authors} ${b.focus}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  )
                  .map((b, i) => (
                    <button
                      className="library-card"
                      key={b.id}
                      onClick={() => openBook(b.id)}
                    >
                      <div className="book-cover-area">
                        <BookCover title={b.title} index={i} />
                        <span className="book-order">
                          {String(b.order).padStart(2, "0")}
                        </span>
                      </div>
                      <div className="library-card-copy">
                        <span className="eyebrow">
                          SELECTIVE STUDY · {b.hours[0]}–{b.hours[1]} H
                        </span>
                        <h3>{b.title}</h3>
                        <p>{b.authors}</p>
                        <div className="library-card-footer">
                          <span>Open study workspace</span>
                          <ArrowRight size={16} />
                        </div>
                      </div>
                    </button>
                  ))}
              </div>
              <p className="muted-footnote">
                Books are study references. No commercial book text is bundled.
                Topic outlines are provisional and do not claim chapter-level
                coverage.
              </p>
            </>
          )}
          {page === "roadmap" && (
            <>
              <PageHeading
                eyebrow="THE LONG GAME"
                title="Depth, one layer at a time."
                description="A flexible 15–18 month path from systems foundations to hardware-aware AI inference."
              />
              <div className="tabs">
                {["all", "C++", "CUDA", "FPGA"].map((t) => (
                  <button
                    className={track === t ? "selected" : ""}
                    key={t}
                    onClick={() => setTrack(t)}
                  >
                    {t === "all" ? "Full roadmap" : t}
                  </button>
                ))}
              </div>
              <div className="roadmap-list">
                {phases
                  .filter(
                    (p) =>
                      track === "all" ||
                      (track === "C++" &&
                        ["phase-1", "phase-2"].includes(p.id)) ||
                      (track === "CUDA" &&
                        ["phase-3", "phase-4"].includes(p.id)) ||
                      track === "FPGA",
                  )
                  .map((p, i) => (
                    <section className="phase-card" key={p.id}>
                      <div className="phase-number">
                        {String(phases.indexOf(p) + 1).padStart(2, "0")}
                        <span />
                      </div>
                      <div className="phase-body">
                        <div className="card-topline">
                          <span className="eyebrow">MONTHS {p.months}</span>
                          <span className="small-tag">
                            {phases.indexOf(p) === 0
                              ? "START HERE"
                              : "ON YOUR HORIZON"}
                          </span>
                        </div>
                        <h2>{p.title}</h2>
                        <p>{p.focus}</p>
                        <div className="module-list">
                          {modules
                            .filter(
                              (m) =>
                                m.phaseId === p.id &&
                                (track === "all" ||
                                  track !== "FPGA" ||
                                  m.track.toLowerCase().includes("fpga")),
                            )
                            .map((m) => (
                              <button key={m.id} onClick={() => openTopic(m)}>
                                <span
                                  className={`module-dot ${trackClass(m.track)}`}
                                >
                                  {dashboard.topics.find(
                                    (t) => t.topicId === m.id,
                                  )?.mastery === "passed" ? (
                                    <Check size={13} />
                                  ) : (
                                    <Circle size={10} />
                                  )}
                                </span>
                                <span>
                                  {m.title}
                                  <small>{m.track}</small>
                                </span>
                                <ChevronRight size={16} />
                              </button>
                            ))}
                        </div>
                        <div className="exit-criteria">
                          <FlagIcon />
                          <span>
                            <strong>Exit artifact</strong>
                            {p.exitCriteria}
                          </span>
                        </div>
                        {track === "FPGA" && (
                          <p className="parallel-note">{p.parallelTrack}</p>
                        )}
                      </div>
                    </section>
                  ))}
              </div>
            </>
          )}
          {page === "projects" && (
            <>
              <PageHeading
                eyebrow="TURN KNOWLEDGE INTO EVIDENCE"
                title="Four projects. Real depth."
                description="Portfolio work built around correctness, controlled experiments, and reproducible results."
              />
              <div className="project-grid">
                {projects.map((p, i) => (
                  <section
                    className={`project-card ${i === 0 ? "cyan" : i === 3 ? "purple" : "green"}`}
                    key={p.id}
                  >
                    <div className="card-topline">
                      <span className="project-number">PROJECT 0{i + 1}</span>
                      <FolderGit2 size={23} />
                    </div>
                    <h2>{p.title}</h2>
                    <code>{p.repo}</code>
                    <p>{p.summary}</p>
                    <div className="milestone-list">
                      {p.milestones.slice(0, 4).map((m) => (
                        <div key={m}>
                          <Circle size={12} />
                          <span>{m}</span>
                        </div>
                      ))}
                    </div>
                    <div className="small-tag">EVIDENCE NOT YET RECORDED</div>
                  </section>
                ))}
              </div>
              <section className="panel measurement-panel">
                <h2>The measurement contract</h2>
                <p>
                  Every performance claim needs a trail someone else can follow.
                </p>
                <div className="rules-grid">
                  {measurementRules.map((r, i) => (
                    <div key={i}>
                      <span>{String(i + 1).padStart(2, "0")}</span>
                      <p>{typeof r === "string" ? r : JSON.stringify(r)}</p>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
          {page === "achievements" && (
            <>
              <PageHeading
                eyebrow="EARNED, NEVER ASSUMED"
                title="Milestones that mean something."
                description="Knowledge checks reward understanding. Your reading status alone never claims mastery."
              />
              <div className="achievement-summary">
                <Trophy size={36} />
                <div>
                  <h2>{dashboard.achievements.length} achievements earned</h2>
                  <p>
                    {dashboard.totalXp} verified XP ·{" "}
                    {dashboard.attempts.length} submitted knowledge checks
                  </p>
                </div>
              </div>
              <div className="achievement-grid">
                {dashboard.achievements.length ? (
                  dashboard.achievements.map((a) => (
                    <section className="panel earned-achievement" key={a.id}>
                      <Trophy size={30} />
                      <h3>{a.title}</h3>
                      <p>Earned {new Date(a.earnedAt).toLocaleDateString()}</p>
                    </section>
                  ))
                ) : (
                  <section className="panel empty-achievements">
                    <div className="empty-icon">
                      <Trophy size={30} />
                    </div>
                    <h2>Your first milestone is ahead.</h2>
                    <p>
                      Read a topic, explain it in your own words, then take a
                      knowledge check.
                    </p>
                    <button
                      className="primary-button"
                      onClick={() => openTopic(nextTopic)}
                    >
                      Begin with the foundations
                      <ArrowRight size={16} />
                    </button>
                  </section>
                )}
              </div>
              <section className="panel history-panel">
                <h2>Knowledge check history</h2>
                {dashboard.attempts.length ? (
                  dashboard.attempts
                    .slice()
                    .reverse()
                    .map((a) => (
                      <div className="history-row" key={a.attemptId}>
                        <span>
                          {modules.find((m) => m.id === a.topicId)?.title ??
                            a.topicId}
                          <small>
                            {new Date(a.createdAt).toLocaleString()}
                          </small>
                        </span>
                        <span>
                          {a.score}/{a.total}
                        </span>
                        <span className={a.passed ? "cyan-text" : "muted"}>
                          {a.passed ? "Passed" : "Review suggested"}
                        </span>
                        <strong>+{a.xpAwarded} XP</strong>
                      </div>
                    ))
                ) : (
                  <p className="empty-copy">No attempts recorded yet.</p>
                )}
              </section>
            </>
          )}
          {page === "settings" && (
            <>
              <PageHeading
                eyebrow="YOUR WORKSPACE"
                title="Quiet tools. Clear boundaries."
                description="A local learning companion with a transparent source of truth."
              />
              <div className="settings-grid">
                <section className="panel">
                  <ShieldCheck size={26} className="cyan-text" />
                  <h2>Private by design</h2>
                  <p>
                    Progress, quiz attempts, notes, and imported PDFs live in
                    the desktop app’s local storage. No account or cloud sync is
                    required.
                  </p>
                  <div className="setting-row">
                    <span>Database connection</span>
                    <strong>
                      {writable
                        ? "Connected"
                        : native
                          ? "Unavailable"
                          : "Desktop app required"}
                    </strong>
                  </div>
                  <div className="setting-row">
                    <span>Curriculum source</span>
                    <strong>ROADMAP.md</strong>
                  </div>
                  <div className="setting-row">
                    <span>Starting point</span>
                    <strong>November 2026</strong>
                  </div>
                </section>
                <section className="panel">
                  <GraduationCap size={26} className="purple-text" />
                  <h2>Credentials are optional</h2>
                  <p>
                    Certificates support your projects. Prices and availability
                    from the plan need verification before purchasing.
                  </p>
                  {credentials.map((c) => (
                    <a
                      className="credential-link"
                      key={c.id}
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span>
                        {c.title}
                        <small>{c.kind}</small>
                      </span>
                      <ArrowRight size={15} />
                    </a>
                  ))}
                </section>
              </div>
            </>
          )}
          {page === "reader" && (
            <>
              <div className="reader-heading">
                <button
                  className="icon-button"
                  aria-label="Back to library"
                  onClick={() => setPage("library")}
                >
                  <ChevronLeft size={21} />
                </button>
                <div>
                  <span className="eyebrow">STUDY WORKSPACE</span>
                  <h1>{topicHasBook ? book.title : topic.title}</h1>
                </div>
                <span className="small-tag">
                  {topicHasBook ? "LOCAL PDF" : "ROADMAP TOPIC"}
                </span>
              </div>
              <div className="study-layout">
                <section className="study-document">
                  <>
                    {topicHasBook ? (
                      <Suspense
                        fallback={
                          <div className="document-empty">
                            <p>Opening local reader…</p>
                          </div>
                        }
                      >
                        <Reader
                          key={book.id}
                          bookId={book.id}
                          title={book.title}
                          onError={setError}
                        />
                      </Suspense>
                    ) : (
                      <div className="document-empty roadmap-topic">
                        <div className="empty-icon">
                          <Cpu size={32} />
                        </div>
                        <span className="eyebrow">ROADMAP STUDY WORKSPACE</span>
                        <h2>{topic.title}</h2>
                        <p>{topic.summary}</p>
                        <small>
                          This topic has no assigned book. Use the guide, notes,
                          and project exercise alongside your own resources.
                        </small>
                      </div>
                    )}
                  </>
                </section>
                <aside className="study-sidebar">
                  <div className="study-tabs">
                    <span>
                      <Bookmark size={15} />
                      Study guide
                    </span>
                    <span className="small-tag">PROVISIONAL</span>
                  </div>
                  <div className="study-scroll">
                    <label className="topic-picker">
                      STUDY TOPIC
                      <select
                        value={topicId}
                        onChange={(e) => setTopicId(e.target.value)}
                      >
                        {modules
                          .filter((m) =>
                            topicHasBook ? m.bookId === book.id : !m.bookId,
                          )
                          .map((m) => (
                            <option value={m.id} key={m.id}>
                              {m.title}
                            </option>
                          ))}
                      </select>
                      <ChevronDown size={14} />
                    </label>
                    <span className={`eyebrow ${trackClass(topic.track)}-text`}>
                      {topic.track}
                    </span>
                    <h2>{topic.title}</h2>
                    <p>{topic.summary}</p>
                    <div className="guide-section">
                      <h3>What to understand</h3>
                      {topic.objectives.map((o) => (
                        <div className="objective" key={o}>
                          <span />
                          <p>{o}</p>
                        </div>
                      ))}
                    </div>
                    <div className="exercise-box">
                      <span className="eyebrow">
                        <Code2 size={14} />
                        PUT IT TO WORK
                      </span>
                      <p>{topic.exercise}</p>
                      <small>
                        <strong>Done when:</strong> {topic.doneWhen}
                      </small>
                    </div>
                    <div className="guide-section">
                      <h3>Your reading status</h3>
                      <div className="status-buttons">
                        {(
                          [
                            { id: "not_started", label: "Not started" },
                            { id: "reading", label: "Reading" },
                            { id: "read", label: "Read" },
                          ] as { id: Status; label: string }[]
                        ).map((s) => (
                          <button
                            key={s.id}
                            disabled={!writable || busy}
                            className={
                              (currentProgress?.status ?? "not_started") ===
                              s.id
                                ? "selected"
                                : ""
                            }
                            onClick={() => changeStatus(s.id)}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                      <p className="micro-copy">
                        Reading is self-reported. Mastery comes from a passed
                        knowledge check.
                      </p>
                    </div>
                    <div className="notes-area">
                      <h3>
                        Your notes{" "}
                        <span>{note !== savedNote ? "UNSAVED" : "LOCAL"}</span>
                      </h3>
                      <textarea
                        aria-label="Topic notes"
                        placeholder={
                          writable
                            ? "What clicked? What would you test next?"
                            : "Notes are available in the desktop app."
                        }
                        value={note}
                        disabled={!writable}
                        onChange={(e) => setNote(e.target.value)}
                      />
                      <button
                        className="secondary-button"
                        disabled={!writable || busy || note === savedNote}
                        onClick={saveNote}
                      >
                        Save note
                      </button>
                      <p className="micro-copy">
                        Drafts stay while this app is open. Save to keep notes
                        on disk.
                      </p>
                    </div>
                    <div className="knowledge-check">
                      <div>
                        <Target size={19} />
                        <h3>Check your understanding</h3>
                      </div>
                      <p>
                        {!hasQuiz
                          ? "A curated knowledge check is not available for this topic yet. You can still study, write notes, and record reading."
                          : currentProgress?.mastery === "passed"
                            ? "Passed. Review any time; repeat passes do not farm XP."
                            : "A short, curated check. Earn 100 XP on your first pass. Reading earns 20 XP once."}
                      </p>
                      <button
                        className="primary-button"
                        disabled={!writable || busy || !hasQuiz}
                        onClick={() => startQuiz(topic)}
                      >
                        {hasQuiz
                          ? "Take knowledge check"
                          : "Knowledge check coming later"}
                        <ArrowRight size={16} />
                      </button>
                    </div>
                    <p className="micro-copy">
                      This is a roadmap topic outline, not imported book text or
                      a verified chapter map. PDF highlights and page bookmarks
                      are not implemented in this version.
                    </p>
                  </div>
                </aside>
              </div>
            </>
          )}
        </main>
        <footer className="app-footer">
          <span>
            <span className="footer-dot" /> SILICON QUEST
          </span>
          <span>Build and measure before claiming performance.</span>
          <span>LOCAL FIRST · v0.1</span>
        </footer>
      </div>
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {notice}
        </div>
      )}
      {error && (
        <div className="error-toast" role="alert">
          <span>{error}</span>
          <button
            className="icon-button"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {quiz && (
        <div className="modal-backdrop">
          <section
            className="quiz-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="quiz-title"
          >
            <div className="quiz-header">
              <span className="eyebrow">
                <Target size={14} /> KNOWLEDGE CHECK
              </span>
              <button
                className="icon-button"
                aria-label="Close quiz"
                onClick={() => setQuiz(null)}
              >
                <X size={20} />
              </button>
            </div>
            <h2 id="quiz-title">
              {modules.find((m) => m.id === quiz.topicId)?.title}
            </h2>
            <p className="quiz-intro">
              Think it through. Understanding is more useful than a perfect
              first attempt.
            </p>
            {quiz.questions.length === 0 ? (
              <p>No curated questions are available for this topic yet.</p>
            ) : (
              quiz.questions.map((q, i) => (
                <div className="quiz-question" key={q.id}>
                  <h3>
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    {q.prompt}
                  </h3>
                  {q.options.map((o, j) => (
                    <label
                      key={j}
                      className={`quiz-option ${answers[i] === j ? "chosen" : ""} ${quizResult?.feedback[i]?.correctIndex === j ? "correct" : ""}`}
                    >
                      <input
                        type="radio"
                        name={q.id}
                        checked={answers[i] === j}
                        disabled={!!quizResult || busy}
                        onChange={() =>
                          setAnswers(answers.map((v, k) => (k === i ? j : v)))
                        }
                      />
                      <span>{o}</span>
                      {quizResult?.feedback[i]?.correctIndex === j && (
                        <Check size={16} />
                      )}
                    </label>
                  ))}
                  {quizResult && (
                    <p className="answer-explanation">
                      {quizResult.feedback[i]?.explanation}
                    </p>
                  )}
                </div>
              ))
            )}
            {quizResult ? (
              <div className="quiz-result">
                <div>
                  <strong>
                    {quizResult.attempt.score}/{quizResult.attempt.total} ·{" "}
                    {quizResult.attempt.passed ? "Passed" : "Keep exploring"}
                  </strong>
                  <p>
                    {quizResult.attempt.xpAwarded > 0
                      ? `+${quizResult.attempt.xpAwarded} XP earned. Saved to your local progress.`
                      : "Attempt saved. Review the explanations and return when you are ready."}
                  </p>
                </div>
                <button
                  className="primary-button"
                  onClick={() => setQuiz(null)}
                >
                  Back to learning
                  <ArrowRight size={16} />
                </button>
              </div>
            ) : (
              <button
                className="primary-button quiz-submit"
                disabled={busy || answers.some((a) => a < 0) || !answers.length}
                onClick={submitQuiz}
              >
                {busy ? "Checking…" : "Submit answers"}
                <ArrowRight size={16} />
              </button>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">
          <span className="tiny-line" />
          {eyebrow}
        </div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </div>
  );
}
function Stat({
  icon: Icon,
  label,
  value,
  suffix,
  detail,
  color,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  suffix: string;
  detail: string;
  color: string;
}) {
  return (
    <section className="stat-card">
      <div className="card-topline">
        <span className="eyebrow">{label}</span>
        <Icon size={17} className={`${color}-text`} />
      </div>
      <div className="stat-value">
        {value}
        <span>{suffix}</span>
      </div>
      <p>{detail}</p>
    </section>
  );
}
function BookCover({
  title,
  index,
  mini = false,
}: {
  title: string;
  index: number;
  mini?: boolean;
}) {
  const colors = ["cyan", "orange", "purple", "green"];
  return (
    <div
      className={`book-cover ${colors[index % 4]} ${mini ? "mini" : ""}`}
      aria-hidden="true"
    >
      <div className="book-spine" />
      <div className="cover-top">SYSTEMS / KNOWLEDGE</div>
      <div className="cover-pattern">
        <span />
        <span />
        <span />
        <span />
      </div>
      <strong>{title}</strong>
      <div className="cover-bottom">
        SILICON QUEST READING SERIES <Cpu size={16} />
      </div>
    </div>
  );
}
function FlagIcon() {
  return <CheckCircle2 size={17} />;
}
