"use client";

import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, RotateCcw, X } from "lucide-react";
import { createPortal } from "react-dom";

const EXAMPLE_PROFILE = "natgeo";
const SCENES = [
  {
    id: "setup",
    number: "01",
    title: "Choose the engine and input",
    phases: [
      {
        id: "engine",
        kicker: "First · Scraping engine",
        copy: "Select Server for a quick cloud run.",
        cursor: { x: 76, y: 25 }
      },
      {
        id: "input",
        kicker: "Then · Input type",
        copy: "Choose Profile to collect content from a public Facebook profile.",
        cursor: { x: 65, y: 40 }
      }
    ]
  },
  {
    id: "details",
    number: "02",
    title: "Add the profile and collection",
    phases: [
      {
        id: "typing",
        kicker: "First · Profile input",
        copy: "Enter the username or paste the full public profile link.",
        cursor: { x: 74, y: 53 }
      },
      {
        id: "collection",
        kicker: "Then · Collection",
        copy: "Choose Latest, Range, or Analyze Profile for the result you need.",
        cursor: { x: 70, y: 67 }
      }
    ]
  },
  {
    id: "run",
    number: "03",
    title: "Start and export the results",
    phases: [
      {
        id: "launch",
        kicker: "First · Start scraping",
        copy: "Set the result count and start the live run.",
        cursor: { x: 80, y: 81 }
      },
      {
        id: "results",
        kicker: "Then · Results",
        copy: "Review the finished dataset or export it as JSON or CSV.",
        cursor: { x: 83, y: 26 }
      }
    ]
  }
];

