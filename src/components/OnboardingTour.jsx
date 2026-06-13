import { useState } from 'react';

export const TOUR_KEY = 'bbae_tour_seen_v1';

const STEPS = [
  {
    icon: '✈️',
    title: 'Welcome to Bastian Boys Airline Empires',
    body: "You've founded your airline with $10 million in startup capital — but that's a loan, not a gift. Your mission: build a profitable route network before the debt catches up.",
    highlight: null,
  },
  {
    icon: '🎯',
    title: 'What You\'re Trying to Do',
    body: "Every week you collect ticket revenue. Every week costs come out — fuel, crew, leases, loan repayments. Stay profitable, grow your network, and outlast the competition.",
    highlight: null,
  },
  {
    icon: '🛒',
    title: 'Step 1 — Get an Aircraft',
    body: 'Open the Market tab. Lease a Turboprop or Regional Jet to start — they\'re cheap to run with low commitment. You can order larger aircraft later once you have capital.',
    highlight: 'Market',
  },
  {
    icon: '🗺️',
    title: 'Step 2 — Open a Route',
    body: "Go to Routes → New Route. Pick two airports, assign your aircraft, and set a ticket price. You already have a gate at your hub — you'll need to buy one at your destination first.",
    highlight: 'Routes',
  },
  {
    icon: '⏩',
    title: 'Step 3 — Advance the Week',
    body: "Hit Next Week in the top bar to fly your routes and collect revenue. The game also auto-advances every hour. Check your Dashboard after each week — it shows alerts when something needs attention.",
    highlight: 'Next Week',
  },
  {
    icon: '💀',
    title: 'How You Go Bankrupt',
    body: "Two ways to lose:\n• Miss 3 loan payments (cash goes negative on a week when loans are due)\n• Stay cash-negative for 6 consecutive weeks\n\nWatch Finance. Manage your debt early. Warning toasts will appear before either limit is reached.",
    highlight: 'Finance',
  },
  {
    icon: '🏆',
    title: "You're Ready to Fly",
    body: "That's everything you need to know. Good luck — the skies are competitive.\n\nYou can reopen this guide anytime with the ? button in the top bar.",
    highlight: null,
    last: true,
  },
];

export default function OnboardingTour({ onClose }) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  function handleNext() {
    if (isLast) {
      markSeen();
      onClose();
    } else {
      setStep(s => s + 1);
    }
  }

  function handleBack() {
    setStep(s => Math.max(0, s - 1));
  }

  function handleSkip() {
    markSeen();
    onClose();
  }

  function markSeen() {
    try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) {}
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.78)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 10000,
      padding: 24,
      backdropFilter: 'blur(2px)',
    }}>
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 18,
        padding: '36px 36px 28px',
        maxWidth: 480,
        width: '100%',
        position: 'relative',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
      }}>
        {/* Step counter */}
        <div style={{
          position: 'absolute', top: 18, right: 22,
          fontSize: 11, color: 'var(--text-dim)',
          fontFamily: 'monospace', letterSpacing: '0.5px',
        }}>
          {step + 1} / {STEPS.length}
        </div>

        {/* Icon */}
        <div style={{ fontSize: 46, marginBottom: 18, lineHeight: 1 }}>
          {current.icon}
        </div>

        {/* Title */}
        <div style={{
          fontSize: 20, fontWeight: 700, marginBottom: 14,
          lineHeight: 1.3, color: 'var(--text)',
        }}>
          {current.title}
        </div>

        {/* Body */}
        <div style={{
          fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.75,
          whiteSpace: 'pre-line', marginBottom: current.highlight ? 16 : 28,
          minHeight: 80,
        }}>
          {current.body}
        </div>

        {/* Highlight tag */}
        {current.highlight && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '5px 14px', borderRadius: 20, marginBottom: 24,
            background: 'var(--accent-dim)',
            border: '1px solid var(--accent)',
            fontSize: 12, color: 'var(--accent)', fontWeight: 600,
          }}>
            Look for: {current.highlight} →
          </div>
        )}

        {/* Progress dots */}
        <div style={{ display: 'flex', gap: 5, marginBottom: 24, alignItems: 'center' }}>
          {STEPS.map((_, i) => (
            <div
              key={i}
              onClick={() => setStep(i)}
              style={{
                width: i === step ? 22 : 7,
                height: 7,
                borderRadius: 4,
                background: i === step
                  ? 'var(--accent)'
                  : i < step
                  ? 'var(--accent-dim)'
                  : 'var(--surface3)',
                transition: 'width 0.25s ease, background 0.2s',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            />
          ))}
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!isLast && (
            <button
              onClick={handleSkip}
              style={{
                background: 'none', border: 'none',
                color: 'var(--text-dim)', cursor: 'pointer',
                fontSize: 12, padding: '8px 10px', borderRadius: 8,
                marginRight: 'auto',
              }}
            >
              Skip tour
            </button>
          )}
          {step > 0 && (
            <button
              onClick={handleBack}
              className="btn"
              style={{ padding: '8px 16px', fontSize: 13 }}
            >
              ← Back
            </button>
          )}
          <button
            onClick={handleNext}
            className="btn btn-primary"
            style={{ padding: '9px 22px', fontSize: 13, fontWeight: 600, marginLeft: isLast ? 'auto' : 0 }}
          >
            {isLast ? "Let's Go! 🚀" : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  );
}
