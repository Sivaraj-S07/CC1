import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ListChecks, Clock, Users, ArrowRight, Sparkles } from "lucide-react";
import Badge from "../../components/ui/Badge";
import Skeleton from "../../components/ui/Skeleton";
import { useToast } from "../../components/ui/Toast";
import { apiFetch, ApiError } from "../../lib/api";
import StudentTutorial, { hasSeenStudentTutorial } from "../../components/StudentTutorial";

const STATUS_TONE = { upcoming: "upcoming", live: "live", completed: "completed" };

export default function Landing() {
  const { push } = useToast();
  const [quizzes, setQuizzes] = useState([]);
  const [loading, setLoading] = useState(true);
  // First-visit tutorial: shown once, stays up while quizzes load behind it.
  const [showTutorial, setShowTutorial] = useState(false);

  useEffect(() => {
    setShowTutorial(!hasSeenStudentTutorial());
  }, []);

  useEffect(() => {
    apiFetch("/quizzes")
      .then((data) => setQuizzes(data.quizzes))
      .catch((err) => push(err instanceof ApiError ? err.message : "Failed to load quizzes", "error"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {showTutorial && (
        <StudentTutorial dataLoading={loading} onFinish={() => setShowTutorial(false)} />
      )}
      <div className="mx-auto max-w-7xl px-5 py-10 lg:px-8">
      <div className="glass-panel relative overflow-hidden p-8 sm:p-12">
        <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-electric/20 blur-3xl" />
        <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-violet/20 blur-3xl" />
        <div className="relative">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-electric/10 px-3 py-1 text-[11px] font-medium text-electric-light">
            <Sparkles className="h-3 w-3" /> College Quiz & Assessment Platform
          </span>
          <h1 className="mt-4 max-w-xl font-display text-3xl font-semibold text-ink-100 sm:text-4xl">
            Prove your skills in real time.
          </h1>
          <p className="mt-3 max-w-lg text-sm text-ink-500">
            Join a live quiz with your class, track your score instantly, and see how you rank against your peers.
          </p>
        </div>
      </div>

      <h2 className="mt-10 mb-4 font-display text-lg font-semibold text-ink-100">Available quizzes</h2>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-2xl" />
          ))}
        </div>
      ) : quizzes.length === 0 ? (
        <div className="glass-card p-10 text-center text-sm text-ink-500">No quizzes are published yet. Check back soon.</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {quizzes.map((q) => (
            <div key={q.id} className="glass-card flex flex-col p-5">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display text-base font-semibold text-ink-100 leading-snug">{q.title}</h3>
                <Badge tone={STATUS_TONE[q.status] || "upcoming"} dot={q.status === "live"}>
                  {q.status}
                </Badge>
              </div>
              <p className="mt-1.5 line-clamp-2 flex-1 text-xs text-ink-500">{q.description || "No description provided."}</p>
              <div className="mt-4 flex items-center gap-4 text-xs text-ink-500">
                <span className="flex items-center gap-1"><ListChecks className="h-3.5 w-3.5" /> {q.questionCount} Qs</span>
                <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {q.durationMinutes}m</span>
                <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {q.participantCount}</span>
              </div>
              <Link
                to={`/login/${q.id}`}
                className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-electric-light to-electric px-4 py-2.5 text-sm font-semibold text-void shadow-glow transition-all hover:brightness-110 hover:-translate-y-0.5"
              >
                Join quiz <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ))}
        </div>
      )}
      </div>
    </>
  );
}