function FacebookScraperVideoGuide({ open, onClose }) {
  const playerRef = useRef(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [sceneCycle, setSceneCycle] = useState(0);
  const [phaseActionDone, setPhaseActionDone] = useState(false);
  const [typedValue, setTypedValue] = useState("");
  const scene = SCENES[stepIndex];
  const phase = scene.phases[phaseIndex];

  useEffect(() => {
    if (!open) return;
    setStepIndex(0);
    setPhaseIndex(0);
    setPhaseActionDone(false);
    setTypedValue("");
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    setPhaseActionDone(false);
    const timers = [];
    let typingTimer;
    let transitionTimer;

    if (phase.id === "typing") {
      setTypedValue("");
      timers.push(window.setTimeout(() => {
        let position = 0;
        typingTimer = window.setInterval(() => {
          position += 1;
          setTypedValue(EXAMPLE_PROFILE.slice(0, position));
          if (position >= EXAMPLE_PROFILE.length) {
            window.clearInterval(typingTimer);
            setPhaseActionDone(true);
            transitionTimer = window.setTimeout(() => setPhaseIndex(1), 520);
          }
        }, 90);
      }, 360));
    } else if (phase.id === "engine") {
      timers.push(window.setTimeout(() => setPhaseActionDone(true), 480));
      transitionTimer = window.setTimeout(() => setPhaseIndex(1), 1250);
    } else if (phase.id === "launch") {
      setTypedValue(EXAMPLE_PROFILE);
      timers.push(window.setTimeout(() => setPhaseActionDone(true), 500));
      transitionTimer = window.setTimeout(() => setPhaseIndex(1), 1300);
    } else {
      if (stepIndex > 0) setTypedValue(EXAMPLE_PROFILE);
      timers.push(window.setTimeout(() => {
        setPhaseActionDone(true);
      }, phase.id === "results" ? 380 : 540));
    }

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      window.clearInterval(typingTimer);
      window.clearTimeout(transitionTimer);
    };
  }, [open, phase.id, sceneCycle, stepIndex]);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => playerRef.current?.focus({ preventScroll: true }));

    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (stepIndex >= SCENES.length - 1) onClose();
        else {
          setPhaseIndex(0);
          setStepIndex((value) => value + 1);
        }
      }
      if (event.key === "ArrowLeft" && stepIndex > 0) {
        event.preventDefault();
        setPhaseIndex(0);
        setStepIndex((value) => value - 1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.({ preventScroll: true });
    };
  }, [onClose, open, stepIndex]);

  if (!open || typeof document === "undefined") return null;

  const serverSelected = stepIndex > 0 || phaseIndex > 0 || (phase.id === "engine" && phaseActionDone);
  const profileSelected = stepIndex > 0 || (phase.id === "input" && phaseActionDone);
  const latestSelected = stepIndex > 1 || (phase.id === "collection" && phaseActionDone);
  const startPressed = phase.id === "launch" && phaseActionDone;
  const showResults = phase.id === "results";

  const moveBack = () => {
    if (stepIndex > 0) {
      setPhaseIndex(0);
      setStepIndex((value) => value - 1);
    }
  };

  const moveNext = () => {
    if (stepIndex >= SCENES.length - 1) {
      onClose();
      return;
    }
    setPhaseIndex(0);
    setStepIndex((value) => value + 1);
  };

  const replayScene = () => {
    setPhaseIndex(0);
    setSceneCycle((value) => value + 1);
  };

  return createPortal(
    <div className="facebook-film-overlay">
      <section
        ref={playerRef}
        className="facebook-film-player facebook-film-step-player"
        role="dialog"
        aria-modal="true"
        aria-label="Facebook scraper step-by-step guide"
        tabIndex={-1}
      >
        <header className="facebook-film-header">
          <div className="facebook-film-brand">
            <span aria-hidden="true">f</span>
            <div>
              <strong>Facebook Scraper</strong>
              <small>Step-by-step interactive guide</small>
            </div>
          </div>
          <div className="facebook-film-header-progress" aria-label={`Step ${stepIndex + 1} of ${SCENES.length}`}>
            <span>{stepIndex + 1} of {SCENES.length}</span>
            <div>{SCENES.map((item, index) => <i key={item.id} className={index <= stepIndex ? "is-complete" : ""} />)}</div>
          </div>
          <button type="button" className="facebook-film-close" onClick={onClose} aria-label="Close Facebook guide">
            <X size={19} aria-hidden="true" />
          </button>
        </header>

        <div className="facebook-film-stage">
          <div className="facebook-film-browserbar" aria-hidden="true">
            <div><i /><i /><i /></div>
            <span>agenticthat.com/scraper/facebook</span>
            <b>Secure</b>
          </div>

          <div className={`facebook-film-screen scene-${scene.id} phase-${phase.id}`} key={`${scene.id}-${sceneCycle}`}>
            <aside className="facebook-film-intro">
              <span>Facebook intelligence</span>
              <h2>Facebook<br />scraper</h2>
              <p>Public post and Reel data.</p>
            </aside>

            <div className="facebook-film-demo">
              {!showResults ? (
                <div className="facebook-film-form">
                  <section className={phase.id === "engine" ? "is-film-focus" : ""}>
                    <label>Choose scraping engine</label>
                    <div className="facebook-film-engine">
                      <button type="button" className={serverSelected ? "is-selected" : ""} tabIndex={-1}>
                        <strong>Server</strong><span>Runs in the cloud</span>
                      </button>
                      <button type="button" tabIndex={-1}><strong>Local Companion</strong><span>Runs privately here</span></button>
                    </div>
                  </section>

                  <section className={phase.id === "input" ? "is-film-focus" : ""}>
                    <label>Choose input type</label>
                    <div className="facebook-film-types">
                      <button type="button" className={profileSelected ? "is-selected" : ""} tabIndex={-1}><i>f</i> Profile</button>
                      <button type="button" tabIndex={-1}><i>#</i> Keyword</button>
                      <button type="button" tabIndex={-1}><i>P</i> Profile URL</button>
                      <button type="button" tabIndex={-1}><i>POST</i> Post URL</button>
                    </div>
                  </section>

                  <section className={`facebook-film-query ${profileSelected ? "is-revealed" : "is-concealed"} ${phase.id === "typing" ? "is-film-focus" : ""}`}>
                    <label>Page or public profile username</label>
                    <div><span>@</span><b>{typedValue}</b>{phase.id === "typing" && <i />}</div>
                  </section>

                  <section className={phase.id === "collection" ? "is-film-focus" : ""}>
                    <label>Choose collection</label>
                    <div className="facebook-film-collections">
                      <button type="button" className={latestSelected ? "is-selected" : ""} tabIndex={-1}>Latest</button>
                      <button type="button" tabIndex={-1}>Range</button>
                      <button type="button" tabIndex={-1}>Analyze Profile</button>
                    </div>
                  </section>

                  <section className={`facebook-film-launch ${phase.id === "launch" ? "is-film-focus" : ""}`}>
                    <div><label>Results per ranking</label><b>10</b></div>
                    <button type="button" className={startPressed ? "is-pressed" : ""} tabIndex={-1}>Start Scraping</button>
                  </section>
                </div>
              ) : (
                <div className="facebook-film-results facebook-film-results-step">
                  <header>
                    <div><span>Dataset ready · Server</span><strong>@natgeo</strong></div>
                    <div className="is-film-focus"><button type="button" tabIndex={-1}>New Search</button><button type="button" tabIndex={-1}>JSON</button><button type="button" tabIndex={-1}>CSV</button></div>
                  </header>
                  <div className="facebook-film-metrics">
                    <article><span>Posts collected</span><strong>10</strong><i /></article>
                    <article><span>Total reactions</span><strong>248K</strong><i /></article>
                    <article><span>Comments</span><strong>8.4K</strong><i /></article>
                  </div>
                  <div className="facebook-film-table">
                    {["Reel · Wildlife story", "Post · Photo feature", "Video · Field journal"].map((label, index) => (
                      <div key={label}><span>{index + 1}</span><i /><strong>{label}</strong><b>{["84K", "63K", "41K"][index]}</b></div>
                    ))}
                  </div>
                  <div className="facebook-film-ready">
                    <Check size={18} aria-hidden="true" />
                    <span><strong>Your results are ready</strong><small>Review the data or export it whenever you need.</small></span>
                  </div>
                </div>
              )}

              <div
                className="facebook-film-cursor"
                style={{ "--cursor-x": `${phase.cursor.x}%`, "--cursor-y": `${phase.cursor.y}%` }}
                aria-hidden="true"
              >
                <svg width="25" height="29" viewBox="0 0 25 29" fill="none">
                  <path d="M3 2.5L21.4 18.2L13.4 19.6L9.2 26.4L3 2.5Z" fill="white" stroke="#122033" strokeWidth="1.8" strokeLinejoin="round" />
                </svg>
                <i key={phase.id} />
              </div>
            </div>

            <div className="facebook-film-caption" key={`caption-${phase.id}`}>
              <span>{scene.number}</span>
              <div><small>{phase.kicker}</small><strong>{scene.title}</strong><p>{phase.copy}</p></div>
            </div>
          </div>
        </div>

        <footer className="facebook-film-controls facebook-film-step-controls">
          <div>
            <button type="button" onClick={moveBack} disabled={stepIndex === 0}>
              <ArrowLeft size={16} aria-hidden="true" /> Back
            </button>
            <button type="button" onClick={replayScene}>
              <RotateCcw size={15} aria-hidden="true" /> Replay screen
            </button>
          </div>
          <div>
            <button type="button" className="facebook-film-skip" onClick={onClose}>Skip guide</button>
            <button type="button" className="facebook-film-done" onClick={moveNext}>
              {stepIndex === SCENES.length - 1 ? "Finish guide" : "Next"}
              {stepIndex === SCENES.length - 1 ? <Check size={16} aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body
  );
}

export default FacebookScraperVideoGuide;
